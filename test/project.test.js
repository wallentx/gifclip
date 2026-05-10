const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createProject,
  splitAtFrame,
  setSliceDeleted,
  setSliceSpeed,
  markDuplicateFrames,
  buildFramePlan
} = require("../src/project");

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

test("createProject creates one full-range slice", () => {
  assert.deepEqual(createProject(source), {
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
        duplicateFrames: []
      }
    ]
  });
});

test("splitAtFrame splits after the selected frame", () => {
  const project = splitAtFrame(createProject(source), 2);

  assert.deepEqual(project.slices, [
    {
      id: "slice-1",
      start: 0,
      end: 2,
      deleted: false,
      speed: 1,
      duplicateFrames: []
    },
    {
      id: "slice-2",
      start: 3,
      end: 5,
      deleted: false,
      speed: 1,
      duplicateFrames: []
    }
  ]);
});

test("buildFramePlan omits deleted slices", () => {
  let project = splitAtFrame(createProject(source), 2);
  project = setSliceDeleted(project, "slice-1", true);

  assert.deepEqual(buildFramePlan(project), {
    mode: "lossless-native",
    sourcePath: "/repo/demo.gif",
    width: 100,
    height: 80,
    loop: "forever",
    frames: [
      { sourceIndex: 3, delayCs: 40, sliceId: "slice-2" },
      { sourceIndex: 4, delayCs: 50, sliceId: "slice-2" },
      { sourceIndex: 5, delayCs: 60, sliceId: "slice-2" }
    ]
  });
});

test("buildFramePlan applies slice speed to frame delays", () => {
  let project = splitAtFrame(createProject(source), 2);
  project = setSliceSpeed(project, "slice-2", 2);

  assert.deepEqual(buildFramePlan(project).frames, [
    { sourceIndex: 0, delayCs: 10, sliceId: "slice-1" },
    { sourceIndex: 1, delayCs: 20, sliceId: "slice-1" },
    { sourceIndex: 2, delayCs: 30, sliceId: "slice-1" },
    { sourceIndex: 3, delayCs: 20, sliceId: "slice-2" },
    { sourceIndex: 4, delayCs: 25, sliceId: "slice-2" },
    { sourceIndex: 5, delayCs: 30, sliceId: "slice-2" }
  ]);
});

test("buildFramePlan omits duplicate frames after sanitizing them", () => {
  let project = splitAtFrame(createProject(source), 2);
  project = markDuplicateFrames(project, "slice-2", [5, 5, 2, 4.5, 8]);

  assert.deepEqual(buildFramePlan(project).frames, [
    { sourceIndex: 0, delayCs: 10, sliceId: "slice-1" },
    { sourceIndex: 1, delayCs: 20, sliceId: "slice-1" },
    { sourceIndex: 2, delayCs: 30, sliceId: "slice-1" },
    { sourceIndex: 3, delayCs: 40, sliceId: "slice-2" },
    { sourceIndex: 4, delayCs: 110, sliceId: "slice-2" }
  ]);
});

test("buildFramePlan folds duplicate duration after slice speed", () => {
  let project = splitAtFrame(createProject(source), 2);
  project = setSliceSpeed(project, "slice-2", 2);
  project = markDuplicateFrames(project, "slice-2", [5]);

  assert.deepEqual(buildFramePlan(project).frames.slice(3), [
    { sourceIndex: 3, delayCs: 20, sliceId: "slice-2" },
    { sourceIndex: 4, delayCs: 55, sliceId: "slice-2" }
  ]);
});
