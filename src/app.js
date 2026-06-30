import { TableDocument, clamp } from "./core/table-model.js";
import { makeCellCommand } from "./core/undo.js";
import { resetUndoManagerForDocument, undoManagerForDocument } from "./core/document-undo-state.js";
import {
  listenForNativeDrops
} from "./core/io.js";
import {
  exposeTxteditorPerf
} from "./core/perf-instrumentation.js";
import {
  documentChangeSyncRoute,
  effectiveVectorLspHover,
  isLegacyLintEngineValue,
  isVectorLintEngineValue,
  legacyLintImmediateSchedule
} from "./core/lint-controller-policy.js";
import { CanvasGrid } from "./ui/canvas-grid.js";
import {
  columnRangesFromRanges,
  columnsFromRanges,
  keepSelectionVisible as keepSelectionOnVisibleRow,
  rowOperationTargetRanges,
  rowsFromRanges
} from "./ui/row-operation-policy.js";
import {
  createToastFeedback,
  escapeHtml
} from "./ui/app-runtime-utils.js";
import { createInitialAppState } from "./ui/app-startup-state.js";
import { collectAppElements } from "./ui/app-elements.js";
import { createAppPerf } from "./ui/app-perf.js";
import {
  askText as askPromptText,
  promptNumber as promptForNumber
} from "./ui/prompt-dialog.js";
import { createCommandController } from "./ui/controllers/command-controller.js";
import { createCommandSurfaceController } from "./ui/controllers/command-surface-controller.js";
import { createDiagnosticsController } from "./ui/controllers/diagnostics-controller.js";
import { createDocumentController } from "./ui/controllers/document-controller.js";
import { createDockController } from "./ui/controllers/dock-controller.js";
import { createAppEventController } from "./ui/controllers/app-event-controller.js";
import { createEditCommandController } from "./ui/controllers/edit-command-controller.js";
import { createGridCommandController } from "./ui/controllers/grid-command-controller.js";
import { createLegacyLintController } from "./ui/controllers/legacy-lint-controller.js";
import { createLspController } from "./ui/controllers/lsp-controller.js";
import { createSearchController } from "./ui/controllers/search-controller.js";
import { createSettingsController } from "./ui/controllers/settings-controller.js";
import { createShellController } from "./ui/controllers/shell-controller.js";
const { state, savedTheme, savedGridFont, savedPanelState } = createInitialAppState({ storage: localStorage });
const {
  uiPerfSamples,
  lintEngineEvents,
  perfNow,
  elapsedMs,
  recordUiPerf,
  recordLintEngineEvent
} = createAppPerf({ state });
document.documentElement.dataset.theme = savedTheme;
document.documentElement.style.setProperty("--grid-font", savedGridFont);
document.documentElement.style.setProperty("--sidebar-width", `${savedPanelState.sidebarWidth}px`);
document.documentElement.style.setProperty("--problems-height", `${savedPanelState.problemsHeight}px`);

const els = collectAppElements(document);
const { showError, showToast } = createToastFeedback(els);
const askText = (options) => askPromptText({ ...options, escapeHtml, host: els.host });
const promptNumber = (options) => promptForNumber({ ...options, askText });

const isDevelopmentMode = ["localhost", "127.0.0.1", ""].includes(location.hostname);

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
  saveSelectionState,
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
let gridCommandController = null;
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
  onResizeCommand: (resize) => gridCommandController.commitResize(resize),
  onAutoFitColumn: (column) => gridCommandController.autoFitColumns([column]).catch(showError),
  onHoverRequest: (row, column, meta) => lspController.requestHover(row, column, meta).catch((error) => lspController.reportHoverDispatchFailure(row, column, error, "grid-hover-request")),
  onHoverInvalidated: () => lspController.clearVisibleHover("grid-hover-cleared"),
  onViewportChanged: (reason) => lspController.scheduleHoverPrewarm(reason),
  onSelectionChanged: () => {
    saveSelectionState();
    diagnosticsController.handleSelectionChanged();
  }
});

grid.setFontFamily(state.gridFont);
grid.setColorizeColumns(state.colorizeColumns);
grid.setVectorLspHoverEnabled(effectiveVectorLspHoverEnabled());
gridCommandController = createGridCommandController({
  state,
  grid,
  activeDoc,
  hasOpenDocument,
  execute,
  saveSelectionState,
  renderChrome,
  showError,
  applyFreezeToDoc,
  rowsForContextOperation,
  columnsFromSelection
});
const {
  toggleFreeze,
  unhideAll,
  zoomBy,
  zoomReset,
  resetRowHeights,
  resizeFit,
  cloneRows
} = gridCommandController;
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
  saveSelectionState,
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
const searchController = createSearchController({
  state,
  els,
  grid,
  activeDoc,
  updateActiveProblemHighlight,
  saveSelectionState
});
const editCommandController = createEditCommandController({
  state,
  grid,
  activeDoc,
  hasOpenDocument,
  execute,
  saveSelectionState,
  promptNumber,
  showError
});
const {
  copySelection,
  cutSelection,
  pasteSelection,
  selectAll,
  addRows,
  addColumns,
  math
} = editCommandController;
const commandController = createCommandController({
  isDevelopmentMode,
  state,
  activeDoc,
  hasOpenDocument,
  execute,
  rowsFromSelection,
  rowsForRowOperation,
  columnsFromSelection,
  columnsForColumnOperation,
  showError,
  handlers: {
    openFile: documentController.openFile,
    openFolder: documentController.openFolder,
    saveFile: documentController.saveFile,
    saveAs: documentController.saveAs,
    undo,
    redo,
    showSearch: searchController.showSearch,
    findNext: searchController.findNext,
    copySelection,
    pasteSelection,
    cutSelection,
    selectAll,
    addRows,
    cloneRows,
    addColumns,
    unhideAll,
    toggleColorize: settingsController.toggleColorize,
    toggleVectorLspHover: settingsController.toggleVectorLspHover,
    toggleLint: settingsController.toggleLint,
    toggleLintRules: settingsController.toggleLintRules,
    toggleExplorerPane,
    toggleProblemsPanel,
    resetRowHeights,
    toggleSidebar,
    toggleTheme: settingsController.toggleTheme,
    showAppSettings: settingsController.showAppSettings,
    showSettings: settingsController.showSettings,
    goToDefinition: lspController.goToDefinition,
    loadFixture: documentController.loadFixture,
    math,
    toggleFreeze,
    zoomBy,
    zoomReset,
    resizeFit
  }
});
const { commandLabels, commands } = commandController;
const commandSurfaceController = createCommandSurfaceController({
  state,
  els,
  grid,
  commandLabels,
  runCommand: commandController.runCommand,
  activeDoc,
  rowsForContextOperation,
  cellHasReference,
  clearVisibleLspHover,
  showError,
  escapeHtml
});
shellController = createShellController({
  state,
  els,
  grid,
  activeDoc,
  hasOpenDocument,
  applyFreezeToDoc,
  closeTab: documentController.closeTab,
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
  saveSelectionState,
  recordUiPerf,
  perfNow,
  showError,
  lintPathKey,
  escapeHtml
});
const eventController = createAppEventController({
  state,
  els,
  grid,
  commands,
  documentController,
  searchController,
  syncDockLayout,
  wirePaneResizers,
  positionContextMenu,
  updateOverviewRuler,
  renderPalette,
  runCommand: commandController.runCommand,
  switchBottomTab,
  showError,
  hideContextMenu,
  closeTab: documentController.closeTab,
  openFile: documentController.openFile,
  toggleSidebar,
  toggleProblemsPanel,
  resetRowHeights,
  saveAs: documentController.saveAs,
  saveFile: documentController.saveFile,
  redo,
  undo,
  showPalette,
  copySelection,
  cutSelection,
  pasteSelection
});
renderChrome();
eventController.wireEvents();
wireCloseHandler().catch((error) => reportStartupFailure("Window close handler", error));
settingsController.loadConfig().catch((error) => {
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

function saveSelectionState(doc = activeDoc()) {
  if (!hasOpenDocument() || doc === EMPTY_DOC || typeof state.selection.snapshot !== "function") return;
  doc.selectionState = state.selection.snapshot();
}

function activeUndo() {
  return undoManagerForDocument(activeDoc());
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

function execute(command) {
  if (!hasOpenDocument()) return showError("Open a file before editing.");
  if (!command || command.isEmpty) return;
  const started = perfNow();
  const doc = activeDoc();
  command.redo(doc);
  activeUndo().push(command);
  finishCommand(doc, command, "edit", started);
}

function finishCommand(doc, command, context = "edit", started = perfNow()) {
  const contentChanged = command.contentChanged !== false;
  if (contentChanged) markLegacyLintDocChanged(doc);
  keepSelectionOnVisibleRow({ doc, selection: state.selection, clamp });
  saveSelectionState(doc);
  grid.layout();
  const lspChange = context === "undo" ? command.undoLspChange ?? command.lspChange : command.lspChange;
  if (contentChanged && documentChangeSyncRoute(state.lint.engine) === "vector-update") {
    lspUpdateDoc(doc, lspChange).catch((error) => handleLspUpdateError(doc, error, context));
  } else if (contentChanged && !doc.largeFileMode) {
    scheduleLegacyLintForEdit(doc);
  }
  recordUiPerf("row-command", started, { changedRows: Array.isArray(lspChange) ? lspChange.length : lspChange?.rows?.length ?? 0, contentChanged });
  renderChrome();
}

function applyEdits(edits, label = "Edit Cells") {
  execute(makeCellCommand(label, activeDoc(), edits));
}

async function wireCloseHandler() {
  return documentController.wireCloseHandler();
}

async function addDocument(doc) {
  return documentController.addDocument(doc);
}

async function openDroppedNativePaths(paths) {
  return documentController.openDroppedNativePaths(paths);
}

function undo() {
  const doc = activeDoc();
  const command = activeUndo().undo(doc);
  if (command) finishCommand(doc, command, "undo");
}

function redo() {
  const doc = activeDoc();
  const command = activeUndo().redo(doc);
  if (command) finishCommand(doc, command, "redo");
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

function docHasDiagnostics(doc) {
  return diagnosticsController.docHasDiagnostics(doc);
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

function rowsFromSelection() {
  return rowsFromRanges(state.selection.ranges);
}

function rowsForContextOperation() {
  const hit = state.contextHit;
  const doc = activeDoc();
  if (hit?.kind === "row-header" && !state.selection.hasFullRow(hit.row, doc.columnCount)) return [hit.row];
  return rowsFromSelection();
}

function rowsForRowOperation() {
  const doc = activeDoc();
  return rowOperationTargetRanges({
    selection: state.selection,
    contextHit: state.contextMenuOpen ? state.contextHit : null,
    rowCount: doc.rowCount,
    columnCount: doc.columnCount
  });
}

function columnsFromSelection() {
  return columnsFromRanges(state.selection.ranges);
}

function columnsForColumnOperation() { return columnRangesFromRanges(state.selection.ranges, activeDoc().columnCount); }

function lintDocKey(doc) {
  return lintPathKey(doc?.path || doc?.name || "");
}

function lintPathKey(path) {
  return String(path || "").replace(/\\/g, "/").toLowerCase();
}
