# Lossless GIF Editor Design

## Goal

Build a fast localhost GIF editor for large GIFs, with the first version focused on lossless slice, speed, delete, and export workflows. Text overlays, GIF overlays, and GIF insertion are deferred to v2.

## Scope

Version 1 supports:

- Loading local GIFs, including `jobscout-demo.gif`.
- Reading GIF metadata: logical screen size, frame count, frame delays, and loop behavior.
- Scrubbing frame by frame through a cached preview.
- Splitting the timeline into slices at the current frame.
- Selecting, deleting, and reordering output by slice inclusion.
- Changing playback speed per slice by rewriting frame delays.
- Removing duplicate adjacent frames by omitting duplicate frame indexes.
- Exporting the resulting GIF with native GIF tools.

Version 1 does not support:

- Text overlays.
- GIF overlays.
- Inserting other GIFs.
- Pixel compositing.
- Full raster editing.

Those v2 features require a re-encode path and should not complicate the first lossless workflow.

## Architecture

The app uses a small Node server as the localhost control plane and native GIF tools for expensive work. Node handles HTTP, project state, command orchestration, cache paths, and validation. It does not decode entire GIFs in JavaScript.

The browser UI is a static app served by Node. It keeps a lightweight project model: source GIF identity, current frame, and an ordered list of slices. Each slice references a source frame range and stores non-pixel edits such as enabled/deleted state, speed multiplier, and duplicate-removal decisions.

Native tools:

- `gifsicle` reads metadata, selects frame ranges, changes frame delays, and writes the lossless/native export.
- `ffmpeg` extracts scaled preview frames on demand.
- ImageMagick is available for later v2 work but is not required for the v1 lossless path.

## Lossless Export Path

The exporter converts the slice list into an ordered frame plan:

1. Exclude deleted slices.
2. Expand each remaining slice into source frame indexes.
3. Omit duplicate frames selected for removal.
4. Apply slice speed by computing output delays from the original frame delays.
5. Write the output GIF with `gifsicle`.

For frame cuts, slice deletion, and duplicate omission, the output should preserve the original GIF frame data as much as `gifsicle` allows. Speed changes rewrite GIF delay metadata, but do not require pixel re-encoding.

The exporter should report `mode: "lossless-native"` when the project contains only v1 edits. If future edits require compositing or pixel rewriting, the exporter should refuse them in v1 rather than silently re-encoding.

## Preview And Cache Strategy

Large GIFs must not be fully decoded in the browser or in Node memory.

Preview behavior:

- Parse metadata once per loaded source.
- Generate previews on demand with `ffmpeg`.
- Scale previews to a configured maximum dimension.
- Cache preview images under `.gifclip/cache/`.
- Key cached previews by source file hash, frame index, and preview size.
- Throttle frame slider requests in the browser.
- Prefetch a small number of nearby frames after the current preview loads.

The included `jobscout-demo.gif` is expected to report a logical screen of `3164x4704` and `2607` frames. The UI should remain responsive by requesting only the currently needed preview frame.

## Smallest Usable UI

The first screen is the editor, not a landing page.

Required controls:

- Source picker showing local GIFs in the repo.
- Load button.
- Preview pane.
- Frame slider with current frame and frame delay.
- Split-at-frame button.
- Slice list with start, end, frame count, enabled/deleted status, and speed.
- Delete/restore slice control.
- Per-slice speed multiplier.
- Duplicate-removal action for adjacent duplicates.
- Export button.
- Export status and output link.

The UI should clearly show that overlays and inserts are v2-only if their controls are present at all. The v1 UI may omit them entirely.

## Error Handling

Startup should detect missing native tools and report actionable messages.

Server endpoints should validate:

- Source paths stay inside the project directory unless uploads are explicitly added.
- Frame indexes are integers within the source frame count.
- Slice ranges are non-empty and ordered.
- Speed multipliers are positive and bounded.
- Export plans contain only v1-supported edits.

Long-running exports should return status updates or at minimum a clear pending/exporting/done/error state.

## Verification

Before calling v1 complete:

- `gifsicle --info jobscout-demo.gif` metadata is parsed as `3164x4704` and `2607` frames.
- A preview frame can be generated and served.
- A small lossless export, such as frames 10 through 12, produces a valid 3-frame GIF.
- A slice delete export produces the expected reduced frame count.
- A speed-change export changes frame delays without invoking the re-encode path.
- The README contains the local run command and tool prerequisites.
