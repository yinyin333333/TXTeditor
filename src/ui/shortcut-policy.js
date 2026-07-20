export const SHORTCUT_STORAGE_KEY = "txteditor.shortcuts.v1";
import { tText } from "../core/i18n.js";

export const SHORTCUT_DEFINITIONS = Object.freeze([
  shortcut("open-file", "command.open-file", ["Ctrl+O"]), shortcut("save-file", "command.save-file", ["Ctrl+S"], { allowWhileEditing: true }), shortcut("save-as", "command.save-as", ["Ctrl+Shift+S"], { allowWhileEditing: true }), shortcut("search", "command.search", ["Ctrl+F"]), shortcut("find-next", "command.find-next", ["F3"], { allowWhileEditing: true }), shortcut("find-previous", "command.find-previous", ["Shift+F3"], { allowWhileEditing: true }), shortcut("replace", "command.replace", ["Ctrl+Shift+H"], { allowWhileEditing: true }), shortcut("go-to-row", "command.go-to-row", ["Ctrl+G"], { allowWhileEditing: true }), shortcut("undo", "command.undo", ["Ctrl+Z"]), shortcut("redo", "command.redo", ["Ctrl+Y", "Ctrl+Shift+Z"]), shortcut("copy", "command.copy", ["Ctrl+C"]), shortcut("cut", "command.cut", ["Ctrl+X"]), shortcut("paste", "command.paste", ["Ctrl+V"]), shortcut("select-all", "command.select-all", ["Ctrl+A"]), shortcut("clear-selection", "command.clear-selection", ["Delete"]), shortcut("show-palette", "shortcut.commandPalette", ["Ctrl+P", "Ctrl+Shift+P"]), shortcut("close-tab", "shortcut.closeCurrentTab", ["Ctrl+W"], { allowWhileEditing: true }), shortcut("next-tab", "command.next-tab", ["Ctrl+Tab"], { allowWhileEditing: true }), shortcut("previous-tab", "command.previous-tab", ["Ctrl+Shift+Tab"], { allowWhileEditing: true }), shortcut("toggle-sidebar", "command.toggle-sidebar", ["Ctrl+B"]), shortcut("toggle-problems", "shortcut.toggleProblems", ["Ctrl+L"], { allowWhileEditing: true }), shortcut("reset-row-heights", "command.reset-row-heights", ["Ctrl+H"], { allowWhileEditing: true }), shortcut("zoom-in", "command.zoom-in", ["Ctrl+Plus", "Ctrl+="]), shortcut("zoom-out", "command.zoom-out", ["Ctrl+Minus"]), shortcut("zoom-reset", "command.zoom-reset", ["Ctrl+0"]), shortcut("scroll-page-up", "shortcut.scrollPageUp", ["PageUp"], { context: "grid", group: "shortcut.groupGrid" }), shortcut("scroll-page-down", "shortcut.scrollPageDown", ["PageDown"], { context: "grid", group: "shortcut.groupGrid" }), shortcut("scroll-top", "shortcut.scrollTop", ["Home"], { context: "grid", group: "shortcut.groupGrid" }), shortcut("scroll-bottom", "shortcut.scrollBottom", ["End"], { context: "grid", group: "shortcut.groupGrid" }), shortcut("scroll-left", "shortcut.scrollLeft", ["Shift+Home"], { context: "grid", group: "shortcut.groupGrid" }), shortcut("scroll-right", "shortcut.scrollRight", ["Shift+End"], { context: "grid", group: "shortcut.groupGrid" })
]);

const DEFINITION_BY_ACTION = new Map(SHORTCUT_DEFINITIONS.map((definition) => [definition.action, definition]));
const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "OS", "Shift"]);
const FIXED_NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Enter", "Escape", "F2", "Tab"]);
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"];

function shortcut(action, labelKey, defaults, {
  allowWhileEditing = false,
  context = "global",
  group = "shortcut.groupCommands"
} = {}) {
  return Object.freeze({
    action,
    labelKey,
    get label() { return tText(labelKey); },
    defaults: Object.freeze([...defaults]),
    allowWhileEditing,
    context,
    group
  });
}

export function defaultShortcutBindings() {
  return Object.fromEntries(SHORTCUT_DEFINITIONS.map(({ action, defaults }) => [action, [...defaults]]));
}

export function cloneShortcutBindings(bindings) {
  return Object.fromEntries(SHORTCUT_DEFINITIONS.map(({ action, defaults }) => [
    action,
    [...(Array.isArray(bindings?.[action]) ? bindings[action] : defaults)]
  ]));
}

export function normalizeShortcutBindings(value) {
  const defaults = defaultShortcutBindings();
  const source = value?.bindings && typeof value.bindings === "object" ? value.bindings : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) return defaults;

  const normalized = {};
  for (const definition of SHORTCUT_DEFINITIONS) {
    const { action } = definition;
    if (!Object.hasOwn(source, action)) {
      normalized[action] = [...defaults[action]];
      continue;
    }
    const raw = Array.isArray(source[action]) ? source[action] : [source[action]];
    if (raw.length === 0) {
      normalized[action] = [];
      continue;
    }
    const chords = [...new Set(raw.map(normalizeShortcutChord).filter(Boolean))]
      .filter((chord) => validateShortcutChord(chord).valid);
    normalized[action] = chords.length ? chords : [...defaults[action]];
  }

  return shortcutConflicts(normalized).length ? defaults : normalized;
}

export function loadShortcutBindings(storage = localStorage) {
  try {
    const raw = storage.getItem(SHORTCUT_STORAGE_KEY);
    return raw ? normalizeShortcutBindings(JSON.parse(raw)) : defaultShortcutBindings();
  } catch {
    return defaultShortcutBindings();
  }
}

export function saveShortcutBindings(bindings, storage = localStorage) {
  const normalized = normalizeShortcutBindings(bindings);
  storage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify({ version: 1, bindings: normalized }));
  return normalized;
}

export function shortcutChordFromEvent(event = {}) {
  const key = normalizeEventKey(event.key);
  if (!key || MODIFIER_KEYS.has(String(event.key ?? ""))) return "";
  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey && key !== "Plus") modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");
  return [...modifiers, key].join("+");
}

export function normalizeShortcutChord(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  const rawKey = parts.pop();
  const key = normalizeEventKey(rawKey);
  if (!key || MODIFIER_KEYS.has(rawKey)) return "";

  const modifierSet = new Set();
  for (const part of parts) {
    const modifier = normalizeModifier(part);
    if (!modifier) return "";
    modifierSet.add(modifier);
  }
  if (key === "Plus") modifierSet.delete("Shift");
  return [...MODIFIER_ORDER.filter((modifier) => modifierSet.has(modifier)), key].join("+");
}

export function validateShortcutChord(value) {
  const chord = normalizeShortcutChord(value);
  if (!chord) return { valid: false, message: tText("shortcut.validationNonModifier") };
  const { key, modifiers } = shortcutChordParts(chord);
  const modifiedTab = key === "Tab" && modifiers.some((modifier) => modifier === "Ctrl" || modifier === "Alt" || modifier === "Meta");
  if (FIXED_NAVIGATION_KEYS.has(key) && !modifiedTab) {
    return { valid: false, message: tText("shortcut.validationReserved", { key }) };
  }
  if (isPrintableShortcutKey(key) && !modifiers.some((modifier) => modifier === "Ctrl" || modifier === "Alt" || modifier === "Meta")) {
    return { valid: false, message: tText("shortcut.validationModifier") };
  }
  return { valid: true, message: "", chord };
}

export function shortcutActionForEvent(event, bindings, {
  context = "global",
  editingCell = false
} = {}) {
  const chord = shortcutChordFromEvent(event);
  if (!chord) return null;
  const { key } = shortcutChordParts(chord);
  for (const definition of SHORTCUT_DEFINITIONS) {
    if (definition.context !== context) continue;
    if (editingCell && !definition.allowWhileEditing) continue;
    if (editingCell && !event.ctrlKey && !event.altKey && !event.metaKey && !isFunctionShortcutKey(key)) continue;
    const assigned = Array.isArray(bindings?.[definition.action]) ? bindings[definition.action] : definition.defaults;
    if (assigned.includes(chord)) return definition.action;
  }
  return null;
}

export function shortcutDisplayForAction(action, bindings) {
  const definition = DEFINITION_BY_ACTION.get(action);
  if (!definition) return "";
  const assigned = Array.isArray(bindings?.[action]) ? bindings[action] : definition.defaults;
  return assigned.join(" / ");
}

export function shortcutConflicts(bindings) {
  const actionsByChord = new Map();
  for (const definition of SHORTCUT_DEFINITIONS) {
    const assigned = Array.isArray(bindings?.[definition.action]) ? bindings[definition.action] : definition.defaults;
    for (const chord of new Set(assigned)) {
      if (!actionsByChord.has(chord)) actionsByChord.set(chord, []);
      actionsByChord.get(chord).push(definition.action);
    }
  }
  return [...actionsByChord.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([chord, actions]) => ({
      chord,
      actions,
      labels: actions.map((action) => DEFINITION_BY_ACTION.get(action)?.label ?? action)
    }));
}

export function shortcutDefinition(action) {
  return DEFINITION_BY_ACTION.get(action) ?? null;
}

export function shortcutLabelForAction(action) {
  return DEFINITION_BY_ACTION.get(action)?.label ?? "";
}

function normalizeModifier(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (key === "ctrl" || key === "control") return "Ctrl";
  if (key === "alt" || key === "option") return "Alt";
  if (key === "shift") return "Shift";
  if (key === "meta" || key === "cmd" || key === "command" || key === "win" || key === "windows") return "Meta";
  return "";
}

function normalizeEventKey(value) {
  const raw = String(value ?? "");
  const lower = raw.toLowerCase();
  const aliases = {
    " ": "Space",
    "+": "Plus",
    "-": "Minus",
    add: "Plus",
    alt: "Alt",
    altgraph: "AltGraph",
    control: "Control",
    del: "Delete",
    esc: "Escape",
    meta: "Meta",
    os: "OS",
    pagedown: "PageDown",
    "page down": "PageDown",
    pageup: "PageUp",
    "page up": "PageUp",
    shift: "Shift",
    subtract: "Minus"
  };
  if (Object.hasOwn(aliases, lower)) return aliases[lower];
  if (/^[a-z]$/i.test(raw)) return raw.toUpperCase();
  if (/^f([1-9]|1\d|2[0-4])$/i.test(raw)) return raw.toUpperCase();
  if (/^arrow(up|down|left|right)$/i.test(raw)) return `Arrow${lower.slice(5, 6).toUpperCase()}${lower.slice(6)}`;
  if (["backspace", "delete", "end", "enter", "escape", "home", "insert", "space", "tab"].includes(lower)) {
    return `${lower[0].toUpperCase()}${lower.slice(1)}`;
  }
  return raw;
}

function shortcutChordParts(chord) {
  const parts = chord.split("+");
  return { key: parts.at(-1), modifiers: parts.slice(0, -1) };
}

function isPrintableShortcutKey(key) {
  return key.length === 1 || key === "Space" || key === "Plus" || key === "Minus";
}

function isFunctionShortcutKey(key) {
  return /^F([1-9]|1\d|2[0-4])$/.test(key);
}
