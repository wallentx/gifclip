const assert = require("node:assert/strict");
const test = require("node:test");

const {
  batchPreviewArgs,
  benchmarkFrameRange,
  singlePreviewArgs,
  summarizeBenchmark
} = require("../src/preview-benchmark");

test("benchmarkFrameRange clamps start/count to source bounds", () => {
  assert.deepEqual(benchmarkFrameRange(10, 5, 100), { start: 10, end: 14, count: 5 });
  assert.deepEqual(benchmarkFrameRange(98, 10, 100), { start: 98, end: 99, count: 2 });
  assert.deepEqual(benchmarkFrameRange(-10, 3, 100), { start: 0, end: 2, count: 3 });
});

test("singlePreviewArgs extracts one scaled proxy frame", () => {
  assert.deepEqual(singlePreviewArgs("in.gif", 12, 900, "out.jpg", { threads: 8, hwaccel: "auto" }), [
    "-v",
    "error",
    "-threads",
    "8",
    "-filter_threads",
    "8",
    "-hwaccel",
    "auto",
    "-i",
    "in.gif",
    "-vf",
    "select=eq(n\\,12),scale='if(gte(iw,ih),min(900,iw),-2)':'if(gte(ih,iw),min(900,ih),-2)'",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-y",
    "out.jpg"
  ]);
});

test("batchPreviewArgs extracts a contiguous scaled proxy frame window", () => {
  assert.deepEqual(batchPreviewArgs("in.gif", 12, 16, 720, "frame-%06d.jpg", { threads: 8, hwaccel: "auto" }), [
    "-v",
    "error",
    "-threads",
    "8",
    "-filter_threads",
    "8",
    "-hwaccel",
    "auto",
    "-i",
    "in.gif",
    "-vf",
    "select=between(n\\,12\\,16),scale='if(gte(iw,ih),min(720,iw),-2)':'if(gte(ih,iw),min(720,ih),-2)'",
    "-fps_mode",
    "passthrough",
    "-frames:v",
    "5",
    "-q:v",
    "3",
    "-y",
    "frame-%06d.jpg"
  ]);
});

test("summarizeBenchmark reports relative speedup", () => {
  const summary = summarizeBenchmark({
    frameRange: { count: 10 },
    singleMs: 1000,
    batchMs: 250,
    cachedReadMs: 5,
    singleBytes: 100,
    batchBytes: 100
  });

  assert.equal(summary.single.perFrameMs, 100);
  assert.equal(summary.batch.perFrameMs, 25);
  assert.equal(summary.batch.speedupVsSingle, 4);
  assert.equal(summary.cachedRead.perFrameMs, 0.5);
});
