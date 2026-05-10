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

  return { clampFrame, createFramePreviewController, frameUrl, stepFrame };
});
