const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { rootDir, sourcesDir, ensureDir, assertInsideRoot } = require("./paths");

function sourceId(origin, name) {
  return `${origin}:${name}`;
}

function safeGifName(name) {
  const ext = path.extname(String(name || "")).toLowerCase();
  const stem = path.basename(String(name || "upload"), ext)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${stem || "upload"}-${Date.now()}-${randomUUID()}.gif`;
}

function listRootGifSources() {
  return fs.readdirSync(rootDir)
    .filter((name) => name.toLowerCase().endsWith(".gif"))
    .map((name) => {
      const filePath = path.join(rootDir, name);
      const stat = fs.statSync(filePath);
      return {
        id: sourceId("root", name),
        origin: "root",
        name,
        basename: name,
        bytes: stat.size
      };
    });
}

function listUploadedGifSources() {
  ensureDir(sourcesDir);
  return fs.readdirSync(sourcesDir)
    .filter((name) => name.toLowerCase().endsWith(".gif"))
    .map((name) => {
      const filePath = path.join(sourcesDir, name);
      const stat = fs.statSync(filePath);
      return {
        id: sourceId("upload", name),
        origin: "upload",
        name,
        basename: name,
        bytes: stat.size
      };
    });
}

function listSources() {
  return [...listRootGifSources(), ...listUploadedGifSources()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.origin.localeCompare(b.origin));
}

function resolveSource(sourceIdOrName) {
  const value = String(sourceIdOrName || "");
  if (value.startsWith("upload:")) {
    const name = value.slice("upload:".length);
    return assertInsideRoot(path.join(sourcesDir, name));
  }
  if (value.startsWith("root:")) {
    const name = value.slice("root:".length);
    return assertInsideRoot(path.join(rootDir, name));
  }
  return assertInsideRoot(path.join(rootDir, value));
}

async function saveUploadedSource(name, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Uploaded GIF is empty");
  }
  ensureDir(sourcesDir);
  const outputName = safeGifName(name);
  const outputPath = assertInsideRoot(path.join(sourcesDir, outputName));
  await fs.promises.writeFile(outputPath, buffer, { flag: "wx" });
  return outputPath;
}

module.exports = {
  listSources,
  resolveSource,
  saveUploadedSource,
  safeGifName,
  sourceId
};
