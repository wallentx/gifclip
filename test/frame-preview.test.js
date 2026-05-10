const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createFramePreviewController,
  createHoldRepeatController,
  holdRepeatIntervalMs,
  stepFrame
} = require("../public/frame-preview.js");

test("scheduled frame preview coalesces rapid slider input", async () => {
  const scheduled = [];
  const cleared = [];
  const fetched = [];
  const preview = { src: "" };

  const controller = createFramePreviewController({
    getProjectId: () => "project-1",
    getFrameCount: () => 20,
    previewElement: preview,
    createObjectUrl: (blob) => `blob:${blob.frame}`,
    fetchFrame: async (url) => {
      fetched.push(url);
      return {
        ok: true,
        blob: async () => ({ frame: url.match(/\/(\d+)\?/)?.[1] })
      };
    },
    setTimer: (fn) => {
      scheduled.push(fn);
      return scheduled.length;
    },
    clearTimer: (id) => cleared.push(id)
  });

  controller.schedule(4, 80);
  controller.schedule(9, 80);
  await scheduled.at(-1)();

  assert.deepEqual(cleared, [1]);
  assert.deepEqual(fetched, ["/api/frame/project-1/9?max=900"]);
  assert.equal(preview.src, "blob:9");
});

test("direct frame preview fetches only the requested frame", async () => {
  const fetched = [];
  const controller = createFramePreviewController({
    getProjectId: () => "project-1",
    getFrameCount: () => 20,
    previewElement: { src: "" },
    createObjectUrl: () => "blob:url",
    fetchFrame: async (url) => {
      fetched.push(url);
      return { ok: true, blob: async () => ({}) };
    }
  });

  await controller.show(7);

  assert.deepEqual(fetched, ["/api/frame/project-1/7?max=900"]);
});

test("stepFrame moves one frame and clamps to timeline bounds", () => {
  assert.equal(stepFrame(6, -1, 10), 5);
  assert.equal(stepFrame(6, 1, 10), 7);
  assert.equal(stepFrame(0, -1, 10), 0);
  assert.equal(stepFrame(9, 1, 10), 9);
});

test("holdRepeatIntervalMs accelerates to a capped interval", () => {
  assert.equal(holdRepeatIntervalMs(0), 180);
  assert.equal(holdRepeatIntervalMs(1), 162);
  assert.equal(holdRepeatIntervalMs(8), 50);
  assert.equal(holdRepeatIntervalMs(100), 50);
});

test("hold repeat controller steps immediately, then accelerates until stopped", () => {
  const timers = [];
  const cleared = [];
  const steps = [];
  const controller = createHoldRepeatController({
    step: () => steps.push(steps.length),
    setTimer: (fn, delayMs) => {
      timers.push({ fn, delayMs });
      return timers.length;
    },
    clearTimer: (id) => cleared.push(id)
  });

  controller.start();
  timers[0].fn();
  timers[1].fn();
  controller.stop();

  assert.deepEqual(steps, [0, 1, 2]);
  assert.deepEqual(timers.map((timer) => timer.delayMs), [350, 180, 162]);
  assert.deepEqual(cleared, [3]);
});
