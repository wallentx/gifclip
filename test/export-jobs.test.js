const assert = require("node:assert/strict");
const test = require("node:test");

const { createExportJobStore } = require("../src/export-jobs");

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for export job");
}

test("export job store exposes phased progress and final result", async () => {
  let finishExport;
  const store = createExportJobStore({
    exportLossless: async (_project, options) => {
      options.onProgress({ phase: "Selecting frames", progress: 35 });
      await new Promise((resolve) => {
        finishExport = resolve;
      });
      options.onProgress({ phase: "Optimizing output", progress: 90 });
      return { href: "/exports/out.gif", frameCount: 3, mode: "lossless-native" };
    }
  });

  const started = store.start({ id: "project-1" });
  assert.equal(started.done, false);
  assert.equal(started.phase, "Queued");

  const selecting = await waitFor(() => {
    const job = store.get(started.id);
    return job.progress === 35 ? job : null;
  });
  assert.equal(selecting.phase, "Selecting frames");
  assert.equal(selecting.done, false);

  finishExport();
  const done = await waitFor(() => {
    const job = store.get(started.id);
    return job.done ? job : null;
  });

  assert.equal(done.phase, "Done");
  assert.equal(done.progress, 100);
  assert.deepEqual(done.result, { href: "/exports/out.gif", frameCount: 3, mode: "lossless-native" });
});

test("export job store records failed exports", async () => {
  const store = createExportJobStore({
    exportLossless: async () => {
      throw new Error("native export failed");
    }
  });

  const started = store.start({ id: "project-1" });
  const failed = await waitFor(() => {
    const job = store.get(started.id);
    return job.done ? job : null;
  });

  assert.equal(failed.phase, "Failed");
  assert.equal(failed.done, true);
  assert.equal(failed.error, "native export failed");
});
