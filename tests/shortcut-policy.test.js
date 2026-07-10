import assert from "node:assert/strict";
import test from "node:test";
import {
  SHORTCUT_STORAGE_KEY,
  defaultShortcutBindings,
  loadShortcutBindings,
  normalizeShortcutChord,
  saveShortcutBindings,
  shortcutActionForEvent,
  shortcutChordFromEvent,
  shortcutConflicts,
  shortcutDisplayForAction,
  validateShortcutChord
} from "../src/ui/shortcut-policy.js";
import {
  globalShortcutAction,
  gridScrollShortcutAction
} from "../src/ui/global-shortcut-policy.js";

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

test("shortcut defaults preserve command aliases and requested grid scrolling keys", () => {
  const shortcuts = defaultShortcutBindings();

  assert.equal(globalShortcutAction({ key: "s", ctrlKey: true }, { shortcuts }), "save-file");
  assert.equal(globalShortcutAction({ key: "z", ctrlKey: true, shiftKey: true }, { shortcuts }), "redo");
  assert.equal(globalShortcutAction({ key: "+", ctrlKey: true, shiftKey: true }, { shortcuts }), "zoom-in");
  assert.equal(globalShortcutAction({ key: "a", ctrlKey: true }, { shortcuts }), "select-all");
  assert.equal(gridScrollShortcutAction({ key: "PageUp" }, { shortcuts }), "scroll-page-up");
  assert.equal(gridScrollShortcutAction({ key: "PageDown" }, { shortcuts }), "scroll-page-down");
  assert.equal(gridScrollShortcutAction({ key: "Home" }, { shortcuts }), "scroll-top");
  assert.equal(gridScrollShortcutAction({ key: "End" }, { shortcuts }), "scroll-bottom");
  assert.equal(gridScrollShortcutAction({ key: "Home", shiftKey: true }, { shortcuts }), "scroll-left");
  assert.equal(gridScrollShortcutAction({ key: "End", shiftKey: true }, { shortcuts }), "scroll-right");
});

test("remapped shortcuts replace defaults at runtime", () => {
  const shortcuts = defaultShortcutBindings();
  shortcuts["save-file"] = ["Ctrl+K"];
  shortcuts["scroll-page-down"] = ["Ctrl+PageDown"];

  assert.equal(globalShortcutAction({ key: "s", ctrlKey: true }, { shortcuts }), null);
  assert.equal(globalShortcutAction({ key: "k", ctrlKey: true }, { shortcuts }), "save-file");
  assert.equal(gridScrollShortcutAction({ key: "PageDown" }, { shortcuts }), null);
  assert.equal(gridScrollShortcutAction({ key: "PageDown", ctrlKey: true }, { shortcuts }), "scroll-page-down");
  assert.equal(shortcutActionForEvent({ key: "k", ctrlKey: true }, shortcuts), "save-file");
});

test("cell editing keeps unmodified text-navigation keys native after remapping", () => {
  const shortcuts = defaultShortcutBindings();
  shortcuts["save-file"] = ["Home", "Ctrl+K"];

  assert.equal(globalShortcutAction({ key: "Home" }, { shortcuts, editingCell: false }), "save-file");
  assert.equal(globalShortcutAction({ key: "Home" }, { shortcuts, editingCell: true }), null);
  assert.equal(globalShortcutAction({ key: "k", ctrlKey: true }, { shortcuts, editingCell: true }), "save-file");
});

test("shortcut recording normalizes modifiers, aliases, and plus keys", () => {
  assert.equal(shortcutChordFromEvent({ key: "s", ctrlKey: true }), "Ctrl+S");
  assert.equal(shortcutChordFromEvent({ key: "S", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+S");
  assert.equal(shortcutChordFromEvent({ key: "+", ctrlKey: true, shiftKey: true }), "Ctrl+Plus");
  assert.equal(shortcutChordFromEvent({ key: "Shift", shiftKey: true }), "");
  assert.equal(normalizeShortcutChord("control+shift+s"), "Ctrl+Shift+S");
  assert.equal(normalizeShortcutChord("Ctrl+Add"), "Ctrl+Plus");
});

test("shortcut validation keeps editing and navigation keys fixed", () => {
  for (const chord of ["ArrowUp", "Ctrl+ArrowLeft", "Enter", "Shift+Tab", "Escape", "F2"]) {
    assert.equal(validateShortcutChord(chord).valid, false, chord);
  }
  assert.equal(validateShortcutChord("S").valid, false);
  assert.equal(validateShortcutChord("Shift+S").valid, false);
  assert.equal(validateShortcutChord("Ctrl+S").valid, true);
  assert.equal(validateShortcutChord("PageUp").valid, true);
  assert.equal(validateShortcutChord("Shift+Home").valid, true);
});

test("shortcut conflicts are reported across command and grid contexts", () => {
  const shortcuts = defaultShortcutBindings();
  shortcuts["scroll-top"] = ["Ctrl+S"];
  const conflicts = shortcutConflicts(shortcuts);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].chord, "Ctrl+S");
  assert.deepEqual(conflicts[0].actions, ["save-file", "scroll-top"]);
});

test("shortcut storage persists overrides, aliases, and unassigned commands", () => {
  const storage = makeStorage();
  const shortcuts = defaultShortcutBindings();
  shortcuts["save-file"] = ["Ctrl+K"];
  shortcuts.copy = [];

  const saved = saveShortcutBindings(shortcuts, storage);
  const loaded = loadShortcutBindings(storage);

  assert.deepEqual(saved["save-file"], ["Ctrl+K"]);
  assert.deepEqual(loaded["save-file"], ["Ctrl+K"]);
  assert.deepEqual(loaded.copy, []);
  assert.equal(shortcutDisplayForAction("save-file", loaded), "Ctrl+K");
  assert.equal(JSON.parse(storage.getItem(SHORTCUT_STORAGE_KEY)).version, 1);
});
