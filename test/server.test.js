const assert = require("node:assert/strict");
const test = require("node:test");

const { clientProjectWithTrustedSource, resolveFramePreviewPath } = require("../server");

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

test("clientProjectWithTrustedSource preserves edited delays without trusting source paths", () => {
  const trusted = {
    id: "project-1",
    source: {
      id: "project-1",
      sourcePath: "/trusted/source.gif",
      frameCount: 3,
      delaysCs: [10, 20, 30],
      width: 100,
      height: 80
    }
  };
  const clientProject = {
    id: "project-1",
    source: {
      sourcePath: "/untrusted/source.gif",
      delaysCs: [10, 25, 30]
    },
    slices: []
  };

  const merged = clientProjectWithTrustedSource(trusted, clientProject);

  assert.equal(merged.source.sourcePath, "/trusted/source.gif");
  assert.deepEqual(merged.source.delaysCs, [10, 25, 30]);
});
