const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { previewCacheDir } = require("../src/paths");
const {
  boundedPreviewRange,
  ensurePreviewRange,
  ffmpegPreviewArgs,
  ffmpegPreviewRangeArgs,
  previewCachePath
} = require("../src/preview");

test("previewCachePath is stable for source hash, frame, and size", () => {
  const source = { sha256: "abcdef1234567890abcdef1234567890" };

  const first = previewCachePath(source, 12, 900);
  const second = previewCachePath(source, 12, 900);

  assert.equal(first, second);
  assert.equal(first, path.join(previewCacheDir, "abcdef1234567890-12-900.jpg"));
});

test("ffmpegPreviewArgs selects one scaled jpeg frame", () => {
  const args = ffmpegPreviewArgs("source.gif", 7, 900, "out.jpg");

  assert.deepEqual(args, [
    "-v",
    "error",
    "-i",
    "source.gif",
    "-vf",
    "select=eq(n\\,7),scale='if(gte(iw,ih),min(900,iw),-2)':'if(gte(ih,iw),min(900,ih),-2)'",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-y",
    "out.jpg"
  ]);
});

test("boundedPreviewRange clamps requested windows to source bounds and max frames", () => {
  assert.deepEqual(boundedPreviewRange(10, 40, 100, 16), { start: 10, end: 25, count: 16 });
  assert.deepEqual(boundedPreviewRange(-5, 5, 100, 20), { start: 0, end: 5, count: 6 });
  assert.deepEqual(boundedPreviewRange(95, 120, 100, 20), { start: 95, end: 99, count: 5 });
});

test("boundedPreviewRange creates a bounded window around a frame marker", () => {
  assert.deepEqual(boundedPreviewRange(32, 48, 100, 17, 40), { start: 32, end: 48, count: 17 });
  assert.deepEqual(boundedPreviewRange(20, 80, 100, 17, 40), { start: 32, end: 48, count: 17 });
  assert.deepEqual(boundedPreviewRange(0, 80, 100, 17, 2), { start: 0, end: 10, count: 11 });
});

test("ffmpegPreviewRangeArgs selects a bounded scaled jpeg frame window", () => {
  const args = ffmpegPreviewRangeArgs("source.gif", 7, 9, 900, "frame-%06d.jpg");

  assert.deepEqual(args, [
    "-v",
    "error",
    "-i",
    "source.gif",
    "-vf",
    "select=between(n\\,7\\,9),scale='if(gte(iw,ih),min(900,iw),-2)':'if(gte(ih,iw),min(900,ih),-2)'",
    "-fps_mode",
    "passthrough",
    "-frames:v",
    "3",
    "-q:v",
    "3",
    "-y",
    "frame-%06d.jpg"
  ]);
});

test("ensurePreviewRange generates the marker-centered bounded window", async () => {
  const source = {
    sha256: "centeredpreviewrange0001",
    sourcePath: "source.gif",
    frameCount: 100
  };
  const outputPaths = [];

  try {
    const result = await ensurePreviewRange(source, 20, 80, 900, {
      maxFrames: 17,
      center: 40,
      runTool: async (_tool, args) => {
        const frames = Number(args[args.indexOf("-frames:v") + 1]);
        const outputPattern = args.at(-1);
        const outputDir = path.dirname(outputPattern);
        for (let index = 1; index <= frames; index += 1) {
          fs.writeFileSync(path.join(outputDir, `frame-${String(index).padStart(6, "0")}.jpg`), "preview");
        }
      }
    });

    outputPaths.push(...result.outputPaths);
    assert.deepEqual(
      { start: result.start, end: result.end, count: result.count, generated: result.generated },
      { start: 32, end: 48, count: 17, generated: 17 }
    );
  } finally {
    for (const outputPath of outputPaths) {
      fs.rmSync(outputPath, { force: true });
    }
  }
});
