const EDITOR_ALLOWED_CTRL_KEYS = new Set(["s", "w", "h", "l"]);

export function isEditorShortcutAllowed(key, ctrlKey) {
  return Boolean(ctrlKey && EDITOR_ALLOWED_CTRL_KEYS.has(String(key).toLowerCase()));
}

export function gridScrollShortcutAction(event) {
  const key = String(event.key ?? "");
  const shiftKey = Boolean(event.shiftKey);
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (key === "Home") return shiftKey ? "scroll-left" : "scroll-top";
  if (key === "End") return shiftKey ? "scroll-right" : "scroll-bottom";
  if (shiftKey) return null;
  if (key === "PageUp") return "scroll-page-up";
  if (key === "PageDown") return "scroll-page-down";
  return null;
}

export function globalShortcutAction(event, { editingCell = false } = {}) {
  const key = String(event.key ?? "").toLowerCase();
  const ctrlKey = Boolean(event.ctrlKey);
  const shiftKey = Boolean(event.shiftKey);
  const altKey = Boolean(event.altKey);

  if (editingCell && !isEditorShortcutAllowed(key, ctrlKey)) return null;
  if (ctrlKey && (key === "+" || key === "=")) return "zoom-in";
  if (ctrlKey && key === "-") return "zoom-out";
  if (ctrlKey && key === "0") return "zoom-reset";
  if (ctrlKey && key === "o") return "open-file";
  if (ctrlKey && key === "b") return "toggle-sidebar";
  if (ctrlKey && key === "l") return "toggle-problems";
  if (ctrlKey && key === "h") return "reset-row-heights";
  if (ctrlKey && key === "s" && shiftKey) return "save-as";
  if (ctrlKey && key === "s") return "save-file";
  if (ctrlKey && key === "f") return "search";
  if (ctrlKey && key === "z" && shiftKey) return "redo";
  if (ctrlKey && key === "z") return "undo";
  if (ctrlKey && key === "y") return "redo";
  if (ctrlKey && key === "p") return "show-palette";
  if (ctrlKey && key === "w") return "close-tab";
  if (ctrlKey && key === "c") return "copy";
  if (ctrlKey && key === "x") return "cut";
  if (ctrlKey && key === "v") return "paste";
  if (!ctrlKey && !altKey && key === "delete" && !editingCell) return "clear-selection";
  return null;
}
