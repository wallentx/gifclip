const fs = require("node:fs");
const http = require("node:http");
const { URL } = require("node:url");
const { createDuplicateJobStore } = require("./src/duplicate-jobs");
const { createExportJobStore } = require("./src/export-jobs");
const { exportLossless } = require("./src/exporter");
const { loadGifInfo } = require("./src/gif-info");
const { sendError, sendJson, readBody, readJson, sendStatic } = require("./src/http-utils");
const { blueprintFromProject, projectFromBlueprint, sourceMatchesBlueprint } = require("./src/blueprints");
const { createProject, normalizeProject } = require("./src/project");
const { cachedPreviewRanges, ensurePreview, ensurePreviewRange } = require("./src/preview");
const { ensureRuntimeDirs } = require("./src/paths");
const { listSources, resolveSource, saveUploadedSource } = require("./src/sources");
const { checkRequiredTools } = require("./src/tools");

const projects = new Map();
const duplicateJobs = createDuplicateJobStore();
const exportJobs = createExportJobStore({ exportLossless });
const MIN_PREVIEW_SIZE = 120;
const MAX_PREVIEW_SIZE = 1200;
const DEFAULT_PREVIEW_WINDOW_FRAMES = 121;
const MAX_PREVIEW_WINDOW_FRAMES = 241;

function projectFromRequest(clientProject) {
  if (!clientProject || typeof clientProject.id !== "string") {
    throw new Error("Project id is required");
  }
  const trusted = projects.get(clientProject.id);
  if (!trusted) {
    throw new Error(`Unknown project: ${clientProject.id}`);
  }
  return {
    ...clientProject,
    id: trusted.id,
    source: trusted.source
  };
}

function previewSize(value) {
  const size = Number(value || "900");
  if (!Number.isFinite(size)) {
    return 900;
  }
  return Math.max(MIN_PREVIEW_SIZE, Math.min(MAX_PREVIEW_SIZE, Math.trunc(size)));
}

function previewWindowFrames(value) {
  const size = Number(value || DEFAULT_PREVIEW_WINDOW_FRAMES);
  if (!Number.isFinite(size)) {
    return DEFAULT_PREVIEW_WINDOW_FRAMES;
  }
  return Math.max(1, Math.min(MAX_PREVIEW_WINDOW_FRAMES, Math.trunc(size)));
}

async function loadProjectFromSourceId(sourceId) {
  const source = await loadGifInfo(resolveSource(sourceId));
  const project = createProject(source);
  projects.set(project.id, project);
  return project;
}

async function findProjectForBlueprint(blueprint) {
  for (const sourceEntry of listSources()) {
    const source = await loadGifInfo(resolveSource(sourceEntry.id));
    if (sourceMatchesBlueprint(source, blueprint.source)) {
      const project = projectFromBlueprint(source, blueprint);
      projects.set(project.id, project);
      return project;
    }
  }
  throw new Error("No loaded source matches this blueprint");
}

function responseAbortSignal(res) {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });
  return controller.signal;
}

async function resolveFramePreviewPath(project, frameIndex, maxSize, options = {}) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= project.source.frameCount) {
    throw new Error(`Preview frame is outside source range: ${frameIndex}`);
  }
  const preview = options.ensurePreview || ensurePreview;
  return preview(project.source, frameIndex, maxSize, {
    priority: "high",
    signal: options.signal
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/sources") {
    sendJson(res, 200, { sources: listSources() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/load") {
    const body = await readJson(req);
    const project = await loadProjectFromSourceId(body.sourceId || body.name);
    sendJson(res, 200, { project });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upload") {
    const buffer = await readBody(req, { maxBytes: 512 * 1024 * 1024 });
    const uploadPath = await saveUploadedSource(url.searchParams.get("name"), buffer);
    try {
      const source = await loadGifInfo(uploadPath);
      const project = createProject(source);
      projects.set(project.id, project);
      sendJson(res, 201, { project, source });
    } catch (error) {
      fs.rmSync(uploadPath, { force: true });
      throw error;
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/frame/")) {
    const [, , , projectId, frameText] = url.pathname.split("/");
    const project = projects.get(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const frameIndex = Number(frameText);
    const maxSize = previewSize(url.searchParams.get("max"));
    const previewPath = await resolveFramePreviewPath(project, frameIndex, maxSize, {
      signal: responseAbortSignal(res)
    });
    res.writeHead(200, { "content-type": "image/jpeg" });
    fs.createReadStream(previewPath).pipe(res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/prewarm-preview") {
    const body = await readJson(req);
    const project = projectFromRequest(body.project);
    const maxSize = previewSize(body.max);
    const range = await ensurePreviewRange(project.source, Number(body.start), Number(body.end), maxSize, {
      center: Number(body.center),
      maxFrames: previewWindowFrames(body.maxFrames),
      signal: responseAbortSignal(res)
    });
    sendJson(res, 200, {
      start: range.start,
      end: range.end,
      count: range.count,
      generated: range.generated,
      generatedRanges: range.generatedRanges
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/preview-cache/status") {
    const body = await readJson(req);
    const project = projectFromRequest(body.project);
    const maxSize = previewSize(body.max);
    sendJson(res, 200, cachedPreviewRanges(project.source, Number(body.start), Number(body.end), maxSize));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze-duplicates/start") {
    const body = await readJson(req);
    const project = normalizeProject(projectFromRequest(body.project));
    const slice = project.slices.find((item) => item.id === body.sliceId);
    if (!slice) throw new Error(`Unknown slice: ${body.sliceId}`);
    const job = duplicateJobs.start(project, slice, (updated) => {
      projects.set(updated.id, updated);
    });
    sendJson(res, 202, { job });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/analyze-duplicates/status/")) {
    const [, , , , jobId] = url.pathname.split("/");
    const job = duplicateJobs.get(jobId);
    if (!job) throw new Error(`Unknown duplicate-analysis job: ${jobId}`);
    sendJson(res, 200, { job });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/export") {
    const body = await readJson(req);
    const project = projectFromRequest(body.project);
    const exported = await exportLossless(project);
    sendJson(res, 200, exported);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/export/start") {
    const body = await readJson(req);
    const project = projectFromRequest(body.project);
    const job = exportJobs.start(project);
    sendJson(res, 202, { job });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/blueprint/export") {
    const body = await readJson(req);
    const project = normalizeProject(projectFromRequest(body.project));
    sendJson(res, 200, { blueprint: blueprintFromProject(project) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/blueprint/load") {
    const body = await readJson(req);
    const blueprint = body.blueprint;
    let project;
    if (body.sourceId || body.name) {
      const source = await loadGifInfo(resolveSource(body.sourceId || body.name));
      project = projectFromBlueprint(source, blueprint);
      projects.set(project.id, project);
    } else {
      project = await findProjectForBlueprint(blueprint);
    }
    sendJson(res, 200, { project });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/export/status/")) {
    const [, , , , jobId] = url.pathname.split("/");
    const job = exportJobs.get(jobId);
    if (!job) throw new Error(`Unknown export job: ${jobId}`);
    sendJson(res, 200, { job });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function handle(req, res) {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    if (!sendStatic(req, res)) {
      sendJson(res, 404, { error: "Not found" });
    }
  } catch (error) {
    sendError(res, 400, error);
  }
}

function main() {
  checkRequiredTools();
  ensureRuntimeDirs();
  const port = Number(process.env.PORT || "8787");
  const server = http.createServer(handle);
  server.listen(port, "127.0.0.1", () => {
    console.log(`gifclip listening on http://127.0.0.1:${port}`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { listSources, resolveFramePreviewPath, handleApi, handle };
