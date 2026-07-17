import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Shortcuts appears immediately before Settings without changing either command", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const shortcuts = '<button data-command="open-shortcut-settings">Shortcuts</button>';
  const settings = '<button data-command="open-app-settings">Settings</button>';
  const shortcutsIndex = html.indexOf(shortcuts);
  const settingsIndex = html.indexOf(settings);

  assert.notEqual(shortcutsIndex, -1);
  assert.notEqual(settingsIndex, -1);
  assert.ok(shortcutsIndex < settingsIndex);
  assert.match(html.slice(shortcutsIndex, settingsIndex + settings.length), /Shortcuts<\/button>\s*<button data-command="open-app-settings">Settings<\/button>/);
});
