const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { ffmpegInputArgs: configuredFfmpegInputArgs } = require("./ffmpeg-options");
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

function firstImageLine(infoText) {
  const match = String(infoText).match(/^\s*\+\s+image #0\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function firstFrameIsFullCanvas(infoText, width, height) {
  const line = firstImageLine(infoText);
  if (!line) return false;

  const imageMatch = line.match(/^(\d+)x(\d+)(?:\s+at\s+(-?\d+),(-?\d+))?/);
  if (!imageMatch) return false;

  const frameWidth = Number(imageMatch[1]);
  const frameHeight = Number(imageMatch[2]);
  const x = imageMatch[3] == null ? 0 : Number(imageMatch[3]);
  const y = imageMatch[4] == null ? 0 : Number(imageMatch[4]);
  return frameWidth === width && frameHeight === height && x === 0 && y === 0;
}

function ffmpegFirstFrameArgs(sourcePath, frameIndex, outputPath, options = {}) {
  return [
    "-v",
    "error",
    ...(options.ffmpegInputArgs || configuredFfmpegInputArgs(options)),
    "-i",
    sourcePath,
    "-vf",
    `select=eq(n\\,${frameIndex})`,
    "-frames:v",
    "1",
    "-gifflags",
    "-offsetting",
    "-y",
    outputPath
  ];
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

function reportProgress(onProgress, phase, progress) {
  if (typeof onProgress === "function") {
    onProgress({ phase, progress });
  }
}

async function exportLossless(project, options = {}) {
  const run = options.runTool || runTool;
  const onProgress = options.onProgress;

  const mode = exportModeForProject(project);
  reportProgress(onProgress, "Building export plan", 10);
  const plan = buildFramePlan(project);
  ensureDir(tmpDir);
  ensureDir(exportsDir);

  const tempPath = path.join(tmpDir, outputName("gifclip-temp"));
  const outputPath = path.join(exportsDir, outputName(project.source && project.source.basename));
  const tempPaths = [tempPath];
  let firstFrameRepaired = false;

  try {
    reportProgress(onProgress, "Selecting frames", 35);
    await run("gifsicle", [
      plan.sourcePath,
      ...frameSelectionArgs(plan.frames),
      "--output",
      tempPath
    ]);
    reportProgress(onProgress, "Applying frame delays", 65);
    await run("gifsicle", ["--batch", tempPath, ...delayBatchArgs(plan.frames)]);
    reportProgress(onProgress, "Checking first frame", 78);
    const { stdout } = await run("gifsicle", ["--info", tempPath]);
    if (!firstFrameIsFullCanvas(stdout.toString("utf8"), plan.width, plan.height)) {
      reportProgress(onProgress, "Repairing first frame", 82);
      const firstGifPath = path.join(tmpDir, outputName("gifclip-first-frame"));
      const firstDelayPath = path.join(tmpDir, outputName("gifclip-first-frame-delay"));
      const repairedPath = path.join(tmpDir, outputName("gifclip-repaired"));
      tempPaths.push(firstGifPath, firstDelayPath, repairedPath);

      const firstFrame = plan.frames[0];
      await run("ffmpeg", ffmpegFirstFrameArgs(plan.sourcePath, firstFrame.sourceIndex, firstGifPath));
      await run("gifsicle", [
        firstGifPath,
        "--delay",
        String(firstFrame.delayCs),
        "#0",
        "--output",
        firstDelayPath
      ]);
      if (plan.frames.length === 1) {
        fs.renameSync(firstDelayPath, tempPath);
      } else {
        await run("gifsicle", [firstDelayPath, tempPath, "#1-", "--output", repairedPath]);
        fs.renameSync(repairedPath, tempPath);
      }
      firstFrameRepaired = true;
    }
    reportProgress(onProgress, "Optimizing output", 90);
    await run("gifsicle", ["--optimize=2", tempPath, "--output", outputPath]);
  } finally {
    for (const temp of tempPaths) {
      fs.rmSync(temp, { force: true });
    }
  }

  return {
    mode,
    frameCount: plan.frames.length,
    firstFrameRepaired,
    outputPath,
    href: `/exports/${path.basename(outputPath)}`
  };
}

module.exports = {
  frameSelectionArgs,
  delayGroups,
  delayBatchArgs,
  exportModeForProject,
  ffmpegFirstFrameArgs,
  firstFrameIsFullCanvas,
  exportLossless
};
