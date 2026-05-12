"use strict";

(function expose(factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    window.GifclipFramePreview = factory();
  }
})(function factory() {
  function frameUrl(projectId, frameIndex, maxSize) {
    return `/api/frame/${encodeURIComponent(projectId)}/${frameIndex}?max=${maxSize}`;
  }

  function clampFrame(frameIndex, frameCount) {
    if (!Number.isFinite(frameIndex) || !Number.isFinite(frameCount) || frameCount <= 0) return 0;
    return Math.min(Math.max(Math.trunc(frameIndex), 0), frameCount - 1);
  }

  function stepFrame(currentFrame, delta, frameCount) {
    return clampFrame(currentFrame + delta, frameCount);
  }

  function frameRangeForSlice(slice, frameCount) {
    const count = Number.isFinite(frameCount) && frameCount > 0 ? Math.trunc(frameCount) : 1;
    const fullEnd = count - 1;
    if (!slice || !Number.isFinite(slice.start) || !Number.isFinite(slice.end)) {
      return { start: 0, end: fullEnd };
    }

    const start = Math.min(Math.max(Math.trunc(slice.start), 0), fullEnd);
    const end = Math.min(Math.max(Math.trunc(slice.end), start), fullEnd);
    return { start, end };
  }

  function frameRangesForSlices(slices, frameCount) {
    if (!Array.isArray(slices)) return [];
    return mergeFrameRanges(
      slices
        .filter((slice) => slice && !slice.deleted)
        .map((slice) => frameRangeForSlice(slice, frameCount))
    );
  }

  function clampFrameToRange(frameIndex, range) {
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) return Math.trunc(frameIndex) || 0;
    const start = Math.trunc(range.start);
    const end = Math.max(start, Math.trunc(range.end));
    return Math.min(Math.max(Math.trunc(frameIndex) || 0, start), end);
  }

  function stepFrameWithinRange(currentFrame, delta, range) {
    return clampFrameToRange(currentFrame + delta, range);
  }

  function stepFrameAcrossRanges(currentFrame, delta, ranges) {
    const merged = mergeFrameRanges(ranges);
    if (merged.length === 0) return Math.trunc(currentFrame) || 0;
    const current = Math.trunc(currentFrame) || 0;
    const direction = Math.sign(delta);
    if (direction === 0) return current;

    if (direction > 0) {
      for (let index = 0; index < merged.length; index += 1) {
        const range = merged[index];
        if (current < range.start) return range.start;
        if (current < range.end) return current + 1;
        if (current === range.end) return merged[index + 1]?.start ?? current;
      }
      return current;
    }

    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const range = merged[index];
      if (current > range.end) return range.end;
      if (current > range.start) return current - 1;
      if (current === range.start) return merged[index - 1]?.end ?? current;
    }
    return current;
  }

  function sliceStepTarget(slices, selectedSliceId, delta) {
    const activeSlices = Array.isArray(slices) ? slices.filter((slice) => slice && !slice.deleted) : [];
    const currentIndex = activeSlices.findIndex((slice) => slice.id === selectedSliceId);
    if (currentIndex === -1) return null;
    const target = activeSlices[currentIndex + Math.sign(delta)];
    return target ? { sliceId: target.id, frame: target.start } : null;
  }

  function nextPlaybackFrame(currentFrame, range) {
    const current = clampFrameToRange(currentFrame, range);
    if (!range || current >= range.end) return range?.start || 0;
    return current + 1;
  }

  function boundedPreviewRange(start, end, frameCount, maxFrames, center) {
    const safeFrameCount = Math.max(1, Math.trunc(frameCount) || 1);
    const safeMaxFrames = Math.max(1, Math.trunc(maxFrames) || 1);
    const safeStart = Math.min(Math.max(Math.trunc(start) || 0, 0), safeFrameCount - 1);
    const requestedEnd = Number.isFinite(end) ? Math.trunc(end) : safeStart;
    const safeEnd = Math.min(Math.max(requestedEnd, safeStart), safeFrameCount - 1);

    if (Number.isFinite(center)) {
      const radius = Math.floor((safeMaxFrames - 1) / 2);
      const marker = Math.min(Math.max(Math.trunc(center), safeStart), safeEnd);
      const markerStart = Math.max(safeStart, marker - radius);
      const markerEnd = Math.min(safeEnd, marker + radius);
      return { start: markerStart, end: markerEnd, count: markerEnd - markerStart + 1 };
    }

    const boundedEnd = Math.min(safeEnd, safeStart + safeMaxFrames - 1);
    return { start: safeStart, end: boundedEnd, count: boundedEnd - safeStart + 1 };
  }

  function mergeFrameRanges(ranges) {
    if (!Array.isArray(ranges) || ranges.length === 0) return [];
    const sorted = ranges
      .filter((range) => Number.isFinite(range?.start) && Number.isFinite(range?.end))
      .map((range) => ({
        start: Math.trunc(range.start),
        end: Math.trunc(range.end)
      }))
      .filter((range) => range.end >= range.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const merged = [];
    for (const range of sorted) {
      const last = merged[merged.length - 1];
      if (!last || range.start > last.end + 1) {
        merged.push({ ...range, count: range.end - range.start + 1 });
        continue;
      }
      last.end = Math.max(last.end, range.end);
      last.count = last.end - last.start + 1;
    }
    return merged;
  }

  function subtractFrameRanges(ranges, subtractRanges) {
    const subtractors = mergeFrameRanges(subtractRanges);
    const result = [];

    for (const sourceRange of mergeFrameRanges(ranges)) {
      let cursor = sourceRange.start;
      for (const subtractor of subtractors) {
        if (subtractor.end < cursor) continue;
        if (subtractor.start > sourceRange.end) break;
        if (subtractor.start > cursor) {
          result.push({ start: cursor, end: Math.min(subtractor.start - 1, sourceRange.end) });
        }
        cursor = Math.max(cursor, subtractor.end + 1);
        if (cursor > sourceRange.end) break;
      }
      if (cursor <= sourceRange.end) {
        result.push({ start: cursor, end: sourceRange.end });
      }
    }

    return mergeFrameRanges(result);
  }

  function nextPreviewWindowSize(currentSize, maxSize) {
    const current = Math.max(1, Math.trunc(currentSize) || 1);
    const max = Math.max(current, Math.trunc(maxSize) || current);
    return Math.min(max, current * 2 - 1);
  }

  function playbackDelayMs(delaysCs, frameIndex, speed = 1) {
    const delayCs = Array.isArray(delaysCs) ? Number(delaysCs[frameIndex]) : 0;
    const safeDelayCs = Number.isFinite(delayCs) && delayCs > 0 ? delayCs : 1;
    const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
    return Math.max(10, Math.round((safeDelayCs * 10) / safeSpeed));
  }

  function holdRepeatIntervalMs(repeatIndex, options = {}) {
    const startIntervalMs = options.startIntervalMs ?? 180;
    const minIntervalMs = options.minIntervalMs ?? 50;
    const accelerationMs = options.accelerationMs ?? 18;
    const index = Math.max(0, Math.trunc(repeatIndex) || 0);
    return Math.max(minIntervalMs, startIntervalMs - index * accelerationMs);
  }

  function createHoldRepeatController(options) {
    const step = options.step;
    const canStep = options.canStep || (() => true);
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const initialDelayMs = options.initialDelayMs ?? 350;
    const intervalOptions = options.intervalOptions || {};

    let active = false;
    let timerId = null;
    let repeatIndex = 0;

    function clearScheduled() {
      if (timerId !== null) {
        clearTimer(timerId);
        timerId = null;
      }
    }

    function stop() {
      active = false;
      clearScheduled();
    }

    function schedule(delayMs) {
      clearScheduled();
      timerId = setTimer(() => {
        timerId = null;
        if (!active || !canStep()) {
          stop();
          return;
        }

        step();
        if (!active || !canStep()) {
          stop();
          return;
        }

        const nextDelay = holdRepeatIntervalMs(repeatIndex, intervalOptions);
        repeatIndex += 1;
        schedule(nextDelay);
      }, delayMs);
    }

    function start() {
      stop();
      if (!canStep()) return;

      active = true;
      repeatIndex = 0;
      step();
      if (active && canStep()) {
        schedule(initialDelayMs);
      }
    }

    return { start, stop };
  }

  function createFramePreviewController(options) {
    const fetchFrame = options.fetchFrame || fetch;
    const getProjectId = options.getProjectId;
    const getFrameCount = options.getFrameCount || (() => Number.POSITIVE_INFINITY);
    const previewElement = options.previewElement;
    const maxSize = options.maxSize || 900;
    const createObjectUrl = options.createObjectUrl || URL.createObjectURL.bind(URL);
    const revokeObjectUrl = options.revokeObjectUrl || URL.revokeObjectURL.bind(URL);
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const setStatus = options.setStatus || (() => {});
    const onError = options.onError || (() => {});
    const onLoaded = options.onLoaded || (() => {});

    let abortController = null;
    let previewUrl = null;
    let requestId = 0;
    let timerId = null;

    function clearScheduled() {
      if (timerId !== null) {
        clearTimer(timerId);
        timerId = null;
      }
    }

    async function show(frameIndex) {
      const projectId = getProjectId();
      const frameCount = getFrameCount();
      if (!projectId || frameIndex < 0 || frameIndex >= frameCount) return null;

      clearScheduled();
      if (abortController) {
        abortController.abort();
      }

      const currentRequest = requestId + 1;
      requestId = currentRequest;
      abortController = new AbortController();
      setStatus(`Loading frame ${frameIndex + 1}...`);

      const response = await fetchFrame(frameUrl(projectId, frameIndex, maxSize), {
        signal: abortController.signal
      });
      if (!response.ok) {
        throw new Error("Preview failed");
      }

      const blob = await response.blob();
      if (currentRequest !== requestId) return null;

      if (previewUrl) {
        revokeObjectUrl(previewUrl);
      }
      previewUrl = createObjectUrl(blob);
      previewElement.src = previewUrl;
      setStatus(`Loaded frame ${frameIndex + 1}.`);
      onLoaded(frameIndex, previewUrl);
      return previewUrl;
    }

    function schedule(frameIndex, delayMs) {
      clearScheduled();
      timerId = setTimer(() => {
        timerId = null;
        return show(frameIndex).catch(onError);
      }, delayMs);
    }

    function cancel() {
      clearScheduled();
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      requestId += 1;
    }

    return { cancel, schedule, show };
  }

  return {
    boundedPreviewRange,
    clampFrameToRange,
    clampFrame,
    createFramePreviewController,
    createHoldRepeatController,
    frameRangesForSlices,
    frameRangeForSlice,
    frameUrl,
    holdRepeatIntervalMs,
    mergeFrameRanges,
    nextPlaybackFrame,
    nextPreviewWindowSize,
    playbackDelayMs,
    sliceStepTarget,
    subtractFrameRanges,
    stepFrame,
    stepFrameAcrossRanges,
    stepFrameWithinRange
  };
});
