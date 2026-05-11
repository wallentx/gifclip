const assert = require("node:assert/strict");
const test = require("node:test");

const {
  BLUEPRINT_SCHEMA,
  blueprintFromProject,
  projectFromBlueprint,
  sourceMatchesBlueprint
} = require("../src/blueprints");
const { createProject } = require("../src/project");

const source = {
  id: "abc",
  basename: "demo.gif",
  sourcePath: "/repo/demo.gif",
  frameCount: 3,
  width: 100,
  height: 80,
  delaysCs: [10, 20, 30],
  loop: "forever",
  sha256: "abc123",
  bytes: 123
};

test("blueprintFromProject serializes source identity and slices", () => {
  const project = createProject(source);
  project.slices[0].speed = 2;

  const blueprint = blueprintFromProject(project);

  assert.equal(blueprint.schema, BLUEPRINT_SCHEMA);
  assert.equal(blueprint.source.sha256, "abc123");
  assert.equal(blueprint.slices[0].speed, 2);
});

test("projectFromBlueprint restores slices onto a matching source", () => {
  const blueprint = {
    schema: BLUEPRINT_SCHEMA,
    source: {
      sha256: "abc123",
      basename: "demo.gif",
      frameCount: 3,
      width: 100,
      height: 80
    },
    currentFrame: 1,
    slices: [
      { id: "slice-1", start: 0, end: 1, deleted: false, speed: 1, duplicateFrames: [] },
      { id: "slice-2", start: 2, end: 2, deleted: true, speed: 1.5, duplicateFrames: [] }
    ]
  };

  const project = projectFromBlueprint(source, blueprint);

  assert.equal(project.currentFrame, 1);
  assert.equal(project.slices.length, 2);
  assert.equal(project.slices[1].deleted, true);
});

test("sourceMatchesBlueprint rejects a different gif", () => {
  assert.equal(sourceMatchesBlueprint(source, { sha256: "nope" }), false);
});
