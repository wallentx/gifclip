const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { buildFramePlan } = require("./project");
const { runTool } = require("./tools");
const { tmpDir, exportsDir, ensureDir } = require("./paths");

function frameSelector(start, end) {
  return start === end ? `#${start}` : `#${start}-${end}`;
}

function frameSelectionArgs(frames) {
  if (frames.length === 0) {
    return [];
  }

  const selectors = [];
  let start = frames[0].sourceIndex;
  let end = start;

  for (const frame of frames.slice(1)) {
    if (frame.sourceIndex === end + 1) {
      end = frame.sourceIndex;
      continue;
    }
    selectors.push(frameSelector(start, end));
    start = frame.sourceIndex;
    end = frame.sourceIndex;
  }

  selectors.push(frameSelector(start, end));
  return selectors;
}

function delayGroups(frames) {
  if (frames.length === 0) {
    return [];
  }

  const groups = [];
  let start = 0;
  let delayCs = frames[0].delayCs;

  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index].delayCs === delayCs) {
      continue;
    }
    groups.push({ start, end: index - 1, delayCs });
    start = index;
    delayCs = frames[index].delayCs;
  }

  groups.push({ start, end: frames.length - 1, delayCs });
  return groups;
}

function delayBatchArgs(frames) {
  return delayGroups(frames).flatMap((group) => [
    "--delay",
    String(group.delayCs),
    frameSelector(group.start, group.end)
  ]);
}

function containsEdit(slice, key) {
  const value = slice[key];
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

function exportModeForProject(project) {
  const slices = Array.isArray(project && project.slices) ? project.slices : [];
  for (const slice of slices) {
    if (containsEdit(slice, "overlays")) {
      throw new Error("Lossless v1 export does not support overlays");
    }
    if (containsEdit(slice, "inserts")) {
      throw new Error("Lossless v1 export does not support inserts");
    }
  }
  return "lossless-native";
}

function outputName(prefix) {
  const safePrefix = String(prefix || "gifclip")
    .replace(/\.gif$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${safePrefix || "gifclip"}-${Date.now()}-${randomUUID()}.gif`;
}

async function exportLossless(project) {
  const mode = exportModeForProject(project);
  const plan = buildFramePlan(project);
  ensureDir(tmpDir);
  ensureDir(exportsDir);

  const tempPath = path.join(tmpDir, outputName("gifclip-temp"));
  const outputPath = path.join(exportsDir, outputName(project.source && project.source.basename));

  try {
    await runTool("gifsicle", [
      plan.sourcePath,
      ...frameSelectionArgs(plan.frames),
      "--output",
      tempPath
    ]);
    await runTool("gifsicle", ["--batch", tempPath, ...delayBatchArgs(plan.frames)]);
    await runTool("gifsicle", ["--optimize=2", tempPath, "--output", outputPath]);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }

  return {
    mode,
    frameCount: plan.frames.length,
    outputPath,
    href: `/exports/${path.basename(outputPath)}`
  };
}

module.exports = {
  frameSelectionArgs,
  delayGroups,
  delayBatchArgs,
  exportModeForProject,
  exportLossless
};
