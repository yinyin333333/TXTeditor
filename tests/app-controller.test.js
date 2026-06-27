import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TableDocument } from "../src/core/table-model.js";
import { SelectionModel } from "../src/core/selection.js";
import { findInTable } from "../src/core/search.js";
import { fillSelectedCellsCommand } from "../src/core/operations.js";
import { documentFileKey } from "../src/core/file-identity.js";
import { applySavedTextPayload } from "../src/core/platform/file-payloads.js";
import { CanvasGrid } from "../src/ui/canvas-grid.js";
import {
  canRunCommandWithoutDocument,
  commandActionForId,
  columnCommandItems,
  commandLabelsForEnvironment,
  createCommandRunners,
  fillCommandItems,
  mathCommandItems,
  rowCommandItems
} from "../src/ui/command-registry.js";
import {
  contextMenuActiveGroupId,
  contextMenuGroupIsActive,
  contextMenuHiddenState
} from "../src/ui/context-menu-policy.js";
import {
  activeIndexAfterTabClose,
  closeDialogMessage,
  documentOpenPlan,
  unsavedDocuments
} from "../src/ui/document-lifecycle-policy.js";
import { createDocumentController } from "../src/ui/controllers/document-controller.js";
import { createCommandController } from "../src/ui/controllers/command-controller.js";
import { createDiagnosticsController } from "../src/ui/controllers/diagnostics-controller.js";
import { createShellController } from "../src/ui/controllers/shell-controller.js";
import { syncDockChildren } from "../src/ui/dock-sync.js";
import {
  globalShortcutAction,
  isEditorShortcutAllowed
} from "../src/ui/global-shortcut-policy.js";
import {
  DEFAULT_GRID_FONT,
  appSettingsVisualControls,
  fontLabelFromFamily,
  normaliseGridFont
} from "../src/ui/app-settings-policy.js";
import {
  DEFAULT_DOCK_LAYOUT,
  DOCK_EDGES,
  DOCK_PANELS,
  MIN_DOCK_HEIGHT,
  MIN_DOCK_WIDTH,
  dockPanelEdge,
  dockPanelFlexStyle,
  dockSettingsControls,
  fitDockPair,
  normalizeDockEdge,
  normalizeDockLayout,
  panelsForDockEdge,
  resetDockLayoutState
} from "../src/ui/dock-layout-policy.js";
import {
  DOCK_LAYOUT_KEY,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  PROBLEMS_HEIGHT_KEY,
  PROBLEMS_VISIBILITY_KEY,
  SIDEBAR_VISIBILITY_KEY,
  SIDEBAR_WIDTH_KEY,
  nextPanelVisibility,
  panelStateFromStorage,
  panelVisibilityStorageValue,
  problemsHeaderShouldUseNarrowLayout
} from "../src/ui/panel-state-policy.js";
import {
  lintDiagnosticsStateAfterUpdate,
  groupDiagnosticsByFile,
  problemsPanelHtml,
  problemsPanelRenderDecision,
  problemsPanelRenderKey,
  shouldRenderProblemsPanel
} from "../src/ui/problems-policy.js";
import {
  initialSearchState,
  searchShouldIncludeStart,
  searchStateAfterFind,
  searchStateAfterInput
} from "../src/ui/search-policy.js";
import {
  createDefaultLintSettings,
  lintRuleGroupsForProfile,
  runLint
} from "../src/core/lint-engine.js";

function lintDocs(docs, profile = "RotW") {
  const settings = createDefaultLintSettings();
  settings.profile = profile;
  return runLint(docs, settings);
}

function ruleIdsForProfile(profile) {
  return lintRuleGroupsForProfile(profile).flatMap((group) => group.rules.map((rule) => rule.id));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fakeElement(extra = {}) {
  return {
    innerHTML: "",
    textContent: "",
    style: {},
    dataset: {},
    classList: {
      toggle() {},
      add() {},
      remove() {}
    },
    querySelectorAll: () => [],
    ...extra
  };
}

test("search wraps through the document", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\tneedle\nlast\trow");
  assert.deepEqual(findInTable(doc, "needle", { row: 2, column: 1 }), { row: 1, column: 1 });
});

test("search finds first-row header names as normal cells", () => {
  const doc = TableDocument.fromText("skills.txt", "pSrvDoFunc\tpSrvHitFunc\n1\t2");
  assert.deepEqual(findInTable(doc, "pSrvDoFunc", { row: 1, column: 0 }), { row: 0, column: 0 });
});

test("search includes the first real data column", () => {
  const doc = TableDocument.fromText("skills.txt", "skill\tid\tdesc\nbash\t1\tmelee\nwarcry\t2\tbuff");
  assert.deepEqual(findInTable(doc, "warcry", { row: 0, column: 0 }), { row: 2, column: 0 });
});

test("search can skip hidden rows and columns", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\nhidden-row\tvisible\nvisible\thidden-column");
  doc.hiddenRows.add(1);
  doc.hiddenColumns.add(1);
  assert.deepEqual(findInTable(doc, "hidden", { row: 0, column: 0 }), { row: 1, column: 0 });
  assert.equal(findInTable(doc, "hidden", { row: 0, column: 0 }, { skipHidden: true }), null);
});

test("search can land on the current first-column cell for a changed query", () => {
  const doc = TableDocument.fromText("skills.txt", "skill\tref\nWar Cry\twarcry\nLeap\twarcry");
  assert.deepEqual(findInTable(doc, "war cry", { row: 1, column: 0 }, { includeStart: true }), { row: 1, column: 0 });
  assert.deepEqual(findInTable(doc, "warcry", { row: 0, column: 0 }), { row: 1, column: 1 });
  assert.equal(findInTable(doc, "3", { row: 0, column: 0 }, { includeStart: true }), null);
});

test("search matching is case-insensitive only, without whitespace normalization", () => {
  const doc = TableDocument.fromText("skills.txt", "skill\nWarcry\nWARCRY\nWar Cry\nwar cry");
  assert.deepEqual(findInTable(doc, "warcry", { row: 0, column: 0 }), { row: 1, column: 0 });
  assert.deepEqual(findInTable(doc, "warcry", { row: 1, column: 0 }), { row: 2, column: 0 });
  assert.deepEqual(findInTable(doc, "warcry", { row: 2, column: 0 }), { row: 1, column: 0 });
  assert.deepEqual(findInTable(doc, "War Cry", { row: 0, column: 0 }), { row: 3, column: 0 });
  assert.deepEqual(findInTable(doc, "war cry", { row: 0, column: 0 }), { row: 3, column: 0 });
});

test("context menu source stays anchored when right-clicking inside a multi-cell selection", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\tc\n20\t25\t30");
  const selection = new SelectionModel();
  selection.set(1, 0);
  selection.extend(1, 2);
  const contextHit = { kind: "cell", row: 1, column: 2 };
  if (contextHit.kind === "cell" && !selection.contains(contextHit.row, contextHit.column)) selection.set(contextHit.row, contextHit.column);
  assert.deepEqual(selection.anchor, { row: 1, column: 0 });
  fillSelectedCellsCommand(doc, selection.ranges, selection.anchor).redo(doc);
  assert.deepEqual(doc.rows[1], ["20", "20", "20"]);
});

test("command registry preserves public command labels and availability policy", () => {
  const productionLabels = commandLabelsForEnvironment({ isDevelopmentMode: false });
  const developmentLabels = commandLabelsForEnvironment({ isDevelopmentMode: true });
  const productionIds = productionLabels.map(([id]) => id);
  const developmentIds = developmentLabels.map(([id]) => id);

  assert.deepEqual(
    ["open-file", "open-folder", "save-file", "toggle-lint", "show-problems"].map((id) => productionIds.includes(id)),
    [true, true, true, true, true]
  );
  assert.equal(new Set(productionIds).size, productionIds.length);
  assert.equal(productionIds.includes("load-fixture-20k"), false);
  assert.equal(developmentIds.includes("load-fixture-20k"), true);
  assert.equal(developmentIds.includes("load-fixture-200k"), true);

  const calls = [];
  const runners = createCommandRunners(productionLabels, (id) => calls.push(id));
  runners["open-file"]();
  runners["show-problems"]();
  assert.deepEqual(calls, ["open-file", "show-problems"]);

  assert.equal(canRunCommandWithoutDocument("open-file"), true);
  assert.equal(canRunCommandWithoutDocument("show-problems"), true);
  assert.equal(canRunCommandWithoutDocument("save-file"), false);
  assert.equal(canRunCommandWithoutDocument("go-to-definition"), false);
  assert.deepEqual(commandActionForId("open-file"), { type: "handler", name: "openFile" });
  assert.deepEqual(commandActionForId("load-fixture-20k"), { type: "fixture", size: 20000 });
  assert.deepEqual(commandActionForId("math-add"), { type: "math", kind: "add" });
  assert.deepEqual(commandActionForId("toggle-freeze-row"), { type: "freeze", kind: "row" });
  assert.deepEqual(commandActionForId("resize-selected-fit"), { type: "resize", useSelection: true });
  assert.deepEqual(commandActionForId("go-to-definition"), { type: "handler", name: "goToDefinition" });
  assert.deepEqual(commandActionForId("missing-command"), { type: "unknown", id: "missing-command" });
});

test("document lifecycle policy preserves open, unsaved, and close-tab decisions", () => {
  const docs = [
    { name: "items.txt", path: "Data/items.txt", dirty: false },
    { name: "skills.txt", path: "Data/skills.txt", dirty: true },
    { name: "Untitled.txt", path: "", dirty: true }
  ];

  assert.deepEqual(documentOpenPlan(docs, { name: "skills-copy.txt", path: "Data/skills.txt" }), {
    action: "activate-existing",
    activeIndex: 1
  });
  assert.deepEqual(documentOpenPlan(docs, { name: "skills-copy.txt", path: "DATA\\SKILLS.TXT" }), {
    action: "activate-existing",
    activeIndex: 1
  });
  assert.deepEqual(documentOpenPlan(docs, { name: "new.txt", path: "Data/new.txt" }), {
    action: "add-new",
    activeIndex: 3
  });
  assert.deepEqual(documentOpenPlan(docs, { name: "Untitled.txt", path: "" }), {
    action: "add-new",
    activeIndex: 3
  });
  assert.deepEqual(unsavedDocuments(docs).map((doc) => doc.name), ["skills.txt", "Untitled.txt"]);
  assert.equal(activeIndexAfterTabClose({ activeIndex: 2, closeIndex: 1, documentCount: 3 }), 1);
  assert.equal(activeIndexAfterTabClose({ activeIndex: 0, closeIndex: 2, documentCount: 3 }), 0);
  assert.equal(activeIndexAfterTabClose({ activeIndex: 0, closeIndex: 0, documentCount: 1 }), -1);
  assert.equal(closeDialogMessage(docs[1]), "skills.txt has unsaved changes.");

  assert.deepEqual(documentOpenPlan([{ name: "same.txt", path: "", fileKey: "browser:1:same.txt" }], {
    name: "same.txt",
    path: "",
    fileKey: "browser:2:same.txt"
  }), {
    action: "add-new",
    activeIndex: 1
  });

  const browserDoc = TableDocument.fromText("same.txt", "a", {
    fileKey: "browser:1:same.txt:1:1",
    path: ""
  });
  assert.equal(documentFileKey(browserDoc), "browser:1:same.txt:1:1");
  applySavedTextPayload(browserDoc, {
    path: "E:\\dir\\same.txt",
    name: "same.txt",
    encoding: "utf-8"
  });
  const nativeDoc = TableDocument.fromText("same.txt", "a", {
    path: "E:\\dir\\same.txt"
  });
  assert.equal(documentFileKey(browserDoc), "e:/dir/same.txt");
  assert.deepEqual(documentOpenPlan([browserDoc], nativeDoc), {
    action: "activate-existing",
    activeIndex: 0
  });
  applySavedTextPayload(browserDoc, {
    path: "E:\\dir\\renamed.txt",
    name: "renamed.txt",
    encoding: "utf-8"
  });
  assert.deepEqual(documentOpenPlan([browserDoc], TableDocument.fromText("renamed.txt", "a", {
    path: "E:\\other\\renamed.txt"
  })), {
    action: "add-new",
    activeIndex: 1
  });
});

test("close tab commits active editor before unsaved prompt decisions", async () => {
  const doc = TableDocument.fromText("items.txt", "id\n1", { dirty: false });
  const classState = new Set(["hidden"]);
  const state = {
    docs: [doc],
    active: 0,
    lint: { engine: "legacy" }
  };
  const gridCalls = [];
  const controller = createDocumentController({
    state,
    els: {
      closeDialogText: { textContent: "" },
      closeDialog: {
        classList: {
          add: (name) => classState.add(name),
          remove: (name) => classState.delete(name)
        }
      }
    },
    grid: {
      setDocument: (target) => gridCalls.push(["setDocument", target.name])
    },
    emptyDoc: TableDocument.fromText("Empty", ""),
    activeDoc: () => state.docs[state.active] ?? TableDocument.fromText("Empty", ""),
    applyFreezeToDoc() {},
    renderChrome() {},
    showError(error) {
      throw error instanceof Error ? error : new Error(String(error));
    },
    reportWindowCloseFailure() {},
    lspOpenDoc() {},
    reportLspOpenFailure() {},
    lspCloseDoc() {},
    reportLspCloseFailure() {},
    lspStartWorkspace() {},
    scheduleHoverPrewarm() {},
    resetUndoManagerForDocument() {},
    resetLegacyWorkspaceIndex() {},
    scheduleLegacyLintForOpen() {},
    scheduleLegacyLintFull() {},
    cancelLegacyLintJobs() {},
    isVectorLintEngine: () => false,
    isLegacyLintEngine: () => true,
    updateGridDiagnostics() {},
    scrollProblemsToActiveFile() {},
    commitActiveCellEditor() {
      doc.setCell(1, 0, "edited");
    }
  });

  const closePromise = controller.closeTab(0);
  await Promise.resolve();
  assert.equal(doc.dirty, true);
  assert.equal(classState.has("hidden"), false);
  controller.handleCloseDialogClick({
    target: {
      closest: () => ({ dataset: { closeChoice: "cancel" } })
    }
  });
  await closePromise;

  assert.equal(state.docs.length, 1);
  assert.equal(doc.getCell(1, 0), "edited");
  assert.deepEqual(gridCalls, []);
});

test("save file commits active editor before serializing document text", async () => {
  const writes = [];
  const doc = TableDocument.fromText("items.txt", "id\n1", {
    dirty: false,
    handle: {
      async createWritable() {
        return {
          async write(bytes) {
            writes.push(new TextDecoder().decode(bytes));
          },
          async close() {}
        };
      }
    }
  });
  const state = {
    docs: [doc],
    active: 0,
    lint: { engine: "legacy" }
  };
  const controller = createDocumentController({
    state,
    els: { closeDialogText: {}, closeDialog: { classList: { add() {}, remove() {} } } },
    grid: { draw() {}, setDocument() {} },
    emptyDoc: TableDocument.fromText("Empty", ""),
    activeDoc: () => state.docs[state.active] ?? TableDocument.fromText("Empty", ""),
    applyFreezeToDoc() {},
    renderChrome() {},
    showError(error) {
      throw error instanceof Error ? error : new Error(String(error));
    },
    reportWindowCloseFailure() {},
    lspOpenDoc() {},
    reportLspOpenFailure() {},
    lspCloseDoc() {},
    reportLspCloseFailure() {},
    lspStartWorkspace() {},
    scheduleHoverPrewarm() {},
    resetUndoManagerForDocument() {},
    resetLegacyWorkspaceIndex() {},
    scheduleLegacyLintForOpen() {},
    scheduleLegacyLintFull() {},
    cancelLegacyLintJobs() {},
    isVectorLintEngine: () => false,
    isLegacyLintEngine: () => true,
    updateGridDiagnostics() {},
    scrollProblemsToActiveFile() {},
    commitActiveCellEditor() {
      doc.setCell(1, 0, "edited");
    }
  });

  assert.equal(await controller.saveFile(), true);
  assert.deepEqual(writes, ["id\nedited"]);
  assert.equal(doc.dirty, false);
});

test("browser save encodes before opening writable streams", async () => {
  let createWritableCalls = 0;
  const errors = [];
  const doc = TableDocument.fromText("items.txt", "id\nemoji-\u{1F642}", {
    dirty: true,
    encoding: "windows-1252",
    handle: {
      async createWritable() {
        createWritableCalls += 1;
        throw new Error("stream should not open");
      }
    }
  });
  const state = {
    docs: [doc],
    active: 0,
    lint: { engine: "legacy" }
  };
  const controller = createDocumentController({
    state,
    els: { closeDialogText: {}, closeDialog: { classList: { add() {}, remove() {} } } },
    grid: { draw() {}, setDocument() {} },
    emptyDoc: TableDocument.fromText("Empty", ""),
    activeDoc: () => state.docs[state.active] ?? TableDocument.fromText("Empty", ""),
    applyFreezeToDoc() {},
    renderChrome() {},
    showError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    reportWindowCloseFailure() {},
    lspOpenDoc() {},
    reportLspOpenFailure() {},
    lspCloseDoc() {},
    reportLspCloseFailure() {},
    lspStartWorkspace() {},
    scheduleHoverPrewarm() {},
    resetUndoManagerForDocument() {},
    resetLegacyWorkspaceIndex() {},
    scheduleLegacyLintForOpen() {},
    scheduleLegacyLintFull() {},
    cancelLegacyLintJobs() {},
    isVectorLintEngine: () => false,
    isLegacyLintEngine: () => true,
    updateGridDiagnostics() {},
    scrollProblemsToActiveFile() {},
    commitActiveCellEditor() {}
  });

  assert.equal(await controller.saveFile(), false);
  assert.equal(createWritableCalls, 0);
  assert.equal(doc.dirty, true);
  assert.match(errors[0], /cannot be saved as Windows-1252/);
});

test("open folder surfaces workspace scan warnings without failing the open", async () => {
  const originalWindow = globalThis.window;
  const calls = [];
  const toasts = [];
  const state = {
    docs: [],
    active: -1,
    workspace: null,
    lint: { engine: "legacy" }
  };
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          if (command === "open_folder_dialog") return "E:\\Workspace";
          if (command === "list_workspace_files") {
            return {
              path: "E:\\Workspace",
              warning: "Workspace scan stopped after 20,000 files.",
              files: [{ path: "E:\\Workspace\\items.txt", name: "items.txt" }]
            };
          }
          throw new Error(`unexpected invoke: ${command}`);
        }
      }
    }
  };
  const controller = createDocumentController({
    state,
    els: { closeDialogText: {}, closeDialog: { classList: { add() {}, remove() {} } } },
    grid: { draw() {}, setDocument() {} },
    emptyDoc: TableDocument.fromText("Empty", ""),
    activeDoc: () => state.docs[state.active] ?? TableDocument.fromText("Empty", ""),
    applyFreezeToDoc() {},
    renderChrome: () => calls.push(["render"]),
    showError(error) {
      throw error instanceof Error ? error : new Error(String(error));
    },
    showToast: (message) => toasts.push(message),
    reportWindowCloseFailure() {},
    lspOpenDoc() {},
    reportLspOpenFailure() {},
    lspCloseDoc() {},
    reportLspCloseFailure() {},
    lspStartWorkspace() {},
    scheduleHoverPrewarm() {},
    resetUndoManagerForDocument() {},
    resetLegacyWorkspaceIndex: () => calls.push(["reset-workspace-index"]),
    scheduleLegacyLintForOpen() {},
    scheduleLegacyLintFull: (reason, delay) => calls.push(["schedule-legacy", reason, delay]),
    cancelLegacyLintJobs() {},
    isVectorLintEngine: () => false,
    isLegacyLintEngine: () => true,
    updateGridDiagnostics() {},
    scrollProblemsToActiveFile() {},
    commitActiveCellEditor() {}
  });

  try {
    await controller.openFolder();
    assert.deepEqual(toasts, ["Workspace scan stopped after 20,000 files."]);
    assert.equal(state.workspace.path, "E:\\Workspace");
    assert.equal(state.workspace.files.length, 1);
    assert.deepEqual(calls, [
      ["open_folder_dialog", undefined],
      ["list_workspace_files", { path: "E:\\Workspace" }],
      ["reset-workspace-index"],
      ["schedule-legacy", "workspace-opened", 0],
      ["render"]
    ]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("browser save aborts writable streams after write failures", async () => {
  const calls = [];
  const doc = TableDocument.fromText("items.txt", "id\n1", {
    dirty: true,
    handle: {
      async createWritable() {
        calls.push("create");
        return {
          async write() {
            calls.push("write");
            throw new Error("disk full");
          },
          async close() {
            calls.push("close");
          },
          async abort() {
            calls.push("abort");
          }
        };
      }
    }
  });
  const state = {
    docs: [doc],
    active: 0,
    lint: { engine: "legacy" }
  };
  const errors = [];
  const controller = createDocumentController({
    state,
    els: { closeDialogText: {}, closeDialog: { classList: { add() {}, remove() {} } } },
    grid: { draw() {}, setDocument() {} },
    emptyDoc: TableDocument.fromText("Empty", ""),
    activeDoc: () => state.docs[state.active] ?? TableDocument.fromText("Empty", ""),
    applyFreezeToDoc() {},
    renderChrome() {},
    showError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    reportWindowCloseFailure() {},
    lspOpenDoc() {},
    reportLspOpenFailure() {},
    lspCloseDoc() {},
    reportLspCloseFailure() {},
    lspStartWorkspace() {},
    scheduleHoverPrewarm() {},
    resetUndoManagerForDocument() {},
    resetLegacyWorkspaceIndex() {},
    scheduleLegacyLintForOpen() {},
    scheduleLegacyLintFull() {},
    cancelLegacyLintJobs() {},
    isVectorLintEngine: () => false,
    isLegacyLintEngine: () => true,
    updateGridDiagnostics() {},
    scrollProblemsToActiveFile() {},
    commitActiveCellEditor() {}
  });

  assert.equal(await controller.saveFile(), false);
  assert.deepEqual(calls, ["create", "write", "abort"]);
  assert.equal(doc.dirty, true);
  assert.equal(errors[0], "disk full");
});

test("context menu command item registries preserve expected command groups", () => {
  assert.deepEqual(columnCommandItems().map((item) => item.id), ["add-column", "insert-column", "hide-column", "delete-column"]);
  assert.deepEqual(fillCommandItems().map((item) => item.id), ["fill", "increment-fill"]);
  assert.deepEqual(mathCommandItems().map((item) => item.id), ["math-add", "math-subtract", "math-multiply", "math-divide"]);
});

test("Open File and Open Folder sidebar buttons are constrained to one line", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(html, /<button data-command="open-file">Open File<\/button>/);
  assert.match(html, /<button data-command="open-folder">Open Folder<\/button>/);
  assert.match(css, /--sidebar-width:\s*260px/);
  assert.match(css, /\.layout-root\s*\{[\s\S]*grid-template-columns:\s*var\(--dock-left-width\) minmax\(var\(--editor-min-width\), 1fr\) var\(--dock-right-width\)/);
  assert.match(css, /\.sidebar\s*\{[\s\S]*min-width:\s*0/);
  assert.match(css, /\.sidebar-actions button\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.equal(MIN_SIDEBAR_WIDTH, 260);
  assert.equal(MAX_SIDEBAR_WIDTH, 520);
});

test("app source has real Explorer and Problems toggles with persisted resize state", () => {
  const storageValues = new Map([
    [SIDEBAR_VISIBILITY_KEY, "hidden"],
    [PROBLEMS_VISIBILITY_KEY, "visible"],
    [SIDEBAR_WIDTH_KEY, "999"],
    [PROBLEMS_HEIGHT_KEY, "90"]
  ]);
  const storage = { getItem: (key) => storageValues.get(key) ?? null };
  const savedDockLayout = normalizeDockLayout({
    sizes: { explorerHeight: 310, problemsWidth: 450 }
  });
  assert.deepEqual(panelStateFromStorage(storage, savedDockLayout), {
    sidebarVisible: false,
    sidebarWidth: MAX_SIDEBAR_WIDTH,
    sidebarHeight: 310,
    problemsVisible: true,
    problemsWidth: 450,
    problemsHeight: 150,
    dockLayout: savedDockLayout
  });
  assert.equal(nextPanelVisibility(false), true);
  assert.equal(nextPanelVisibility(true), false);
  assert.equal(panelVisibilityStorageValue(true), "visible");
  assert.equal(panelVisibilityStorageValue(false), "hidden");
});

test("phase 3 ownership boundaries keep app shell and grid behavior in owners", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const canvasSource = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  const lspController = readFileSync(new URL("../src/ui/controllers/lsp-controller.js", import.meta.url), "utf8");
  const lspHoverController = readFileSync(new URL("../src/ui/controllers/lsp-hover-controller.js", import.meta.url), "utf8");
  const lspUriPolicy = readFileSync(new URL("../src/core/lsp-uri-policy.js", import.meta.url), "utf8");
  const appRuntimeUtils = readFileSync(new URL("../src/ui/app-runtime-utils.js", import.meta.url), "utf8");
  const settingsController = readFileSync(new URL("../src/ui/controllers/settings-controller.js", import.meta.url), "utf8");
  const commandSurfaceController = readFileSync(new URL("../src/ui/controllers/command-surface-controller.js", import.meta.url), "utf8");
  const commandController = readFileSync(new URL("../src/ui/controllers/command-controller.js", import.meta.url), "utf8");
  const diagnosticsController = readFileSync(new URL("../src/ui/controllers/diagnostics-controller.js", import.meta.url), "utf8");
  const documentController = readFileSync(new URL("../src/ui/controllers/document-controller.js", import.meta.url), "utf8");
  const shellController = readFileSync(new URL("../src/ui/controllers/shell-controller.js", import.meta.url), "utf8");
  const workspaceFileListPolicy = readFileSync(new URL("../src/ui/workspace-file-list-policy.js", import.meta.url), "utf8");
  const gridHover = readFileSync(new URL("../src/ui/grid/grid-hover.js", import.meta.url), "utf8");

  assert.ok(appSource.split(/\r?\n/).length <= 1200);
  assert.ok(canvasSource.split(/\r?\n/).length <= 900);
  assert.ok(lspController.split(/\r?\n/).length <= 850);
  assert.match(appSource, /createCommandController/);
  assert.match(appSource, /createDiagnosticsController/);
  assert.match(appSource, /createDocumentController/);
  assert.match(appSource, /createLspController/);
  assert.match(appSource, /createSettingsController/);
  assert.match(appSource, /createCommandSurfaceController/);
  assert.match(appSource, /createShellController/);
  assert.doesNotMatch(appSource, /function renderWorkspaceFileList/);
  assert.match(commandController, /function runCommand/);
  assert.match(commandController, /function executeCommandAction/);
  assert.match(diagnosticsController, /function renderProblemsPanelIfNeeded/);
  assert.match(diagnosticsController, /async function goToDiagnostic/);
  assert.match(documentController, /async function openFile/);
  assert.match(documentController, /async function closeTab/);
  assert.match(shellController, /function renderChrome/);
  assert.match(workspaceFileListPolicy, /function renderWorkspaceFileList/);
  assert.match(lspController, /async function startWorkspace/);
  assert.match(lspController, /createLspHoverController/);
  assert.doesNotMatch(lspController, /async function requestHover/);
  assert.match(lspHoverController, /async function requestHover/);
  assert.match(lspHoverController, /function scheduleHoverPrewarm/);
  assert.match(lspUriPolicy, /function docToUri/);
  assert.match(lspUriPolicy, /function uriToFileKey/);
  assert.match(appRuntimeUtils, /function createToastFeedback/);
  assert.match(settingsController, /function showSettings/);
  assert.match(settingsController, /function setLintEngine/);
  assert.match(commandSurfaceController, /function showContextMenu/);
  assert.match(gridHover, /function updateGridTooltip/);
  assert.match(gridHover, /function setGridLspHover/);
});

test("dock layout defaults to Explorer left and Problems bottom without replacing visibility keys", () => {
  assert.deepEqual(DOCK_EDGES, ["left", "right", "top", "bottom"]);
  assert.deepEqual(DOCK_PANELS, ["explorer", "problems"]);
  assert.equal(DEFAULT_DOCK_LAYOUT.explorer, "left");
  assert.equal(DEFAULT_DOCK_LAYOUT.problems, "bottom");
  assert.equal(normalizeDockEdge("right", "left"), "right");
  assert.equal(normalizeDockEdge("elsewhere", "left"), "left");
  assert.deepEqual(normalizeDockLayout({
    explorer: "right",
    problems: "sideways",
    splits: { left: 0.01, right: 0.9 },
    sizes: { explorerHeight: 10, problemsWidth: 999 }
  }), {
    explorer: "right",
    problems: "bottom",
    splits: { left: 0.15, right: 0.85, top: 0.5, bottom: 0.5 },
    sizes: { explorerHeight: MIN_DOCK_HEIGHT, problemsWidth: 640 }
  });
  assert.equal(dockPanelEdge({ explorer: "top" }, "explorer"), "top");
  assert.equal(dockPanelEdge({ explorer: "bad" }, "explorer"), "left");
  assert.deepEqual(panelsForDockEdge({
    layout: { explorer: "left", problems: "left" },
    edge: "left",
    visiblePanels: new Set(["problems"])
  }), ["problems"]);
  assert.equal(DOCK_LAYOUT_KEY, "txteditor.layout.docks");
  const reset = resetDockLayoutState({
    explorer: "right",
    problems: "left",
    splits: { left: 0.25, right: 0.8, top: 0.3, bottom: 0.7 },
    sizes: { explorerHeight: 310, problemsWidth: 430 }
  });
  assert.equal(reset.explorer, "left");
  assert.equal(reset.problems, "bottom");
  assert.deepEqual(reset.splits, DEFAULT_DOCK_LAYOUT.splits);
  assert.deepEqual(reset.sizes, { explorerHeight: 310, problemsWidth: 430 });
});

test("dock shell renders every edge and same-edge split orientations", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const id of ["layoutRoot", "dockTop", "dockLeft", "dockRight", "dockBottom"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-dock-panel="explorer"/);
  assert.match(html, /data-dock-panel="problems"/);
  assert.match(css, /\.dock-left\s*\{[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.dock-right\s*\{[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.dock-top\s*\{[\s\S]*flex-direction:\s*row/);
  assert.match(css, /\.dock-bottom\s*\{[\s\S]*flex-direction:\s*row/);
  assert.match(css, /\.dock-left \.dock-splitter,\s*\.dock-right \.dock-splitter\s*\{[\s\S]*cursor:\s*ns-resize/);
  assert.match(css, /\.dock-top \.dock-splitter,\s*\.dock-bottom \.dock-splitter\s*\{[\s\S]*cursor:\s*ew-resize/);
  assert.deepEqual(panelsForDockEdge({
    layout: { explorer: "left", problems: "left" },
    edge: "left",
    visiblePanels: new Set(["explorer", "problems"])
  }), ["explorer", "problems"]);
  assert.deepEqual(panelsForDockEdge({
    layout: { explorer: "top", problems: "bottom" },
    edge: "bottom",
    visiblePanels: new Set(["explorer", "problems"])
  }), ["problems"]);
  assert.deepEqual(fitDockPair(260, 320, 1000, MIN_DOCK_WIDTH), [260, 320]);
  assert.deepEqual(fitDockPair(400, 200, 500, MIN_DOCK_WIDTH), [320, 180]);
  assert.deepEqual(fitDockPair(400, 200, 250, MIN_DOCK_WIDTH), [125, 125]);
  assert.deepEqual(fitDockPair(0, 320, 200, MIN_DOCK_WIDTH), [0, 200]);
  assert.deepEqual(dockPanelFlexStyle({ edge: "left", count: 1, index: 0 }), {
    minWidth: "0",
    minHeight: `${MIN_DOCK_HEIGHT}px`,
    flex: "1 1 auto"
  });
  assert.deepEqual(dockPanelFlexStyle({ edge: "top", count: 2, index: 1, splitRatio: 0.25 }), {
    minWidth: `${MIN_DOCK_WIDTH}px`,
    minHeight: "0",
    flex: "0 1 75%"
  });
});

test("dock sync preserves mounted panels when the dock order is unchanged", () => {
  const first = { id: "first" };
  const splitter = { id: "splitter" };
  const second = { id: "second" };
  const calls = [];
  const dock = {
    children: [first, splitter, second],
    replaceChildren(...children) {
      calls.push(children);
      this.children = children;
    }
  };
  assert.equal(syncDockChildren(dock, [first, splitter, second]), false);
  assert.equal(calls.length, 0);
  assert.equal(syncDockChildren(dock, [second, splitter, first]), true);
  assert.deepEqual(calls, [[second, splitter, first]]);
});

test("dock settings expose Explorer, Problems, and reset layout without drag controls", () => {
  const controls = dockSettingsControls({ layout: { explorer: "right", problems: "bottom" } });
  assert.deepEqual(controls.map((control) => [control.panel, control.label]), [
    ["explorer", "Explorer Dock"],
    ["problems", "Problems Dock"]
  ]);
  assert.deepEqual(controls[0].options.map((option) => [option.edge, option.label, option.active]), [
    ["left", "Left", false],
    ["right", "Right", true],
    ["top", "Top", false],
    ["bottom", "Bottom", false]
  ]);
  assert.equal(controls[1].options.find((option) => option.edge === "bottom").active, true);
  assert.deepEqual(resetDockLayoutState({ explorer: "right", problems: "top" }), DEFAULT_DOCK_LAYOUT);
});

test("dock drop UI is removed and docked controls keep a single-row Problems header", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, /dockDropZones|dock-drop-zone|data-dock-target/);
  assert.doesNotMatch(html, /activity-button[^>]*data-dock-panel|sidebar-header[^>]*data-dock-panel|problems-header[^>]*data-dock-panel/);
  assert.doesNotMatch(css, /dock-drop-zone|dock-dragging|dock-drag-handle/);
  assert.match(css, /\.main\s*\{[\s\S]*grid-template-rows:\s*34px auto minmax\(0, 1fr\);/);
  assert.match(css, /\.toolbar\s*\{[\s\S]*overflow-x:\s*auto;/);
  assert.match(css, /\.problems-panel\s*\{[\s\S]*grid-template-rows:\s*38px auto minmax\(0, 1fr\);/);
  assert.match(css, /\.problems-panel\.problems-panel-narrow\s*\{[\s\S]*grid-template-rows:\s*76px auto minmax\(0, 1fr\);/);
  assert.match(css, /\.problems-header\s*\{[\s\S]*height:\s*38px;[\s\S]*overflow-x:\s*auto;[\s\S]*scrollbar-width:\s*none;/);
  assert.match(css, /\.problems-panel\.problems-panel-narrow \.problems-header\s*\{[\s\S]*grid-template-rows:\s*38px 38px;[\s\S]*height:\s*76px;/);
  assert.match(css, /\.problems-panel\.problems-panel-narrow \.lint-controls\s*\{[\s\S]*height:\s*38px;[\s\S]*overflow-x:\s*auto;[\s\S]*scrollbar-width:\s*none;/);
  assert.match(css, /\.lint-controls\s*\{[\s\S]*flex:\s*0 0 auto;/);
  assert.match(css, /\.problem-item\s*\{[\s\S]*white-space:\s*nowrap !important;/);
  assert.match(css, /\.problems-panel\[data-dock-edge="left"\] \.problem-item,\s*\.problems-panel\[data-dock-edge="right"\] \.problem-item\s*\{[\s\S]*white-space:\s*normal !important;/);
  assert.match(css, /\.problems-panel\[data-dock-edge="left"\] \.problem-message,\s*\.problems-panel\[data-dock-edge="right"\] \.problem-message\s*\{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*white-space:\s*normal;/);
  assert.equal(problemsHeaderShouldUseNarrowLayout({ dockEdge: "left", hidden: false, scrollWidth: 103, clientWidth: 100 }), true);
  assert.equal(problemsHeaderShouldUseNarrowLayout({ dockEdge: "right", hidden: false, scrollWidth: 102, clientWidth: 100 }), false);
  assert.equal(problemsHeaderShouldUseNarrowLayout({ dockEdge: "bottom", hidden: false, scrollWidth: 200, clientWidth: 100 }), false);
  assert.equal(problemsHeaderShouldUseNarrowLayout({ dockEdge: "left", hidden: true, scrollWidth: 200, clientWidth: 100 }), false);
  assert.doesNotMatch(css, /\.problems-panel\[data-dock-edge="left"\] \.problems-header/);
  assert.doesNotMatch(css, /\.problems-panel\[data-dock-edge="left"\] \.lint-controls/);
});

test("context menu uses one explicit active submenu and exposes Clone Row only", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const activeGroup = { dataset: { menuGroup: "Row Operations" } };
  const inactiveGroup = { dataset: { menuGroup: "Column Operations" } };
  assert.equal(contextMenuActiveGroupId(activeGroup), "Row Operations");
  assert.equal(contextMenuActiveGroupId(null), "");
  assert.equal(contextMenuGroupIsActive(activeGroup, activeGroup), true);
  assert.equal(contextMenuGroupIsActive(inactiveGroup, activeGroup), false);
  assert.deepEqual(contextMenuHiddenState(), { contextMenuActiveGroup: "", contextMenuOpen: false });
  assert.equal(rowCommandItems().some((item) => item.id === "clone-row" && item.label === "Clone Row"), true);
  assert.equal(rowCommandItems().some((item) => item.label === "Swap Rows"), false);
  assert.match(css, /\.menu-group\.active > \.submenu\s*\{\s*display: block;/);
  assert.doesNotMatch(css, /\.menu-group:hover \.submenu/);
});

test("row context menu orders Clone Row after hide and delete without changing commands", () => {
  const rowItems = rowCommandItems({ cloneDisabled: true });
  const ids = rowItems.map((item) => item.id);
  assert.deepEqual(ids, ["add-row", "insert-row", "hide-row", "delete-row", "clone-row"]);
  assert.deepEqual(rowItems.at(-1), { id: "clone-row", label: "Clone Row", disabled: true });
});

test("row commands protect the header row while allowing mixed body-row selections", () => {
  const doc = TableDocument.fromText("x.txt", "header1\theader2\nbody1\tbody2");
  const state = { selection: new SelectionModel() };
  const errors = [];
  const controller = createCommandController({
    isDevelopmentMode: false,
    state,
    activeDoc: () => doc,
    hasOpenDocument: () => true,
    execute(command) {
      command.redo(doc);
    },
    rowsFromSelection: () => {
      const rows = [];
      const rect = state.selection.rect;
      for (let row = rect.top; row <= rect.bottom; row++) rows.push(row);
      return rows;
    },
    columnsFromSelection: () => [state.selection.focus.column],
    showError: (message) => errors.push(message),
    handlers: {}
  });

  state.selection.set(0, 0);
  controller.runCommand("delete-row");
  controller.runCommand("hide-row");
  controller.runCommand("clear-row");
  assert.equal(doc.rowCount, 2);
  assert.equal(doc.getCell(0, 0), "header1");
  assert.equal(doc.hiddenRows.has(0), false);
  assert.equal(errors.length, 3);

  state.selection.setRange(0, 0, 1, 1);
  controller.runCommand("clear-row");
  assert.deepEqual(doc.rows[0], ["header1", "header2"]);
  assert.deepEqual(doc.rows[1], ["", ""]);

  doc.setCell(1, 0, "body1");
  doc.setCell(1, 1, "body2");
  state.selection.setRow(0, doc.columnCount);
  controller.runCommand("clear-selection");
  assert.deepEqual(doc.rows[0], ["header1", "header2"]);
  assert.deepEqual(doc.rows[1], ["body1", "body2"]);
  assert.equal(errors.at(-1), "Header row cannot be cleared as a row.");

  state.selection.set(0, 0);
  controller.runCommand("clear-selection");
  assert.deepEqual(doc.rows[0], ["", "header2"]);

  doc.setCell(0, 0, "header1");
  state.selection.setRow(0, doc.columnCount);
  state.selection.extendRows(1, doc.columnCount);
  controller.runCommand("clear-selection");
  assert.deepEqual(doc.rows[0], ["header1", "header2"]);
  assert.equal(doc.getCell(1, 0), "");
  assert.equal(doc.getCell(1, 1), "");
});

test("Settings modal exposes immediate visual settings without save cancel apply", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const controls = appSettingsVisualControls({
    colorizeColumns: true,
    vectorLspHover: true,
    legacyLintEngine: true,
    theme: "light",
    gridFont: "custom"
  });
  assert.deepEqual(controls.colorize, { id: "settingsColorizeColumns", label: "Colorize columns", checked: true });
  assert.equal(controls.vectorHover.id, "settingsVectorLspHover");
  assert.equal(controls.vectorHover.label, "Vector-LSP Hover");
  assert.equal(controls.vectorHover.disabled, true);
  assert.equal(controls.vectorHover.hintHidden, false);
  assert.equal(controls.font.id, "settingsGridFont");
  assert.equal(controls.font.label, "Font");
  assert.equal(controls.font.value, DEFAULT_GRID_FONT);
  assert.equal(controls.font.options.some(([label]) => label === "Cascadia Mono"), true);
  assert.deepEqual(controls.themes, [
    { theme: "dark", label: "Dark", active: false },
    { theme: "light", label: "Light", active: true }
  ]);
  assert.equal(normaliseGridFont("  Consolas  "), "Consolas");
  assert.equal(fontLabelFromFamily("'Cascadia Mono', Consolas"), "Cascadia Mono");
  assert.equal(Object.hasOwn(controls, "choices"), false);
  assert.match(css, /\.settings-segmented/);
});

test("Problems panel rendering is skipped while hidden and cached while unchanged", () => {
  assert.deepEqual(lintDiagnosticsStateAfterUpdate({ version: 4 }, [{ id: "a" }]), {
    diagnostics: [{ id: "a" }],
    version: 5
  });
  assert.equal(shouldRenderProblemsPanel({ hasProblemsList: false, problemsVisible: true, bottomTab: "problems" }), false);
  assert.equal(shouldRenderProblemsPanel({ hasProblemsList: true, problemsVisible: false, bottomTab: "problems" }), false);
  assert.equal(shouldRenderProblemsPanel({ hasProblemsList: true, problemsVisible: true, bottomTab: "logs" }), false);
  assert.equal(shouldRenderProblemsPanel({ hasProblemsList: true, problemsVisible: true, bottomTab: "problems" }), true);
  assert.equal(problemsPanelRenderKey({
    engine: "legacy",
    lintEnabled: true,
    lspStarted: false,
    lintStatus: "ready",
    legacyStatus: "",
    legacyRulesOpen: true,
    legacyProfile: "RotW",
    lintVersion: 7,
    collapsedFiles: ["b.txt", "a.txt"]
  }), ["legacy", "on", "stopped", "ready", "", "rules-open", "RotW", 7, "a.txt\u001fb.txt"].join("\u001e"));
  assert.equal(problemsPanelRenderDecision({ currentKey: "same", nextKey: "same" }), "cached");
  assert.equal(problemsPanelRenderDecision({ currentKey: "old", nextKey: "new" }), "render");
});

test("Problems panel groups duplicate basenames by file key", () => {
  const diagnostics = [
    { id: "a", fileName: "skills.txt", fileKey: "e:/mod-a/skills.txt", severity: "error", rowIndex: 0, columnIndex: 0, message: "A" },
    { id: "b", fileName: "skills.txt", fileKey: "e:/mod-b/skills.txt", severity: "warning", rowIndex: 1, columnIndex: 0, message: "B" }
  ];
  const groups = groupDiagnosticsByFile(diagnostics);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(([, items, key]) => [key, items.length]), [
    ["e:/mod-a/skills.txt", 1],
    ["e:/mod-b/skills.txt", 1]
  ]);
  const html = problemsPanelHtml({ lintEnabled: true, diagnostics });
  assert.match(html, /data-file-key="e:\/mod-a\/skills\.txt"/);
  assert.match(html, /data-file-key="e:\/mod-b\/skills\.txt"/);
});

test("diagnostic severity styles tabs by the active diagnostics for each document", () => {
  const docA = TableDocument.fromText("skills.txt", "id\n1", { path: "E:\\mod-a\\skills.txt" });
  const docB = TableDocument.fromText("skills.txt", "id\n2", { path: "E:\\mod-b\\skills.txt" });
  const state = {
    docs: [docA, docB],
    active: 0,
    problemsVisible: true,
    bottomTab: "problems",
    sidebarVisible: true,
    freezeRow: false,
    freezeColumn: false,
    colorizeColumns: false,
    workspace: null,
    lint: {
      enabled: true,
      engine: "vector-lsp",
      diagnostics: [
        { id: "a", fileKey: "e:/mod-a/skills.txt", fileName: "skills.txt", severity: "error", rowIndex: 0, columnIndex: 0, message: "A" },
        { id: "b", fileKey: "e:/mod-b/skills.txt", fileName: "skills.txt", severity: "warning", rowIndex: 0, columnIndex: 0, message: "B" }
      ],
      version: 1,
      status: "",
      legacy: {
        status: "",
        rulesOpen: false,
        settings: { profile: "RotW" },
        workspaceLoad: { status: "ready" }
      }
    },
    lsp: { started: true, openFileCount: 2 }
  };
  const diagnostics = createDiagnosticsController({
    state,
    els: {
      host: { getBoundingClientRect: () => ({ top: 0, height: 100 }) },
      overviewRuler: fakeElement(),
      problemsList: null
    },
    grid: { setDiagnostics() {} },
    activeDoc: () => state.docs[state.active],
    hasOpenDocument: () => true,
    addDocument: async () => {},
    renderChrome() {},
    recordUiPerf() {},
    showError() {},
    lintDocKey: (target) => documentFileKey(target),
    lintPathKey: (target) => String(target || "").replace(/\\/g, "/").toLowerCase(),
    escapeHtml
  });

  assert.equal(diagnostics.docDiagnosticSeverity(docA), "error");
  assert.equal(diagnostics.docDiagnosticSeverity(docB), "warning");

  const els = {
    shell: fakeElement(),
    sidebar: fakeElement(),
    problemsPanel: fakeElement(),
    problemsList: null,
    logList: null,
    emptyState: fakeElement(),
    tabs: fakeElement(),
    fileList: fakeElement(),
    lintSummary: fakeElement()
  };
  const shell = createShellController({
    state,
    els,
    grid: { setDocument() {} },
    activeDoc: () => state.docs[state.active],
    hasOpenDocument: () => true,
    applyFreezeToDoc() {},
    closeTab: async () => {},
    openDroppedNativePaths: async () => {},
    updateGridDiagnostics() {},
    renderProblemsPanelIfNeeded() {},
    scrollProblemsToActiveFile() {},
    docDiagnosticSeverity: diagnostics.docDiagnosticSeverity,
    lintSummaryText: diagnostics.lintSummaryText,
    problemBadgeForPath: diagnostics.problemBadgeForPath,
    lintNotificationCount: diagnostics.lintNotificationCount,
    renderLintControls() {},
    syncDockLayout() {},
    syncProblemsHeaderLayout() {},
    scheduleHoverPrewarm() {},
    commitActiveCellEditor() {},
    recordUiPerf() {},
    perfNow: () => 0,
    showError() {},
    lintPathKey: (target) => String(target || "").replace(/\\/g, "/").toLowerCase(),
    escapeHtml,
    documentRef: { querySelectorAll: () => [] }
  });
  shell.renderChrome();
  assert.match(els.tabs.innerHTML, /tab-title tab-title-error/);
  assert.match(els.tabs.innerHTML, /tab-title tab-title-warning/);

  state.lint.enabled = false;
  shell.renderChrome();
  assert.doesNotMatch(els.tabs.innerHTML, /tab-title-(error|warning)/);
  state.lint.enabled = true;
  state.lint.diagnostics = [];
  assert.equal(diagnostics.docDiagnosticSeverity(docA), null);
});

test("diagnostic navigation failure leaves the active document and selection unchanged", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("active.txt", "id\n1", { path: "E:\\Data\\active.txt" });
  const state = {
    docs: [doc],
    active: 0,
    selection: new SelectionModel(),
    problemsVisible: true,
    bottomTab: "problems",
    lint: {
      enabled: true,
      engine: "legacy",
      diagnostics: [{
        id: "missing",
        fileName: "missing.txt",
        filePath: "E:\\Data\\missing.txt",
        fileKey: "e:/data/missing.txt",
        rowIndex: 8,
        columnIndex: 4,
        severity: "error",
        message: "missing"
      }],
      version: 1,
      status: "",
      legacy: {
        status: "",
        rulesOpen: false,
        settings: { profile: "RotW" },
        workspaceLoad: { status: "ready" },
        workspaceDocs: []
      }
    },
    lsp: { started: false }
  };
  state.selection.set(0, 0);
  const errors = [];
  const gridCalls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command) => {
          if (command === "read_text_files") return [{ Err: "missing" }];
          throw new Error(`unexpected ${command}`);
        }
      },
      event: { listen: async () => () => {} }
    }
  };
  try {
    const controller = createDiagnosticsController({
      state,
      els: {
        host: { getBoundingClientRect: () => ({ top: 0, height: 100 }), focus() {} },
        overviewRuler: { style: {}, innerHTML: "" },
        problemsList: null
      },
      grid: {
        setDiagnostics() {},
        setDocument: () => gridCalls.push("set-document"),
        scrollCellIntoView: () => gridCalls.push("scroll"),
        draw: () => gridCalls.push("draw")
      },
      activeDoc: () => state.docs[state.active],
      hasOpenDocument: () => true,
      addDocument: async (newDoc) => {
        state.docs.push(newDoc);
        state.active = state.docs.length - 1;
      },
      renderChrome() {},
      recordUiPerf() {},
      showError: (message) => errors.push(String(message)),
      lintDocKey: (target) => String(target?.path || target?.name || "").replace(/\\/g, "/").toLowerCase(),
      lintPathKey: (target) => String(target || "").replace(/\\/g, "/").toLowerCase(),
      escapeHtml
    });

    await controller.goToDiagnostic("missing");
    assert.equal(state.active, 0);
    assert.deepEqual(state.selection.focus, { row: 0, column: 0 });
    assert.deepEqual(gridCalls, []);
    assert.equal(errors.some((message) => message.includes("Diagnostic target could not be opened")), true);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Find Next includes the current cell once when the query changes", () => {
  const doc = TableDocument.fromText("x.txt", "name\nwar cry\nwar cry");
  const focus = { row: 1, column: 0 };
  const query = "war cry";
  let searchState = initialSearchState();
  let includeStart = searchShouldIncludeStart(query, searchState.lastQuery);
  assert.equal(includeStart, true);
  assert.deepEqual(findInTable(doc, query, focus, { includeStart }), focus);

  searchState = searchStateAfterFind(query);
  includeStart = searchShouldIncludeStart(query, searchState.lastQuery);
  assert.equal(includeStart, false);
  assert.deepEqual(findInTable(doc, query, focus, { includeStart }), { row: 2, column: 0 });

  searchState = searchStateAfterInput();
  includeStart = searchShouldIncludeStart(query, searchState.lastQuery);
  assert.equal(includeStart, true);
  assert.deepEqual(findInTable(doc, query, focus, { includeStart }), focus);
});

test("Ctrl+B, Ctrl+L, and Ctrl+H use the shared panel and row-height reset paths", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.equal(globalShortcutAction({ key: "b", ctrlKey: true }), "toggle-sidebar");
  assert.equal(globalShortcutAction({ key: "l", ctrlKey: true }), "toggle-problems");
  assert.equal(globalShortcutAction({ key: "h", ctrlKey: true }), "reset-row-heights");
  assert.equal(globalShortcutAction({ key: "Delete" }), "clear-selection");
  assert.equal(globalShortcutAction({ key: "b", ctrlKey: true }, { editingCell: true }), null);
  assert.equal(globalShortcutAction({ key: "h", ctrlKey: true }, { editingCell: true }), "reset-row-heights");
  assert.equal(isEditorShortcutAllowed("h", true), true);
  assert.equal(isEditorShortcutAllowed("b", true), false);
  assert.equal(commandLabelsForEnvironment().some(([id, label]) => id === "reset-row-heights" && label === "Reset Row Heights"), true);
  assert.match(readme, /`Ctrl\+B`: toggle Explorer panel/);
  assert.match(readme, /`Ctrl\+L`: toggle Problems panel/);
  assert.match(readme, /`Ctrl\+H`: reset all row heights to default/);
});
