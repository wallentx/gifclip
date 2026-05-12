const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ffmpegFrameMd5Args,
  ffmpegFrameDiffArgs,
  parseFrameMd5,
  parseFrameDiffStats,
  adjacentDuplicateIndexes,
  adjacentNearDuplicateIndexes
} = require("../src/duplicates");

const sample = `#format: frame checksums
0,          0,          0,        1,   320000, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
0,          1,          1,        1,   320000, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
0,          2,          2,        1,   320000, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`;

test("parseFrameMd5 returns ordered hashes from data lines", () => {
  assert.deepEqual(parseFrameMd5(sample), [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  ]);
});

test("adjacentDuplicateIndexes keeps first frame in each duplicate run", () => {
  const hashes = ["a", "a", "b", "b", "b", "a", "a"];

  assert.deepEqual(adjacentDuplicateIndexes(hashes, 10), [11, 13, 14, 16]);
});

test("ffmpegFrameMd5Args selects inclusive frame range as framemd5 stdout", () => {
  assert.deepEqual(ffmpegFrameMd5Args("input.gif", 3, 8, { threads: 8, hwaccel: "auto" }), [
    "-v",
    "error",
    "-threads",
    "8",
    "-filter_threads",
    "8",
    "-hwaccel",
    "auto",
    "-i",
    "input.gif",
    "-vf",
    "select=between(n\\,3\\,8)",
    "-fps_mode",
    "passthrough",
    "-f",
    "framemd5",
    "-"
  ]);
});

test("ffmpegFrameDiffArgs emits adjacent-frame difference metadata", () => {
  assert.deepEqual(ffmpegFrameDiffArgs("input.gif", 3, 8, { threads: 8, hwaccel: "auto" }), [
    "-v",
    "error",
    "-threads",
    "8",
    "-filter_threads",
    "8",
    "-hwaccel",
    "auto",
    "-i",
    "input.gif",
    "-vf",
    "select=between(n\\,3\\,8),tblend=all_mode=difference,signalstats,metadata=print:file=-",
    "-fps_mode",
    "passthrough",
    "-f",
    "null",
    "-"
  ]);
});

test("parseFrameDiffStats maps filtered diff frames to duplicate candidates", () => {
  const text = `frame:0    pts:4       pts_time:4
lavfi.signalstats.YAVG=0
frame:1    pts:5       pts_time:5
lavfi.signalstats.YAVG=2.75
frame:2    pts:6       pts_time:6
lavfi.signalstats.YAVG=12`;

  assert.deepEqual(parseFrameDiffStats(text, 3), [
    { frame: 4, yavg: 0 },
    { frame: 5, yavg: 2.75 },
    { frame: 6, yavg: 12 }
  ]);
});

test("adjacentNearDuplicateIndexes uses a luma-difference fuzz threshold", () => {
  const stats = [
    { frame: 4, yavg: 0 },
    { frame: 5, yavg: 2.75 },
    { frame: 6, yavg: 12 }
  ];

  assert.deepEqual(adjacentNearDuplicateIndexes(stats, 3), [4, 5]);
  assert.deepEqual(adjacentNearDuplicateIndexes(stats, 0), [4]);
});
