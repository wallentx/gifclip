const fs = require("node:fs");
const path = require("node:path");
const { configuredPreviewJobs, ffmpegInputArgs } = require("./ffmpeg-options");
const { previewCacheDir, ensureDir } = require("./paths");
const { runTool } = require("./tools");

const inflightPreviews = new Map();
const queuedPreviewJobs = [];
let activePreviewJobs = 0;

function abortError() {
  const error = new Error("Preview aborted");
  error.name = "AbortError";
  return error;
}

function safeMaxJobs(value) {
  const jobs = Number(value);
  if (!Number.isFinite(jobs)) {
    return configuredPreviewJobs();
  }
  return Math.max(1, Math.trunc(jobs));
}

function drainPreviewJobs() {
  while (queuedPreviewJobs.length > 0 && activePreviewJobs < queuedPreviewJobs[0].maxJobs) {
    const job = queuedPreviewJobs.shift();
    if (job.signal && job.signal.aborted) {
      if (job.onAbort) {
        job.signal.removeEventListener("abort", job.onAbort);
      }
      job.reject(abortError());
      continue;
    }
    activePreviewJobs += 1;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        if (job.signal && job.onAbort) {
          job.signal.removeEventListener("abort", job.onAbort);
        }
        activePreviewJobs -= 1;
        drainPreviewJobs();
      });
  }
}

function runPreviewJob(task, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal && options.signal.aborted) {
      reject(abortError());
      return;
    }
    const job = {
      task,
      maxJobs: safeMaxJobs(options.maxJobs),
      resolve,
      reject,
      signal: options.signal
    };
    if (job.signal) {
      job.onAbort = () => {
        const index = queuedPreviewJobs.indexOf(job);
        if (index !== -1) {
          queuedPreviewJobs.splice(index, 1);
          reject(abortError());
        }
      };
      job.signal.addEventListener("abort", job.onAbort, { once: true });
    }
    if (options.priority === "high") {
      const firstLowPriority = queuedPreviewJobs.findIndex((queued) => queued.priority !== "high");
      job.priority = "high";
      if (firstLowPriority === -1) {
        queuedPreviewJobs.push(job);
      } else {
        queuedPreviewJobs.splice(firstLowPriority, 0, job);
      }
    } else {
      job.priority = "normal";
      queuedPreviewJobs.push(job);
    }
    drainPreviewJobs();
  });
}

function previewCachePath(source, frameIndex, maxSize) {
  const safeHash = source.sha256.slice(0, 16);
  return path.join(previewCacheDir, `${safeHash}-${frameIndex}-${maxSize}.jpg`);
}

function ffmpegPreviewArgs(sourcePath, frameIndex, maxSize, outputPath, options = {}) {
  const select = `select=eq(n\\,${frameIndex})`;
  const scale = `scale='if(gte(iw,ih),min(${maxSize},iw),-2)':'if(gte(ih,iw),min(${maxSize},ih),-2)'`;
  return [
    "-v",
    "error",
    ...ffmpegInputArgs(options),
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

function ffmpegPreviewRangeArgs(sourcePath, start, end, maxSize, outputPattern, options = {}) {
  const count = Math.max(1, end - start + 1);
  const select = `select=between(n\\,${start}\\,${end})`;
  const scale = `scale='if(gte(iw,ih),min(${maxSize},iw),-2)':'if(gte(ih,iw),min(${maxSize},ih),-2)'`;
  return [
    "-v",
    "error",
    ...ffmpegInputArgs(options),
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

function missingPreviewSpans(range, outputPaths) {
  const spans = [];
  let current = null;
  for (let index = 0; index < outputPaths.length; index += 1) {
    if (fs.existsSync(outputPaths[index])) {
      if (current) {
        spans.push(current);
        current = null;
      }
      continue;
    }

    const frame = range.start + index;
    if (!current) {
      current = { start: frame, end: frame, startIndex: index, endIndex: index, count: 1 };
      continue;
    }
    current.end = frame;
    current.endIndex = index;
    current.count += 1;
  }
  if (current) {
    spans.push(current);
  }
  return spans;
}

function cachedPreviewRanges(source, start, end, maxSize = 900) {
  const range = boundedPreviewRange(start, end, source.frameCount, source.frameCount);
  const ranges = [];
  let current = null;

  for (let frame = range.start; frame <= range.end; frame += 1) {
    if (!fs.existsSync(previewCachePath(source, frame, maxSize))) {
      if (current) {
        ranges.push(current);
        current = null;
      }
      continue;
    }

    if (!current) {
      current = { start: frame, end: frame, count: 1 };
      continue;
    }
    current.end = frame;
    current.count += 1;
  }

  if (current) {
    ranges.push(current);
  }

  return { ...range, ranges };
}

async function ensurePreview(source, frameIndex, maxSize = 900, options = {}) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= source.frameCount) {
    throw new Error(`Preview frame is outside source range: ${frameIndex}`);
  }

  ensureDir(previewCacheDir);
  const outputPath = previewCachePath(source, frameIndex, maxSize);
  if (!fs.existsSync(outputPath)) {
    if (!inflightPreviews.has(outputPath)) {
      const run = options.runTool || runTool;
      const pending = runPreviewJob(() =>
        fs.existsSync(outputPath)
          ? undefined
          : run("ffmpeg", ffmpegPreviewArgs(source.sourcePath, frameIndex, maxSize, outputPath, options), {
              signal: options.signal
            }),
      { maxJobs: options.maxJobs, priority: options.priority || "high", signal: options.signal });
      inflightPreviews.set(outputPath, pending.finally(() => inflightPreviews.delete(outputPath)));
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

  const missingSpans = missingPreviewSpans(range, outputPaths);
  if (missingSpans.length === 0) {
    return { ...range, generated: 0, generatedRanges: [], outputPaths };
  }

  const run = options.runTool || runTool;
  let generated = 0;
  const generatedRanges = [];

  for (const span of missingSpans) {
    const tempDir = fs.mkdtempSync(path.join(previewCacheDir, ".range-"));
    const outputPattern = path.join(tempDir, "frame-%06d.jpg");

    try {
      await runPreviewJob(() =>
        run("ffmpeg", ffmpegPreviewRangeArgs(source.sourcePath, span.start, span.end, maxSize, outputPattern, options), {
          signal: options.signal
        }),
      { maxJobs: options.maxJobs, priority: options.priority || "normal", signal: options.signal }
      );

      for (let index = 0; index < span.count; index += 1) {
        const tempPath = path.join(tempDir, `frame-${String(index + 1).padStart(6, "0")}.jpg`);
        if (!fs.existsSync(tempPath)) {
          throw new Error(`Expected preview frame was not generated: ${tempPath}`);
        }
        fs.renameSync(tempPath, outputPaths[span.startIndex + index]);
      }
      generated += span.count;
      generatedRanges.push({ start: span.start, end: span.end, count: span.count });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return { ...range, generated, generatedRanges, outputPaths };
}

module.exports = {
  boundedPreviewRange,
  cachedPreviewRanges,
  ffmpegPreviewRangeArgs,
  missingPreviewSpans,
  previewCachePath,
  ffmpegPreviewArgs,
  ensurePreview,
  ensurePreviewRange
};
