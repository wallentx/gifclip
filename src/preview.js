const fs = require("node:fs");
const path = require("node:path");
const { previewCacheDir, ensureDir } = require("./paths");
const { runTool } = require("./tools");

const inflightPreviews = new Map();
let previewQueue = Promise.resolve();

function previewCachePath(source, frameIndex, maxSize) {
  const safeHash = source.sha256.slice(0, 16);
  return path.join(previewCacheDir, `${safeHash}-${frameIndex}-${maxSize}.jpg`);
}

function ffmpegPreviewArgs(sourcePath, frameIndex, maxSize, outputPath) {
  const select = `select=eq(n\\,${frameIndex})`;
  const scale = `scale='if(gte(iw,ih),min(${maxSize},iw),-2)':'if(gte(ih,iw),min(${maxSize},ih),-2)'`;
  return [
    "-v",
    "error",
    "-i",
    sourcePath,
    "-vf",
    `${select},${scale}`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-y",
    outputPath
  ];
}

function boundedPreviewRange(start, end, frameCount, maxFrames, center) {
  const safeFrameCount = Math.max(1, Math.trunc(frameCount) || 1);
  const safeMaxFrames = Math.max(1, Math.trunc(maxFrames) || 1);
  const safeStart = Math.min(Math.max(Math.trunc(start) || 0, 0), safeFrameCount - 1);
  const requestedEnd = Number.isFinite(end) ? Math.trunc(end) : safeStart;
  const safeEnd = Math.min(Math.max(requestedEnd, safeStart), safeFrameCount - 1);

  if (Number.isFinite(center)) {
    const radius = Math.floor((safeMaxFrames - 1) / 2);
    const marker = Math.min(Math.max(Math.trunc(center), safeStart), safeEnd);
    const markerStart = Math.max(safeStart, marker - radius);
    const markerEnd = Math.min(safeEnd, marker + radius);
    return { start: markerStart, end: markerEnd, count: markerEnd - markerStart + 1 };
  }

  const boundedEnd = Math.min(safeEnd, safeStart + safeMaxFrames - 1);
  return { start: safeStart, end: boundedEnd, count: boundedEnd - safeStart + 1 };
}

function ffmpegPreviewRangeArgs(sourcePath, start, end, maxSize, outputPattern) {
  const count = Math.max(1, end - start + 1);
  const select = `select=between(n\\,${start}\\,${end})`;
  const scale = `scale='if(gte(iw,ih),min(${maxSize},iw),-2)':'if(gte(ih,iw),min(${maxSize},ih),-2)'`;
  return [
    "-v",
    "error",
    "-i",
    sourcePath,
    "-vf",
    `${select},${scale}`,
    "-fps_mode",
    "passthrough",
    "-frames:v",
    String(count),
    "-q:v",
    "3",
    "-y",
    outputPattern
  ];
}

async function ensurePreview(source, frameIndex, maxSize = 900) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= source.frameCount) {
    throw new Error(`Preview frame is outside source range: ${frameIndex}`);
  }

  ensureDir(previewCacheDir);
  const outputPath = previewCachePath(source, frameIndex, maxSize);
  if (!fs.existsSync(outputPath)) {
    if (!inflightPreviews.has(outputPath)) {
      const pending = previewQueue.then(() =>
        fs.existsSync(outputPath)
          ? undefined
          : runTool("ffmpeg", ffmpegPreviewArgs(source.sourcePath, frameIndex, maxSize, outputPath))
      );
      inflightPreviews.set(outputPath, pending.finally(() => inflightPreviews.delete(outputPath)));
      previewQueue = pending.catch(() => {});
    }
    await inflightPreviews.get(outputPath);
  }
  return outputPath;
}

async function ensurePreviewRange(source, start, end, maxSize = 900, options = {}) {
  const range = boundedPreviewRange(start, end, source.frameCount, options.maxFrames || 60, options.center);
  ensureDir(previewCacheDir);

  const outputPaths = [];
  for (let frame = range.start; frame <= range.end; frame += 1) {
    outputPaths.push(previewCachePath(source, frame, maxSize));
  }

  if (outputPaths.every((outputPath) => fs.existsSync(outputPath))) {
    return { ...range, generated: 0, outputPaths };
  }

  const run = options.runTool || runTool;
  const tempDir = fs.mkdtempSync(path.join(previewCacheDir, ".range-"));
  const outputPattern = path.join(tempDir, "frame-%06d.jpg");

  try {
    const pending = previewQueue.then(() =>
      run("ffmpeg", ffmpegPreviewRangeArgs(source.sourcePath, range.start, range.end, maxSize, outputPattern))
    );
    previewQueue = pending.catch(() => {});
    await pending;

    for (let index = 0; index < outputPaths.length; index += 1) {
      const tempPath = path.join(tempDir, `frame-${String(index + 1).padStart(6, "0")}.jpg`);
      if (!fs.existsSync(tempPath)) {
        throw new Error(`Expected preview frame was not generated: ${tempPath}`);
      }
      fs.renameSync(tempPath, outputPaths[index]);
    }

    return { ...range, generated: outputPaths.length, outputPaths };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  boundedPreviewRange,
  ffmpegPreviewRangeArgs,
  previewCachePath,
  ffmpegPreviewArgs,
  ensurePreview,
  ensurePreviewRange
};
