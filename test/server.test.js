const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveFramePreviewPath } = require("../server");

test("resolveFramePreviewPath returns the requested frame without waiting for a range", async () => {
  const calls = [];
  const project = {
    source: {
      frameCount: 2607,
      sha256: "serverpreviewtest0000",
      sourcePath: "source.gif"
    }
  };

  const previewPath = await resolveFramePreviewPath(project, 1217 - 1, 900, {
    ensurePreview: async (_source, frameIndex, maxSize) => {
      calls.push({ frameIndex, maxSize });
      return `/cache/${frameIndex}-${maxSize}.jpg`;
    }
  });

  assert.equal(previewPath, "/cache/1216-900.jpg");
  assert.deepEqual(calls, [{ frameIndex: 1216, maxSize: 900 }]);
});
