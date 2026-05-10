const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { analyzeAdjacentDuplicates } = require("./src/duplicates");
const { exportLossless } = require("./src/exporter");
const { loadGifInfo } = require("./src/gif-info");
const { sendError, sendJson, readJson, sendStatic } = require("./src/http-utils");
const { createProject, markDuplicateFrames, normalizeProject } = require("./src/project");
const { ensurePreview } = require("./src/preview");
const { rootDir, ensureRuntimeDirs, assertInsideRoot } = require("./src/paths");
const { checkRequiredTools } = require("./src/tools");

const projects = new Map();

function listSources() {
  return fs.readdirSync(rootDir)
    .filter((name) => name.toLowerCase().endsWith(".gif"))
    .map((name) => {
      const filePath = path.join(rootDir, name);
      const stat = fs.statSync(filePath);
      return { name, bytes: stat.size };
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
    const sourcePath = assertInsideRoot(path.join(rootDir, body.name || ""));
    const source = await loadGifInfo(sourcePath);
    const project = createProject(source);
    projects.set(project.id, project);
    sendJson(res, 200, { project });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/frame/")) {
    const [, , , projectId, frameText] = url.pathname.split("/");
    const project = projects.get(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const frameIndex = Number(frameText);
    const maxSize = Number(url.searchParams.get("max") || "900");
    const previewPath = await ensurePreview(project.source, frameIndex, maxSize);
    res.writeHead(200, { "content-type": "image/jpeg" });
    fs.createReadStream(previewPath).pipe(res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze-duplicates") {
    const body = await readJson(req);
    const project = normalizeProject(body.project);
    const slice = project.slices.find((item) => item.id === body.sliceId);
    if (!slice) throw new Error(`Unknown slice: ${body.sliceId}`);
    const analysis = await analyzeAdjacentDuplicates(project.source, slice.start, slice.end);
    const updated = markDuplicateFrames(project, slice.id, analysis.duplicateFrames);
    projects.set(updated.id, updated);
    sendJson(res, 200, { project: updated, analysis });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/export") {
    const body = await readJson(req);
    const project = normalizeProject(body.project);
    const exported = await exportLossless(project);
    sendJson(res, 200, exported);
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

module.exports = { listSources, handleApi, handle };
