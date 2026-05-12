const fs = require("node:fs");
const { exportLossless } = require("../src/exporter");
const { loadGifInfo, parseGifInfo } = require("../src/gif-info");
const { ensurePreview } = require("../src/preview");
const { createProject, setSliceSpeed } = require("../src/project");
const { ensureRuntimeDirs } = require("../src/paths");
const { listSources, resolveSource } = require("../src/sources");
const { checkRequiredTools, runTool } = require("../src/tools");

async function verify() {
  checkRequiredTools();
  ensureRuntimeDirs();

  const sourceEntry = listSources()[0];
  if (!sourceEntry) {
    console.log("no GIF sources available; skipping sample verification");
    return;
  }

  const sourcePath = resolveSource(sourceEntry.id);
  const info = await loadGifInfo(sourcePath);

  const preview = await ensurePreview(info, Math.min(10, info.frameCount - 1), 900);
  if (!fs.existsSync(preview)) {
    throw new Error("Preview was not generated");
  }

  let project = createProject(info);
  project = setSliceSpeed(project, "slice-1", 2);
  project.slices[0].end = Math.min(info.frameCount - 1, 2);

  const exported = await exportLossless(project);
  const exportedInfoText = (await runTool("gifsicle", ["--info", exported.outputPath])).stdout.toString("utf8");
  const exportedInfo = parseGifInfo(exportedInfoText, exported.outputPath);
  const expectedFrames = project.slices[0].end + 1;
  if (exportedInfo.frameCount !== expectedFrames) {
    throw new Error(`Expected ${expectedFrames} exported frames, got ${exportedInfo.frameCount}`);
  }

  console.log(`verified ${sourceEntry.name}: ${exported.href}`);
}

verify().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
