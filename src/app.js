import { TableDocument, clamp } from "./core/table-model.js";
import { SelectionModel } from "./core/selection.js";
import { makeCellCommand, makeCustomCommand } from "./core/undo.js";
import { resetUndoManagerForDocument, undoManagerForDocument } from "./core/document-undo-state.js";
import {
  addColumnsCommand,
  addRowsCommand,
  arithmeticRangesCommand,
  arithmeticCommand,
  clearRangesCommand,
  cloneRowsCommand,
  copyRange,
  copyRanges,
  hiddenColumnsCommand,
  hiddenRowsCommand,
  incrementFillRangesCommand,
  incrementFillCommand,
  pasteTextToRangesCommand,
  pasteTextCommand,
  resizeColumnCommand,
  resizeRowCommand
} from "./core/operations.js";
import {
  isTauriRuntime,
  listenForNativeDrops
} from "./core/io.js";
import {
  createDefaultLintSettings,
  normalizeLintSettings
} from "./core/lint-engine.js";
import {
  exposeTxteditorPerf,
  recordUiPerfSample
} from "./core/perf-instrumentation.js";
import {
  documentChangeSyncRoute,
  effectiveVectorLspHover,
  isLegacyLintEngineValue,
  isVectorLintEngineValue,
  legacyLintImmediateSchedule,
  normalizeLintEngine,
  vectorLspHoverFromStorage
} from "./core/lint-controller-policy.js";
import { CanvasGrid } from "./ui/canvas-grid.js";
import {
  DEFAULT_DOCK_LAYOUT,
  normalizeDockLayout
} from "./ui/dock-layout-policy.js";
import { globalShortcutAction } from "./ui/global-shortcut-policy.js";
import {
  DOCK_LAYOUT_KEY,
  panelStateFromStorage
} from "./ui/panel-state-policy.js";
import {
  initialSearchState,
  isTextInputTarget
} from "./ui/search-policy.js";
import {
  normaliseGridFont
} from "./ui/app-settings-policy.js";
import {
  createToastFeedback,
  escapeHtml,
  readJsonStorage
} from "./ui/app-runtime-utils.js";
import { createCommandController } from "./ui/controllers/command-controller.js";
import { createCommandSurfaceController } from "./ui/controllers/command-surface-controller.js";
import { createDiagnosticsController } from "./ui/controllers/diagnostics-controller.js";
import { createDocumentController } from "./ui/controllers/document-controller.js";
import { createDockController } from "./ui/controllers/dock-controller.js";
import { createLegacyLintController } from "./ui/controllers/legacy-lint-controller.js";
import { createLspController } from "./ui/controllers/lsp-controller.js";
import { createSearchController } from "./ui/controllers/search-controller.js";
import { createSettingsController } from "./ui/controllers/settings-controller.js";
import { createShellController } from "./ui/controllers/shell-controller.js";
const savedTheme = localStorage.getItem("txteditor.theme") === "light" ? "light" : "dark";
const savedGridFont = normaliseGridFont(localStorage.getItem("txteditor.gridFont"));
const savedColorize = localStorage.getItem("txteditor.colorize") === "on";
const savedVectorLspHover = vectorLspHoverFromStorage(localStorage.getItem("txteditor.vectorLspHover"));
const savedLintEnabled = readJsonStorage("txteditor.lint.settings", {}).enabled !== false;
const savedLintEngine = normalizeLintEngine(localStorage.getItem("txteditor.lint.engine"));
const savedLegacyLintSettings = normalizeLintSettings(readJsonStorage("txteditor.legacyLint.settings", createDefaultLintSettings()));
const savedDockLayout = normalizeDockLayout(readJsonStorage(DOCK_LAYOUT_KEY, DEFAULT_DOCK_LAYOUT));
const savedPanelState = panelStateFromStorage(localStorage, savedDockLayout);
const savedFreeze = readJsonStorage("txteditor.freeze", {});
const lintEngineEvents = [];
document.documentElement.dataset.theme = savedTheme;
document.documentElement.style.setProperty("--grid-font", savedGridFont);
document.documentElement.style.setProperty("--sidebar-width", `${savedPanelState.sidebarWidth}px`);
document.documentElement.style.setProperty("--problems-height", `${savedPanelState.problemsHeight}px`);

const state = {
  docs: [],
  active: 0,
  selection: new SelectionModel(),
  workspace: null,
  search: initialSearchState(),
  sidebarVisible: savedPanelState.sidebarVisible,
  sidebarWidth: savedPanelState.sidebarWidth,
  sidebarHeight: savedPanelState.sidebarHeight,
  problemsVisible: savedPanelState.problemsVisible,
  problemsWidth: savedPanelState.problemsWidth,
  problemsHeight: savedPanelState.problemsHeight,
  dockLayout: savedPanelState.dockLayout,
  freezeRow: savedFreeze.row ?? false,
  freezeColumn: savedFreeze.column ?? false,
  contextHit: null,
  contextMenuActiveGroup: "",
  contextMenuOpen: false,
  theme: savedTheme,
  gridFont: savedGridFont,
  colorizeColumns: savedColorize,
  vectorLspHover: savedVectorLspHover,
  lint: {
    engine: savedLintEngine,
    enabled: savedLintEnabled,
    diagnostics: [],
    status: "",
    version: 0,
    legacy: {
      settings: savedLegacyLintSettings,
      timer: 0,
      pendingRun: null,
      version: 0,
      running: false,
      status: "",
      rulesOpen: false,
      lastRunAt: 0,
      workspaceDocs: [],
      workspaceLoad: {
        status: "not-started",
        files: [],
        error: "",
        signature: ""
      },
      workspaceIndexCache: {
        signature: "",
        profile: "",
        index: null
      }
    }
  },
  lsp: {
    started: false
  },
  config: {},
  bottomTab: "problems",
  lspLogs: []
};

const els = {
  shell: document.getElementById("app"),
  layoutRoot: document.getElementById("layoutRoot"),
  dockTop: document.getElementById("dockTop"),
  dockLeft: document.getElementById("dockLeft"),
  dockRight: document.getElementById("dockRight"),
  dockBottom: document.getElementById("dockBottom"),
  sidebar: document.getElementById("sidebar"),
  sidebarResizer: document.getElementById("sidebarResizer"),
  problemsPanel: document.getElementById("problemsPanel"),
  problemsResizer: document.getElementById("problemsResizer"),
  problemsList: document.getElementById("problemsList"),
  logList: document.getElementById("logList"),
  host: document.getElementById("gridHost"),
  canvas: document.getElementById("gridCanvas"),
  frozenCanvas: document.getElementById("frozenCanvas"),
  scrollSurface: document.getElementById("scrollSurface"),
  editor: document.getElementById("cellEditor"),
  tabs: document.getElementById("tabs"),
  emptyState: document.getElementById("emptyState"),
  fileList: document.getElementById("fileList"),
  fileInput: document.getElementById("hiddenFileInput"),
  lintControls: document.getElementById("lintControls"),
  lintRulesPanel: document.getElementById("lintRulesPanel"),
  lintSummary: document.getElementById("lintSummary"),
  searchPanel: document.getElementById("searchPanel"),
  searchInput: document.getElementById("searchInput"),
  searchStatus: document.getElementById("searchStatus"),
  palette: document.getElementById("palette"),
  paletteInput: document.getElementById("paletteInput"),
  paletteResults: document.getElementById("paletteResults"),
  toast: document.getElementById("toast"),
  contextMenu: document.getElementById("contextMenu"),
  closeDialog: document.getElementById("closeDialog"),
  closeDialogText: document.getElementById("closeDialogText"),
  overviewRuler: document.getElementById("overviewRuler")
};
const { showError, showToast } = createToastFeedback(els);

const isDevelopmentMode = ["localhost", "127.0.0.1", ""].includes(location.hostname);
const uiPerfSamples = [];

const commandController = createCommandController({
  isDevelopmentMode,
  state,
  activeDoc,
  hasOpenDocument,
  execute,
  rowsFromSelection,
  columnsFromSelection,
  showError,
  handlers: {
    openFile,
    openFolder,
    saveFile,
    saveAs,
    undo,
    redo,
    showSearch: () => searchController.showSearch(),
    findNext: () => searchController.findNext(),
    copySelection,
    pasteSelection,
    cutSelection,
    selectAll,
    addRows,
    cloneRows,
    addColumns,
    unhideAll,
    toggleColorize,
    toggleVectorLspHover,
    toggleLint,
    toggleLintRules,
    toggleExplorerPane: () => toggleExplorerPane(),
    toggleProblemsPanel: () => toggleProblemsPanel(),
    resetRowHeights,
    toggleSidebar: () => toggleSidebar(),
    toggleTheme,
    showAppSettings,
    showSettings,
    goToDefinition,
    loadFixture,
    math,
    toggleFreeze,
    zoomBy,
    zoomReset,
    resizeFit
  }
});
const { commandLabels, commands } = commandController;

const diagnosticsController = createDiagnosticsController({
  state,
  els,
  grid: () => grid,
  activeDoc,
  hasOpenDocument,
  addDocument,
  renderChrome,
  recordUiPerf,
  showError,
  lintDocKey,
  lintPathKey,
  escapeHtml,
  storage: localStorage
});

const EMPTY_DOC = TableDocument.fromText("Empty", "");
const dockController = createDockController({
  state,
  els,
  renderChrome,
  layoutGrid: () => grid.layout(),
  onProblemsOpened: () => {
    if (isLegacyLintEngine() && state.lint.enabled) {
      const schedule = legacyLintImmediateSchedule("problems-opened");
      scheduleLegacyLintFull(schedule.reason, schedule.delay);
    }
  },
  onProblemsClosed: () => cancelLegacyLintJobs({ clearDiagnostics: false })
});
const {
  dockForPanel,
  resetDockLayout,
  setPanelDock,
  syncDockLayout,
  syncProblemsHeaderLayout,
  toggleExplorerPane,
  toggleProblemsPanel,
  toggleSidebar,
  wirePaneResizers
} = dockController;
const legacyLintController = createLegacyLintController({
  state,
  renderChrome,
  setLintDiagnostics,
  updateGridDiagnostics,
  legacyLintDisplayActive,
  docHasDiagnostics,
  recordLintEngineEvent,
  perfNow,
  elapsedMs,
  lintDocKey
});
const {
  cancelJobs: cancelLegacyLintJobs,
  currentProfileRules: currentLegacyProfileRules,
  markDocumentChanged: markLegacyLintDocChanged,
  resetWorkspaceIndex: resetLegacyWorkspaceIndex,
  scheduleForEdit: scheduleLegacyLintForEdit,
  scheduleForOpen: scheduleLegacyLintForOpen,
  scheduleFull: scheduleLegacyLintFull,
  workspaceFileStatesForExplorer: legacyWorkspaceFileStatesForExplorer,
  workspaceTxtFiles: legacyWorkspaceTxtFiles
} = legacyLintController;

syncDockLayout();

let lspController = null;
let shellController = null;
const grid = new CanvasGrid({
  host: els.host,
  canvas: els.canvas,
  frozenCanvas: els.frozenCanvas,
  scrollSurface: els.scrollSurface,
  editor: els.editor,
  doc: activeDoc(),
  selection: state.selection,
  onEdit: applyEdits,
  onStatus: null,
  onContextMenu: showContextMenu,
  onResizeCommand: commitResize,
  onAutoFitColumn: (column) => autoFitColumns([column]).catch(showError),
  onHoverRequest: (row, column, meta) => lspController.requestHover(row, column, meta).catch((error) => lspController.reportHoverDispatchFailure(row, column, error, "grid-hover-request")),
  onHoverInvalidated: () => lspController.clearVisibleHover("grid-hover-cleared"),
  onViewportChanged: (reason) => lspController.scheduleHoverPrewarm(reason),
  onSelectionChanged: () => {
    diagnosticsController.handleSelectionChanged();
  }
});

grid.setFontFamily(state.gridFont);
grid.setColorizeColumns(state.colorizeColumns);
grid.setVectorLspHoverEnabled(effectiveVectorLspHoverEnabled());
lspController = createLspController({
  state,
  els,
  grid,
  activeDoc,
  isVectorLintEngine,
  effectiveVectorLspHoverEnabled,
  recordLintEngineEvent,
  perfNow,
  showToast,
  showError,
  setLintDiagnostics,
  updateGridDiagnostics,
  renderChrome,
  addDocument,
  applyFreezeToDoc,
  updateActiveProblemHighlight,
  lintPathKey
});
exposeTxteditorPerf(window, {
  uiPerfSamples,
  lintEngineEvents,
  ...lspController.perf
});
const settingsController = createSettingsController({
  state,
  els,
  grid,
  dockForPanel,
  setPanelDock,
  resetDockLayout,
  isLegacyLintEngine,
  isVectorLintEngine,
  effectiveVectorLspHoverEnabled,
  cancelLegacyLintJobs,
  scheduleLegacyLintFull,
  legacyLintDisplayActive,
  currentLegacyProfileRules,
  invalidateLspHover,
  setLintDiagnostics,
  updateGridDiagnostics,
  lspStartWorkspace,
  syncOpenDocsToVectorLsp,
  recordLintEngineEvent,
  renderChrome,
  reportBackgroundFailure,
  showError,
  escapeHtml
});
const documentController = createDocumentController({
  state,
  els,
  grid,
  emptyDoc: EMPTY_DOC,
  activeDoc,
  applyFreezeToDoc,
  renderChrome,
  showError,
  reportWindowCloseFailure,
  lspOpenDoc,
  reportLspOpenFailure,
  lspCloseDoc,
  reportLspCloseFailure,
  lspStartWorkspace,
  scheduleHoverPrewarm,
  resetUndoManagerForDocument,
  resetLegacyWorkspaceIndex,
  scheduleLegacyLintForOpen,
  scheduleLegacyLintFull,
  cancelLegacyLintJobs,
  isVectorLintEngine,
  isLegacyLintEngine,
  updateGridDiagnostics,
  scrollProblemsToActiveFile
});
const commandSurfaceController = createCommandSurfaceController({
  state,
  els,
  grid,
  commandLabels,
  runCommand,
  activeDoc,
  rowsForContextOperation,
  cellHasReference,
  clearVisibleLspHover,
  showError,
  escapeHtml
});
const searchController = createSearchController({
  state,
  els,
  grid,
  activeDoc,
  updateActiveProblemHighlight
});
shellController = createShellController({
  state,
  els,
  grid,
  activeDoc,
  hasOpenDocument,
  applyFreezeToDoc,
  closeTab,
  openDroppedNativePaths,
  updateGridDiagnostics,
  renderProblemsPanelIfNeeded,
  scrollProblemsToActiveFile,
  docDiagnosticSeverity,
  lintSummaryText,
  problemBadgeForPath,
  lintNotificationCount,
  renderLintControls,
  syncDockLayout,
  syncProblemsHeaderLayout,
  scheduleHoverPrewarm,
  recordUiPerf,
  perfNow,
  showError,
  lintPathKey,
  escapeHtml
});
renderChrome();
wireEvents();
wireCloseHandler().catch((error) => reportStartupFailure("Window close handler", error));
loadConfig().catch((error) => {
  state.config = {};
  reportStartupFailure("Configuration load", error);
});
listenForNativeDrops((paths) => openDroppedNativePaths(paths)).catch(showError);
lspController.startListeners();

function activeDoc() {
  return state.docs[state.active] ?? EMPTY_DOC;
}

function hasOpenDocument() {
  return state.docs.length > 0 && state.active >= 0;
}

function activeUndo() {
  return undoManagerForDocument(activeDoc());
}

function perfNow() {
  return typeof performance === "undefined" ? 0 : performance.now();
}

function elapsedMs(started) {
  return Math.round((perfNow() - started) * 100) / 100;
}

function recordUiPerf(name, started, details = {}) {
  if (typeof performance === "undefined") return;
  recordUiPerfSample(uiPerfSamples, {
    name,
    started,
    diagnostics: state.lint.diagnostics.length,
    problemsVisible: state.problemsVisible,
    bottomTab: state.bottomTab,
    details,
    now: () => performance.now()
  });
}

function recordLintEngineEvent(kind, details = {}) {
  lintEngineEvents.push({
    timestamp: perfNow(),
    engine: state.lint.engine,
    diagnostics: state.lint.diagnostics.length,
    ...details,
    kind
  });
  if (lintEngineEvents.length > 2000) lintEngineEvents.shift();
}

function isVectorLintEngine() {
  return isVectorLintEngineValue(state.lint.engine);
}

function isLegacyLintEngine() {
  return isLegacyLintEngineValue(state.lint.engine);
}

function legacyLintDisplayActive() {
  return diagnosticsController.legacyLintDisplayActive();
}

function effectiveVectorLspHoverEnabled() {
  return effectiveVectorLspHover({ engine: state.lint.engine, vectorLspHover: state.vectorLspHover });
}

function execute(command, changedRows = null) {
  if (!hasOpenDocument()) return showError("Open a file before editing.");
  if (!command || command.isEmpty) return;
  const started = perfNow();
  const doc = activeDoc();
  command.redo(activeDoc());
  markLegacyLintDocChanged(doc);
  activeUndo().push(command);
  grid.layout();
  if (documentChangeSyncRoute(state.lint.engine) === "vector-update") {
    lspUpdateDoc(doc, changedRows).catch((error) => handleLspUpdateError(doc, error, "edit"));
  } else {
    scheduleLegacyLintForEdit(doc);
  }
  recordUiPerf("row-command", started, { changedRows: changedRows?.length ?? 0 });
  renderChrome();
}

function applyEdits(edits, label = "Edit Cells") {
  execute(makeCellCommand(label, activeDoc(), edits), [...new Set(edits.map((e) => e.row))]);
}

function wireEvents() {
  document.addEventListener("click", (event) => {
    const command = event.target.closest("[data-command]")?.dataset.command;
    if (command) Promise.resolve(commands[command]?.()).catch(showError);
    const bottomTab = event.target.closest("[data-bottom-tab]")?.dataset.bottomTab;
    if (bottomTab) switchBottomTab(bottomTab);
    if (!event.target.closest(".context-menu")) hideContextMenu();
  });
  els.closeDialog.addEventListener("click", (event) => {
    documentController.handleCloseDialogClick(event);
  });
  els.tabs.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    const tab = event.target.closest("[data-tab]");
    if (tab) closeTab(Number(tab.dataset.tab)).catch(showError);
  });
  document.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("resize", () => {
    syncDockLayout();
    grid.layout();
    positionContextMenu();
    updateOverviewRuler();
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", async (event) => {
    event.preventDefault();
    if (isTauriRuntime()) return;
    await documentController.openBrowserFiles(event.dataTransfer?.files ?? []);
  });
  els.fileInput.addEventListener("change", async () => {
    await documentController.openBrowserFiles(els.fileInput.files ?? []);
    els.fileInput.value = "";
  });
  wirePaneResizers();
  searchController.wireEvents();
  els.paletteInput.addEventListener("input", renderPalette);
  els.paletteInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const first = els.paletteResults.querySelector("[data-run]");
      if (first) Promise.resolve(runCommand(first.dataset.run)).catch(showError);
      els.palette.classList.add("hidden");
    }
    if (event.key === "Escape") els.palette.classList.add("hidden");
  });
}

async function wireCloseHandler() {
  return documentController.wireCloseHandler();
}

function handleGlobalKeydown(event) {
  if (event.defaultPrevented) return;
  const editingCell = els.editor.classList.contains("active");
  if (event.key === "Escape" && !els.contextMenu.classList.contains("hidden")) {
    event.preventDefault();
    hideContextMenu();
    return;
  }
  if (event.key === "Escape" && !els.searchPanel.classList.contains("hidden")) {
    event.preventDefault();
    searchController.closeSearch();
    return;
  }
  if (event.key === "Escape" && !els.palette.classList.contains("hidden")) {
    event.preventDefault();
    els.palette.classList.add("hidden");
    els.host.focus();
    return;
  }
  const shortcutAction = globalShortcutAction(event, { editingCell });
  if (editingCell && !shortcutAction) return;
  if (!editingCell && isTextInputTarget(event.target)) return;
  if (shortcutAction) return runGlobalShortcutAction(event, shortcutAction);
}

function runGlobalShortcutAction(event, action) {
  if (action === "zoom-in") return prevent(event, () => runCommand("zoom-in"));
  if (action === "zoom-out") return prevent(event, () => runCommand("zoom-out"));
  if (action === "zoom-reset") return prevent(event, () => runCommand("zoom-reset"));
  if (action === "open-file") return prevent(event, openFile);
  if (action === "toggle-sidebar") return prevent(event, toggleSidebar);
  if (action === "toggle-problems") return prevent(event, toggleProblemsPanel);
  if (action === "reset-row-heights") return prevent(event, resetRowHeights);
  if (action === "save-as") return prevent(event, saveAs);
  if (action === "save-file") return prevent(event, saveFile);
  if (action === "search") return prevent(event, searchController.showSearch);
  if (action === "redo") return prevent(event, redo);
  if (action === "undo") return prevent(event, undo);
  if (action === "show-palette") return prevent(event, showPalette);
  if (action === "close-tab") return prevent(event, () => closeTab(state.active));
  if (action === "copy") return prevent(event, copySelection);
  if (action === "cut") return prevent(event, cutSelection);
  if (action === "paste") return prevent(event, pasteSelection);
  if (action === "clear-selection") return prevent(event, () => runCommand("clear-selection"));
  return undefined;
}

function prevent(event, fn) {
  event.preventDefault();
  Promise.resolve(fn()).catch(showError);
}

async function addDocument(doc) {
  return documentController.addDocument(doc);
}

async function openFile() {
  return documentController.openFile();
}

async function openDroppedNativePaths(paths) {
  return documentController.openDroppedNativePaths(paths);
}

async function openFolder() {
  return documentController.openFolder();
}

async function saveFile() {
  return documentController.saveFile();
}

async function saveAs() {
  return documentController.saveAs();
}

async function loadFixture(size) {
  return documentController.loadFixture(size);
}

function undo() {
  const doc = activeDoc();
  if (activeUndo().undo(doc)) {
    markLegacyLintDocChanged(doc);
    grid.layout();
    if (isVectorLintEngine()) lspUpdateDoc(doc).catch((error) => handleLspUpdateError(doc, error, "undo"));
    else scheduleLegacyLintForEdit(doc);
    renderChrome();
  }
}

function redo() {
  const doc = activeDoc();
  if (activeUndo().redo(doc)) {
    markLegacyLintDocChanged(doc);
    grid.layout();
    if (isVectorLintEngine()) lspUpdateDoc(doc).catch((error) => handleLspUpdateError(doc, error, "redo"));
    else scheduleLegacyLintForEdit(doc);
    renderChrome();
  }
}

function runCommand(id) {
  return commandController.runCommand(id);
}

async function copySelection() {
  if (!hasOpenDocument()) return;
  try {
    await writeClipboardText(copyRanges(activeDoc(), state.selection.ranges));
  } catch (error) {
    showError(`Clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function cutSelection() {
  await copySelection();
  execute(clearRangesCommand(activeDoc(), state.selection.ranges, "Cut"));
}

async function pasteSelection() {
  if (!hasOpenDocument()) return;
  try {
    const text = await readClipboardText();
    execute(pasteTextToRangesCommand(activeDoc(), state.selection.ranges, state.selection.focus, text));
  } catch (error) {
    showError(`Clipboard paste failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeClipboardText(text) {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard write is not available in this environment.");
  await navigator.clipboard.writeText(text);
}

async function readClipboardText() {
  if (!navigator.clipboard?.readText) throw new Error("Clipboard read is not available in this environment.");
  return navigator.clipboard.readText();
}

function selectAll() {
  state.selection.selectAll(activeDoc().rowCount, activeDoc().columnCount);
  grid.draw();
}

async function addRows() {
  const count = await promptNumber({
    title: "Add Rows",
    message: "Number of rows to add:",
    defaultValue: 1,
    min: 1
  });
  if (count !== null) execute(addRowsCommand(activeDoc(), count));
}

async function addColumns() {
  const count = await promptNumber({
    title: "Add Columns",
    message: "Number of columns to add:",
    defaultValue: 1,
    min: 1
  });
  if (count !== null) execute(addColumnsCommand(activeDoc(), count));
}

async function math(kind) {
  const operator = { add: "+", subtract: "-", multiply: "*", divide: "/" }[kind];
  const operand = await promptNumber({
    title: "Math",
    message: `Apply ${operator} to numeric selected cells:`,
    defaultValue: "",
    allowFloat: true
  });
  if (operand !== null) execute(state.selection.isMultiRange
    ? arithmeticRangesCommand(activeDoc(), state.selection.ranges, operator, operand)
    : arithmeticCommand(activeDoc(), state.selection.rect, operator, operand));
}

function promptNumber({ title, message, defaultValue = "", min = null, allowFloat = false }) {
  return askText({
    title,
    message,
    defaultValue: String(defaultValue),
    inputMode: "decimal",
    validate(value) {
      const text = value.trim();
      const number = allowFloat ? Number(text) : Number.parseInt(text, 10);
      if (text === "" || !Number.isFinite(number)) return { error: "Enter a valid number." };
      if (!allowFloat && String(number) !== text) return { error: "Enter a whole number." };
      if (min !== null && number < min) return { error: `Enter a number ${min} or higher.` };
      return { value: number };
    }
  });
}

function askText({ title, message, defaultValue = "", inputMode = "text", validate = (value) => ({ value }) }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <input class="modal-input" inputmode="${escapeHtml(inputMode)}" value="${escapeHtml(defaultValue)}" />
      <div class="modal-error" role="alert"></div>
      <div class="modal-actions">
        <button data-prompt-choice="ok">OK</button>
        <button data-prompt-choice="cancel">Cancel</button>
      </div>
    </div>`;
  document.body.append(backdrop);
  const input = backdrop.querySelector("input");
  const error = backdrop.querySelector(".modal-error");
  input.focus();
  input.select();
  return new Promise((resolve) => {
    const finish = (value) => {
      backdrop.remove();
      els.host.focus();
      resolve(value);
    };
    const submit = () => {
      const result = validate(input.value);
      if (result?.error) {
        error.textContent = result.error;
        input.focus();
        input.select();
        return;
      }
      finish(result?.value ?? input.value);
    };
    backdrop.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-prompt-choice]")?.dataset.promptChoice;
      if (choice === "ok") submit();
      if (choice === "cancel") finish(null);
    });
    input.addEventListener("input", () => {
      error.textContent = "";
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    });
  });
}

function toggleFreeze(kind) {
  if (!hasOpenDocument()) return;
  if (kind === "row") state.freezeRow = !state.freezeRow;
  if (kind === "column") state.freezeColumn = !state.freezeColumn;
  localStorage.setItem("txteditor.freeze", JSON.stringify({ row: state.freezeRow, column: state.freezeColumn }));
  applyFreezeToDoc(activeDoc());
  grid.layout();
  renderChrome();
}

function unhideAll() {
  const doc = activeDoc();
  const rows = [...doc.hiddenRows];
  const columns = [...doc.hiddenColumns];
  if (!rows.length && !columns.length) return;
  const commands = [
    rows.length ? hiddenRowsCommand(rows, false) : null,
    columns.length ? hiddenColumnsCommand(columns, false) : null
  ].filter(Boolean);
  const command = makeCustomCommand("Unhide All", {
    redo(target) {
      for (const item of commands) item.redo(target);
    },
    undo(target) {
      for (let i = commands.length - 1; i >= 0; i--) commands[i].undo(target);
    }
  });
  execute(command);
}

function zoomBy(delta) {
  if (!hasOpenDocument()) return;
  grid.setZoom(activeDoc().zoom + delta);
  renderChrome();
}

function zoomReset() {
  if (!hasOpenDocument()) return;
  grid.setZoom(1);
  renderChrome();
}

function resetRowHeights() {
  if (!hasOpenDocument()) return;
  activeDoc().resetRowHeights();
  grid.layout();
  renderChrome();
}

function toggleTheme() {
  return settingsController.toggleTheme();
}

function toggleColorize() {
  return settingsController.toggleColorize();
}

function toggleVectorLspHover() {
  return settingsController.toggleVectorLspHover();
}

function setLintEngine(engine) {
  return settingsController.setLintEngine(engine);
}

function invalidateLspHover(clearCache = false, reason = "hover-invalidated") {
  return lspController.invalidateHover(clearCache, reason);
}

function clearVisibleLspHover(reason = "hover-cleared") {
  return lspController.clearVisibleHover(reason);
}

function setLintDiagnostics(diagnostics) {
  return diagnosticsController.setLintDiagnostics(diagnostics);
}

function toggleLint() {
  return settingsController.toggleLint();
}

function toggleLintRules() {
  return settingsController.toggleLintRules();
}

function setLegacyLintProfile(profile) {
  return settingsController.setLegacyLintProfile(profile);
}

function setLegacyLintRuleEnabled(ruleId, enabled) {
  return settingsController.setLegacyLintRuleEnabled(ruleId, enabled);
}

function switchBottomTab(tab) {
  state.bottomTab = tab;
  renderChrome();
  if (tab === "log" && els.logList) {
    els.logList.innerHTML = state.lspLogs
      .map((msg) => `<div class="log-entry">${escapeHtml(msg)}</div>`)
      .join("");
    els.logList.scrollTop = els.logList.scrollHeight;
  }
}

function reportStartupFailure(label, error) {
  return lspController.reportStartupFailure(label, error);
}

function reportBackgroundFailure(label, error, context) {
  return lspController.reportBackgroundFailure(label, error, context);
}

function reportWindowCloseFailure(error, context) {
  return lspController.reportWindowCloseFailure(error, context);
}

async function lspStartWorkspace(workspacePath) {
  return lspController.startWorkspace(workspacePath);
}

async function syncOpenDocsToVectorLsp() {
  return lspController.syncOpenDocs();
}

async function lspOpenDoc(doc) {
  return lspController.openDoc(doc);
}

function reportLspOpenFailure(doc, error, context) {
  return lspController.reportOpenFailure(doc, error, context);
}

async function lspUpdateDoc(doc, changedRows = null) {
  return lspController.updateDoc(doc, changedRows);
}

function handleLspUpdateError(doc, error, context) {
  return lspController.handleUpdateError(doc, error, context);
}

async function lspCloseDoc(doc) {
  return lspController.closeDoc(doc);
}

function reportLspCloseFailure(doc, error, context) {
  return lspController.reportCloseFailure(doc, error, context);
}

function reportHoverDispatchFailure(row, column, error, context) {
  return lspController.reportHoverDispatchFailure(row, column, error, context);
}

function scheduleHoverPrewarm(reason = "schedule") {
  return lspController.scheduleHoverPrewarm(reason);
}

function updateGridDiagnostics() {
  return diagnosticsController.updateGridDiagnostics();
}

function docDiagnosticSeverity(_doc) {
  return diagnosticsController.docDiagnosticSeverity(_doc);
}

function updateOverviewRuler() {
  return diagnosticsController.updateOverviewRuler();
}

function applyFreezeToDoc(doc) {
  doc.freezeFirstRow = state.freezeRow;
  doc.freezeFirstColumn = state.freezeColumn;
}

function scrollProblemsToActiveFile() {
  return diagnosticsController.scrollProblemsToActiveFile();
}

function cellHasReference(row, col) {
  return lspController.cellHasReference(row, col);
}

async function goToDefinition() {
  return lspController.goToDefinition();
}

function docHasDiagnostics(doc) {
  return diagnosticsController.docHasDiagnostics(doc);
}

async function loadConfig() {
  return settingsController.loadConfig();
}

function showAppSettings() {
  return settingsController.showAppSettings();
}

async function showSettings() {
  return settingsController.showSettings();
}

function resizeFit(useSelection) {
  const doc = activeDoc();
  const rect = state.selection.rect;
  const hit = state.contextHit;
  if (isFullRowSelection(rect, doc) || hit?.kind === "row-header") {
    const rows = useSelection ? rowsFromSelection() : [hit?.row ?? state.selection.focus.row];
    return autoFitRows(rows);
  }
  if (isFullColumnSelection(rect, doc) || hit?.row === 0 || hit?.kind === "column-header") {
    const columns = useSelection ? columnsFromSelection() : [hit?.column ?? state.selection.focus.column];
    return autoFitColumns(columns);
  }
  return autoFitColumns(useSelection ? columnsFromSelection() : [state.selection.focus.column]);
}

async function autoFitColumns(columns) {
  const doc = activeDoc();
  const targets = [...new Set(columns)].filter((column) => column >= 0 && column < doc.columnCount && !doc.hiddenColumns.has(column));
  if (!targets.length) return;
  const wasDirty = doc.dirty;
  const widths = await Promise.all(targets.map((col) => grid.measureColumnFitWidth(col, { yieldEvery: 0 })));
  targets.forEach((col, i) => doc.setColumnWidth(col, widths[i]));
  doc.dirty = wasDirty;
  grid.layout();
  renderChrome();
}

function autoFitRows(rows) {
  const doc = activeDoc();
  const targets = [...new Set(rows)].filter((row) => row >= 0 && row < doc.rowCount && !doc.hiddenRows.has(row));
  const wasDirty = doc.dirty;
  for (const row of targets) doc.setRowHeight(row, doc.defaultRowHeight);
  doc.dirty = wasDirty;
  grid.layout();
  renderChrome();
}

function cloneRows() {
  const doc = activeDoc();
  const rows = rowsForContextOperation().filter((row) => row > 0 && row < doc.rowCount);
  if (!rows.length) return showError("Select one or more body rows to clone.");
  const insertAt = clamp(Math.max(...rows) + 1, 1, doc.rowCount);
  execute(cloneRowsCommand(doc, rows, insertAt));
  const column = clamp(state.selection.focus.column, 0, Math.max(0, doc.columnCount - 1));
  state.selection.setRange(insertAt, 0, insertAt + rows.length - 1, doc.columnCount - 1, { row: insertAt, column });
  grid.scrollCellIntoView(insertAt, column);
  grid.draw();
  renderChrome();
}

function commitResize(resize) {
  if (!resize || resize.before === resize.current) return;
  renderChrome();
}

function showPalette() {
  return commandSurfaceController.showPalette();
}

function renderPalette() {
  return commandSurfaceController.renderPalette();
}

function showContextMenu(args) {
  return commandSurfaceController.showContextMenu(args);
}

function positionContextMenu() {
  return commandSurfaceController.positionContextMenu();
}

function hideContextMenu() {
  return commandSurfaceController.hideContextMenu();
}

function renderLintControls() {
  return settingsController.renderLintControls();
}

function renderChrome() {
  return shellController.renderChrome();
}

function renderProblemsPanelIfNeeded() {
  return diagnosticsController.renderProblemsPanelIfNeeded();
}

function updateActiveProblemHighlight({ scroll = false } = {}) {
  return diagnosticsController.updateActiveProblemHighlight({ scroll });
}

function lintSummaryText() {
  return diagnosticsController.lintSummaryText();
}

function problemBadgeForPath(path) {
  return diagnosticsController.problemBadgeForPath(path);
}

function lintNotificationCount() {
  return diagnosticsController.lintNotificationCount();
}

async function closeTab(index) {
  return documentController.closeTab(index);
}

function rowsFromSelection() {
  return sortedUnique(state.selection.ranges.flatMap((rect) => range(rect.top, rect.bottom)));
}

function rowsForContextOperation() {
  const hit = state.contextHit;
  const doc = activeDoc();
  if (hit?.kind === "row-header" && !state.selection.hasFullRow(hit.row, doc.columnCount)) return [hit.row];
  return rowsFromSelection();
}

function columnsFromSelection() {
  return sortedUnique(state.selection.ranges.flatMap((rect) => range(rect.left, rect.right)));
}

function isFullRowSelection(rect, doc) {
  return state.selection.ranges.some((range) => range.left === 0 && range.right >= doc.columnCount - 1);
}

function isFullColumnSelection(rect, doc) {
  return state.selection.ranges.some((range) => range.top === 0 && range.bottom >= doc.rowCount - 1);
}

function range(start, end) {
  const values = [];
  for (let value = start; value <= end; value++) values.push(value);
  return values;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function lintDocKey(doc) {
  return lintPathKey(doc?.path || doc?.name || "");
}

function lintPathKey(path) {
  return String(path || "").replace(/\\/g, "/").toLowerCase();
}
