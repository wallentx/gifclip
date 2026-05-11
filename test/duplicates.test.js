const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ffmpegFrameMd5Args,
  parseFrameMd5,
  adjacentDuplicateIndexes
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
