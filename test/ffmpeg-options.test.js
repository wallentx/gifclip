const test = require("node:test");
const assert = require("node:assert/strict");
const {
  configuredDuplicateThreads,
  configuredFfmpegHwaccel,
  configuredFfmpegThreads,
  configuredPreviewJobs,
  ffmpegInputArgs
} = require("../src/ffmpeg-options");

test("configuredFfmpegThreads scales with available CPU count", () => {
  assert.equal(configuredFfmpegThreads({}, 1), 1);
  assert.equal(configuredFfmpegThreads({}, 4), 4);
  assert.equal(configuredFfmpegThreads({}, 16), 8);
});

test("configuredFfmpegThreads accepts an environment override", () => {
  assert.equal(configuredFfmpegThreads({ GIFCLIP_FFMPEG_THREADS: "12" }, 16), 12);
  assert.equal(configuredFfmpegThreads({ GIFCLIP_FFMPEG_THREADS: "0" }, 16), 8);
  assert.equal(configuredFfmpegThreads({ GIFCLIP_FFMPEG_THREADS: "nope" }, 16), 8);
});

test("configuredPreviewJobs uses a larger CPU-scaled preview pool", () => {
  assert.equal(configuredPreviewJobs({}, 1), 1);
  assert.equal(configuredPreviewJobs({}, 4), 4);
  assert.equal(configuredPreviewJobs({}, 16), 12);
});

test("configuredPreviewJobs accepts an environment override", () => {
  assert.equal(configuredPreviewJobs({ GIFCLIP_PREVIEW_JOBS: "6" }, 16), 6);
  assert.equal(configuredPreviewJobs({ GIFCLIP_PREVIEW_JOBS: "0" }, 16), 12);
  assert.equal(configuredPreviewJobs({ GIFCLIP_PREVIEW_JOBS: "nope" }, 16), 12);
});

test("configuredDuplicateThreads defaults to the full available CPU count", () => {
  assert.equal(configuredDuplicateThreads({}, 1), 1);
  assert.equal(configuredDuplicateThreads({}, 4), 4);
  assert.equal(configuredDuplicateThreads({}, 16), 16);
});

test("configuredDuplicateThreads accepts an environment override", () => {
  assert.equal(configuredDuplicateThreads({ GIFCLIP_DUPLICATE_THREADS: "24" }, 16), 24);
  assert.equal(configuredDuplicateThreads({ GIFCLIP_DUPLICATE_THREADS: "0" }, 16), 16);
  assert.equal(configuredDuplicateThreads({ GIFCLIP_DUPLICATE_THREADS: "nope" }, 16), 16);
});

test("configuredFfmpegHwaccel defaults to automatic hardware decode", () => {
  assert.equal(configuredFfmpegHwaccel({}), "auto");
  assert.equal(configuredFfmpegHwaccel({ GIFCLIP_FFMPEG_HWACCEL: "none" }), null);
  assert.equal(configuredFfmpegHwaccel({ GIFCLIP_FFMPEG_HWACCEL: "off" }), null);
  assert.equal(configuredFfmpegHwaccel({ GIFCLIP_FFMPEG_HWACCEL: "cuda" }), "cuda");
});

test("ffmpegInputArgs emits threading and hardware decode options", () => {
  assert.deepEqual(ffmpegInputArgs({ threads: 6, hwaccel: "auto" }), [
    "-threads",
    "6",
    "-filter_threads",
    "6",
    "-hwaccel",
    "auto"
  ]);
});

test("ffmpegInputArgs can disable hardware decode probing", () => {
  assert.deepEqual(ffmpegInputArgs({ threads: 6, hwaccel: null }), [
    "-threads",
    "6",
    "-filter_threads",
    "6"
  ]);
});
