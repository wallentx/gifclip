const { createProject, normalizeProject } = require("./project");

const BLUEPRINT_SCHEMA = "gifclip-blueprint-v1";

function blueprintFromProject(project) {
  const normalized = normalizeProject(project);
  return {
    schema: BLUEPRINT_SCHEMA,
    source: {
      sha256: normalized.source.sha256,
      basename: normalized.source.basename,
      frameCount: normalized.source.frameCount,
      width: normalized.source.width,
      height: normalized.source.height,
      delaysCs: [...normalized.source.delaysCs]
    },
    currentFrame: normalized.currentFrame,
    slices: normalized.slices
  };
}

function sourceMatchesBlueprint(source, blueprintSource) {
  if (!source || !blueprintSource) return false;
  if (blueprintSource.sha256) return source.sha256 === blueprintSource.sha256;
  return (
    source.basename === blueprintSource.basename &&
    source.frameCount === blueprintSource.frameCount &&
    source.width === blueprintSource.width &&
    source.height === blueprintSource.height
  );
}

function projectFromBlueprint(source, blueprint) {
  if (!blueprint || blueprint.schema !== BLUEPRINT_SCHEMA) {
    throw new Error(`Blueprint must use ${BLUEPRINT_SCHEMA}`);
  }
  if (!sourceMatchesBlueprint(source, blueprint.source)) {
    throw new Error("Blueprint source does not match this GIF");
  }
  const sourceWithDelays =
    Array.isArray(blueprint.source.delaysCs) && blueprint.source.delaysCs.length >= source.frameCount
      ? {
          ...source,
          delaysCs: blueprint.source.delaysCs.slice(0, source.frameCount).map((delay) => Math.max(1, Math.round(Number(delay))))
        }
      : source;
  const base = createProject(sourceWithDelays);
  return normalizeProject({
    ...base,
    currentFrame: Number.isInteger(blueprint.currentFrame) ? blueprint.currentFrame : 0,
    slices: blueprint.slices
  });
}

module.exports = {
  BLUEPRINT_SCHEMA,
  blueprintFromProject,
  projectFromBlueprint,
  sourceMatchesBlueprint
};
