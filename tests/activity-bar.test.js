import assert from "node:assert/strict";
import test from "node:test";
import { createDockController } from "../src/ui/controllers/dock-controller.js";
import { createCommandController } from "../src/ui/controllers/command-controller.js";
import { ACTIVITY_BAR_VISIBILITY_KEY, panelStateFromStorage } from "../src/ui/panel-state-policy.js";
import { DEFAULT_DOCK_LAYOUT } from "../src/ui/dock-layout-policy.js";
import { defaultShortcutBindings, saveShortcutBindings, loadShortcutBindings } from "../src/ui/shortcut-policy.js";
import { globalShortcutAction } from "../src/ui/global-shortcut-policy.js";

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("E/P sidebar shortcut starts unassigned and a saved binding resolves while editing", () => {
  const shortcuts = defaultShortcutBindings();
  assert.deepEqual(shortcuts["toggle-activity-bar"], []);
  assert.deepEqual(shortcuts["toggle-sidebar"], ["Ctrl+B"]);
  shortcuts["toggle-activity-bar"] = ["Ctrl+Shift+B"];
  const saved = storage();
  saveShortcutBindings(shortcuts, saved);
  assert.equal(globalShortcutAction({ key: "b", ctrlKey: true, shiftKey: true }, {
    shortcuts: loadShortcutBindings(saved), editingCell: true
  }), "toggle-activity-bar");
});

test("E/P sidebar toggles independently, persists, and works with no document or JSON", () => {
  const previous = globalThis.localStorage;
  const saved = storage();
  globalThis.localStorage = saved;
  const state = { activityBarVisible: true, sidebarVisible: true, problemsVisible: true, selection: {} };
  let renders = 0;
  let layouts = 0;
  try {
    const dock = createDockController({ state, els: {}, renderChrome: () => renders++, layoutGrid: () => layouts++ });
    let open = false;
    const commands = createCommandController({
      state, activeDoc: () => ({ kind: "json" }), hasOpenDocument: () => open,
      handlers: { toggleActivityBar: dock.toggleActivityBar },
      showError: message => assert.fail(message)
    });
    assert.equal(panelStateFromStorage(saved, DEFAULT_DOCK_LAYOUT).activityBarVisible, true);
    commands.runCommand("toggle-activity-bar");
    assert.equal(state.activityBarVisible, false);
    assert.equal(saved.getItem(ACTIVITY_BAR_VISIBILITY_KEY), "hidden");
    assert.equal(panelStateFromStorage(saved, DEFAULT_DOCK_LAYOUT).activityBarVisible, false);
    open = true;
    commands.runCommand("toggle-activity-bar");
    assert.equal(state.activityBarVisible, true);
    assert.equal(saved.getItem(ACTIVITY_BAR_VISIBILITY_KEY), "visible");
    assert.equal(state.sidebarVisible, true);
    assert.equal(state.problemsVisible, true);
    assert.equal(renders, 2);
    assert.equal(layouts, 2);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
