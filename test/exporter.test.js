const test = require("node:test");
const assert = require("node:assert/strict");
const {
  frameSelectionArgs,
  delayGroups,
  delayBatchArgs,
  exportModeForProject,
  exportLossless
} = require("../src/exporter");
const { normalizeProject } = require("../src/project");

const source = {
  id: "abc",
  basename: "demo.gif",
  sourcePath: "/repo/demo.gif",
  frameCount: 6,
  width: 100,
  height: 80,
  delaysCs: [10, 20, 30, 40, 50, 60],
  loop: "forever"
};

function projectWithSlice(slice) {
  return {
    id: "abc",
    source,
    currentFrame: 0,
    slices: [
      {
        id: "slice-1",
        start: 0,
        end: 5,
        deleted: false,
        speed: 1,
        duplicateFrames: [],
        ...slice
      }
    ]
  };
}

test("frameSelectionArgs collapses adjacent source frame indexes", () => {
  const frames = [0, 1, 2, 5, 7, 8].map((sourceIndex) => ({ sourceIndex }));

  assert.deepEqual(frameSelectionArgs(frames), ["#0-2", "#5", "#7-8"]);
});

test("delayGroups groups adjacent output frame positions by delay", () => {
  const frames = [10, 10, 5, 5, 5, 10].map((delayCs) => ({ delayCs }));

  assert.deepEqual(delayGroups(frames), [
    { start: 0, end: 1, delayCs: 10 },
    { start: 2, end: 4, delayCs: 5 },
    { start: 5, end: 5, delayCs: 10 }
  ]);
});

test("delayBatchArgs emits gifsicle delay rewrite arguments", () => {
  const frames = [10, 10, 5, 5, 5, 10].map((delayCs) => ({ delayCs }));

  assert.deepEqual(delayBatchArgs(frames), [
    "--delay",
    "10",
    "#0-1",
    "--delay",
    "5",
    "#2-4",
    "--delay",
    "10",
    "#5"
  ]);
});

test("exportModeForProject accepts v1 lossless edits", () => {
  assert.equal(exportModeForProject(projectWithSlice()), "lossless-native");
});

test("exportModeForProject rejects overlays", () => {
  assert.throws(
    () => exportModeForProject(projectWithSlice({ overlays: [{ text: "hello" }] })),
    /overlays/
  );
});

test("exportModeForProject rejects inserts", () => {
  assert.throws(
    () => exportModeForProject(projectWithSlice({ inserts: [{ sourcePath: "/repo/other.gif" }] })),
    /inserts/
  );
});

test("exportModeForProject rejects unsupported edits after normalization", () => {
  const normalized = normalizeProject(projectWithSlice({ overlays: [{ text: "hello" }] }));

  assert.throws(() => exportModeForProject(normalized), /overlays/);
});

test("exportLossless reports phase progress during native export", async () => {
  const events = [];
  const commands = [];

  const exported = await exportLossless(projectWithSlice(), {
    onProgress: (event) => events.push(event),
    runTool: async (tool, args) => {
      commands.push({ tool, args });
    }
  });

  assert.deepEqual(events.map((event) => [event.phase, event.progress]), [
    ["Building export plan", 10],
    ["Selecting frames", 35],
    ["Applying frame delays", 65],
    ["Optimizing output", 90]
  ]);
  assert.equal(commands.length, 3);
  assert.equal(exported.mode, "lossless-native");
  assert.equal(exported.frameCount, 6);
});
