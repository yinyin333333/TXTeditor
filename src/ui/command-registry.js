import { tText } from "../core/i18n.js";

export const COMMAND_LABELS_BASE = [
  ["open-file", "command.open-file"], ["open-folder", "command.open-folder"], ["close-all", "toolbar.closeAll"], ["save-file", "command.save-file"], ["save-as", "command.save-as"],
  ["search", "command.search"], ["find-next", "command.find-next"], ["find-previous", "command.find-previous"], ["replace", "command.replace"],
  ["go-to-row", "command.go-to-row"], ["next-tab", "command.next-tab"], ["previous-tab", "command.previous-tab"], ["undo", "command.undo"], ["redo", "command.redo"],
  ["copy", "command.copy"], ["paste", "command.paste"], ["cut", "command.cut"], ["clear-selection", "command.clear-selection"], ["select-all", "command.select-all"],
  ["add-row", "command.add-row"], ["insert-row", "command.insert-row"], ["clone-row", "command.clone-row"], ["delete-row", "command.delete-row"], ["clear-row", "command.clear-row"], ["hide-row", "command.hide-row"], ["unhide-all", "command.unhide-all"],
  ["add-column", "command.add-column"], ["insert-column", "command.insert-column"], ["clone-column", "command.clone-column"], ["delete-column", "command.delete-column"], ["clear-column", "command.clear-column"], ["hide-column", "command.hide-column"],
  ["fill", "command.fill"], ["increment-fill", "command.increment-fill"], ["math-add", "command.math-add"], ["math-subtract", "command.math-subtract"], ["math-multiply", "command.math-multiply"], ["math-divide", "command.math-divide"],
  ["toggle-freeze-row", "command.toggle-freeze-row"], ["toggle-freeze-column", "command.toggle-freeze-column"], ["toggle-colorize", "command.toggle-colorize"], ["toggle-vector-lsp-hover", "command.toggle-vector-lsp-hover"], ["toggle-lint", "command.toggle-lint"], ["toggle-lint-rules", "command.toggle-lint-rules"],
  ["show-explorer", "command.show-explorer"], ["show-problems", "command.show-problems"], ["zoom-in", "command.zoom-in"], ["zoom-out", "command.zoom-out"], ["zoom-reset", "command.zoom-reset"],
  ["resize-fit", "command.resize-fit"], ["resize-selected-fit", "command.resize-selected-fit"], ["reset-row-heights", "command.reset-row-heights"], ["toggle-sidebar", "command.toggle-sidebar"], ["toggle-theme", "command.toggle-theme"],
  ["open-app-settings", "command.open-app-settings"], ["open-shortcut-settings", "command.open-shortcut-settings"], ["open-settings", "command.open-settings"]
];

export const DEVELOPMENT_COMMAND_LABELS = [
  ["load-fixture-20k", "Load 20k Fixture"],
  ["load-fixture-200k", "Load 200k Fixture"]
];

export const COMMANDS_AVAILABLE_WITHOUT_DOCUMENT = new Set([
  "open-file",
  "open-folder",
  "close-all",
  "open-settings",
  "open-app-settings",
  "open-shortcut-settings",
  "toggle-sidebar",
  "toggle-theme",
  "toggle-colorize",
  "toggle-vector-lsp-hover",
  "toggle-lint",
  "toggle-lint-rules",
  "show-explorer",
  "show-problems",
  "zoom-in",
  "zoom-out",
  "zoom-reset",
  "load-fixture-20k",
  "load-fixture-200k"
]);

const COMMAND_ACTIONS = new Map([
  ["open-file", { type: "handler", name: "openFile" }],
  ["open-folder", { type: "handler", name: "openFolder" }],
  ["close-all", { type: "handler", name: "closeAll" }],
  ["save-file", { type: "handler", name: "saveFile" }],
  ["save-as", { type: "handler", name: "saveAs" }],
  ["load-fixture-20k", { type: "fixture", size: 20000 }],
  ["load-fixture-200k", { type: "fixture", size: 200000 }],
  ["undo", { type: "handler", name: "undo" }],
  ["redo", { type: "handler", name: "redo" }],
  ["search", { type: "handler", name: "showSearch" }],
  ["find-next", { type: "handler", name: "findNext" }],
  ["find-previous", { type: "handler", name: "findPrevious" }],
  ["replace", { type: "handler", name: "showReplace" }],
  ["go-to-row", { type: "handler", name: "goToRow" }],
  ["next-tab", { type: "handler", name: "nextTab" }],
  ["previous-tab", { type: "handler", name: "previousTab" }],
  ["copy", { type: "handler", name: "copySelection" }],
  ["paste", { type: "handler", name: "pasteSelection" }],
  ["cut", { type: "handler", name: "cutSelection" }],
  ["select-all", { type: "handler", name: "selectAll" }],
  ["clear-selection", { type: "execute", name: "clearSelection" }],
  ["add-row", { type: "handler", name: "addRows" }],
  ["insert-row", { type: "handler", name: "insertRows" }],
  ["clone-row", { type: "handler", name: "cloneRows" }],
  ["delete-row", { type: "execute", name: "deleteRow" }],
  ["clear-row", { type: "execute", name: "clearRow" }],
  ["hide-row", { type: "execute", name: "hideRow" }],
  ["unhide-rows", { type: "execute", name: "unhideRows" }],
  ["add-column", { type: "handler", name: "addColumns" }],
  ["insert-column", { type: "handler", name: "insertColumns" }],
  ["clone-column", { type: "handler", name: "cloneColumns" }],
  ["delete-column", { type: "execute", name: "deleteColumn" }],
  ["clear-column", { type: "execute", name: "clearColumn" }],
  ["hide-column", { type: "execute", name: "hideColumn" }],
  ["unhide-columns", { type: "execute", name: "unhideColumns" }],
  ["unhide-all", { type: "handler", name: "unhideAll" }],
  ["fill", { type: "execute", name: "fill" }],
  ["increment-fill", { type: "execute", name: "incrementFill" }],
  ["toggle-freeze-row", { type: "freeze", kind: "row" }],
  ["toggle-freeze-column", { type: "freeze", kind: "column" }],
  ["toggle-colorize", { type: "handler", name: "toggleColorize" }],
  ["toggle-vector-lsp-hover", { type: "handler", name: "toggleVectorLspHover" }],
  ["toggle-lint", { type: "handler", name: "toggleLint" }],
  ["toggle-lint-rules", { type: "handler", name: "toggleLintRules" }],
  ["show-explorer", { type: "handler", name: "toggleExplorerPane" }],
  ["show-problems", { type: "handler", name: "toggleProblemsPanel" }],
  ["zoom-in", { type: "zoom", delta: 0.1 }],
  ["zoom-out", { type: "zoom", delta: -0.1 }],
  ["zoom-reset", { type: "zoom-reset" }],
  ["resize-fit", { type: "resize", useSelection: false }],
  ["resize-selected-fit", { type: "resize", useSelection: true }],
  ["reset-row-heights", { type: "handler", name: "resetRowHeights" }],
  ["toggle-sidebar", { type: "handler", name: "toggleSidebar" }],
  ["toggle-theme", { type: "handler", name: "toggleTheme" }],
  ["open-app-settings", { type: "handler", name: "showAppSettings" }],
  ["open-shortcut-settings", { type: "handler", name: "showShortcutSettings" }],
  ["open-settings", { type: "handler", name: "showSettings" }],
  ["go-to-definition", { type: "handler", name: "goToDefinition" }]
]);

export function commandLabelsForEnvironment({ isDevelopmentMode = false } = {}) {
  return [
    ...COMMAND_LABELS_BASE,
    ...(isDevelopmentMode ? DEVELOPMENT_COMMAND_LABELS : [])
  ].map(([id, key]) => [id, tText(key)]);
}

export function createCommandRunners(commandLabels, runCommand) {
  return Object.fromEntries(commandLabels.map(([id]) => [id, () => runCommand(id)]));
}

export function canRunCommandWithoutDocument(id) {
  return COMMANDS_AVAILABLE_WITHOUT_DOCUMENT.has(id);
}

export function commandActionForId(id) {
  if (id.startsWith("math-")) return { type: "math", kind: id.replace("math-", "") };
  const action = COMMAND_ACTIONS.get(id);
  return action ? { ...action } : { type: "unknown", id };
}

export function rowCommandItems({ cloneDisabled = false } = {}) {
  return [
    { id: "add-row", label: tText("command.add-rows") },
    { id: "insert-row", label: tText("command.insert-row") },
    { id: "hide-row", label: tText("command.hide-rows") },
    { id: "delete-row", label: tText("command.delete-rows") },
    { id: "clone-row", label: tText("command.clone-row"), disabled: cloneDisabled }
  ];
}

export function columnCommandItems({ cloneDisabled = false } = {}) {
  return [
    { id: "add-column", label: tText("command.add-columns") },
    { id: "insert-column", label: tText("command.insert-columns") },
    { id: "hide-column", label: tText("command.hide-columns") },
    { id: "delete-column", label: tText("command.delete-columns") },
    { id: "clone-column", label: tText("command.clone-columns"), disabled: cloneDisabled }
  ];
}

export function fillCommandItems() {
  return [
    { id: "fill", label: tText("menu.fill") },
    { id: "increment-fill", label: tText("command.increment-fill") }
  ];
}

export function mathCommandItems() {
  return [
    { id: "math-add", label: tText("command.math-add-short") },
    { id: "math-subtract", label: tText("command.math-subtract-short") },
    { id: "math-multiply", label: tText("command.math-multiply-short") },
    { id: "math-divide", label: tText("command.math-divide-short") }
  ];
}

const JSON_DOCUMENT_COMMANDS = new Set([
  "open-file", "open-folder", "close-all", "save-file", "save-as", "search", "find-next", "find-previous", "replace",
  "next-tab", "previous-tab",
  "undo", "redo", "select-all", "toggle-sidebar", "toggle-theme",
  "open-app-settings", "open-shortcut-settings", "open-settings",
  "toggle-lint", "toggle-lint-rules", "show-explorer", "show-problems"
]);

export function canRunCommandForDocument(id, kind = "table") {
  return kind !== "json" || JSON_DOCUMENT_COMMANDS.has(id);
}
