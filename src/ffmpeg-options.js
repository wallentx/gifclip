const os = require("node:os");

function availableCpuCount() {
  if (typeof os.availableParallelism === "function") {
    return os.availableParallelism();
  }
  return os.cpus().length || 1;
}

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  const integer = Math.trunc(number);
  return integer > 0 ? integer : null;
}

function configuredFfmpegThreads(env = process.env, cpuCount = availableCpuCount()) {
  const fallback = Math.max(1, Math.min(8, Math.trunc(cpuCount) || 1));
  return positiveInteger(env.GIFCLIP_FFMPEG_THREADS) || fallback;
}

function configuredDuplicateThreads(env = process.env, cpuCount = availableCpuCount()) {
  const fallback = Math.max(1, Math.trunc(cpuCount) || 1);
  return positiveInteger(env.GIFCLIP_DUPLICATE_THREADS) || fallback;
}

function configuredPreviewJobs(env = process.env, cpuCount = availableCpuCount()) {
  const fallback = Math.max(1, Math.min(12, Math.trunc(cpuCount) || 1));
  return positiveInteger(env.GIFCLIP_PREVIEW_JOBS) || fallback;
}

function configuredFfmpegHwaccel(env = process.env) {
  const value = String(env.GIFCLIP_FFMPEG_HWACCEL || "auto").trim();
  const normalized = value.toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "none" || normalized === "off" || normalized === "no") {
    return null;
  }
  return value || "auto";
}

function ffmpegInputArgs(options = {}) {
  const threads = positiveInteger(options.threads) || configuredFfmpegThreads();
  const hwaccel = options.hwaccel === undefined ? configuredFfmpegHwaccel() : options.hwaccel;
  const args = [
    "-threads",
    String(threads),
    "-filter_threads",
    String(threads)
  ];
  if (hwaccel) {
    args.push("-hwaccel", String(hwaccel));
  }
  return args;
}

function ffmpegThreadArgs(options = {}) {
  const threads = positiveInteger(options.threads) || configuredFfmpegThreads();
  return [
    "-threads",
    String(threads),
    "-filter_threads",
    String(threads)
  ];
}

module.exports = {
  configuredDuplicateThreads,
  configuredFfmpegHwaccel,
  configuredFfmpegThreads,
  configuredPreviewJobs,
  ffmpegInputArgs,
  ffmpegThreadArgs
};
