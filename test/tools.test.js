const test = require("node:test");
const assert = require("node:assert/strict");
const { assertInsideRoot, rootDir } = require("../src/paths");
const { REQUIRED_TOOLS } = require("../src/tools");

test("required tool list contains native gif tools", () => {
  assert.deepEqual(REQUIRED_TOOLS, ["gifsicle", "ffmpeg"]);
});

test("assertInsideRoot accepts paths under the repo", () => {
  const resolved = assertInsideRoot(`${rootDir}/jobscout-demo.gif`);
  assert.ok(resolved.endsWith("jobscout-demo.gif"));
});

test("assertInsideRoot rejects paths outside the repo", () => {
  assert.throws(() => assertInsideRoot("/etc/passwd"), /outside project root/);
});
