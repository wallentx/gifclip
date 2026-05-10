const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGifInfo } = require("../src/gif-info");

const sampleInfo = `* jobscout-demo.gif 3 images
  logical screen 3164x4704
  global color table [2]
  background 0
  loop forever
  + image #0 3164x4704
    disposal asis delay 0.67s
  + image #1 35x168 at 35,42 transparent 0
    disposal asis delay 1.31s
  + image #2 2246x1596 at 35,126 transparent 0
    disposal asis delay 0.73s`;

test("parseGifInfo extracts frame count, size, loop, and delays", () => {
  const parsed = parseGifInfo(sampleInfo, "jobscout-demo.gif");
  assert.equal(parsed.frameCount, 3);
  assert.equal(parsed.width, 3164);
  assert.equal(parsed.height, 4704);
  assert.equal(parsed.loop, "forever");
  assert.deepEqual(parsed.delaysCs, [67, 131, 73]);
});

test("parseGifInfo fails when logical screen is missing", () => {
  assert.throws(() => parseGifInfo("* bad.gif 1 images", "bad.gif"), /logical screen/);
});
