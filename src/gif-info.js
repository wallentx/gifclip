const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { assertInsideRoot } = require("./paths");
const { runTool } = require("./tools");

function parseGifInfo(infoText, sourceName) {
  const text = String(infoText);
  const frameMatch = text.match(/^\*\s+.*?\s+(\d+)\s+images?\s*$/m);
  if (!frameMatch) {
    throw new Error(`Could not parse frame count from gifsicle info for ${sourceName}`);
  }

  const screenMatch = text.match(/^\s*logical screen\s+(\d+)x(\d+)\s*$/m);
  if (!screenMatch) {
    throw new Error(`Could not parse logical screen from gifsicle info for ${sourceName}`);
  }

  const loopMatch = text.match(/^\s*loop\s+(.+?)\s*$/m);
  const delaysCs = [...text.matchAll(/\bdelay\s+([0-9]+(?:\.[0-9]+)?)s\b/g)].map((match) =>
    Math.max(1, Math.round(Number(match[1]) * 100))
  );
  const frameCount = Number(frameMatch[1]);
  if (delaysCs.length !== frameCount) {
    throw new Error(
      `Parsed ${delaysCs.length} frame delays for ${sourceName}, expected ${frameCount}`
    );
  }

  return {
    frameCount,
    width: Number(screenMatch[1]),
    height: Number(screenMatch[2]),
    loop: loopMatch ? loopMatch[1] : "unspecified",
    delaysCs
  };
}

function assertGifPath(sourcePath) {
  const filePath = assertInsideRoot(sourcePath);
  if (path.extname(filePath).toLowerCase() !== ".gif") {
    throw new Error(`Source must be a .gif file: ${sourcePath}`);
  }
  return filePath;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function loadGifInfo(sourcePath) {
  const filePath = assertGifPath(sourcePath);
  const basename = path.basename(filePath);
  const [{ stdout }, stat, sha256] = await Promise.all([
    runTool("gifsicle", ["--info", filePath]),
    fs.promises.stat(filePath),
    hashFile(filePath)
  ]);
  return {
    ...parseGifInfo(stdout.toString("utf8"), basename),
    sourcePath: filePath,
    id: sha256.slice(0, 16),
    sha256,
    bytes: stat.size,
    basename
  };
}

module.exports = {
  parseGifInfo,
  hashFile,
  loadGifInfo
};
