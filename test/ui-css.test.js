const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("frame hold buttons suppress touch text selection", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  const block = /\.frameControlRow button\s*\{[^}]+\}/.exec(css)?.[0] || "";

  assert.match(block, /touch-action:\s*none/);
  assert.match(block, /-webkit-touch-callout:\s*none/);
  assert.match(block, /-webkit-user-select:\s*none/);
  assert.match(block, /user-select:\s*none/);
});

test("empty preview image is hidden behind a placeholder", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  const hiddenImageBlock = /#preview:not\(\[src\]\)\s*\{[^}]+\}/.exec(css)?.[0] || "";
  const placeholderBlock = /\.previewStage\.is-empty::before\s*\{[^}]+\}/.exec(css)?.[0] || "";

  assert.match(hiddenImageBlock, /display:\s*none/);
  assert.match(placeholderBlock, /border:\s*1px dashed/);
});
