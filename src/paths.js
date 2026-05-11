const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const runtimeDir = path.join(rootDir, ".gifclip");
const projectsDir = path.join(runtimeDir, "projects");
const cacheDir = path.join(runtimeDir, "cache");
const previewCacheDir = path.join(cacheDir, "previews");
const tmpDir = path.join(runtimeDir, "tmp");
const sourcesDir = path.join(runtimeDir, "sources");
const exportsDir = path.join(rootDir, "exports");
const publicDir = path.join(rootDir, "public");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureRuntimeDirs() {
  for (const dir of [projectsDir, previewCacheDir, tmpDir, sourcesDir, exportsDir]) {
    ensureDir(dir);
  }
}

function assertInsideRoot(candidate) {
  const resolved = path.resolve(candidate);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside project root: ${candidate}`);
  }
  return resolved;
}

module.exports = {
  rootDir,
  runtimeDir,
  projectsDir,
  previewCacheDir,
  tmpDir,
  sourcesDir,
  exportsDir,
  publicDir,
  ensureDir,
  ensureRuntimeDirs,
  assertInsideRoot
};
