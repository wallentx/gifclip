const fs = require("node:fs");
const path = require("node:path");
const {
  benchmarkBatchExtraction,
  benchmarkCachedReads,
  benchmarkFrameRange,
  benchmarkRoot,
  benchmarkSingleFrameExtraction,
  summarizeBenchmark
} = require("../src/preview-benchmark");
const { loadGifInfo } = require("../src/gif-info");
const { rootDir, ensureRuntimeDirs } = require("../src/paths");
const { checkRequiredTools } = require("../src/tools");

function optionValue(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

async function main() {
  checkRequiredTools();
  ensureRuntimeDirs();

  const sourceName = optionValue("source", "jobscout-demo.gif");
  const start = Number(optionValue("start", "10"));
  const count = Number(optionValue("count", "8"));
  const maxSize = Number(optionValue("max", "900"));
  const sourcePath = path.join(rootDir, sourceName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`${sourceName} not found in repo root`);
  }

  const source = await loadGifInfo(sourcePath);
  const frameRange = benchmarkFrameRange(start, count, source.frameCount);
  const outputRoot = benchmarkRoot(path.basename(sourceName, path.extname(sourceName)));
  const singleDir = path.join(outputRoot, "single");
  const batchDir = path.join(outputRoot, "batch");

  console.log(`source: ${source.basename || sourceName}`);
  console.log(`frames: ${frameRange.start}-${frameRange.end} (${frameRange.count})`);
  console.log(`preview max: ${maxSize}px`);
  console.log(`output: ${outputRoot}`);

  const single = await benchmarkSingleFrameExtraction(source, frameRange, maxSize, singleDir);
  const batch = await benchmarkBatchExtraction(source, frameRange, maxSize, batchDir);
  const cachedRead = await benchmarkCachedReads(batch.outputDir);
  const summary = summarizeBenchmark({
    frameRange,
    singleMs: single.ms,
    batchMs: batch.ms,
    cachedReadMs: cachedRead.ms,
    singleBytes: single.bytes,
    batchBytes: batch.bytes
  });

  const summaryPath = path.join(outputRoot, "summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(JSON.stringify(summary, null, 2));
  console.log(`summary: ${summaryPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
