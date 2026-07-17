export const COMMAND_LABELS_BASE = [
  ["open-file", "Open File"],
  ["open-folder", "Open Folder / Workspace"],
  ["save-file", "Save"],
  ["save-as", "Save As"],
  ["search", "Find/Search"],
  ["find-next", "Find Next"],
  ["find-previous", "Find Previous"],
  ["replace", "Find and Replace"],
  ["go-to-row", "Go to Row"],
  ["next-tab", "Next Tab"],
  ["previous-tab", "Previous Tab"],
  ["undo", "Undo"],
  ["redo", "Redo"],
  ["copy", "Copy"],
  ["paste", "Paste"],
  ["cut", "Cut"],
  ["clear-selection", "Clear Cell(s)"],
  ["select-all", "Select All"],
  ["add-row", "Add Row"],
  ["insert-row", "Insert Rows..."],
  ["clone-row", "Clone Row"],
  ["delete-row", "Delete Row"],
  ["clear-row", "Clear Row"],
  ["hide-row", "Hide Row"],
  ["unhide-all", "Unhide All"],
  ["add-column", "Add Column"],
  ["insert-column", "Insert Columns..."],
  ["clone-column", "Clone Column(s)"],
  ["delete-column", "Delete Column"],
  ["clear-column", "Clear Column"],
  ["hide-column", "Hide Column"],
  ["fill", "Fill"],
  ["increment-fill", "Increment Fill"],
  ["math-add", "Math Add"],
  ["math-subtract", "Math Subtract"],
  ["math-multiply", "Math Multiply"],
  ["math-divide", "Math Divide"],
  ["toggle-freeze-row", "Freeze First Row"],
  ["toggle-freeze-column", "Freeze First Column"],
  ["toggle-colorize", "Colorize Columns"],
  ["toggle-vector-lsp-hover", "Vector-LSP Hover"],
  ["toggle-lint", "Toggle Lint"],
  ["toggle-lint-rules", "Lint Rules"],
  ["show-explorer", "Show Explorer"],
  ["show-problems", "Show Problems"],
  ["zoom-in", "Zoom In"],
  ["zoom-out", "Zoom Out"],
  ["zoom-reset", "Reset Zoom"],
  ["resize-fit", "Resize To Fit"],
  ["resize-selected-fit", "Resize Selected To Fit"],
  ["reset-row-heights", "Reset Row Heights"],
  ["toggle-sidebar", "Toggle Explorer"],
  ["toggle-theme", "Toggle Light/Dark Mode"],
  ["open-app-settings", "Settings"],
  ["open-shortcut-settings", "Keyboard Shortcuts"],
  ["open-settings", "Lint Options"]
];

export const DEVELOPMENT_COMMAND_LABELS = [
  ["load-fixture-20k", "Load 20k Fixture"],
  ["load-fixture-200k", "Load 200k Fixture"]
];

export const COMMANDS_AVAILABLE_WITHOUT_DOCUMENT = new Set([
  "open-file",
  "open-folder",
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
  ];
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
    { id: "add-row", label: "Add Rows..." },
    { id: "insert-row", label: "Insert Rows..." },
    { id: "hide-row", label: "Hide Row(s)" },
    { id: "delete-row", label: "Delete Row(s)" },
    { id: "clone-row", label: "Clone Row", disabled: cloneDisabled }
  ];
}

export function columnCommandItems({ cloneDisabled = false } = {}) {
  return [
    { id: "add-column", label: "Add Columns..." },
    { id: "insert-column", label: "Insert Columns..." },
    { id: "hide-column", label: "Hide Column(s)" },
    { id: "delete-column", label: "Delete Column(s)" },
    { id: "clone-column", label: "Clone Column(s)", disabled: cloneDisabled }
  ];
}

export function fillCommandItems() {
  return [
    { id: "fill", label: "Fill" },
    { id: "increment-fill", label: "Increment Fill" }
  ];
}

export function mathCommandItems() {
  return [
    { id: "math-add", label: "Add" },
    { id: "math-subtract", label: "Subtract" },
    { id: "math-multiply", label: "Multiply" },
    { id: "math-divide", label: "Divide" }
  ];
}

const JSON_DOCUMENT_COMMANDS = new Set([
  "open-file", "open-folder", "save-file", "save-as", "search", "find-next", "find-previous", "replace",
  "next-tab", "previous-tab",
  "undo", "redo", "select-all", "toggle-sidebar", "toggle-theme",
  "open-app-settings", "open-shortcut-settings", "open-settings",
  "toggle-lint", "toggle-lint-rules", "show-explorer", "show-problems"
]);

export function canRunCommandForDocument(id, kind = "table") {
  return kind !== "json" || JSON_DOCUMENT_COMMANDS.has(id);
}
