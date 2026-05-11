const { randomUUID } = require("node:crypto");
const { analyzeAdjacentDuplicates: defaultAnalyzeAdjacentDuplicates } = require("./duplicates");
const { markDuplicateFrames } = require("./project");

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

function createDuplicateJobStore(options = {}) {
  const analyzeAdjacentDuplicates = options.analyzeAdjacentDuplicates || defaultAnalyzeAdjacentDuplicates;
  const jobs = new Map();

  function start(project, slice, onDone) {
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
        job.phase = `Analyzing ${slice.id}`;
        job.progress = 10;
        const analysis = await analyzeAdjacentDuplicates(project.source, slice.start, slice.end);
        job.phase = "Marking duplicates";
        job.progress = 90;
        const updated = markDuplicateFrames(project, slice.id, analysis.duplicateFrames);
        if (typeof onDone === "function") {
          onDone(updated);
        }
        job.phase = "Done";
        job.progress = 100;
        job.done = true;
        job.result = { project: updated, analysis };
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

module.exports = { createDuplicateJobStore };
