"use strict";

const state = {
  project: null,
  selectedSliceId: null,
  framePreview: null,
  frameHoldControllers: []
};

const els = {
  sourceSelect: document.querySelector("#sourceSelect"),
  loadBtn: document.querySelector("#loadBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  outputLink: document.querySelector("#outputLink"),
  preview: document.querySelector("#preview"),
  status: document.querySelector("#status"),
  frameSlider: document.querySelector("#frameSlider"),
  prevFrameBtn: document.querySelector("#prevFrameBtn"),
  nextFrameBtn: document.querySelector("#nextFrameBtn"),
  frameLabel: document.querySelector("#frameLabel"),
  delayLabel: document.querySelector("#delayLabel"),
  splitBtn: document.querySelector("#splitBtn"),
  dupeBtn: document.querySelector("#dupeBtn"),
  speedInput: document.querySelector("#speedInput"),
  sliceList: document.querySelector("#sliceList")
};

async function api(path, options = {}) {
  const init = { ...options };
  if (init.body && !(init.body instanceof FormData)) {
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
  els.status.textContent = message;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

function nextSliceId(slices) {
  let max = 0;
  for (const slice of slices) {
    const match = /^slice-(\d+)$/.exec(slice.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `slice-${max + 1}`;
}

function setControlsEnabled(enabled) {
  els.exportBtn.disabled = !enabled;
  els.frameSlider.disabled = !enabled;
  els.prevFrameBtn.disabled = !enabled;
  els.nextFrameBtn.disabled = !enabled;
  els.splitBtn.disabled = !enabled;
  els.dupeBtn.disabled = !enabled;
  els.speedInput.disabled = !enabled;
}

function ignorePreviewAbort(error) {
  if (error.name !== "AbortError") setStatus(error.message);
}

function renderProject() {
  const project = state.project;
  setControlsEnabled(Boolean(project));

  if (!project) {
    els.frameSlider.max = "0";
    els.frameSlider.value = "0";
    els.frameLabel.textContent = "0";
    els.delayLabel.textContent = "Delay: 0 cs";
    els.speedInput.value = "1";
    els.sliceList.innerHTML = '<div class="emptyState">No GIF loaded.</div>';
    return;
  }

  const frame = Math.min(currentFrame(), project.source.frameCount - 1);
  project.currentFrame = frame;
  els.frameSlider.max = String(project.source.frameCount - 1);
  els.frameSlider.value = String(frame);
  els.frameLabel.textContent = `${frame + 1} / ${project.source.frameCount}`;
  els.delayLabel.textContent = `Delay: ${project.source.delaysCs[frame] || 0} cs`;
  els.prevFrameBtn.disabled = frame <= 0;
  els.nextFrameBtn.disabled = frame >= project.source.frameCount - 1;

  const active = selectedSlice();
  els.speedInput.value = active ? String(active.speed) : "1";
  els.dupeBtn.disabled = !active;
  els.speedInput.disabled = !active;
  els.splitBtn.disabled = !canSplitAt(frame);

  els.sliceList.innerHTML = "";
  for (const slice of project.slices) {
    const node = document.createElement("article");
    node.className = `slice${slice.id === state.selectedSliceId ? " active" : ""}${slice.deleted ? " deleted" : ""}`;
    node.innerHTML = `
      <div class="sliceTop">
        <div class="sliceName">${slice.id}</div>
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

async function loadSources() {
  setStatus("Loading sources...");
  const { sources } = await api("/api/sources");
  els.sourceSelect.innerHTML = "";

  if (!sources || sources.length === 0) {
    const option = document.createElement("option");
    option.textContent = "No GIF sources found";
    option.value = "";
    els.sourceSelect.appendChild(option);
    els.loadBtn.disabled = true;
    setStatus("No GIF sources found.");
    return;
  }

  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source.name;
    option.textContent = `${source.name} (${formatBytes(source.bytes)})`;
    els.sourceSelect.appendChild(option);
  }

  els.loadBtn.disabled = false;
  setStatus("Choose a GIF to start.");
}

async function loadSelectedSource() {
  if (!els.sourceSelect.value) return;

  setStatus("Loading GIF metadata...");
  els.loadBtn.disabled = true;
  els.outputLink.hidden = true;

  try {
    const { project } = await api("/api/load", {
      method: "POST",
      body: JSON.stringify({ name: els.sourceSelect.value })
    });
    state.project = project;
    state.selectedSliceId = project.slices[0]?.id || null;
    stopFrameHolds();
    state.framePreview.cancel();
    els.frameSlider.value = String(project.currentFrame || 0);
    renderProject();
    await state.framePreview.show(currentFrame());
    const sourceName = project.source.basename || project.source.name || project.source.id;
    setStatus(`${sourceName}: ${project.source.width}x${project.source.height}, ${project.source.frameCount} frames.`);
  } finally {
    els.loadBtn.disabled = false;
  }
}

function updateFrameFromSlider(delayMs) {
  const frame = currentFrame();
  if (state.project) state.project.currentFrame = frame;
  renderProject();
  if (delayMs === 0) {
    state.framePreview.show(frame).catch(ignorePreviewAbort);
    return;
  }
  state.framePreview.schedule(frame, delayMs);
}

function canMoveFrame(delta) {
  if (!state.project) return false;
  const frame = currentFrame();
  return window.GifclipFramePreview.stepFrame(frame, delta, state.project.source.frameCount) !== frame;
}

function moveFrame(delta) {
  if (!state.project) return;
  const current = currentFrame();
  const frame = window.GifclipFramePreview.stepFrame(current, delta, state.project.source.frameCount);
  if (frame === current) return;

  els.frameSlider.value = String(frame);
  updateFrameFromSlider(0);
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

  return controller;
}

function splitLocal(frame) {
  if (!state.project || !canSplitAt(frame)) return;

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
  setStatus(`Split at frame ${frame + 1}.`);
}

function updateSelectedSpeed() {
  const slice = selectedSlice();
  if (!slice) return;

  const speed = Number(els.speedInput.value);
  if (!Number.isFinite(speed) || speed <= 0 || speed > 16) {
    els.speedInput.value = String(slice.speed);
    setStatus("Slice speed must be greater than 0 and no more than 16.");
    return;
  }

  slice.speed = speed;
  renderProject();
  setStatus(`${slice.id} speed set to ${speed}x.`);
}

function selectSlice(sliceId) {
  state.selectedSliceId = sliceId;
  renderProject();
}

function toggleSliceDeleted(sliceId) {
  const slice = state.project?.slices.find((item) => item.id === sliceId);
  if (!slice) return;

  slice.deleted = !slice.deleted;
  state.selectedSliceId = sliceId;
  renderProject();
  setStatus(`${slice.id} ${slice.deleted ? "deleted" : "restored"}.`);
}

els.loadBtn.addEventListener("click", () => {
  loadSelectedSource().catch((error) => setStatus(error.message));
});

els.frameSlider.addEventListener("input", () => updateFrameFromSlider(80));
els.frameSlider.addEventListener("change", () => updateFrameFromSlider(0));

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

  const sliceNode = event.target.closest(".slice");
  if (sliceNode?.dataset.select) {
    selectSlice(sliceNode.dataset.select);
  }
});

els.speedInput.addEventListener("change", updateSelectedSpeed);

els.dupeBtn.addEventListener("click", async () => {
  const slice = selectedSlice();
  if (!slice) return;

  setStatus(`Analyzing ${slice.id} for adjacent duplicates...`);
  els.dupeBtn.disabled = true;

  try {
    const { project, analysis } = await api("/api/analyze-duplicates", {
      method: "POST",
      body: JSON.stringify({ project: state.project, sliceId: slice.id })
    });
    state.project = project;
    state.selectedSliceId = slice.id;
    renderProject();
    const duplicateCount = analysis?.duplicateFrames?.length || 0;
    setStatus(`Marked ${duplicateCount} adjacent duplicates in ${slice.id}.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    renderProject();
  }
});

els.exportBtn.addEventListener("click", async () => {
  if (!state.project) return;

  setStatus("Exporting lossless/native GIF...");
  els.exportBtn.disabled = true;
  els.outputLink.hidden = true;

  try {
    const result = await api("/api/export", {
      method: "POST",
      body: JSON.stringify({ project: state.project })
    });
    els.outputLink.href = result.href;
    els.outputLink.hidden = false;
    setStatus(`Exported ${result.frameCount} frames with ${result.mode}.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    renderProject();
  }
});

state.framePreview = window.GifclipFramePreview.createFramePreviewController({
  getProjectId: () => state.project?.id || "",
  getFrameCount: () => state.project?.source.frameCount || 0,
  previewElement: els.preview,
  setStatus,
  onError: ignorePreviewAbort
});
state.frameHoldControllers = [
  bindFrameHoldButton(els.prevFrameBtn, -1),
  bindFrameHoldButton(els.nextFrameBtn, 1)
];

renderProject();
loadSources().catch((error) => setStatus(error.message));
