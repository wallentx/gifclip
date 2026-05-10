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

module.exports = {
  previewCachePath,
  ffmpegPreviewArgs,
  ensurePreview
};
