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

## Smoke Test

After starting the server, these endpoints should respond:

```bash
curl -s http://127.0.0.1:8787/api/sources
curl -s http://127.0.0.1:8787/ | head
```
