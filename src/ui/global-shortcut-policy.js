import {
  defaultShortcutBindings,
  shortcutActionForEvent
} from "./shortcut-policy.js";

const DEFAULT_SHORTCUTS = defaultShortcutBindings();

export function isEditorShortcutAllowed(key, ctrlKey) {
  return Boolean(globalShortcutAction({ key, ctrlKey }, { editingCell: true }));
}

export function gridScrollShortcutAction(event, { shortcuts = DEFAULT_SHORTCUTS } = {}) {
  return shortcutActionForEvent(event, shortcuts, { context: "grid" });
}

export function globalShortcutAction(event, { editingCell = false, shortcuts = DEFAULT_SHORTCUTS } = {}) {
  return shortcutActionForEvent(event, shortcuts, { context: "global", editingCell });
}
