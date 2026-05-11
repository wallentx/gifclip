const assert = require("node:assert/strict");
const test = require("node:test");

const { createDuplicateJobStore } = require("../src/duplicate-jobs");

const project = {
  id: "project-1",
  source: {
    id: "source-1",
    sourcePath: "/repo/demo.gif",
    frameCount: 4,
    width: 100,
    height: 80,
    delaysCs: [10, 10, 10, 10]
  },
  currentFrame: 0,
  slices: [
    {
      id: "slice-1",
      start: 0,
      end: 3,
      deleted: false,
      speed: 1,
      duplicateFrames: []
    }
  ]
};

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for duplicate job");
}

test("duplicate job store exposes final marked project", async () => {
  let analyzed = false;
  let storedProject = null;
  const store = createDuplicateJobStore({
    analyzeAdjacentDuplicates: async (_source, start, end) => {
      analyzed = true;
      assert.equal(start, 0);
      assert.equal(end, 3);
      return { start, end, duplicateFrames: [2] };
    }
  });

  const started = store.start(project, project.slices[0], (updated) => {
    storedProject = updated;
  });
  assert.equal(started.done, false);
  assert.equal(started.phase, "Queued");

  const done = await waitFor(() => {
    const job = store.get(started.id);
    return job.done ? job : null;
  });

  assert.equal(analyzed, true);
  assert.equal(done.phase, "Done");
  assert.equal(done.progress, 100);
  assert.deepEqual(done.result.analysis.duplicateFrames, [2]);
  assert.deepEqual(done.result.project.slices[0].duplicateFrames, [2]);
  assert.deepEqual(storedProject.slices[0].duplicateFrames, [2]);
});

test("duplicate job store records failures", async () => {
  const store = createDuplicateJobStore({
    analyzeAdjacentDuplicates: async () => {
      throw new Error("duplicate scan failed");
    }
  });

  const started = store.start(project, project.slices[0]);
  const failed = await waitFor(() => {
    const job = store.get(started.id);
    return job.done ? job : null;
  });

  assert.equal(failed.phase, "Failed");
  assert.equal(failed.done, true);
  assert.equal(failed.error, "duplicate scan failed");
});
