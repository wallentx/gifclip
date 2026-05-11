const test = require("node:test");
const assert = require("node:assert/strict");
const { assertInsideRoot, rootDir } = require("../src/paths");
const { REQUIRED_TOOLS, runTool } = require("../src/tools");

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

test("runTool aborts a running child process", async () => {
  const controller = new AbortController();
  const pending = runTool(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
    signal: controller.signal
  });

  controller.abort();

  await assert.rejects(pending, /aborted/);
});
