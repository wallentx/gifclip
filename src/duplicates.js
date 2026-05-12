const { runTool } = require("./tools");
const { configuredDuplicateThreads, ffmpegInputArgs } = require("./ffmpeg-options");

function validateFrameRange(start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new TypeError("Frame range start and end must be integers");
  }
  if (start < 0 || end < 0) {
    throw new RangeError("Frame range start and end must be non-negative");
  }
  if (start > end) {
    throw new RangeError("Frame range start must be less than or equal to end");
  }
}

function ffmpegFrameMd5Args(sourcePath, start, end, options = {}) {
  validateFrameRange(start, end);
  return [
    "-v",
    "error",
    ...ffmpegInputArgs(options),
    "-i",
    sourcePath,
    "-vf",
    `select=between(n\\,${start}\\,${end})`,
    "-fps_mode",
    "passthrough",
    "-f",
    "framemd5",
    "-"
  ];
}

function ffmpegFrameDiffArgs(sourcePath, start, end, options = {}) {
  validateFrameRange(start, end);
  return [
    "-v",
    "error",
    ...ffmpegInputArgs(options),
    "-i",
    sourcePath,
    "-vf",
    `select=between(n\\,${start}\\,${end}),tblend=all_mode=difference,signalstats,metadata=print:file=-`,
    "-fps_mode",
    "passthrough",
    "-f",
    "null",
    "-"
  ];
}

function parseFrameMd5(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const fields = line.split(",");
      return fields[fields.length - 1].trim();
    });
}

function parseFrameDiffStats(text, startFrame) {
  const stats = [];
  let currentFrame = null;
  for (const line of String(text).split(/\r?\n/)) {
    const frameMatch = line.match(/^frame:\s*(\d+)/);
    if (frameMatch) {
      currentFrame = startFrame + Number(frameMatch[1]) + 1;
      continue;
    }

    const yavgMatch = line.match(/^lavfi\.signalstats\.YAVG=([0-9]+(?:\.[0-9]+)?)/);
    if (yavgMatch && currentFrame !== null) {
      stats.push({ frame: currentFrame, yavg: Number(yavgMatch[1]) });
    }
  }
  return stats;
}

function adjacentDuplicateIndexes(hashes, startFrame) {
  const duplicateFrames = [];
  for (let index = 1; index < hashes.length; index += 1) {
    if (hashes[index] === hashes[index - 1]) {
      duplicateFrames.push(startFrame + index);
    }
  }
  return duplicateFrames;
}

function adjacentNearDuplicateIndexes(stats, fuzz) {
  const threshold = Math.max(0, Number(fuzz) || 0);
  return stats
    .filter((stat) => Number.isFinite(stat.yavg) && stat.yavg <= threshold)
    .map((stat) => stat.frame);
}

async function analyzeAdjacentDuplicates(source, start, end, options = {}) {
  validateFrameRange(start, end);
  const sourcePath = typeof source === "string" ? source : source && source.sourcePath;
  if (!sourcePath) {
    throw new Error("Duplicate analysis sourcePath is required");
  }
  if (source.frameCount !== undefined && end >= source.frameCount) {
    throw new Error(`Invalid duplicate-analysis range: ${start}-${end}`);
  }
  const fuzz = Math.max(0, Number(options.fuzz) || 0);
  const ffmpegOptions = {
    threads: configuredDuplicateThreads()
  };
  if (fuzz > 0) {
    const result = await runTool("ffmpeg", ffmpegFrameDiffArgs(sourcePath, start, end, ffmpegOptions));
    const stats = parseFrameDiffStats(result.stdout.toString("utf8"), start);
    return {
      start,
      end,
      fuzz,
      duplicateFrames: adjacentNearDuplicateIndexes(stats, fuzz)
    };
  }

  const args = ffmpegFrameMd5Args(sourcePath, start, end, ffmpegOptions);
  const result = await runTool("ffmpeg", args);
  const hashes = parseFrameMd5(result.stdout.toString("utf8"));
  return {
    start,
    end,
    fuzz,
    duplicateFrames: adjacentDuplicateIndexes(hashes, start)
  };
}

module.exports = {
  ffmpegFrameMd5Args,
  ffmpegFrameDiffArgs,
  parseFrameMd5,
  parseFrameDiffStats,
  adjacentDuplicateIndexes,
  adjacentNearDuplicateIndexes,
  analyzeAdjacentDuplicates
};
