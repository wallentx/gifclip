const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { tmpDir } = require("./paths");
const { runTool } = require("./tools");

function scaleFilter(maxSize) {
  return `scale='if(gte(iw,ih),min(${maxSize},iw),-2)':'if(gte(ih,iw),min(${maxSize},ih),-2)'`;
}

function benchmarkFrameRange(start, count, frameCount) {
  const safeFrameCount = Math.max(1, Math.trunc(frameCount) || 1);
  const safeStart = Math.min(Math.max(Math.trunc(start) || 0, 0), safeFrameCount - 1);
  const safeCount = Math.max(1, Math.trunc(count) || 1);
  const end = Math.min(safeFrameCount - 1, safeStart + safeCount - 1);
  return { start: safeStart, end, count: end - safeStart + 1 };
}

function singlePreviewArgs(sourcePath, frameIndex, maxSize, outputPath) {
  return [
    "-v",
    "error",
    "-i",
    sourcePath,
    "-vf",
    `select=eq(n\\,${frameIndex}),${scaleFilter(maxSize)}`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-y",
    outputPath
  ];
}

function batchPreviewArgs(sourcePath, start, end, maxSize, outputPattern) {
  const count = Math.max(1, end - start + 1);
  return [
    "-v",
    "error",
    "-i",
    sourcePath,
    "-vf",
    `select=between(n\\,${start}\\,${end}),${scaleFilter(maxSize)}`,
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

function outputBytes(dir) {
  return fs.readdirSync(dir)
    .filter((name) => /\.(?:jpg|jpeg|webp|png)$/i.test(name))
    .reduce((total, name) => total + fs.statSync(path.join(dir, name)).size, 0);
}

function outputCount(dir) {
  return fs.readdirSync(dir).filter((name) => /\.(?:jpg|jpeg|webp|png)$/i.test(name)).length;
}

async function timed(fn) {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

async function benchmarkSingleFrameExtraction(source, frameRange, maxSize, outputDir) {
  resetDir(outputDir);
  const result = await timed(async () => {
    for (let frame = frameRange.start; frame <= frameRange.end; frame += 1) {
      const outputPath = path.join(outputDir, `${String(frame).padStart(6, "0")}.jpg`);
      await runTool("ffmpeg", singlePreviewArgs(source.sourcePath, frame, maxSize, outputPath));
    }
  });

  return { ms: result.ms, bytes: outputBytes(outputDir), frames: outputCount(outputDir), outputDir };
}

async function benchmarkBatchExtraction(source, frameRange, maxSize, outputDir) {
  resetDir(outputDir);
  const outputPattern = path.join(outputDir, "frame-%06d.jpg");
  const result = await timed(() =>
    runTool("ffmpeg", batchPreviewArgs(source.sourcePath, frameRange.start, frameRange.end, maxSize, outputPattern))
  );

  return { ms: result.ms, bytes: outputBytes(outputDir), frames: outputCount(outputDir), outputDir };
}

async function benchmarkCachedReads(outputDir) {
  const files = fs.readdirSync(outputDir)
    .filter((name) => /\.(?:jpg|jpeg|webp|png)$/i.test(name))
    .map((name) => path.join(outputDir, name));
  const result = await timed(async () => {
    for (const file of files) {
      await fs.promises.stat(file);
    }
  });
  return { ms: result.ms, frames: files.length };
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function summarizeBenchmark({ frameRange, singleMs, batchMs, cachedReadMs, singleBytes, batchBytes }) {
  return {
    frames: frameRange.count,
    single: {
      totalMs: round(singleMs),
      perFrameMs: round(singleMs / frameRange.count),
      bytes: singleBytes
    },
    batch: {
      totalMs: round(batchMs),
      perFrameMs: round(batchMs / frameRange.count),
      speedupVsSingle: round(singleMs / batchMs, 2),
      bytes: batchBytes
    },
    cachedRead: {
      totalMs: round(cachedReadMs),
      perFrameMs: round(cachedReadMs / frameRange.count)
    }
  };
}

function benchmarkRoot(label) {
  const safeLabel = String(label || "preview")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return path.join(tmpDir, "benchmarks", `${safeLabel || "preview"}-${Date.now()}`);
}

module.exports = {
  batchPreviewArgs,
  benchmarkBatchExtraction,
  benchmarkCachedReads,
  benchmarkFrameRange,
  benchmarkRoot,
  benchmarkSingleFrameExtraction,
  singlePreviewArgs,
  summarizeBenchmark
};
