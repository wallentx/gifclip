const { runTool } = require("./tools");

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

function ffmpegFrameMd5Args(sourcePath, start, end) {
  validateFrameRange(start, end);
  return [
    "-v",
    "error",
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

function adjacentDuplicateIndexes(hashes, startFrame) {
  const duplicateFrames = [];
  for (let index = 1; index < hashes.length; index += 1) {
    if (hashes[index] === hashes[index - 1]) {
      duplicateFrames.push(startFrame + index);
    }
  }
  return duplicateFrames;
}

async function analyzeAdjacentDuplicates(source, start, end) {
  validateFrameRange(start, end);
  const sourcePath = typeof source === "string" ? source : source && source.sourcePath;
  if (!sourcePath) {
    throw new Error("Duplicate analysis sourcePath is required");
  }
  if (source.frameCount !== undefined && end >= source.frameCount) {
    throw new Error(`Invalid duplicate-analysis range: ${start}-${end}`);
  }
  const args = ffmpegFrameMd5Args(sourcePath, start, end);
  const result = await runTool("ffmpeg", args);
  const hashes = parseFrameMd5(result.stdout.toString("utf8"));
  return {
    start,
    end,
    duplicateFrames: adjacentDuplicateIndexes(hashes, start)
  };
}

module.exports = {
  ffmpegFrameMd5Args,
  parseFrameMd5,
  adjacentDuplicateIndexes,
  analyzeAdjacentDuplicates
};
