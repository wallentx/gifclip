const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  frameSelectionArgs,
  delayGroups,
  delayBatchArgs,
  exportModeForProject,
  ffmpegOptimizedGifArgs,
  firstFrameIsFullCanvas,
  normalizeExportOptions,
  exportGif,
  exportLossless
} = require("../src/exporter");
const { normalizeProject } = require("../src/project");

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

function projectWithSlice(slice) {
  return {
    id: "abc",
    source,
    currentFrame: 0,
    slices: [
      {
        id: "slice-1",
        start: 0,
        end: 5,
        deleted: false,
        speed: 1,
        duplicateFrames: [],
        ...slice
      }
    ]
  };
}

test("frameSelectionArgs collapses adjacent source frame indexes", () => {
  const frames = [0, 1, 2, 5, 7, 8].map((sourceIndex) => ({ sourceIndex }));

  assert.deepEqual(frameSelectionArgs(frames), ["#0-2", "#5", "#7-8"]);
});

test("delayGroups groups adjacent output frame positions by delay", () => {
  const frames = [10, 10, 5, 5, 5, 10].map((delayCs) => ({ delayCs }));

  assert.deepEqual(delayGroups(frames), [
    { start: 0, end: 1, delayCs: 10 },
    { start: 2, end: 4, delayCs: 5 },
    { start: 5, end: 5, delayCs: 10 }
  ]);
});

test("delayBatchArgs emits gifsicle delay rewrite arguments", () => {
  const frames = [10, 10, 5, 5, 5, 10].map((delayCs) => ({ delayCs }));

  assert.deepEqual(delayBatchArgs(frames), [
    "--delay",
    "10",
    "#0-1",
    "--delay",
    "5",
    "#2-4",
    "--delay",
    "10",
    "#5"
  ]);
});

test("exportModeForProject accepts v1 lossless edits", () => {
  assert.equal(exportModeForProject(projectWithSlice()), "lossless-native");
});

test("exportModeForProject rejects overlays", () => {
  assert.throws(
    () => exportModeForProject(projectWithSlice({ overlays: [{ text: "hello" }] })),
    /overlays/
  );
});

test("exportModeForProject rejects inserts", () => {
  assert.throws(
    () => exportModeForProject(projectWithSlice({ inserts: [{ sourcePath: "/repo/other.gif" }] })),
    /inserts/
  );
});

test("exportModeForProject rejects unsupported edits after normalization", () => {
  const normalized = normalizeProject(projectWithSlice({ overlays: [{ text: "hello" }] }));

  assert.throws(() => exportModeForProject(normalized), /overlays/);
});

test("firstFrameIsFullCanvas detects optimized partial first frames", () => {
  assert.equal(
    firstFrameIsFullCanvas("+ image #0 3164x4704\n    delay 2.62s", 3164, 4704),
    true
  );
  assert.equal(
    firstFrameIsFullCanvas("+ image #0 3038x4322 at 41,162 transparent 114", 3164, 4704),
    false
  );
});

test("normalizeExportOptions keeps native export as default", () => {
  assert.deepEqual(normalizeExportOptions(), {
    method: "native",
    fps: null,
    colors: 32,
    scaleWidth: null,
    optimizeLevel: 2
  });
});

test("ffmpegOptimizedGifArgs builds fps, scale, and palette filters", () => {
  const args = ffmpegOptimizedGifArgs("in.gif", "out.gif", {
    method: "optimized",
    fps: 9,
    colors: 64,
    scaleWidth: 1520,
    optimizeLevel: 3
  });

  assert.equal(args.includes("-threads"), true);
  assert.equal(args.includes("in.gif"), true);
  assert.equal(args.at(-1), "out.gif");
  const filter = args[args.indexOf("-filter_complex") + 1];
  assert.match(filter, /fps=9/);
  assert.match(filter, /scale=1520:-2:flags=lanczos/);
  assert.match(filter, /palettegen=max_colors=64:stats_mode=diff/);
});

test("exportLossless reports phase progress during native export", async () => {
  const events = [];
  const commands = [];

  const exported = await exportLossless(projectWithSlice(), {
    onProgress: (event) => events.push(event),
    runTool: async (tool, args) => {
      commands.push({ tool, args });
      if (tool === "gifsicle" && args[0] === "--info") {
        return { stdout: Buffer.from("+ image #0 100x80\n") };
      }
      return { stdout: Buffer.from("") };
    }
  });

  assert.deepEqual(events.map((event) => [event.phase, event.progress]), [
    ["Building export plan", 10],
    ["Selecting frames", 35],
    ["Applying frame delays", 65],
    ["Checking first frame", 78],
    ["Optimizing output", 90]
  ]);
  assert.equal(commands.length, 4);
  assert.equal(exported.mode, "lossless-native");
  assert.equal(exported.frameCount, 6);
  assert.equal(exported.firstFrameRepaired, false);
});

test("exportLossless repairs a partial first frame before optimizing", async () => {
  const commands = [];
  const exported = await exportLossless(projectWithSlice({ start: 2, end: 4 }), {
    runTool: async (tool, args) => {
      commands.push({ tool, args });
      if (tool === "gifsicle" && args[0] === "--info") {
        return { stdout: Buffer.from("+ image #0 90x70 at 5,5 transparent 1\n") };
      }
      const outputIndex = args.indexOf("--output");
      if (outputIndex !== -1) {
        fs.writeFileSync(args[outputIndex + 1], "");
      }
      return { stdout: Buffer.from("") };
    }
  });

  assert.equal(exported.firstFrameRepaired, true);
  assert.equal(commands.some((command) => command.tool === "ffmpeg"), true);
  assert.deepEqual(commands.at(-1).args.slice(0, 1), ["--optimize=2"]);
});

test("exportGif runs optimized export after native frame selection", async () => {
  const commands = [];
  const exported = await exportGif(
    projectWithSlice(),
    { method: "optimized", fps: 9, colors: 64, scaleWidth: 1520, optimizeLevel: 3 },
    {
      runTool: async (tool, args) => {
        commands.push({ tool, args });
        if (tool === "gifsicle" && args[0] === "--info") {
          return { stdout: Buffer.from("+ image #0 100x80\n") };
        }
        const outputIndex = args.indexOf("--output");
        if (outputIndex !== -1) {
          fs.writeFileSync(args[outputIndex + 1], "");
        } else if (tool === "ffmpeg") {
          fs.writeFileSync(args.at(-1), "");
        }
        return { stdout: Buffer.from("") };
      }
    }
  );

  const ffmpeg = commands.find((command) => command.tool === "ffmpeg");
  assert.ok(ffmpeg);
  assert.match(ffmpeg.args[ffmpeg.args.indexOf("-filter_complex") + 1], /max_colors=64/);
  assert.deepEqual(commands.at(-1).args.slice(0, 1), ["--optimize=3"]);
  assert.equal(exported.mode, "optimized");
  assert.equal(exported.nativeMode, "lossless-native");
});
