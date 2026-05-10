const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { previewCacheDir } = require("../src/paths");
const { previewCachePath, ffmpegPreviewArgs } = require("../src/preview");

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
