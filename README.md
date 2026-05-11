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

## Performance knobs

gifclip defaults to laptop-oriented ffmpeg settings:

- `GIFCLIP_FFMPEG_THREADS`: ffmpeg decode/filter threads. Defaults to the available CPU count, capped at 8.
- `GIFCLIP_DUPLICATE_THREADS`: ffmpeg threads for duplicate-frame analysis. Defaults to the full available CPU count.
- `GIFCLIP_PREVIEW_JOBS`: concurrent preview-generation ffmpeg jobs. Defaults to half the available CPU count, capped at 4.
- `GIFCLIP_FFMPEG_HWACCEL`: ffmpeg input hardware acceleration mode. Defaults to `auto`; set `off` to disable probing, or a specific ffmpeg mode such as `cuda` or `vaapi`.

Current GIF preview and duplicate-analysis paths mostly benefit from CPU threads and concurrent ffmpeg jobs. Preview work is cancelled when the browser moves on to a newer frame so stale scrubbing requests do not keep ffmpeg running. ffmpeg uses CPU SIMD such as AVX512 through its own runtime dispatch when the installed build supports it.

## Verify

```bash
npm test
npm run verify
```

`npm run verify` expects `jobscout-demo.gif` in the repo root. It checks metadata, generates one preview frame, and exports a small lossless/native slice.

## Benchmark Preview Extraction

```bash
npm run benchmark:preview -- --start=10 --count=6 --max=900
```

The benchmark compares the current one-FFmpeg-process-per-frame preview path with a batch proxy-frame extraction path. Outputs and `summary.json` are written under `.gifclip/tmp/benchmarks/`.

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

## Smoke Test

After starting the server, these endpoints should respond:

```bash
curl -s http://127.0.0.1:8787/api/sources
curl -s http://127.0.0.1:8787/ | head
```
