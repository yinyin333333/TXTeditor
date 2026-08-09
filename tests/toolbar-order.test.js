import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Shortcuts appears immediately before Settings", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(
    html,
    /<button\b[^>]*data-command="open-shortcut-settings"[^>]*>[\s\S]*?<\/button>\s*<button\b[^>]*data-command="open-app-settings"/
  );
});
