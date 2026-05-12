const { randomUUID } = require("node:crypto");
const { exportGif: defaultExportGif } = require("./exporter");

function snapshot(job) {
  return {
    id: job.id,
    phase: job.phase,
    progress: job.progress,
    done: job.done,
    error: job.error,
    result: job.result
  };
}

function createExportJobStore(options = {}) {
  const exportProject =
    options.exportProject ||
    (options.exportLossless
      ? (project, _exportOptions, runOptions) => options.exportLossless(project, runOptions)
      : defaultExportGif);
  const jobs = new Map();

  function update(job, patch) {
    if (typeof patch.phase === "string") job.phase = patch.phase;
    if (Number.isFinite(patch.progress)) {
      job.progress = Math.max(0, Math.min(100, Math.trunc(patch.progress)));
    }
  }

  function start(project, exportOptions = {}) {
    const job = {
      id: randomUUID(),
      phase: "Queued",
      progress: 0,
      done: false,
      error: null,
      result: null
    };
    jobs.set(job.id, job);

    Promise.resolve().then(async () => {
      try {
        const result = await exportProject(project, exportOptions || {}, {
          onProgress: (event) => update(job, event)
        });
        job.phase = "Done";
        job.progress = 100;
        job.done = true;
        job.result = result;
      } catch (error) {
        job.phase = "Failed";
        job.done = true;
        job.error = error.message || String(error);
      }
    });

    return snapshot(job);
  }

  function get(id) {
    const job = jobs.get(id);
    return job ? snapshot(job) : null;
  }

  return { get, start };
}

module.exports = { createExportJobStore };
