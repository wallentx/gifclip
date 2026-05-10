const fs = require("node:fs");
const path = require("node:path");
const { exportLossless } = require("../src/exporter");
const { loadGifInfo, parseGifInfo } = require("../src/gif-info");
const { ensurePreview } = require("../src/preview");
const { createProject, setSliceDeleted, setSliceSpeed, splitAtFrame } = require("../src/project");
const { rootDir, ensureRuntimeDirs } = require("../src/paths");
const { checkRequiredTools, runTool } = require("../src/tools");

async function verify() {
  checkRequiredTools();
  ensureRuntimeDirs();

  const sourcePath = path.join(rootDir, "jobscout-demo.gif");
  if (!fs.existsSync(sourcePath)) {
    throw new Error("jobscout-demo.gif is required for sample verification");
  }

  const info = await loadGifInfo(sourcePath);
  if (info.width !== 3164 || info.height !== 4704 || info.frameCount !== 2607) {
    throw new Error(`Unexpected sample metadata: ${info.width}x${info.height}, ${info.frameCount} frames`);
  }

  const preview = await ensurePreview(info, 10, 900);
  if (!fs.existsSync(preview)) {
    throw new Error("Preview was not generated");
  }

  let project = createProject(info);
  project = splitAtFrame(project, 12);
  project = setSliceDeleted(project, "slice-2", true);
  project = setSliceSpeed(project, "slice-1", 2);
  project.slices[0].start = 10;

  const exported = await exportLossless(project);
  const exportedInfoText = (await runTool("gifsicle", ["--info", exported.outputPath])).stdout.toString("utf8");
  const exportedInfo = parseGifInfo(exportedInfoText, exported.outputPath);
  if (exportedInfo.frameCount !== 3) {
    throw new Error(`Expected 3 exported frames, got ${exportedInfo.frameCount}`);
  }

  console.log(`verified sample: ${exported.href}`);
}

verify().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
