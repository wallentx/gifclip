const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { previewCacheDir } = require("../src/paths");
const {
  boundedPreviewRange,
  cachedPreviewRanges,
  ensurePreview,
  ensurePreviewRange,
  ffmpegPreviewArgs,
  ffmpegPreviewRangeArgs,
  previewCachePath
} = require("../src/preview");

async function waitFor(condition) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test("previewCachePath is stable for source hash, frame, and size", () => {
  const source = { sha256: "abcdef1234567890abcdef1234567890" };

  const first = previewCachePath(source, 12, 900);
  const second = previewCachePath(source, 12, 900);

  assert.equal(first, second);
  assert.equal(first, path.join(previewCacheDir, "abcdef1234567890-12-900.jpg"));
});

test("ffmpegPreviewArgs selects one scaled jpeg frame", () => {
  const args = ffmpegPreviewArgs("source.gif", 7, 900, "out.jpg", { threads: 8 });

  assert.deepEqual(args, [
    "-v",
    "error",
    "-threads",
    "8",
    "-filter_threads",
    "8",
    "-hwaccel",
    "auto",
    "-i",
    "source.gif",
    "-vf",
    "select=eq(n\\,7),scale='if(gte(iw,ih),min(900,iw),-2)':'if(gte(ih,iw),min(900,ih),-2)'",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-y",
    "out.jpg"
  ]);
});

test("boundedPreviewRange clamps requested windows to source bounds and max frames", () => {
  assert.deepEqual(boundedPreviewRange(10, 40, 100, 16), { start: 10, end: 25, count: 16 });
  assert.deepEqual(boundedPreviewRange(-5, 5, 100, 20), { start: 0, end: 5, count: 6 });
  assert.deepEqual(boundedPreviewRange(95, 120, 100, 20), { start: 95, end: 99, count: 5 });
});

test("boundedPreviewRange creates a bounded window around a frame marker", () => {
  assert.deepEqual(boundedPreviewRange(32, 48, 100, 17, 40), { start: 32, end: 48, count: 17 });
  assert.deepEqual(boundedPreviewRange(20, 80, 100, 17, 40), { start: 32, end: 48, count: 17 });
  assert.deepEqual(boundedPreviewRange(0, 80, 100, 17, 2), { start: 0, end: 10, count: 11 });
});

test("ffmpegPreviewRangeArgs selects a bounded scaled jpeg frame window", () => {
  const args = ffmpegPreviewRangeArgs("source.gif", 7, 9, 900, "frame-%06d.jpg", { threads: 8 });

  assert.deepEqual(args, [
    "-v",
    "error",
    "-threads",
    "8",
    "-filter_threads",
    "8",
    "-hwaccel",
    "auto",
    "-i",
    "source.gif",
    "-vf",
    "select=between(n\\,7\\,9),scale='if(gte(iw,ih),min(900,iw),-2)':'if(gte(ih,iw),min(900,ih),-2)'",
    "-fps_mode",
    "passthrough",
    "-frames:v",
    "3",
    "-q:v",
    "3",
    "-y",
    "frame-%06d.jpg"
  ]);
});

test("ensurePreview runs configured preview jobs concurrently", async () => {
  const source = {
    sha256: "parallelpreview000000000000",
    sourcePath: "source.gif",
    frameCount: 3
  };
  const outputPaths = [0, 1, 2].map((frame) => previewCachePath(source, frame, 900));
  for (const outputPath of outputPaths) {
    fs.rmSync(outputPath, { force: true });
  }

  let active = 0;
  let started = 0;
  let maxActive = 0;
  const releases = [];
  const runTool = async (_tool, args) => {
    started += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => releases.push(resolve));
    fs.writeFileSync(args.at(-1), "preview");
    active -= 1;
  };

  try {
    const pending = [
      ensurePreview(source, 0, 900, { runTool, maxJobs: 2 }),
      ensurePreview(source, 1, 900, { runTool, maxJobs: 2 }),
      ensurePreview(source, 2, 900, { runTool, maxJobs: 2 })
    ];

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(maxActive, 2);
    assert.equal(started, 2);
    assert.equal(releases.length, 2);

    releases.shift()();
    await waitFor(() => started === 3);
    assert.equal(started, 3);

    while (releases.length > 0) {
      releases.shift()();
    }
    await Promise.all(pending);
  } finally {
    for (const outputPath of outputPaths) {
      fs.rmSync(outputPath, { force: true });
    }
  }
});

test("ensurePreview prioritizes direct frame jobs ahead of queued prewarm ranges", async () => {
  const source = {
    sha256: "prioritypreview000000000",
    sourcePath: "source.gif",
    frameCount: 10
  };
  const outputPaths = [
    ...[0, 1, 2, 3].map((frame) => previewCachePath(source, frame, 900)),
    previewCachePath(source, 8, 900)
  ];
  for (const outputPath of outputPaths) {
    fs.rmSync(outputPath, { force: true });
  }

  const started = [];
  const releases = [];
  const runTool = async (_tool, args) => {
    started.push(args.at(-1).includes("%06d") ? "range" : args.at(-1));
    await new Promise((resolve) => releases.push(resolve));

    const output = args.at(-1);
    if (output.includes("%06d")) {
      const frames = Number(args[args.indexOf("-frames:v") + 1]);
      const outputDir = path.dirname(output);
      for (let index = 1; index <= frames; index += 1) {
        fs.writeFileSync(path.join(outputDir, `frame-${String(index).padStart(6, "0")}.jpg`), "preview");
      }
    } else {
      fs.writeFileSync(output, "preview");
    }
  };

  try {
    const firstRange = ensurePreviewRange(source, 0, 1, 900, { runTool, maxJobs: 1 });
    await waitFor(() => releases.length === 1);
    const secondRange = ensurePreviewRange(source, 2, 3, 900, { runTool, maxJobs: 1 });
    const direct = ensurePreview(source, 8, 900, { runTool, maxJobs: 1 });

    releases.shift()();
    await waitFor(() => started.length === 2);

    assert.equal(started[0], "range");
    assert.equal(started[1], previewCachePath(source, 8, 900));

    releases.shift()();
    await waitFor(() => started.length === 3);
    assert.equal(started[2], "range");
    releases.shift()();
    await Promise.all([firstRange, secondRange, direct]);
  } finally {
    for (const outputPath of outputPaths) {
      fs.rmSync(outputPath, { force: true });
    }
  }
});

test("ensurePreview skips queued jobs aborted before they start", async () => {
  const source = {
    sha256: "abortqueuedpreview000000",
    sourcePath: "source.gif",
    frameCount: 2
  };
  const outputPaths = [0, 1].map((frame) => previewCachePath(source, frame, 900));
  for (const outputPath of outputPaths) {
    fs.rmSync(outputPath, { force: true });
  }

  const abortController = new AbortController();
  const started = [];
  const releases = [];
  const runTool = async (_tool, args) => {
    started.push(args.at(-1));
    await new Promise((resolve) => releases.push(resolve));
    fs.writeFileSync(args.at(-1), "preview");
  };

  try {
    const first = ensurePreview(source, 0, 900, { runTool, maxJobs: 1 });
    await waitFor(() => releases.length === 1);
    const second = ensurePreview(source, 1, 900, {
      runTool,
      maxJobs: 1,
      signal: abortController.signal
    });
    abortController.abort();

    releases.shift()();
    await first;
    await assert.rejects(second, /aborted/i);
    assert.deepEqual(started, [previewCachePath(source, 0, 900)]);
  } finally {
    for (const outputPath of outputPaths) {
      fs.rmSync(outputPath, { force: true });
    }
  }
});

test("ensurePreviewRange generates the marker-centered bounded window", async () => {
  const source = {
    sha256: "centeredpreviewrange0001",
    sourcePath: "source.gif",
    frameCount: 100
  };
  const outputPaths = [];

  try {
    const result = await ensurePreviewRange(source, 20, 80, 900, {
      maxFrames: 17,
      center: 40,
      runTool: async (_tool, args) => {
        const frames = Number(args[args.indexOf("-frames:v") + 1]);
        const outputPattern = args.at(-1);
        const outputDir = path.dirname(outputPattern);
        for (let index = 1; index <= frames; index += 1) {
          fs.writeFileSync(path.join(outputDir, `frame-${String(index).padStart(6, "0")}.jpg`), "preview");
        }
      }
    });

    outputPaths.push(...result.outputPaths);
    assert.deepEqual(
      { start: result.start, end: result.end, count: result.count, generated: result.generated },
      { start: 32, end: 48, count: 17, generated: 17 }
    );
  } finally {
    for (const outputPath of outputPaths) {
      fs.rmSync(outputPath, { force: true });
    }
  }
});

test("ensurePreviewRange generates only missing spans inside a shifted cached window", async () => {
  const source = {
    sha256: "shiftedpreviewrange0001",
    sourcePath: "source.gif",
    frameCount: 2000
  };
  const cachedFrames = [];
  const outputPaths = [];
  for (let frame = 464; frame <= 584; frame += 1) {
    const outputPath = previewCachePath(source, frame, 900);
    cachedFrames.push(outputPath);
    fs.writeFileSync(outputPath, "cached");
  }

  const started = [];
  try {
    const result = await ensurePreviewRange(source, 0, 1999, 900, {
      maxFrames: 121,
      center: 525,
      runTool: async (_tool, args) => {
        const outputPattern = args.at(-1);
        const outputDir = path.dirname(outputPattern);
        started.push({
          filter: args[args.indexOf("-vf") + 1],
          frames: Number(args[args.indexOf("-frames:v") + 1])
        });
        fs.writeFileSync(path.join(outputDir, "frame-000001.jpg"), "preview");
      }
    });

    outputPaths.push(...result.outputPaths);
    assert.deepEqual(started, [
      {
        filter: "select=between(n\\,585\\,585),scale='if(gte(iw,ih),min(900,iw),-2)':'if(gte(ih,iw),min(900,ih),-2)'",
        frames: 1
      }
    ]);
    assert.deepEqual(
      { start: result.start, end: result.end, count: result.count, generated: result.generated },
      { start: 465, end: 585, count: 121, generated: 1 }
    );
    assert.deepEqual(result.generatedRanges, [{ start: 585, end: 585, count: 1 }]);
  } finally {
    for (const outputPath of [...cachedFrames, ...outputPaths]) {
      fs.rmSync(outputPath, { force: true });
    }
  }
});

test("cachedPreviewRanges reports contiguous cached preview spans", () => {
  const source = {
    sha256: "cachedrangespreview0001",
    sourcePath: "source.gif",
    frameCount: 20
  };
  const cachedFrames = [2, 3, 4, 7, 10, 11];
  const outputPaths = cachedFrames.map((frame) => previewCachePath(source, frame, 900));

  try {
    for (const outputPath of outputPaths) {
      fs.writeFileSync(outputPath, "cached");
    }

    assert.deepEqual(cachedPreviewRanges(source, 0, 12, 900), {
      start: 0,
      end: 12,
      count: 13,
      ranges: [
        { start: 2, end: 4, count: 3 },
        { start: 7, end: 7, count: 1 },
        { start: 10, end: 11, count: 2 }
      ]
    });
  } finally {
    for (const outputPath of outputPaths) {
      fs.rmSync(outputPath, { force: true });
    }
  }
});
