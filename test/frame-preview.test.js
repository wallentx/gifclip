const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createFramePreviewController,
  createHoldRepeatController,
  boundedPreviewRange,
  clampFrameToRange,
  frameRangeForSlice,
  frameRangesForSlices,
  mergeFrameRanges,
  nextPlaybackFrame,
  nextPreviewWindowSize,
  playbackDelayMs,
  sliceStepTarget,
  holdRepeatIntervalMs,
  stepFrame,
  stepFrameAcrossRanges,
  subtractFrameRanges,
  stepFrameWithinRange
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

test("direct frame preview reports loaded status after fetch completes", async () => {
  const statuses = [];
  const loaded = [];
  const controller = createFramePreviewController({
    getProjectId: () => "project-1",
    getFrameCount: () => 20,
    previewElement: { src: "" },
    createObjectUrl: () => "blob:url",
    setStatus: (message) => statuses.push(message),
    onLoaded: (frameIndex, url) => loaded.push({ frameIndex, url }),
    fetchFrame: async () => ({ ok: true, blob: async () => ({}) })
  });

  await controller.show(7);

  assert.deepEqual(statuses, ["Loading frame 8...", "Loaded frame 8."]);
  assert.deepEqual(loaded, [{ frameIndex: 7, url: "blob:url" }]);
});

test("boundedPreviewRange tracks a wide centered direct preview batch", () => {
  assert.deepEqual(boundedPreviewRange(0, 199, 200, 121, 100), {
    start: 40,
    end: 160,
    count: 121
  });
  assert.deepEqual(boundedPreviewRange(0, 199, 200, 121, 3), {
    start: 0,
    end: 63,
    count: 64
  });
});

test("mergeFrameRanges combines overlapping and adjacent frame ranges", () => {
  assert.deepEqual(mergeFrameRanges([
    { start: 20, end: 25 },
    { start: 10, end: 12 },
    { start: 13, end: 14 },
    { start: 24, end: 30 }
  ]), [
    { start: 10, end: 14, count: 5 },
    { start: 20, end: 30, count: 11 }
  ]);
});

test("subtractFrameRanges returns only uncached spans", () => {
  assert.deepEqual(subtractFrameRanges(
    [{ start: 465, end: 585 }],
    [{ start: 464, end: 584 }]
  ), [
    { start: 585, end: 585, count: 1 }
  ]);
  assert.deepEqual(subtractFrameRanges(
    [{ start: 100, end: 110 }],
    [{ start: 102, end: 104 }, { start: 108, end: 112 }]
  ), [
    { start: 100, end: 101, count: 2 },
    { start: 105, end: 107, count: 3 }
  ]);
});

test("nextPreviewWindowSize doubles an odd preview window up to a cap", () => {
  assert.equal(nextPreviewWindowSize(121, 241), 241);
  assert.equal(nextPreviewWindowSize(49, 241), 97);
  assert.equal(nextPreviewWindowSize(241, 241), 241);
});

test("stepFrame moves one frame and clamps to timeline bounds", () => {
  assert.equal(stepFrame(6, -1, 10), 5);
  assert.equal(stepFrame(6, 1, 10), 7);
  assert.equal(stepFrame(0, -1, 10), 0);
  assert.equal(stepFrame(9, 1, 10), 9);
});

test("frameRangeForSlice returns selected slice global frame bounds", () => {
  assert.deepEqual(frameRangeForSlice({ start: 12, end: 25 }, 100), { start: 12, end: 25 });
  assert.deepEqual(frameRangeForSlice(null, 100), { start: 0, end: 99 });
  assert.deepEqual(frameRangeForSlice({ start: -8, end: 150 }, 100), { start: 0, end: 99 });
});

test("stepFrameWithinRange clamps movement to the selected slice", () => {
  const range = { start: 12, end: 25 };

  assert.equal(clampFrameToRange(5, range), 12);
  assert.equal(clampFrameToRange(30, range), 25);
  assert.equal(stepFrameWithinRange(12, -1, range), 12);
  assert.equal(stepFrameWithinRange(25, 1, range), 25);
  assert.equal(stepFrameWithinRange(18, 1, range), 19);
});

test("frameRangesForSlices omits deleted slices", () => {
  const slices = [
    { id: "a", start: 0, end: 3, deleted: false },
    { id: "b", start: 4, end: 5, deleted: true },
    { id: "c", start: 8, end: 10, deleted: false }
  ];

  assert.deepEqual(frameRangesForSlices(slices, 20), [
    { start: 0, end: 3, count: 4 },
    { start: 8, end: 10, count: 3 }
  ]);
});

test("stepFrameAcrossRanges spans undeleted slices and stops at ends", () => {
  const ranges = [
    { start: 0, end: 3 },
    { start: 8, end: 10 }
  ];

  assert.equal(stepFrameAcrossRanges(2, 1, ranges), 3);
  assert.equal(stepFrameAcrossRanges(3, 1, ranges), 8);
  assert.equal(stepFrameAcrossRanges(8, -1, ranges), 3);
  assert.equal(stepFrameAcrossRanges(0, -1, ranges), 0);
  assert.equal(stepFrameAcrossRanges(10, 1, ranges), 10);
});

test("sliceStepTarget returns previous and next undeleted slice starts", () => {
  const slices = [
    { id: "a", start: 0, end: 3, deleted: false },
    { id: "b", start: 4, end: 5, deleted: true },
    { id: "c", start: 8, end: 10, deleted: false }
  ];

  assert.deepEqual(sliceStepTarget(slices, "a", 1), { sliceId: "c", frame: 8 });
  assert.deepEqual(sliceStepTarget(slices, "c", -1), { sliceId: "a", frame: 0 });
  assert.equal(sliceStepTarget(slices, "a", -1), null);
  assert.equal(sliceStepTarget(slices, "c", 1), null);
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

test("playback helpers loop inside the selected range and respect slice speed", () => {
  const range = { start: 12, end: 14 };

  assert.equal(nextPlaybackFrame(12, range), 13);
  assert.equal(nextPlaybackFrame(14, range), 12);
  assert.equal(nextPlaybackFrame(40, range), 12);
  assert.equal(playbackDelayMs([10, 20, 30], 1, 2), 100);
  assert.equal(playbackDelayMs([0], 0, 1), 10);
});
