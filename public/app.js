"use strict";

const state = {
  project: null,
  sourceId: "",
  selectedSliceId: null,
  framePreview: null,
  frameHoldControllers: [],
  previewPrewarmRequestId: 0,
  previewPrewarmController: null,
  playbackTimer: null,
  playbackMode: "play",
  playbackPlan: [],
  playbackIndex: 0,
  playing: false,
  exporting: false,
  analyzingDuplicates: false,
  speedEditingSliceId: null,
  statusMessage: "Choose a GIF to start.",
  frameStatus: "",
  batchStatus: "",
  cachedPreviewRanges: [],
  loadingPreviewRanges: [],
  previewCacheStatusRequestId: 0
};

const PREVIEW_WINDOW_FRAMES = 121;
const MAX_PREVIEW_WINDOW_FRAMES = 241;

const els = {
  uploadInput: document.querySelector("#uploadInput"),
  configBtn: document.querySelector("#configBtn"),
  configDialog: document.querySelector("#configDialog"),
  pasteBlueprintBtn: document.querySelector("#pasteBlueprintBtn"),
  pasteBlueprintDialog: document.querySelector("#pasteBlueprintDialog"),
  blueprintText: document.querySelector("#blueprintText"),
  loadBlueprintTextBtn: document.querySelector("#loadBlueprintTextBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  exportDialog: document.querySelector("#exportDialog"),
  startExportBtn: document.querySelector("#startExportBtn"),
  outputLink: document.querySelector("#outputLink"),
  exportProgress: document.querySelector("#exportProgress"),
  exportBar: document.querySelector("#exportBar"),
  exportPhase: document.querySelector("#exportPhase"),
  previewStage: document.querySelector("#previewStage"),
  preview: document.querySelector("#preview"),
  status: document.querySelector("#status"),
  frameSlider: document.querySelector("#frameSlider"),
  previewRenderBar: document.querySelector("#previewRenderBar"),
  frameMarker: document.querySelector("#frameMarker"),
  playBtn: document.querySelector("#playBtn"),
  loopPlayBtn: document.querySelector("#loopPlayBtn"),
  prevSliceBtn: document.querySelector("#prevSliceBtn"),
  nextSliceBtn: document.querySelector("#nextSliceBtn"),
  prevFrameBtn: document.querySelector("#prevFrameBtn"),
  nextFrameBtn: document.querySelector("#nextFrameBtn"),
  frameLabel: document.querySelector("#frameLabel"),
  toolFrameLabel: document.querySelector("#toolFrameLabel"),
  delayLabel: document.querySelector("#delayLabel"),
  delayInput: document.querySelector("#delayInput"),
  splitBtn: document.querySelector("#splitBtn"),
  dupeBtn: document.querySelector("#dupeBtn"),
  dupeFuzzInput: document.querySelector("#dupeFuzzInput"),
  speedDialog: document.querySelector("#speedDialog"),
  speedDialogTitle: document.querySelector("#speedDialogTitle"),
  speedInput: document.querySelector("#speedInput"),
  speedSlider: document.querySelector("#speedSlider"),
  exportMode: document.querySelector("#exportMode"),
  exportFps: document.querySelector("#exportFps"),
  exportColors: document.querySelector("#exportColors"),
  exportScaleWidth: document.querySelector("#exportScaleWidth"),
  exportOptimizeLevel: document.querySelector("#exportOptimizeLevel"),
  copyBlueprintBtn: document.querySelector("#copyBlueprintBtn"),
  downloadBlueprintBtn: document.querySelector("#downloadBlueprintBtn"),
  blueprintInput: document.querySelector("#blueprintInput"),
  sliceList: document.querySelector("#sliceList")
};

async function api(path, options = {}) {
  const init = { ...options };
  if (typeof init.body === "string") {
    init.headers = {
      "content-type": "application/json",
      ...(init.headers || {})
    };
  }

  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || body.message || response.statusText);
  }
  return response.json();
}

function setStatus(message) {
  state.statusMessage = message;
  renderStatus();
}

function setFrameStatus(message) {
  state.frameStatus = message;
  renderStatus();
}

function setBatchStatus(message) {
  state.batchStatus = message;
  renderStatus();
}

function renderStatus() {
  els.status.textContent = [state.statusMessage, state.frameStatus, state.batchStatus]
    .filter(Boolean)
    .join(" | ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setExportProgress(job) {
  els.exportProgress.hidden = false;
  els.exportBar.value = job.progress || 0;
  const suffix = Number.isFinite(job.progress) ? ` ${job.progress}%` : "";
  els.exportPhase.textContent = `${job.phase || "Exporting"}${suffix}`;
}

async function waitForExportJob(jobId) {
  for (;;) {
    const { job } = await api(`/api/export/status/${encodeURIComponent(jobId)}`);
    setExportProgress(job);

    if (job.done) {
      if (job.error) {
        throw new Error(job.error);
      }
      return job.result;
    }

    await sleep(350);
  }
}

async function waitForDuplicateJob(jobId) {
  for (;;) {
    const { job } = await api(`/api/analyze-duplicates/status/${encodeURIComponent(jobId)}`);
    const suffix = Number.isFinite(job.progress) ? ` ${job.progress}%` : "";
    setStatus(`${job.phase || "Analyzing duplicates"}${suffix}`);

    if (job.done) {
      if (job.error) {
        throw new Error(job.error);
      }
      return job.result;
    }

    await sleep(350);
  }
}

async function refreshPreviewCacheStatus(range = sourceFrameRange()) {
  if (!state.project) return;
  const requestId = state.previewCacheStatusRequestId + 1;
  state.previewCacheStatusRequestId = requestId;
  const result = await api("/api/preview-cache/status", {
    method: "POST",
    body: JSON.stringify({
      project: { id: state.project.id },
      start: range.start,
      end: range.end,
      max: 900
    })
  });
  if (requestId !== state.previewCacheStatusRequestId) return;
  state.cachedPreviewRanges = mergeRanges(result.ranges || []);
  state.loadingPreviewRanges = subtractRanges(state.loadingPreviewRanges, state.cachedPreviewRanges);
  renderTimelineCacheBar();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDelayMs(delayCs) {
  const delay = Math.max(1, Math.round(Number(delayCs) || 1));
  return `${delay * 10} ms`;
}

function frameCount(slice) {
  return slice.end - slice.start + 1;
}

function currentFrame() {
  return Number(els.frameSlider.value) || 0;
}

function selectedSlice() {
  if (!state.project) return null;
  return state.project.slices.find((slice) => slice.id === state.selectedSliceId) || state.project.slices[0] || null;
}

function selectedFrameRange() {
  if (!state.project) return { start: 0, end: 0 };
  return window.GifclipFramePreview.frameRangeForSlice(selectedSlice(), state.project.source.frameCount);
}

function activeFrameRanges() {
  if (!state.project) return [];
  return window.GifclipFramePreview.frameRangesForSlices(state.project.slices, state.project.source.frameCount);
}

function activeSlices() {
  return state.project ? state.project.slices.filter((slice) => !slice.deleted) : [];
}

function sourceFrameRange() {
  if (!state.project) return { start: 0, end: 0 };
  return { start: 0, end: state.project.source.frameCount - 1 };
}

function mergeRanges(ranges) {
  return window.GifclipFramePreview.mergeFrameRanges(ranges);
}

function subtractRanges(ranges, subtractors) {
  return window.GifclipFramePreview.subtractFrameRanges(ranges, subtractors);
}

function addCachedPreviewRanges(ranges) {
  state.cachedPreviewRanges = mergeRanges([...state.cachedPreviewRanges, ...(ranges || [])]);
  state.loadingPreviewRanges = subtractRanges(state.loadingPreviewRanges, state.cachedPreviewRanges);
  renderTimelineCacheBar();
}

function addLoadingPreviewRanges(ranges) {
  const missingRanges = subtractRanges(ranges || [], state.cachedPreviewRanges);
  state.loadingPreviewRanges = mergeRanges([...state.loadingPreviewRanges, ...missingRanges]);
  renderTimelineCacheBar();
  return missingRanges;
}

function removeLoadingPreviewRanges(ranges) {
  state.loadingPreviewRanges = subtractRanges(state.loadingPreviewRanges, ranges || []);
  renderTimelineCacheBar();
}

function frameRangeCount(ranges) {
  return mergeRanges(ranges).reduce((total, range) => total + range.count, 0);
}

function renderTimelineCacheBar() {
  if (!els.previewRenderBar) return;
  els.previewRenderBar.innerHTML = "";
  renderTimelineMarker();
  if (!state.project) return;

  const visible = selectedFrameRange();
  const visibleCount = Math.max(1, visible.end - visible.start + 1);

  function appendSegments(ranges, className) {
    for (const range of mergeRanges(ranges)) {
      const start = Math.max(range.start, visible.start);
      const end = Math.min(range.end, visible.end);
      if (end < start) continue;
      const segment = document.createElement("span");
      segment.className = `previewRenderBarSegment ${className}`;
      const left = ((start - visible.start) / visibleCount) * 100;
      const width = ((end - start + 1) / visibleCount) * 100;
      segment.style.left = `${left}%`;
      segment.style.width = `${width}%`;
      els.previewRenderBar.appendChild(segment);
    }
  }

  appendSegments(state.loadingPreviewRanges, "loading");
  appendSegments(state.cachedPreviewRanges, "cached");
}

function renderTimelineMarker() {
  if (!els.frameMarker || !state.project) {
    if (els.frameMarker) els.frameMarker.style.left = "0%";
    return;
  }
  const visible = selectedFrameRange();
  const visibleCount = Math.max(1, visible.end - visible.start);
  const frame = window.GifclipFramePreview.clampFrameToRange(currentFrame(), visible);
  const offset = visible.end === visible.start ? 0 : ((frame - visible.start) / visibleCount) * 100;
  els.frameMarker.style.left = `${offset}%`;
}

function selectedSliceSpeed() {
  const slice = selectedSlice();
  return slice ? slice.speed : 1;
}

function sliceForFrame(frame) {
  if (!state.project) return null;
  return state.project.slices.find((slice) => frame >= slice.start && frame <= slice.end) || null;
}

function buildPlaybackPlan(project, onlySliceId = null) {
  if (!project) return [];
  const frames = [];
  for (const slice of project.slices) {
    if (onlySliceId && slice.id !== onlySliceId) continue;
    if (slice.deleted) continue;
    const duplicates = new Set(slice.duplicateFrames || []);
    let lastKept = null;
    for (let frame = slice.start; frame <= slice.end; frame += 1) {
      const originalDelay = Number(project.source.delaysCs[frame]) || 1;
      const speed = Number(slice.speed) > 0 ? Number(slice.speed) : 1;
      const delayMs = Math.max(10, Math.round((originalDelay * 10) / speed));
      if (duplicates.has(frame)) {
        if (lastKept) lastKept.delayMs += delayMs;
        continue;
      }
      lastKept = { sourceIndex: frame, delayMs, sliceId: slice.id };
      frames.push(lastKept);
    }
  }
  return frames;
}

function refreshPlaybackPlan(onlySliceId = null) {
  state.playbackPlan = buildPlaybackPlan(state.project, onlySliceId);
  if (state.playbackIndex >= state.playbackPlan.length) {
    state.playbackIndex = 0;
  }
}

function playbackPlanIndexForFrame(frame) {
  const exact = state.playbackPlan.findIndex((item) => item.sourceIndex === frame);
  if (exact !== -1) return exact;
  const next = state.playbackPlan.findIndex((item) => item.sourceIndex > frame);
  return next === -1 ? -1 : next;
}

function nextSliceId(slices) {
  let max = 0;
  for (const slice of slices) {
    const match = /^slice-(\d+)$/.exec(slice.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `slice-${max + 1}`;
}

function setControlsEnabled(enabled) {
  els.exportBtn.disabled = !enabled || state.exporting;
  els.configBtn.disabled = !enabled;
  els.startExportBtn.disabled = !enabled || state.exporting;
  els.frameSlider.disabled = !enabled;
  els.playBtn.disabled = !enabled;
  els.loopPlayBtn.disabled = !enabled;
  els.prevSliceBtn.disabled = !enabled;
  els.nextSliceBtn.disabled = !enabled;
  els.prevFrameBtn.disabled = !enabled;
  els.nextFrameBtn.disabled = !enabled;
  els.splitBtn.disabled = !enabled;
  els.dupeBtn.disabled = !enabled || state.analyzingDuplicates;
  els.dupeFuzzInput.disabled = !enabled;
  els.speedInput.disabled = !enabled;
  els.speedSlider.disabled = !enabled;
  els.delayInput.disabled = !enabled;
  els.copyBlueprintBtn.disabled = !enabled;
  els.downloadBlueprintBtn.disabled = !enabled;
  els.pasteBlueprintBtn.disabled = !enabled;
  updateExportOptionControls();
}

function ignorePreviewAbort(error) {
  if (error.name !== "AbortError") setStatus(error.message);
}

function previewBatchForFrame(frame, range = selectedFrameRange(), maxFrames = PREVIEW_WINDOW_FRAMES) {
  if (!state.project) return null;
  return window.GifclipFramePreview.boundedPreviewRange(
    range.start,
    range.end,
    state.project.source.frameCount,
    maxFrames,
    frame
  );
}

function formatFrameRange(range) {
  if (range.start === range.end) return `${range.start + 1}`;
  return `${range.start + 1}-${range.end + 1}`;
}

function setLoadingBatchForFrame(frame, range = selectedFrameRange(), maxFrames = PREVIEW_WINDOW_FRAMES) {
  const batch = previewBatchForFrame(frame, range, maxFrames);
  if (!batch) return null;
  const missingRanges = addLoadingPreviewRanges([batch]);
  const missingCount = frameRangeCount(missingRanges);
  if (missingCount > 0) {
    setBatchStatus(`Loading ${formatGeneratedCount(missingCount)} ${formatGeneratedRanges(missingRanges)}...`);
  } else {
    setBatchStatus(`Frames ${formatFrameRange(batch)} already cached.`);
  }
  return { ...batch, missingRanges };
}

function formatGeneratedRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return "";
  return ranges.map((range) => formatFrameRange(range)).join(", ");
}

function formatGeneratedCount(count) {
  return count === 1 ? "1 new frame" : `${count} new frames`;
}

function prewarmPreviewWindow(frame = currentFrame()) {
  if (!state.project || state.playing) return;

  const range = selectedFrameRange();
  const requestId = state.previewPrewarmRequestId + 1;
  state.previewPrewarmRequestId = requestId;
  if (state.previewPrewarmController) {
    state.previewPrewarmController.abort();
  }
  state.previewPrewarmController = new AbortController();

  runPreviewPrewarm(frame, range, PREVIEW_WINDOW_FRAMES, requestId, state.previewPrewarmController.signal);
}

function runPreviewPrewarm(frame, range, maxFrames, requestId, signal) {
  const batch = setLoadingBatchForFrame(frame, range, maxFrames);

  api("/api/prewarm-preview", {
    method: "POST",
    signal,
    body: JSON.stringify({
      project: { id: state.project.id },
      start: range.start,
      end: range.end,
      center: frame,
      max: 900,
      maxFrames
    })
  }).then((result) => {
    if (requestId === state.previewPrewarmRequestId && batch) {
      removeLoadingPreviewRanges(batch.missingRanges);
      addCachedPreviewRanges([{ start: result.start, end: result.end }]);
      if (result.generated > 0) {
        setBatchStatus(
          `Loaded ${formatGeneratedCount(result.generated)} ${formatGeneratedRanges(result.generatedRanges)}.`
        );
      } else {
        setBatchStatus(`Frames ${formatFrameRange(batch)} already cached.`);
      }
      const nextMaxFrames = window.GifclipFramePreview.nextPreviewWindowSize(maxFrames, MAX_PREVIEW_WINDOW_FRAMES);
      if (nextMaxFrames > maxFrames && !signal.aborted) {
        runPreviewPrewarm(frame, range, nextMaxFrames, requestId, signal);
      }
    }
  }).catch((error) => {
    if (error.name === "AbortError") {
      removeLoadingPreviewRanges(batch?.missingRanges);
      return;
    }
    if (requestId === state.previewPrewarmRequestId) {
      console.debug("Preview prewarm failed", error);
      removeLoadingPreviewRanges(batch?.missingRanges);
      setBatchStatus(`Frame batch failed: ${error.message}`);
    }
  });
}

async function showFrame(frame, options = {}) {
  const loadingFrame = addLoadingPreviewRanges([{ start: frame, end: frame }]);
  try {
    await state.framePreview.show(frame);
    removeLoadingPreviewRanges(loadingFrame);
    addCachedPreviewRanges([{ start: frame, end: frame }]);
    if (options.prewarm !== false) {
      prewarmPreviewWindow(frame);
    }
  } catch (error) {
    removeLoadingPreviewRanges(loadingFrame);
    throw error;
  }
}

function updatePlayButton(range = selectedFrameRange()) {
  const playPlan = buildPlaybackPlan(state.project);
  const loopPlan = buildPlaybackPlan(state.project, selectedSlice()?.id);
  els.playBtn.disabled = playPlan.length <= 1;
  els.loopPlayBtn.disabled = loopPlan.length <= 1 || range.end <= range.start;
  els.playBtn.textContent = state.playing && state.playbackMode === "play" ? "⏸" : "▶";
  els.loopPlayBtn.textContent = state.playing && state.playbackMode === "loop" ? "⏸" : "↻";
}

function updateExportOptionControls() {
  const optimized = Boolean(state.project) && els.exportMode.value === "optimized";
  els.exportFps.disabled = !optimized;
  els.exportColors.disabled = !optimized;
  els.exportScaleWidth.disabled = !optimized;
  els.exportOptimizeLevel.disabled = !optimized;
}

function optionalPositiveInteger(input) {
  const raw = String(input.value || "").trim();
  if (!raw) return null;
  const value = Math.round(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getExportOptions() {
  if (els.exportMode.value !== "optimized") {
    return { method: "native" };
  }
  return {
    method: "optimized",
    fps: optionalPositiveInteger(els.exportFps),
    colors: optionalPositiveInteger(els.exportColors) || 32,
    scaleWidth: optionalPositiveInteger(els.exportScaleWidth),
    optimizeLevel: optionalPositiveInteger(els.exportOptimizeLevel) || 3
  };
}

function renderProject() {
  const project = state.project;
  setControlsEnabled(Boolean(project));

  if (!project) {
    els.preview.removeAttribute("src");
    els.previewStage.classList.add("is-empty");
    els.frameSlider.min = "0";
    els.frameSlider.max = "0";
    els.frameSlider.value = "0";
    els.frameLabel.textContent = "0";
    els.toolFrameLabel.textContent = "0";
    els.delayLabel.textContent = "Delay for frame 0";
    els.delayInput.value = "10";
    els.playBtn.textContent = "▶";
    els.loopPlayBtn.textContent = "↻";
    els.speedInput.value = "1";
    els.speedSlider.value = "1";
    els.sliceList.innerHTML = '<div class="emptyState">No GIF loaded.</div>';
    renderTimelineCacheBar();
    return;
  }

  const active = selectedSlice();
  els.previewStage.classList.remove("is-empty");
  const range = selectedFrameRange();
  const requestedFrame = Number.isInteger(project.currentFrame) ? project.currentFrame : currentFrame();
  const frame = window.GifclipFramePreview.clampFrameToRange(requestedFrame, range);
  project.currentFrame = frame;
  els.frameSlider.min = String(range.start);
  els.frameSlider.max = String(range.end);
  els.frameSlider.value = String(frame);
  els.frameLabel.textContent = `${frame + 1} / ${project.source.frameCount}`;
  els.toolFrameLabel.textContent = `${frame + 1} / ${project.source.frameCount}`;
  els.delayLabel.textContent = `Delay for frame ${frame + 1}`;
  const delayCs = Math.max(1, Math.round(Number(project.source.delaysCs[frame]) || 1));
  els.delayInput.value = String(delayCs * 10);
  updatePlayButton(range);
  const frameRanges = activeFrameRanges();
  els.prevFrameBtn.disabled = window.GifclipFramePreview.stepFrameAcrossRanges(frame, -1, frameRanges) === frame;
  els.nextFrameBtn.disabled = window.GifclipFramePreview.stepFrameAcrossRanges(frame, 1, frameRanges) === frame;
  els.prevSliceBtn.disabled = !window.GifclipFramePreview.sliceStepTarget(project.slices, state.selectedSliceId, -1);
  els.nextSliceBtn.disabled = !window.GifclipFramePreview.sliceStepTarget(project.slices, state.selectedSliceId, 1);

  const speedValue = active ? String(active.speed) : "1";
  els.speedInput.value = speedValue;
  els.speedSlider.value = speedValue;
  els.dupeBtn.disabled = !active || state.analyzingDuplicates;
  els.dupeBtn.textContent = state.analyzingDuplicates ? "Detecting..." : "Detect and delete duplicates";
  els.speedInput.disabled = !active;
  els.speedSlider.disabled = !active;
  els.delayInput.disabled = !active;
  els.splitBtn.disabled = !canSplitAt(frame);
  renderTimelineCacheBar();

  els.sliceList.innerHTML = "";
  for (const slice of project.slices) {
    const node = document.createElement("article");
    node.className = `slice${slice.id === state.selectedSliceId ? " active" : ""}${slice.deleted ? " deleted" : ""}`;
    node.innerHTML = `
      <div class="sliceTop">
        <div class="sliceName">${slice.id}</div>
        <button type="button" data-speed-slice="${slice.id}">${slice.speed}x</button>
        <button type="button" data-delete="${slice.id}">${slice.deleted ? "Restore" : "Delete"}</button>
      </div>
      <div class="sliceMeta">
        <div>Frames ${slice.start + 1}-${slice.end + 1} (${frameCount(slice)})</div>
        <div>${slice.speed}x speed - ${slice.duplicateFrames.length} duplicates marked</div>
      </div>
    `;
    node.dataset.select = slice.id;
    els.sliceList.appendChild(node);
  }
}

function canSplitAt(frame) {
  if (!state.project) return false;
  return state.project.slices.some((slice) => frame >= slice.start && frame < slice.end);
}

async function applyProject(project, options = {}) {
  state.project = project;
  state.cachedPreviewRanges = [];
  state.loadingPreviewRanges = [];
  const current = Number.isInteger(project.currentFrame) ? project.currentFrame : 0;
  state.selectedSliceId = sliceForFrame(current)?.id || project.slices[0]?.id || null;
  refreshPlaybackPlan();
  state.playbackIndex = 0;
  stopFrameHolds();
  state.framePreview.cancel();
  els.frameSlider.value = String(project.currentFrame || 0);
  renderProject();
  await refreshPreviewCacheStatus();
  await showFrame(currentFrame());
  const sourceName = project.source.basename || project.source.name || project.source.id;
  setStatus(options.status || `${sourceName}: ${project.source.width}x${project.source.height}, ${project.source.frameCount} frames.`);
}

async function uploadGif(file) {
  if (!file) return;
  stopPlayback();
  setStatus(`Uploading ${file.name}...`);
  const response = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "content-type": "image/gif" },
    body: await file.arrayBuffer()
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || response.statusText);
  }
  const { project } = await response.json();
  state.sourceId = project.source.id;
  await applyProject(project, { status: "" });
}

function updateFrameFromSlider(delayMs, options = {}) {
  const frame = currentFrame();
  if (state.project) state.project.currentFrame = frame;
  renderProject();
  if (delayMs === 0) {
    showFrame(frame, options).catch(ignorePreviewAbort);
    return;
  }
  setFrameStatus(`Loading frame ${frame + 1}...`);
  addLoadingPreviewRanges([{ start: frame, end: frame }]);
  state.framePreview.schedule(frame, delayMs);
}

function clearPlaybackTimer() {
  if (state.playbackTimer !== null) {
    clearTimeout(state.playbackTimer);
    state.playbackTimer = null;
  }
}

function stopPlayback() {
  state.playing = false;
  clearPlaybackTimer();
  updatePlayButton();
}

function playbackDelayForFrame(frame) {
  return state.playbackPlan[state.playbackIndex]?.delayMs ||
    window.GifclipFramePreview.playbackDelayMs(state.project?.source.delaysCs, frame, selectedSliceSpeed());
}

function setPlaybackFrame(frame, options = {}) {
  const slice = sliceForFrame(frame);
  if (slice) state.selectedSliceId = slice.id;
  state.project.currentFrame = frame;
  renderProject();
  showFrame(frame, options).catch(ignorePreviewAbort);
}

function schedulePlaybackTick() {
  clearPlaybackTimer();
  if (!state.playing || !state.project) return;

  state.playbackTimer = setTimeout(() => {
    state.playbackTimer = null;
    if (!state.playing || !state.project) return;

    if (state.playbackPlan.length === 0) {
      stopPlayback();
      return;
    }

    let nextIndex = state.playbackIndex + 1;
    if (nextIndex >= state.playbackPlan.length) {
      if (state.playbackMode !== "loop") {
        stopPlayback();
        return;
      }
      nextIndex = 0;
    }
    state.playbackIndex = nextIndex;
    const nextFrame = state.playbackPlan[state.playbackIndex].sourceIndex;
    setPlaybackFrame(nextFrame, { prewarm: false });
    schedulePlaybackTick();
  }, playbackDelayForFrame(currentFrame()));
}

function startPlayback(mode = "play") {
  if (!state.project) return;
  state.playbackMode = mode;
  refreshPlaybackPlan(mode === "loop" ? selectedSlice()?.id : null);
  if (state.playbackPlan.length <= 1) return;
  state.playbackIndex = playbackPlanIndexForFrame(currentFrame());
  if (state.playbackIndex < 0) return;
  setPlaybackFrame(state.playbackPlan[state.playbackIndex].sourceIndex, { prewarm: false });

  stopFrameHolds();
  state.playing = true;
  updatePlayButton();
  schedulePlaybackTick();
}

function togglePlayback(mode = "play") {
  if (state.playing) {
    stopPlayback();
    return;
  }
  startPlayback(mode);
}

function canMoveFrame(delta) {
  if (!state.project) return false;
  const frame = currentFrame();
  return window.GifclipFramePreview.stepFrameAcrossRanges(frame, delta, activeFrameRanges()) !== frame;
}

function moveFrame(delta) {
  if (!state.project) return;
  stopPlayback();
  const current = currentFrame();
  const frame = window.GifclipFramePreview.stepFrameAcrossRanges(current, delta, activeFrameRanges());
  if (frame === current) return;

  const slice = sliceForFrame(frame);
  if (slice) state.selectedSliceId = slice.id;
  els.frameSlider.value = String(frame);
  updateFrameFromSlider(0);
}

function moveSlice(delta) {
  if (!state.project) return;
  const target = window.GifclipFramePreview.sliceStepTarget(state.project.slices, state.selectedSliceId, delta);
  if (!target) return;
  stopPlayback();
  state.selectedSliceId = target.sliceId;
  state.project.currentFrame = target.frame;
  els.frameSlider.value = String(target.frame);
  renderProject();
  showFrame(target.frame).catch(ignorePreviewAbort);
}

function stopFrameHolds() {
  for (const controller of state.frameHoldControllers) {
    controller.stop();
  }
}

function bindFrameHoldButton(button, delta) {
  const controller = window.GifclipFramePreview.createHoldRepeatController({
    step: () => moveFrame(delta),
    canStep: () => canMoveFrame(delta)
  });

  function capturePointer(event) {
    try {
      button.setPointerCapture?.(event.pointerId);
    } catch {
      // Some browsers reject capture after cancellation; repeating still works without it.
    }
  }

  function releasePointer(event) {
    try {
      if (button.hasPointerCapture?.(event.pointerId)) {
        button.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore stale pointer ids.
    }
  }

  button.addEventListener("pointerdown", (event) => {
    if (button.disabled || event.button > 0) return;
    event.preventDefault();
    capturePointer(event);
    controller.start();
  });

  button.addEventListener("pointerup", (event) => {
    releasePointer(event);
    controller.stop();
  });
  button.addEventListener("pointerleave", () => controller.stop());
  button.addEventListener("pointercancel", () => controller.stop());
  button.addEventListener("lostpointercapture", () => controller.stop());

  button.addEventListener("keydown", (event) => {
    if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
    event.preventDefault();
    controller.start();
  });
  button.addEventListener("keyup", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      controller.stop();
    }
  });
  button.addEventListener("blur", () => controller.stop());
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  button.addEventListener("dragstart", (event) => event.preventDefault());
  button.addEventListener("selectstart", (event) => event.preventDefault());

  return controller;
}

function splitLocal(frame) {
  if (!state.project || !canSplitAt(frame)) return;
  stopPlayback();

  const project = structuredClone(state.project);
  const sliceIndex = project.slices.findIndex((slice) => frame >= slice.start && frame < slice.end);
  const slice = project.slices[sliceIndex];
  const left = {
    ...slice,
    end: frame,
    duplicateFrames: slice.duplicateFrames.filter((duplicate) => duplicate <= frame)
  };
  const right = {
    ...slice,
    id: nextSliceId(project.slices),
    start: frame + 1,
    duplicateFrames: slice.duplicateFrames.filter((duplicate) => duplicate > frame)
  };

  project.slices.splice(sliceIndex, 1, left, right);
  state.project = project;
  state.selectedSliceId = right.id;
  renderProject();
  showFrame(currentFrame()).catch(ignorePreviewAbort);
  setStatus(`Split at frame ${frame + 1}.`);
}

function updateSelectedSpeed(value = els.speedInput.value, options = {}) {
  const slice = selectedSlice();
  if (!slice) return;

  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0 || speed > 16) {
    els.speedInput.value = String(slice.speed);
    els.speedSlider.value = String(slice.speed);
    setStatus("Slice speed must be greater than 0 and no more than 16.");
    return;
  }

  slice.speed = speed;
  refreshPlaybackPlan(state.playbackMode === "loop" ? selectedSlice()?.id : null);
  renderProject();
  if (options.announce !== false) {
    setStatus(`${slice.id} speed set to ${speed}x.`);
  }
}

function openSpeedDialog(sliceId) {
  const slice = state.project?.slices.find((item) => item.id === sliceId);
  if (!slice) return;
  state.selectedSliceId = slice.id;
  state.speedEditingSliceId = slice.id;
  els.speedDialogTitle.textContent = `${slice.id} Speed`;
  els.speedInput.value = String(slice.speed);
  els.speedSlider.value = String(slice.speed);
  renderProject();
  els.speedDialog.showModal();
}

function updateCurrentFrameDelay(value = els.delayInput.value) {
  if (!state.project) return;
  const frame = currentFrame();
  const delayMs = Math.round(Number(value));
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    els.delayInput.value = String((state.project.source.delaysCs[frame] || 1) * 10);
    setStatus("Frame delay must be a positive millisecond value.");
    return;
  }

  stopPlayback();
  const delayCs = Math.max(1, Math.round(delayMs / 10));
  const delaysCs = [...state.project.source.delaysCs];
  delaysCs[frame] = delayCs;
  state.project = {
    ...state.project,
    source: {
      ...state.project.source,
      delaysCs
    }
  };
  refreshPlaybackPlan(state.playbackMode === "loop" ? selectedSlice()?.id : null);
  renderProject();
  setStatus(`Frame ${frame + 1} delay set to ${delayCs * 10} ms.`);
}

function selectSlice(sliceId) {
  state.selectedSliceId = sliceId;
  stopPlayback();
  stopFrameHolds();
  renderProject();
  showFrame(currentFrame()).catch(ignorePreviewAbort);
}

function toggleSliceDeleted(sliceId) {
  const slice = state.project?.slices.find((item) => item.id === sliceId);
  if (!slice) return;

  slice.deleted = !slice.deleted;
  state.selectedSliceId = sliceId;
  stopPlayback();
  stopFrameHolds();
  renderProject();
  showFrame(currentFrame()).catch(ignorePreviewAbort);
  setStatus(`${slice.id} ${slice.deleted ? "deleted" : "restored"}.`);
}

async function fetchBlueprint() {
  if (!state.project) return null;
  const { blueprint } = await api("/api/blueprint/export", {
    method: "POST",
    body: JSON.stringify({ project: state.project })
  });
  return blueprint;
}

async function copyBlueprint() {
  const blueprint = await fetchBlueprint();
  if (!blueprint) return;
  await navigator.clipboard.writeText(JSON.stringify(blueprint, null, 2));
  setStatus("Blueprint copied.");
}

async function downloadBlueprint() {
  const blueprint = await fetchBlueprint();
  if (!blueprint) return;
  const sourceName = state.project.source.basename || "gifclip";
  const name = `${sourceName.replace(/\.gif$/i, "")}.gifclip.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(blueprint, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Blueprint downloaded.");
}

async function loadBlueprintFile(file) {
  if (!file) return;
  const blueprint = JSON.parse(await file.text());
  await loadBlueprint(blueprint);
}

async function loadBlueprint(blueprint) {
  stopPlayback();
  const { project } = await api("/api/blueprint/load", {
    method: "POST",
    body: JSON.stringify({
      ...(state.sourceId ? { sourceId: state.sourceId } : {}),
      blueprint
    })
  });
  await applyProject(project, { status: "Blueprint loaded." });
}

els.uploadInput.addEventListener("change", () => {
  const file = els.uploadInput.files?.[0];
  uploadGif(file).catch((error) => setStatus(error.message)).finally(() => {
    els.uploadInput.value = "";
  });
});

els.configBtn.addEventListener("click", () => {
  els.configDialog.showModal();
});

els.exportBtn.addEventListener("click", () => {
  if (!state.project) return;
  els.exportDialog.showModal();
});

els.pasteBlueprintBtn.addEventListener("click", () => {
  els.configDialog.close();
  els.blueprintText.value = "";
  els.pasteBlueprintDialog.showModal();
});

els.loadBlueprintTextBtn.addEventListener("click", () => {
  try {
    const blueprint = JSON.parse(els.blueprintText.value);
    loadBlueprint(blueprint)
      .then(() => els.pasteBlueprintDialog.close())
      .catch((error) => setStatus(error.message));
  } catch (error) {
    setStatus(error.message);
  }
});

els.copyBlueprintBtn.addEventListener("click", () => {
  copyBlueprint().catch((error) => setStatus(error.message));
});

els.downloadBlueprintBtn.addEventListener("click", () => {
  downloadBlueprint().catch((error) => setStatus(error.message));
});

els.blueprintInput.addEventListener("change", () => {
  const file = els.blueprintInput.files?.[0];
  loadBlueprintFile(file).catch((error) => setStatus(error.message)).finally(() => {
    els.blueprintInput.value = "";
  });
});

els.frameSlider.addEventListener("input", () => {
  stopPlayback();
  updateFrameFromSlider(80);
});
els.frameSlider.addEventListener("change", () => {
  stopPlayback();
  updateFrameFromSlider(0);
});
els.playBtn.addEventListener("click", () => togglePlayback("play"));
els.loopPlayBtn.addEventListener("click", () => togglePlayback("loop"));
els.prevSliceBtn.addEventListener("click", () => moveSlice(-1));
els.nextSliceBtn.addEventListener("click", () => moveSlice(1));

els.splitBtn.addEventListener("click", () => {
  splitLocal(currentFrame());
});

els.sliceList.addEventListener("click", (event) => {
  const deleteId = event.target.dataset.delete;
  if (deleteId) {
    event.stopPropagation();
    toggleSliceDeleted(deleteId);
    return;
  }

  const speedSliceId = event.target.dataset.speedSlice;
  if (speedSliceId) {
    event.stopPropagation();
    openSpeedDialog(speedSliceId);
    return;
  }

  const sliceNode = event.target.closest(".slice");
  if (sliceNode?.dataset.select) {
    selectSlice(sliceNode.dataset.select);
  }
});

els.speedInput.addEventListener("input", () => {
  els.speedSlider.value = els.speedInput.value;
});
els.speedInput.addEventListener("change", () => updateSelectedSpeed(els.speedInput.value));
els.speedSlider.addEventListener("input", () => {
  updateSelectedSpeed(els.speedSlider.value, { announce: false });
});

els.delayInput.addEventListener("change", () => {
  updateCurrentFrameDelay(els.delayInput.value);
});

els.exportMode.addEventListener("change", updateExportOptionControls);

document.querySelectorAll("[data-speed]").forEach((button) => {
  button.addEventListener("click", () => updateSelectedSpeed(button.dataset.speed));
});

els.dupeBtn.addEventListener("click", async () => {
  const slice = selectedSlice();
  if (!slice || state.analyzingDuplicates) return;

  state.analyzingDuplicates = true;
  renderProject();

  try {
    const { job } = await api("/api/analyze-duplicates/start", {
      method: "POST",
      body: JSON.stringify({
        project: state.project,
        sliceId: slice.id,
        fuzz: Number(els.dupeFuzzInput.value) || 0
      })
    });
    const { project, analysis } = await waitForDuplicateJob(job.id);
    state.project = project;
    state.selectedSliceId = slice.id;
    renderProject();
    const duplicateCount = analysis?.duplicateFrames?.length || 0;
    setStatus(`Marked ${duplicateCount} adjacent duplicates in ${slice.id}.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    state.analyzingDuplicates = false;
    renderProject();
  }
});

els.startExportBtn.addEventListener("click", async () => {
  if (!state.project) return;

  stopPlayback();
  state.exporting = true;
  const exportOptions = getExportOptions();
  setStatus(exportOptions.method === "optimized" ? "Starting optimized export..." : "Starting lossless/native export...");
  renderProject();
  els.outputLink.hidden = true;
  setExportProgress({ phase: "Queued", progress: 0 });

  try {
    const { job } = await api("/api/export/start", {
      method: "POST",
      body: JSON.stringify({ project: state.project, exportOptions })
    });
    setExportProgress(job);
    const result = await waitForExportJob(job.id);
    els.outputLink.href = result.href;
    els.outputLink.hidden = false;
    setStatus(`Exported ${result.frameCount} frames with ${result.mode}.`);
  } catch (error) {
    els.exportProgress.hidden = false;
    els.exportPhase.textContent = `Failed: ${error.message}`;
    setStatus(error.message);
  } finally {
    state.exporting = false;
    renderProject();
  }
});

state.framePreview = window.GifclipFramePreview.createFramePreviewController({
  getProjectId: () => state.project?.id || "",
  getFrameCount: () => state.project?.source.frameCount || 0,
  previewElement: els.preview,
  setStatus: setFrameStatus,
  onLoaded: (frameIndex) => {
    removeLoadingPreviewRanges([{ start: frameIndex, end: frameIndex }]);
    addCachedPreviewRanges([{ start: frameIndex, end: frameIndex }]);
  },
  onError: ignorePreviewAbort
});
state.frameHoldControllers = [
  bindFrameHoldButton(els.prevFrameBtn, -1),
  bindFrameHoldButton(els.nextFrameBtn, 1)
];

renderProject();
