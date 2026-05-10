const MAX_SLICE_SPEED = 16;

function assertSource(source) {
  if (!source || typeof source !== "object") {
    throw new Error("Project source is required");
  }
  if (!Number.isInteger(source.frameCount) || source.frameCount <= 0) {
    throw new Error("Project source frameCount must be a positive integer");
  }
  if (!Array.isArray(source.delaysCs) || source.delaysCs.length < source.frameCount) {
    throw new Error("Project source delaysCs must include one delay per frame");
  }
  for (let index = 0; index < source.frameCount; index += 1) {
    if (!Number.isFinite(source.delaysCs[index]) || source.delaysCs[index] <= 0) {
      throw new Error(`Project source delay for frame ${index} must be positive`);
    }
  }
  if (typeof source.sourcePath !== "string" || source.sourcePath.length === 0) {
    throw new Error("Project sourcePath is required");
  }
  if (!Number.isInteger(source.width) || source.width <= 0) {
    throw new Error("Project source width must be a positive integer");
  }
  if (!Number.isInteger(source.height) || source.height <= 0) {
    throw new Error("Project source height must be a positive integer");
  }
}

function assertSpeed(speed) {
  if (!Number.isFinite(speed) || speed <= 0 || speed > MAX_SLICE_SPEED) {
    throw new Error(`Slice speed must be a positive finite value <= ${MAX_SLICE_SPEED}`);
  }
}

function cloneSlice(slice) {
  const cloned = {
    id: slice.id,
    start: slice.start,
    end: slice.end,
    deleted: Boolean(slice.deleted),
    speed: slice.speed,
    duplicateFrames: Array.isArray(slice.duplicateFrames) ? [...slice.duplicateFrames] : []
  };
  if (Object.hasOwn(slice, "overlays")) {
    cloned.overlays = slice.overlays;
  }
  if (Object.hasOwn(slice, "inserts")) {
    cloned.inserts = slice.inserts;
  }
  return cloned;
}

function sanitizeDuplicateFrames(slice) {
  return [...new Set(slice.duplicateFrames)]
    .filter((frame) => Number.isInteger(frame) && frame > slice.start && frame <= slice.end)
    .sort((a, b) => a - b);
}

function normalizeSlice(source, slice) {
  if (!slice || typeof slice !== "object") {
    throw new Error("Project slice is required");
  }
  if (typeof slice.id !== "string" || slice.id.length === 0) {
    throw new Error("Project slice id is required");
  }
  if (!Number.isInteger(slice.start) || !Number.isInteger(slice.end)) {
    throw new Error(`Project slice ${slice.id} must use integer frame bounds`);
  }
  if (slice.start < 0 || slice.end >= source.frameCount || slice.start > slice.end) {
    throw new Error(`Project slice ${slice.id} has invalid frame bounds`);
  }
  assertSpeed(slice.speed);

  const normalized = cloneSlice(slice);
  normalized.deleted = Boolean(slice.deleted);
  normalized.duplicateFrames = sanitizeDuplicateFrames(normalized);
  return normalized;
}

function normalizeProject(project) {
  if (!project || typeof project !== "object") {
    throw new Error("Project is required");
  }
  assertSource(project.source);
  if (!Array.isArray(project.slices) || project.slices.length === 0) {
    throw new Error("Project must include at least one slice");
  }

  return {
    id: project.id || project.source.id,
    source: project.source,
    currentFrame: Number.isInteger(project.currentFrame) ? project.currentFrame : 0,
    slices: project.slices.map((slice) => normalizeSlice(project.source, slice))
  };
}

function createProject(source) {
  assertSource(source);
  return {
    id: source.id,
    source,
    currentFrame: 0,
    slices: [
      {
        id: "slice-1",
        start: 0,
        end: source.frameCount - 1,
        deleted: false,
        speed: 1,
        duplicateFrames: []
      }
    ]
  };
}

function nextSliceId(slices) {
  const max = slices.reduce((currentMax, slice) => {
    const match = /^slice-(\d+)$/.exec(slice.id);
    if (!match) {
      return currentMax;
    }
    return Math.max(currentMax, Number(match[1]));
  }, 0);
  return `slice-${max + 1}`;
}

function splitAtFrame(project, frame) {
  const normalized = normalizeProject(project);
  if (!Number.isInteger(frame)) {
    throw new Error("Split frame must be an integer");
  }

  const sliceIndex = normalized.slices.findIndex(
    (slice) => frame >= slice.start && frame <= slice.end
  );
  if (sliceIndex === -1 || normalized.slices[sliceIndex].end === frame) {
    return normalized;
  }

  const slice = normalized.slices[sliceIndex];
  const left = {
    ...cloneSlice(slice),
    end: frame,
    duplicateFrames: slice.duplicateFrames.filter((duplicate) => duplicate <= frame)
  };
  const right = {
    ...cloneSlice(slice),
    id: nextSliceId(normalized.slices),
    start: frame + 1,
    duplicateFrames: slice.duplicateFrames.filter((duplicate) => duplicate > frame)
  };

  return {
    id: normalized.id,
    source: normalized.source,
    currentFrame: normalized.currentFrame,
    slices: [
      ...normalized.slices.slice(0, sliceIndex),
      left,
      right,
      ...normalized.slices.slice(sliceIndex + 1)
    ]
  };
}

function updateSlice(project, sliceId, updater) {
  const normalized = normalizeProject(project);
  let found = false;
  const slices = normalized.slices.map((slice) => {
    if (slice.id !== sliceId) {
      return slice;
    }
    found = true;
    return updater(cloneSlice(slice));
  });
  if (!found) {
    throw new Error(`Unknown slice id: ${sliceId}`);
  }
  return normalizeProject({ source: normalized.source, slices });
}

function setSliceDeleted(project, sliceId, deleted) {
  return updateSlice(project, sliceId, (slice) => ({
    ...slice,
    deleted: Boolean(deleted)
  }));
}

function setSliceSpeed(project, sliceId, speed) {
  assertSpeed(speed);
  return updateSlice(project, sliceId, (slice) => ({
    ...slice,
    speed
  }));
}

function markDuplicateFrames(project, sliceId, frames) {
  if (!Array.isArray(frames)) {
    throw new Error("Duplicate frames must be an array");
  }
  return updateSlice(project, sliceId, (slice) => ({
    ...slice,
    duplicateFrames: [...frames]
  }));
}

function buildFramePlan(project) {
  const normalized = normalizeProject(project);
  const frames = [];

  for (const slice of normalized.slices) {
    if (slice.deleted) {
      continue;
    }
    const duplicates = new Set(slice.duplicateFrames);
    let lastKeptFrame = null;
    for (let index = slice.start; index <= slice.end; index += 1) {
      const originalDelay = normalized.source.delaysCs[index];
      const delayCs = Math.max(1, Math.round(originalDelay / slice.speed));
      if (duplicates.has(index)) {
        if (lastKeptFrame) {
          lastKeptFrame.delayCs += delayCs;
        }
        continue;
      }
      lastKeptFrame = {
        sourceIndex: index,
        delayCs,
        sliceId: slice.id
      };
      frames.push(lastKeptFrame);
    }
  }

  if (frames.length === 0) {
    throw new Error("Export plan has no frames");
  }

  return {
    mode: "lossless-native",
    sourcePath: normalized.source.sourcePath,
    width: normalized.source.width,
    height: normalized.source.height,
    loop: normalized.source.loop,
    frames
  };
}

module.exports = {
  createProject,
  splitAtFrame,
  setSliceDeleted,
  setSliceSpeed,
  markDuplicateFrames,
  normalizeProject,
  buildFramePlan
};
