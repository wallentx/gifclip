# Lossless GIF Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 localhost GIF editor for lossless slice, speed, delete, duplicate-removal, preview, and export workflows.

**Architecture:** A dependency-free Node server serves a static browser UI and orchestrates native tools. `gifsicle` owns metadata and lossless/native exports; `ffmpeg` owns on-demand preview and duplicate-analysis frame hashing. The browser holds only a lightweight project plan and preview images, never decoded full-resolution frame data.

**Tech Stack:** Node.js built-in `http`, `fs`, `child_process`, `crypto`, and `node:test`; static HTML/CSS/JS; native `gifsicle` and `ffmpeg`.

---

## File Structure

- Create `.gitignore`: ignore runtime cache, exports, temporary files, and dependencies.
- Create `package.json`: scripts for `npm start`, `npm test`, and `npm run verify`.
- Create `server.js`: HTTP server and API routing.
- Create `src/paths.js`: root-relative runtime paths and path-safety helpers.
- Create `src/tools.js`: native tool discovery, command execution, and startup checks.
- Create `src/gif-info.js`: `gifsicle --info` parser and metadata loader.
- Create `src/project.js`: project state, slice validation, split/delete/speed operations, and export-plan normalization.
- Create `src/preview.js`: preview cache keys and `ffmpeg` preview extraction.
- Create `src/duplicates.js`: adjacent duplicate analysis using `ffmpeg` frame hashes.
- Create `src/exporter.js`: lossless/native GIF export with `gifsicle`.
- Create `src/http-utils.js`: request body parsing, JSON responses, static file serving.
- Create `public/index.html`: editor markup.
- Create `public/styles.css`: compact utility/editor styling.
- Create `public/app.js`: client state, timeline/slice interactions, API calls.
- Create `test/*.test.js`: unit and smoke tests.
- Create `scripts/verify-sample.js`: verifies `jobscout-demo.gif` metadata, preview, and small export.
- Create `README.md`: run command, prerequisites, and v1/v2 scope.

Runtime directories created by the app:

- `.gifclip/projects/`
- `.gifclip/cache/previews/`
- `.gifclip/tmp/`
- `exports/`

---

### Task 1: Project Scaffold And Tool Checks

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `src/paths.js`
- Create: `src/tools.js`
- Create: `test/tools.test.js`

- [ ] **Step 1: Create the Node package manifest**

Create `package.json` with these scripts:

```json
{
  "name": "gifclip",
  "version": "0.1.0",
  "private": true,
  "description": "Localhost lossless GIF slice editor",
  "type": "commonjs",
  "scripts": {
    "start": "node server.js",
    "test": "node --test",
    "verify": "node scripts/verify-sample.js"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Ignore runtime artifacts**

Create `.gitignore`:

```gitignore
node_modules/
.gifclip/
exports/
*.tmp
*.log
```

- [ ] **Step 3: Write path helpers**

Create `src/paths.js`:

```js
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const runtimeDir = path.join(rootDir, ".gifclip");
const projectsDir = path.join(runtimeDir, "projects");
const cacheDir = path.join(runtimeDir, "cache");
const previewCacheDir = path.join(cacheDir, "previews");
const tmpDir = path.join(runtimeDir, "tmp");
const exportsDir = path.join(rootDir, "exports");
const publicDir = path.join(rootDir, "public");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureRuntimeDirs() {
  for (const dir of [projectsDir, previewCacheDir, tmpDir, exportsDir]) {
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
  exportsDir,
  publicDir,
  ensureDir,
  ensureRuntimeDirs,
  assertInsideRoot
};
```

- [ ] **Step 4: Write native tool helpers**

Create `src/tools.js`:

```js
const { spawn, spawnSync } = require("node:child_process");

const REQUIRED_TOOLS = ["gifsicle", "ffmpeg"];

function findTool(name) {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function checkRequiredTools() {
  const tools = {};
  const missing = [];
  for (const name of REQUIRED_TOOLS) {
    const toolPath = findTool(name);
    if (toolPath) {
      tools[name] = toolPath;
    } else {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    const detail = missing.map((name) => `missing: ${name}`).join(", ");
    throw new Error(`Required native GIF tools are not available: ${detail}`);
  }
  return tools;
}

function runTool(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      if (code !== 0) {
        const message = err.toString("utf8").trim() || `${command} exited with ${code}`;
        const error = new Error(message);
        error.code = code;
        error.stdout = out;
        error.stderr = err;
        reject(error);
        return;
      }
      resolve({ stdout: out, stderr: err });
    });
  });
}

module.exports = {
  REQUIRED_TOOLS,
  findTool,
  checkRequiredTools,
  runTool
};
```

- [ ] **Step 5: Write the first tests**

Create `test/tools.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { assertInsideRoot, rootDir } = require("../src/paths");
const { REQUIRED_TOOLS } = require("../src/tools");

test("required tool list contains native gif tools", () => {
  assert.deepEqual(REQUIRED_TOOLS, ["gifsicle", "ffmpeg"]);
});

test("assertInsideRoot accepts paths under the repo", () => {
  const resolved = assertInsideRoot(`${rootDir}/jobscout-demo.gif`);
  assert.ok(resolved.endsWith("jobscout-demo.gif"));
});

test("assertInsideRoot rejects paths outside the repo", () => {
  assert.throws(() => assertInsideRoot("/etc/passwd"), /outside project root/);
});
```

- [ ] **Step 6: Run scaffold tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit scaffold**

Run:

```bash
git add .gitignore package.json src/paths.js src/tools.js test/tools.test.js
git commit -m "feat: scaffold gifclip runtime"
```

---

### Task 2: GIF Metadata Parser And Source Loading

**Files:**
- Create: `src/gif-info.js`
- Create: `test/gif-info.test.js`

- [ ] **Step 1: Write parser tests**

Create `test/gif-info.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGifInfo } = require("../src/gif-info");

const sampleInfo = `* jobscout-demo.gif 3 images
  logical screen 3164x4704
  global color table [2]
  background 0
  loop forever
  + image #0 3164x4704
    disposal asis delay 0.67s
  + image #1 35x168 at 35,42 transparent 0
    disposal asis delay 1.31s
  + image #2 2246x1596 at 35,126 transparent 0
    disposal asis delay 0.73s`;

test("parseGifInfo extracts frame count, size, loop, and delays", () => {
  const parsed = parseGifInfo(sampleInfo, "jobscout-demo.gif");
  assert.equal(parsed.frameCount, 3);
  assert.equal(parsed.width, 3164);
  assert.equal(parsed.height, 4704);
  assert.equal(parsed.loop, "forever");
  assert.deepEqual(parsed.delaysCs, [67, 131, 73]);
});

test("parseGifInfo fails when logical screen is missing", () => {
  assert.throws(() => parseGifInfo("* bad.gif 1 images", "bad.gif"), /logical screen/);
});
```

- [ ] **Step 2: Implement metadata loading**

Create `src/gif-info.js`:

```js
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { runTool } = require("./tools");
const { assertInsideRoot } = require("./paths");

function parseGifInfo(text, sourcePath) {
  const headerMatch = text.match(/^\*\s+.+?\s+(\d+)\s+images/m);
  const screenMatch = text.match(/logical screen\s+(\d+)x(\d+)/);
  const loopMatch = text.match(/^\s*loop\s+(.+)$/m);
  if (!headerMatch) {
    throw new Error(`Could not parse frame count for ${sourcePath}`);
  }
  if (!screenMatch) {
    throw new Error(`Could not parse logical screen for ${sourcePath}`);
  }
  const delaysCs = [];
  const delayPattern = /delay\s+([0-9]+(?:\.[0-9]+)?)s/g;
  let match;
  while ((match = delayPattern.exec(text)) !== null) {
    delaysCs.push(Math.max(1, Math.round(Number(match[1]) * 100)));
  }
  const frameCount = Number(headerMatch[1]);
  if (delaysCs.length !== frameCount) {
    throw new Error(`Expected ${frameCount} frame delays for ${sourcePath}, found ${delaysCs.length}`);
  }
  return {
    sourcePath,
    frameCount,
    width: Number(screenMatch[1]),
    height: Number(screenMatch[2]),
    loop: loopMatch ? loopMatch[1].trim() : "unspecified",
    delaysCs
  };
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

async function loadGifInfo(sourcePath) {
  const safePath = assertInsideRoot(sourcePath);
  if (path.extname(safePath).toLowerCase() !== ".gif") {
    throw new Error("Only GIF sources are supported");
  }
  const result = await runTool("gifsicle", ["--info", safePath]);
  const info = parseGifInfo(result.stdout.toString("utf8"), safePath);
  const stat = fs.statSync(safePath);
  const sha256 = hashFile(safePath);
  return {
    ...info,
    id: sha256.slice(0, 16),
    sha256,
    bytes: stat.size,
    basename: path.basename(safePath)
  };
}

module.exports = {
  parseGifInfo,
  hashFile,
  loadGifInfo
};
```

- [ ] **Step 3: Run parser tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit metadata parser**

Run:

```bash
git add src/gif-info.js test/gif-info.test.js
git commit -m "feat: parse gif metadata"
```

---

### Task 3: Project Slice Model

**Files:**
- Create: `src/project.js`
- Create: `test/project.test.js`

- [ ] **Step 1: Write slice model tests**

Create `test/project.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createProject,
  splitAtFrame,
  setSliceDeleted,
  setSliceSpeed,
  markDuplicateFrames,
  buildFramePlan
} = require("../src/project");

const source = {
  id: "abc",
  basename: "demo.gif",
  sourcePath: "/repo/demo.gif",
  frameCount: 6,
  width: 100,
  height: 80,
  delaysCs: [10, 20, 30, 40, 50, 60],
  loop: "forever"
};

test("createProject starts with one full-range slice", () => {
  const project = createProject(source);
  assert.equal(project.slices.length, 1);
  assert.deepEqual(project.slices[0], {
    id: "slice-1",
    start: 0,
    end: 5,
    deleted: false,
    speed: 1,
    duplicateFrames: []
  });
});

test("splitAtFrame splits after the selected frame", () => {
  const project = splitAtFrame(createProject(source), 2);
  assert.deepEqual(project.slices.map((slice) => [slice.start, slice.end]), [[0, 2], [3, 5]]);
});

test("deleted slices are omitted from frame plan", () => {
  let project = splitAtFrame(createProject(source), 2);
  project = setSliceDeleted(project, "slice-1", true);
  const plan = buildFramePlan(project);
  assert.deepEqual(plan.frames.map((frame) => frame.sourceIndex), [3, 4, 5]);
});

test("speed multiplier rewrites delays without dropping frames", () => {
  let project = createProject(source);
  project = setSliceSpeed(project, "slice-1", 2);
  const plan = buildFramePlan(project);
  assert.deepEqual(plan.frames.map((frame) => frame.delayCs), [5, 10, 15, 20, 25, 30]);
});

test("duplicate marks omit only marked frames", () => {
  let project = createProject(source);
  project = markDuplicateFrames(project, "slice-1", [2, 4]);
  const plan = buildFramePlan(project);
  assert.deepEqual(plan.frames.map((frame) => frame.sourceIndex), [0, 1, 3, 5]);
});
```

- [ ] **Step 2: Implement the project model**

Create `src/project.js`:

```js
function createProject(source) {
  return {
    id: source.id,
    source,
    currentFrame: 0,
    slices: [{
      id: "slice-1",
      start: 0,
      end: source.frameCount - 1,
      deleted: false,
      speed: 1,
      duplicateFrames: []
    }]
  };
}

function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

function validateFrame(project, frame) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= project.source.frameCount) {
    throw new Error(`Frame is outside source range: ${frame}`);
  }
}

function validateSlice(slice) {
  if (!Number.isInteger(slice.start) || !Number.isInteger(slice.end) || slice.start > slice.end) {
    throw new Error(`Invalid slice range: ${slice.start}-${slice.end}`);
  }
  if (typeof slice.deleted !== "boolean") {
    throw new Error(`Invalid deleted value for ${slice.id}`);
  }
  if (typeof slice.speed !== "number" || !Number.isFinite(slice.speed) || slice.speed <= 0 || slice.speed > 16) {
    throw new Error(`Invalid speed value for ${slice.id}`);
  }
}

function normalizeProject(project) {
  if (!project || !project.source || !Array.isArray(project.slices)) {
    throw new Error("Invalid project");
  }
  for (const slice of project.slices) {
    validateSlice(slice);
    validateFrame(project, slice.start);
    validateFrame(project, slice.end);
    slice.duplicateFrames = Array.from(new Set(slice.duplicateFrames || []))
      .filter((frame) => Number.isInteger(frame) && frame >= slice.start && frame <= slice.end)
      .sort((a, b) => a - b);
  }
  return project;
}

function splitAtFrame(project, frame) {
  validateFrame(project, frame);
  const next = cloneProject(project);
  const index = next.slices.findIndex((slice) => slice.start <= frame && frame < slice.end);
  if (index === -1) {
    return normalizeProject(next);
  }
  const old = next.slices[index];
  const left = { ...old, end: frame, duplicateFrames: old.duplicateFrames.filter((value) => value <= frame) };
  const right = {
    ...old,
    id: `slice-${next.slices.length + 1}`,
    start: frame + 1,
    duplicateFrames: old.duplicateFrames.filter((value) => value > frame)
  };
  next.slices.splice(index, 1, left, right);
  return normalizeProject(next);
}

function setSliceDeleted(project, sliceId, deleted) {
  const next = cloneProject(project);
  const slice = next.slices.find((item) => item.id === sliceId);
  if (!slice) {
    throw new Error(`Unknown slice: ${sliceId}`);
  }
  slice.deleted = Boolean(deleted);
  return normalizeProject(next);
}

function setSliceSpeed(project, sliceId, speed) {
  const next = cloneProject(project);
  const slice = next.slices.find((item) => item.id === sliceId);
  if (!slice) {
    throw new Error(`Unknown slice: ${sliceId}`);
  }
  slice.speed = Number(speed);
  return normalizeProject(next);
}

function markDuplicateFrames(project, sliceId, frames) {
  const next = cloneProject(project);
  const slice = next.slices.find((item) => item.id === sliceId);
  if (!slice) {
    throw new Error(`Unknown slice: ${sliceId}`);
  }
  slice.duplicateFrames = frames;
  return normalizeProject(next);
}

function buildFramePlan(project) {
  const normalized = normalizeProject(cloneProject(project));
  const frames = [];
  for (const slice of normalized.slices) {
    if (slice.deleted) {
      continue;
    }
    const omitted = new Set(slice.duplicateFrames);
    for (let sourceIndex = slice.start; sourceIndex <= slice.end; sourceIndex += 1) {
      if (omitted.has(sourceIndex)) {
        continue;
      }
      const originalDelay = normalized.source.delaysCs[sourceIndex] || 1;
      frames.push({
        sourceIndex,
        delayCs: Math.max(1, Math.round(originalDelay / slice.speed)),
        sliceId: slice.id
      });
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
  normalizeProject,
  splitAtFrame,
  setSliceDeleted,
  setSliceSpeed,
  markDuplicateFrames,
  buildFramePlan
};
```

- [ ] **Step 3: Run project tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit project model**

Run:

```bash
git add src/project.js test/project.test.js
git commit -m "feat: model lossless gif slices"
```

---

### Task 4: Lossless Exporter

**Files:**
- Create: `src/exporter.js`
- Create: `test/exporter.test.js`

- [ ] **Step 1: Write exporter unit tests**

Create `test/exporter.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  frameSelectionArgs,
  delayGroups,
  delayBatchArgs,
  exportModeForProject
} = require("../src/exporter");

test("frameSelectionArgs collapses adjacent frame indexes into ranges", () => {
  const frames = [0, 1, 2, 5, 7, 8].map((sourceIndex) => ({ sourceIndex, delayCs: 10 }));
  assert.deepEqual(frameSelectionArgs(frames), ["#0-2", "#5", "#7-8"]);
});

test("delayGroups collapses adjacent output frames with the same delay", () => {
  const frames = [
    { sourceIndex: 0, delayCs: 10 },
    { sourceIndex: 1, delayCs: 10 },
    { sourceIndex: 2, delayCs: 20 },
    { sourceIndex: 3, delayCs: 20 },
    { sourceIndex: 4, delayCs: 10 }
  ];
  assert.deepEqual(delayGroups(frames), [
    { start: 0, end: 1, delayCs: 10 },
    { start: 2, end: 3, delayCs: 20 },
    { start: 4, end: 4, delayCs: 10 }
  ]);
});

test("delayBatchArgs emits gifsicle batch delay arguments", () => {
  const frames = [
    { sourceIndex: 0, delayCs: 10 },
    { sourceIndex: 1, delayCs: 10 },
    { sourceIndex: 2, delayCs: 20 }
  ];
  assert.deepEqual(delayBatchArgs(frames), ["--delay", "10", "#0-1", "--delay", "20", "#2"]);
});

test("exportModeForProject rejects v2-only edits", () => {
  const project = { slices: [{ overlays: [{ text: "x" }] }] };
  assert.throws(() => exportModeForProject(project), /not supported in v1/);
});
```

- [ ] **Step 2: Implement exporter helpers and command orchestration**

Create `src/exporter.js`:

```js
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { runTool } = require("./tools");
const { tmpDir, exportsDir, ensureDir } = require("./paths");
const { buildFramePlan } = require("./project");

function rangeLabel(start, end) {
  return start === end ? `#${start}` : `#${start}-${end}`;
}

function frameSelectionArgs(frames) {
  const ranges = [];
  let start = null;
  let previous = null;
  for (const frame of frames) {
    if (start === null) {
      start = frame.sourceIndex;
      previous = frame.sourceIndex;
      continue;
    }
    if (frame.sourceIndex === previous + 1) {
      previous = frame.sourceIndex;
      continue;
    }
    ranges.push(rangeLabel(start, previous));
    start = frame.sourceIndex;
    previous = frame.sourceIndex;
  }
  if (start !== null) {
    ranges.push(rangeLabel(start, previous));
  }
  return ranges;
}

function delayGroups(frames) {
  const groups = [];
  let current = null;
  frames.forEach((frame, index) => {
    if (!current || current.delayCs !== frame.delayCs || current.end !== index - 1) {
      current = { start: index, end: index, delayCs: frame.delayCs };
      groups.push(current);
      return;
    }
    current.end = index;
  });
  return groups;
}

function delayBatchArgs(frames) {
  const args = [];
  for (const group of delayGroups(frames)) {
    args.push("--delay", String(group.delayCs), rangeLabel(group.start, group.end));
  }
  return args;
}

function exportModeForProject(project) {
  for (const slice of project.slices || []) {
    if ((slice.overlays && slice.overlays.length) || (slice.inserts && slice.inserts.length)) {
      throw new Error("Overlays and inserts are not supported in v1 lossless export");
    }
  }
  return "lossless-native";
}

function outputName(prefix = "gifclip") {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${prefix}-${stamp}-${suffix}.gif`;
}

async function exportLossless(project) {
  exportModeForProject(project);
  ensureDir(tmpDir);
  ensureDir(exportsDir);
  const plan = buildFramePlan(project);
  const tempPath = path.join(tmpDir, `${project.id}-${Date.now()}.gif`);
  const outputPath = path.join(exportsDir, outputName("gifclip"));
  const selectionArgs = [plan.sourcePath, ...frameSelectionArgs(plan.frames), "--output", tempPath];
  await runTool("gifsicle", selectionArgs);
  const delayArgs = delayBatchArgs(plan.frames);
  await runTool("gifsicle", ["--batch", tempPath, ...delayArgs]);
  await runTool("gifsicle", ["--optimize=2", tempPath, "--output", outputPath]);
  fs.rmSync(tempPath, { force: true });
  return {
    mode: "lossless-native",
    frameCount: plan.frames.length,
    outputPath,
    href: `/exports/${path.basename(outputPath)}`
  };
}

module.exports = {
  frameSelectionArgs,
  delayGroups,
  delayBatchArgs,
  exportModeForProject,
  exportLossless
};
```

- [ ] **Step 3: Run exporter tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit exporter**

Run:

```bash
git add src/exporter.js test/exporter.test.js
git commit -m "feat: export lossless gif slices"
```

---

### Task 5: Preview Cache

**Files:**
- Create: `src/preview.js`
- Create: `test/preview.test.js`

- [ ] **Step 1: Write preview cache tests**

Create `test/preview.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { previewCachePath, ffmpegPreviewArgs } = require("../src/preview");

test("previewCachePath is stable for source hash, frame, and size", () => {
  const first = previewCachePath({ sha256: "abcdef" }, 12, 900);
  const second = previewCachePath({ sha256: "abcdef" }, 12, 900);
  assert.equal(first, second);
  assert.ok(first.endsWith("abcdef-12-900.jpg"));
});

test("ffmpegPreviewArgs selects one frame and scales to max dimension", () => {
  const args = ffmpegPreviewArgs("/tmp/in.gif", 5, 900, "/tmp/out.jpg");
  assert.deepEqual(args.slice(0, 4), ["-v", "error", "-i", "/tmp/in.gif"]);
  assert.ok(args.includes("-frames:v"));
  assert.ok(args.includes("/tmp/out.jpg"));
});
```

- [ ] **Step 2: Implement preview generation**

Create `src/preview.js`:

```js
const fs = require("node:fs");
const path = require("node:path");
const { previewCacheDir, ensureDir } = require("./paths");
const { runTool } = require("./tools");

function previewCachePath(source, frameIndex, maxSize) {
  const safeHash = source.sha256.slice(0, 16);
  return path.join(previewCacheDir, `${safeHash}-${frameIndex}-${maxSize}.jpg`);
}

function ffmpegPreviewArgs(sourcePath, frameIndex, maxSize, outputPath) {
  const select = `select=eq(n\\,${frameIndex})`;
  const scale = `scale='if(gt(iw,ih),min(${maxSize},iw),-2)':'if(gt(ih,iw),min(${maxSize},ih),-2)'`;
  return [
    "-v", "error",
    "-i", sourcePath,
    "-vf", `${select},${scale}`,
    "-frames:v", "1",
    "-q:v", "3",
    "-y",
    outputPath
  ];
}

async function ensurePreview(source, frameIndex, maxSize = 900) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= source.frameCount) {
    throw new Error(`Preview frame is outside source range: ${frameIndex}`);
  }
  ensureDir(previewCacheDir);
  const outputPath = previewCachePath(source, frameIndex, maxSize);
  if (!fs.existsSync(outputPath)) {
    await runTool("ffmpeg", ffmpegPreviewArgs(source.sourcePath, frameIndex, maxSize, outputPath));
  }
  return outputPath;
}

module.exports = {
  previewCachePath,
  ffmpegPreviewArgs,
  ensurePreview
};
```

- [ ] **Step 3: Run preview tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit preview cache**

Run:

```bash
git add src/preview.js test/preview.test.js
git commit -m "feat: cache gif preview frames"
```

---

### Task 6: Adjacent Duplicate Analysis

**Files:**
- Create: `src/duplicates.js`
- Create: `test/duplicates.test.js`

- [ ] **Step 1: Write duplicate parser tests**

Create `test/duplicates.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseFrameMd5, adjacentDuplicateIndexes, ffmpegFrameMd5Args } = require("../src/duplicates");

const sample = `#format: frame checksums
0,          0,          0,        1,   320000, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
0,          1,          1,        1,   320000, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
0,          2,          2,        1,   320000, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`;

test("parseFrameMd5 extracts hashes in order", () => {
  assert.deepEqual(parseFrameMd5(sample), [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  ]);
});

test("adjacentDuplicateIndexes returns original frame indexes to omit", () => {
  const hashes = ["a", "a", "b", "b", "b"];
  assert.deepEqual(adjacentDuplicateIndexes(hashes, 10), [11, 13, 14]);
});

test("ffmpegFrameMd5Args selects a bounded frame range", () => {
  const args = ffmpegFrameMd5Args("/tmp/in.gif", 4, 8);
  assert.ok(args.includes("select=between(n\\,4\\,8)"));
  assert.ok(args.includes("framemd5"));
});
```

- [ ] **Step 2: Implement duplicate analysis**

Create `src/duplicates.js`:

```js
const { runTool } = require("./tools");

function ffmpegFrameMd5Args(sourcePath, start, end) {
  return [
    "-v", "error",
    "-i", sourcePath,
    "-vf", `select=between(n\\,${start}\\,${end})`,
    "-fps_mode", "passthrough",
    "-f", "framemd5",
    "-"
  ];
}

function parseFrameMd5(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(",").map((part) => part.trim()).at(-1))
    .filter(Boolean);
}

function adjacentDuplicateIndexes(hashes, startFrame) {
  const duplicates = [];
  for (let index = 1; index < hashes.length; index += 1) {
    if (hashes[index] === hashes[index - 1]) {
      duplicates.push(startFrame + index);
    }
  }
  return duplicates;
}

async function analyzeAdjacentDuplicates(source, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= source.frameCount) {
    throw new Error(`Invalid duplicate-analysis range: ${start}-${end}`);
  }
  const result = await runTool("ffmpeg", ffmpegFrameMd5Args(source.sourcePath, start, end));
  const hashes = parseFrameMd5(result.stdout.toString("utf8"));
  return {
    start,
    end,
    duplicateFrames: adjacentDuplicateIndexes(hashes, start)
  };
}

module.exports = {
  ffmpegFrameMd5Args,
  parseFrameMd5,
  adjacentDuplicateIndexes,
  analyzeAdjacentDuplicates
};
```

- [ ] **Step 3: Run duplicate tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit duplicate analysis**

Run:

```bash
git add src/duplicates.js test/duplicates.test.js
git commit -m "feat: detect adjacent duplicate gif frames"
```

---

### Task 7: HTTP API

**Files:**
- Create: `src/http-utils.js`
- Create: `server.js`
- Modify: `test/tools.test.js`

- [ ] **Step 1: Create HTTP utilities**

Create `src/http-utils.js`:

```js
const fs = require("node:fs");
const path = require("node:path");
const { publicDir, exportsDir } = require("./paths");

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length
  });
  res.end(body);
}

function sendError(res, statusCode, error) {
  sendJson(res, statusCode, { error: error.message || String(error) });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(new Error("Invalid JSON request body"));
      }
    });
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function trySendFile(res, baseDir, urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const relative = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
  const filePath = path.resolve(baseDir, relative);
  const rel = path.relative(baseDir, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  res.writeHead(200, { "content-type": contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function sendStatic(req, res) {
  if (req.url.startsWith("/exports/")) {
    return trySendFile(res, exportsDir, req.url.replace(/^\/exports\//, "/"));
  }
  return trySendFile(res, publicDir, req.url);
}

module.exports = {
  sendJson,
  sendError,
  readJson,
  sendStatic
};
```

- [ ] **Step 2: Implement the API server**

Create `server.js`:

```js
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { checkRequiredTools } = require("./src/tools");
const { rootDir, ensureRuntimeDirs, assertInsideRoot } = require("./src/paths");
const { loadGifInfo } = require("./src/gif-info");
const { createProject, normalizeProject, markDuplicateFrames } = require("./src/project");
const { ensurePreview } = require("./src/preview");
const { analyzeAdjacentDuplicates } = require("./src/duplicates");
const { exportLossless } = require("./src/exporter");
const { sendJson, sendError, readJson, sendStatic } = require("./src/http-utils");

const projects = new Map();

function listSources() {
  return fs.readdirSync(rootDir)
    .filter((name) => name.toLowerCase().endsWith(".gif"))
    .map((name) => {
      const filePath = path.join(rootDir, name);
      const stat = fs.statSync(filePath);
      return { name, bytes: stat.size };
    });
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/sources") {
    sendJson(res, 200, { sources: listSources() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/load") {
    const body = await readJson(req);
    const sourcePath = assertInsideRoot(path.join(rootDir, body.name || ""));
    const source = await loadGifInfo(sourcePath);
    const project = createProject(source);
    projects.set(project.id, project);
    sendJson(res, 200, { project });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/frame/")) {
    const [, , , projectId, frameText] = url.pathname.split("/");
    const project = projects.get(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const frameIndex = Number(frameText);
    const maxSize = Number(url.searchParams.get("max") || "900");
    const previewPath = await ensurePreview(project.source, frameIndex, maxSize);
    res.writeHead(200, { "content-type": "image/jpeg" });
    fs.createReadStream(previewPath).pipe(res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze-duplicates") {
    const body = await readJson(req);
    const project = normalizeProject(body.project);
    const slice = project.slices.find((item) => item.id === body.sliceId);
    if (!slice) throw new Error(`Unknown slice: ${body.sliceId}`);
    const analysis = await analyzeAdjacentDuplicates(project.source, slice.start, slice.end);
    const updated = markDuplicateFrames(project, slice.id, analysis.duplicateFrames);
    projects.set(updated.id, updated);
    sendJson(res, 200, { project: updated, analysis });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/export") {
    const body = await readJson(req);
    const project = normalizeProject(body.project);
    const exported = await exportLossless(project);
    sendJson(res, 200, exported);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function handle(req, res) {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    if (!sendStatic(req, res)) {
      sendJson(res, 404, { error: "Not found" });
    }
  } catch (error) {
    sendError(res, 400, error);
  }
}

function main() {
  checkRequiredTools();
  ensureRuntimeDirs();
  const port = Number(process.env.PORT || "8787");
  const server = http.createServer(handle);
  server.listen(port, "127.0.0.1", () => {
    console.log(`gifclip listening on http://127.0.0.1:${port}`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { listSources, handleApi };
```

- [ ] **Step 3: Run API-adjacent tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit API**

Run:

```bash
git add src/http-utils.js server.js
git commit -m "feat: add gifclip api server"
```

---

### Task 8: Browser Editor UI

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

- [ ] **Step 1: Create the editor HTML**

Create `public/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>gifclip</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="app">
      <header class="toolbar">
        <select id="sourceSelect"></select>
        <button id="loadBtn">Load</button>
        <button id="exportBtn" disabled>Export</button>
        <a id="outputLink" hidden>Open export</a>
      </header>

      <section class="workspace">
        <section class="previewPanel">
          <img id="preview" alt="">
          <div id="status">Choose a GIF to start.</div>
        </section>

        <aside class="sidePanel">
          <div class="field">
            <label for="frameSlider">Frame <span id="frameLabel">0</span></label>
            <input id="frameSlider" type="range" min="0" max="0" value="0" disabled>
            <div id="delayLabel">Delay: 0 cs</div>
          </div>

          <div class="actions">
            <button id="splitBtn" disabled>Split here</button>
            <button id="dupeBtn" disabled>Remove adjacent duplicates</button>
          </div>

          <label class="field">
            Slice speed
            <input id="speedInput" type="number" min="0.1" max="16" step="0.1" value="1" disabled>
          </label>

          <div id="sliceList" class="sliceList"></div>
        </aside>
      </section>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create compact styling**

Create `public/styles.css`:

```css
:root {
  color-scheme: dark;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #101214;
  color: #e8ebef;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
select,
input {
  font: inherit;
}

button,
select,
input[type="number"] {
  border: 1px solid #39414a;
  background: #171b20;
  color: #e8ebef;
  border-radius: 6px;
  padding: 8px 10px;
}

button {
  cursor: pointer;
}

button:disabled,
input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.app {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
}

.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px;
  border-bottom: 1px solid #252b33;
  background: #14181d;
}

.toolbar select {
  min-width: 260px;
}

.toolbar a {
  color: #8dd4ff;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  min-height: 0;
}

.previewPanel {
  min-width: 0;
  display: grid;
  grid-template-rows: 1fr auto;
  place-items: center;
  padding: 12px;
  background: #050607;
}

#preview {
  max-width: 100%;
  max-height: calc(100vh - 92px);
  object-fit: contain;
  image-rendering: auto;
}

#status {
  width: 100%;
  min-height: 32px;
  padding: 8px 2px;
  color: #aeb7c2;
}

.sidePanel {
  border-left: 1px solid #252b33;
  padding: 12px;
  overflow: auto;
  background: #12161b;
}

.field {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

#frameSlider {
  width: 100%;
}

.actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-bottom: 14px;
}

.sliceList {
  display: grid;
  gap: 8px;
}

.slice {
  border: 1px solid #303842;
  border-radius: 6px;
  padding: 10px;
  background: #181d23;
}

.slice.active {
  border-color: #75c7ff;
}

.sliceTop {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.sliceMeta {
  color: #aeb7c2;
  font-size: 13px;
}

@media (max-width: 820px) {
  .workspace {
    grid-template-columns: 1fr;
  }
  .sidePanel {
    border-left: 0;
    border-top: 1px solid #252b33;
  }
}
```

- [ ] **Step 3: Implement client interactions**

Create `public/app.js`:

```js
const state = {
  project: null,
  selectedSliceId: null,
  previewAbort: null
};

const els = {
  sourceSelect: document.querySelector("#sourceSelect"),
  loadBtn: document.querySelector("#loadBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  outputLink: document.querySelector("#outputLink"),
  preview: document.querySelector("#preview"),
  status: document.querySelector("#status"),
  frameSlider: document.querySelector("#frameSlider"),
  frameLabel: document.querySelector("#frameLabel"),
  delayLabel: document.querySelector("#delayLabel"),
  splitBtn: document.querySelector("#splitBtn"),
  dupeBtn: document.querySelector("#dupeBtn"),
  speedInput: document.querySelector("#speedInput"),
  sliceList: document.querySelector("#sliceList")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || response.statusText);
  }
  return response.json();
}

function setStatus(message) {
  els.status.textContent = message;
}

function selectedSlice() {
  if (!state.project) return null;
  return state.project.slices.find((slice) => slice.id === state.selectedSliceId) || state.project.slices[0] || null;
}

function renderProject() {
  const project = state.project;
  const hasProject = Boolean(project);
  els.exportBtn.disabled = !hasProject;
  els.frameSlider.disabled = !hasProject;
  els.splitBtn.disabled = !hasProject;
  els.dupeBtn.disabled = !hasProject;
  els.speedInput.disabled = !hasProject;
  if (!project) {
    els.sliceList.innerHTML = "";
    return;
  }
  els.frameSlider.max = String(project.source.frameCount - 1);
  els.frameLabel.textContent = els.frameSlider.value;
  const frame = Number(els.frameSlider.value);
  els.delayLabel.textContent = `Delay: ${project.source.delaysCs[frame] || 0} cs`;
  const active = selectedSlice();
  els.speedInput.value = active ? String(active.speed) : "1";
  els.sliceList.innerHTML = "";
  for (const slice of project.slices) {
    const node = document.createElement("div");
    node.className = `slice${slice.id === state.selectedSliceId ? " active" : ""}`;
    node.innerHTML = `
      <div class="sliceTop">
        <button data-select="${slice.id}">${slice.id}</button>
        <button data-delete="${slice.id}">${slice.deleted ? "Restore" : "Delete"}</button>
      </div>
      <div class="sliceMeta">${slice.start}-${slice.end} · ${slice.end - slice.start + 1} frames · ${slice.speed}x · ${slice.duplicateFrames.length} dupes</div>
    `;
    els.sliceList.appendChild(node);
  }
}

async function loadSources() {
  const { sources } = await api("/api/sources");
  els.sourceSelect.innerHTML = "";
  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source.name;
    option.textContent = `${source.name} (${Math.round(source.bytes / 1024 / 1024)} MB)`;
    els.sourceSelect.appendChild(option);
  }
}

async function loadSelectedSource() {
  setStatus("Loading GIF metadata...");
  const { project } = await api("/api/load", {
    method: "POST",
    body: JSON.stringify({ name: els.sourceSelect.value })
  });
  state.project = project;
  state.selectedSliceId = project.slices[0].id;
  els.frameSlider.value = "0";
  renderProject();
  await showFrame(0);
  setStatus(`${project.source.basename}: ${project.source.width}x${project.source.height}, ${project.source.frameCount} frames`);
}

async function showFrame(frameIndex) {
  if (!state.project) return;
  if (state.previewAbort) {
    state.previewAbort.abort();
  }
  const controller = new AbortController();
  state.previewAbort = controller;
  const url = `/api/frame/${state.project.id}/${frameIndex}?max=900&cache=${Date.now()}`;
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok) throw new Error("Preview failed");
  const blob = await response.blob();
  els.preview.src = URL.createObjectURL(blob);
  prefetchFrame(frameIndex + 1);
}

function prefetchFrame(frameIndex) {
  if (!state.project || frameIndex >= state.project.source.frameCount) return;
  fetch(`/api/frame/${state.project.id}/${frameIndex}?max=900`).catch(() => {});
}

function splitLocal(frame) {
  const project = structuredClone(state.project);
  const index = project.slices.findIndex((slice) => slice.start <= frame && frame < slice.end);
  if (index === -1) return;
  const old = project.slices[index];
  project.slices.splice(index, 1, {
    ...old,
    end: frame,
    duplicateFrames: old.duplicateFrames.filter((value) => value <= frame)
  }, {
    ...old,
    id: `slice-${project.slices.length + 1}`,
    start: frame + 1,
    duplicateFrames: old.duplicateFrames.filter((value) => value > frame)
  });
  state.project = project;
  renderProject();
}

els.loadBtn.addEventListener("click", () => {
  loadSelectedSource().catch((error) => setStatus(error.message));
});

els.frameSlider.addEventListener("input", () => {
  const frame = Number(els.frameSlider.value);
  renderProject();
  showFrame(frame).catch((error) => {
    if (error.name !== "AbortError") setStatus(error.message);
  });
});

els.splitBtn.addEventListener("click", () => {
  splitLocal(Number(els.frameSlider.value));
});

els.sliceList.addEventListener("click", (event) => {
  const selectId = event.target.dataset.select;
  const deleteId = event.target.dataset.delete;
  if (selectId) {
    state.selectedSliceId = selectId;
  }
  if (deleteId) {
    const slice = state.project.slices.find((item) => item.id === deleteId);
    slice.deleted = !slice.deleted;
  }
  renderProject();
});

els.speedInput.addEventListener("change", () => {
  const slice = selectedSlice();
  if (!slice) return;
  slice.speed = Number(els.speedInput.value);
  renderProject();
});

els.dupeBtn.addEventListener("click", async () => {
  const slice = selectedSlice();
  if (!slice) return;
  setStatus(`Analyzing ${slice.id} for adjacent duplicates...`);
  const { project, analysis } = await api("/api/analyze-duplicates", {
    method: "POST",
    body: JSON.stringify({ project: state.project, sliceId: slice.id })
  });
  state.project = project;
  state.selectedSliceId = slice.id;
  renderProject();
  setStatus(`Marked ${analysis.duplicateFrames.length} adjacent duplicates in ${slice.id}.`);
});

els.exportBtn.addEventListener("click", async () => {
  setStatus("Exporting lossless/native GIF...");
  els.outputLink.hidden = true;
  const result = await api("/api/export", {
    method: "POST",
    body: JSON.stringify({ project: state.project })
  });
  els.outputLink.href = result.href;
  els.outputLink.hidden = false;
  setStatus(`Exported ${result.frameCount} frames with ${result.mode}.`);
});

loadSources().catch((error) => setStatus(error.message));
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit UI**

Run:

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat: add lossless gif editor ui"
```

---

### Task 9: Sample Verification And README

**Files:**
- Create: `scripts/verify-sample.js`
- Create: `README.md`

- [ ] **Step 1: Create the sample verification script**

Create `scripts/verify-sample.js`:

```js
const fs = require("node:fs");
const path = require("node:path");
const { checkRequiredTools } = require("../src/tools");
const { rootDir, ensureRuntimeDirs } = require("../src/paths");
const { loadGifInfo } = require("../src/gif-info");
const { ensurePreview } = require("../src/preview");
const { createProject, splitAtFrame, setSliceDeleted, setSliceSpeed } = require("../src/project");
const { exportLossless } = require("../src/exporter");
const { parseGifInfo } = require("../src/gif-info");
const { runTool } = require("../src/tools");

async function verify() {
  checkRequiredTools();
  ensureRuntimeDirs();
  const sourcePath = path.join(rootDir, "jobscout-demo.gif");
  if (!fs.existsSync(sourcePath)) {
    throw new Error("jobscout-demo.gif is required for sample verification");
  }
  const info = await loadGifInfo(sourcePath);
  if (info.width !== 3164 || info.height !== 4704 || info.frameCount !== 2607) {
    throw new Error(`Unexpected sample metadata: ${info.width}x${info.height}, ${info.frameCount} frames`);
  }
  const preview = await ensurePreview(info, 10, 900);
  if (!fs.existsSync(preview)) {
    throw new Error("Preview was not generated");
  }

  let project = createProject(info);
  project = splitAtFrame(project, 12);
  project = setSliceDeleted(project, "slice-2", true);
  project = setSliceSpeed(project, "slice-1", 2);
  project.slices[0].start = 10;
  const exported = await exportLossless(project);
  const exportedInfoText = (await runTool("gifsicle", ["--info", exported.outputPath])).stdout.toString("utf8");
  const exportedInfo = parseGifInfo(exportedInfoText, exported.outputPath);
  if (exportedInfo.frameCount !== 3) {
    throw new Error(`Expected 3 exported frames, got ${exportedInfo.frameCount}`);
  }
  console.log(`verified sample: ${exported.href}`);
}

verify().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

- [ ] **Step 2: Create README**

Create `README.md`:

```markdown
# gifclip

Localhost GIF editor for lossless slice, speed, delete, duplicate-removal, and export workflows.

## Requirements

- Node.js 20 or newer
- `gifsicle`
- `ffmpeg`

## Run

```bash
npm start
```

Open `http://127.0.0.1:8787`.

The app lists `.gif` files in the repo root, including `jobscout-demo.gif` when present.

## Verify

```bash
npm test
npm run verify
```

`npm run verify` expects `jobscout-demo.gif` in the repo root. It checks metadata, generates one preview frame, and exports a small lossless/native slice.

## V1 Scope

Supported:

- Frame-by-frame preview scrubbing
- Splitting into slices
- Deleting/restoring slices
- Per-slice speed changes
- Adjacent duplicate-frame removal
- Lossless/native export through `gifsicle`

Deferred to v2:

- Text overlays
- GIF overlays
- Inserting other GIFs
- Pixel compositing and re-encoding
```

- [ ] **Step 3: Run all tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run sample verification**

Run:

```bash
npm run verify
```

Expected: prints `verified sample: /exports/...gif`.

- [ ] **Step 5: Commit verification docs**

Run:

```bash
git add scripts/verify-sample.js README.md
git commit -m "docs: document gifclip verification"
```

---

### Task 10: End-To-End Server Smoke Test

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Start the server**

Run:

```bash
npm start
```

Expected output:

```text
gifclip listening on http://127.0.0.1:8787
```

- [ ] **Step 2: In another shell, verify source listing**

Run:

```bash
curl -s http://127.0.0.1:8787/api/sources
```

Expected: JSON includes `jobscout-demo.gif`.

- [ ] **Step 3: Verify the browser entry point**

Run:

```bash
curl -s http://127.0.0.1:8787/ | head
```

Expected: HTML starts with `<!doctype html>`.

- [ ] **Step 4: Stop the server**

Stop the `npm start` process with `Ctrl+C`.

- [ ] **Step 5: Add smoke-test note to README**

Append this to `README.md`:

~~~markdown
## Smoke Test

After starting the server, these endpoints should respond:

```bash
curl -s http://127.0.0.1:8787/api/sources
curl -s http://127.0.0.1:8787/ | head
```
~~~

- [ ] **Step 6: Commit smoke-test docs**

Run:

```bash
git add README.md
git commit -m "docs: add localhost smoke test"
```

---

## Self-Review Checklist

- Spec coverage: Tasks cover loading local GIFs, metadata parsing, frame preview, slice split/delete, speed changes, adjacent duplicate removal, lossless/native export, README run flow, and sample verification.
- V2 exclusion: Text overlays, GIF overlays, GIF insertion, pixel compositing, and re-encoding are explicitly rejected or deferred.
- Path safety: API source loading stays under the repo root.
- Large GIF strategy: Preview generation is on-demand and cached; browser stores only project JSON and preview blobs.
- Test strategy: Unit tests cover parsers, project plans, exporter argument construction, preview cache keys, and duplicate parsing; `npm run verify` exercises real native tools against `jobscout-demo.gif`.
- Subagent boundaries: Tasks 1 through 10 are separable enough for subagents. The best parallel split after Task 1 is Task 2, Task 3, Task 5, and Task 6 in parallel where file ownership is disjoint; Task 4 follows Task 3 because it imports the project model; Task 7 follows the server modules; Task 8 and Task 9 can then proceed in parallel with clear API contracts.
