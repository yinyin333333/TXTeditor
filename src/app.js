import { TableDocument, clamp } from "./core/table-model.js";
import { isTableDocument } from "./core/document-file-state.js";
import { canNavigateLocalizationJsonDiagnostic } from "./core/json-document-policy.js";
import { makeCellCommand } from "./core/undo.js";
import { resetUndoManagerForDocument } from "./core/document-undo-state.js";
import {
  isTauriRuntime,
  listenForNativeDrops,
  startupOpenPathsNative
} from "./core/io.js";
import { exposeTxteditorPerf } from "./core/perf-instrumentation.js";
import { normalizePath as lintPathKey } from "./core/lint-paths.js";
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
import { createDocumentEditorController } from "./ui/controllers/document-editor-controller.js";
import { createDocumentController } from "./ui/controllers/document-controller.js";
import { createDockController } from "./ui/controllers/dock-controller.js";
import { createAppEventController } from "./ui/controllers/app-event-controller.js";
import { createEditCommandController } from "./ui/controllers/edit-command-controller.js";
import { createGridCommandController } from "./ui/controllers/grid-command-controller.js";
import { createLegacyLintController } from "./ui/controllers/legacy-lint-controller.js";
import { createLspController } from "./ui/controllers/lsp-controller.js";
import { createJsonEditorController } from "./ui/controllers/json-editor-controller.js";
import { createSearchController } from "./ui/controllers/search-controller.js";
import { createSettingsController } from "./ui/controllers/settings-controller.js";
import { createShortcutSettingsController } from "./ui/controllers/shortcut-settings-controller.js";
import { createShellController } from "./ui/controllers/shell-controller.js";
import { createLocaleController, initializeLocale } from "./ui/controllers/locale-controller.js";
import { t, tText } from "./core/i18n.js";
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
initializeLocale({ state, storage: localStorage, ownerDocument: document });
document.documentElement.style.setProperty("--grid-font", savedGridFont);
document.documentElement.style.setProperty("--sidebar-width", `${savedPanelState.sidebarWidth}px`);
document.documentElement.style.setProperty("--problems-height", `${savedPanelState.problemsHeight}px`);
const els = collectAppElements(document);
const { showError, showToast } = createToastFeedback(els);
let documentController = null, documentEditorController = null, lspController = null;
const jsonEditorController = createJsonEditorController({
  gridHost: els.host,
  jsonHost: els.jsonHost,
  onDocumentChanged: (doc, changeMeta = {}) => {
    renderChrome(); lspController?.updateDoc(doc, { kind: "json", changes: changeMeta.changes })
      .catch((error) => handleLspUpdateError(doc, error, "json-edit"));
  },
  onLoadError: showError
});
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
  activateDocument,
  openJsonDocumentPath: (...args) => documentController?.openJsonDocumentPath(...args),
  navigateJsonDiagnostic: (doc, diagnostic) => jsonEditorController.navigateToDiagnostic(doc, diagnostic),
  focusActiveEditor,
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

documentEditorController = createDocumentEditorController({
  grid,
  gridHost: els.host,
  jsonEditorController,
  selection: state.selection,
  applyFreezeToDoc
});

grid.setFontFamily(state.gridFont);
grid.setColorizeColumns(state.colorizeColumns);
grid.setMouseResizeLocked(state.mouseResizeLocked);
grid.setVectorLspHoverEnabled(effectiveVectorLspHoverEnabled());
gridCommandController = createGridCommandController({
  state,
  grid,
  activeDoc,
  hasOpenDocument,
  activeDocumentKind: () => activeDoc()?.kind ?? "table",
  execute,
  saveSelectionState,
  renderChrome,
  showError,
  promptNumber,
  applyFreezeToDoc,
  rowsForContextOperation,
  columnsFromSelection
});
const { toggleFreeze, unhideAll, zoomBy, zoomReset, resetRowHeights, goToRow, resizeFit, cloneRows, cloneColumns } = gridCommandController;
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
  renderDiagnosticsChrome,
  addDocument,
  applyFreezeToDoc,
  updateActiveProblemHighlight,
  saveSelectionState,
  lintPathKey,
  canNavigateJsonDiagnostic: ({ filePath, generation, sourceExists }) =>
    canNavigateLocalizationJsonDiagnostic({
      diagnostic: { filePath, generation, sourceExists },
      state,
      editorReady: jsonEditorController.available(),
      desktop: isTauriRuntime()
    }),
  handleWatchedFilesChanged: (payload) => documentController?.handleWatchedFilesChanged(payload)
});
const localeController = createLocaleController({ state, storage: localStorage, ownerDocument: document, legacyActive: isLegacyLintEngine, scheduleLegacyLintFull, lspController, activeDoc, setLintDiagnostics, updateGridDiagnostics, renderChrome, refreshJsonEditorLocale: jsonEditorController.refreshLocale });
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
  stopVectorSession: (reason) => lspController.stopSession(reason),
  ensureDocumentSession: (options) => lspController.ensureStandaloneSession(activeDoc(), options),
  resetLegacyWorkspaceIndex,
  refreshJsonEditorAppearance: jsonEditorController.refreshAppearance,
  recordLintEngineEvent,
  renderChrome,
  reportBackgroundFailure,
  showError,
  t,
  setLocale: localeController.setLocale,
  escapeHtml
});
const shortcutSettingsController = createShortcutSettingsController({
  state,
  els,
  storage: localStorage,
  showToast,
  escapeHtml
});
documentController = createDocumentController({
  state,
  els,
  grid,
  emptyDoc: EMPTY_DOC,
  activeDoc,
  activateDocument,
  commitActiveEditor,
  focusActiveEditor,
  jsonEditorController,
  saveSelectionState,
  applyFreezeToDoc,
  renderChrome,
  showError,
  showToast,
  reportWindowCloseFailure,
  lspOpenDoc, lspUpdateDoc,
  reportLspOpenFailure,
  lspCloseDoc,
  handleLspUpdateError,
  reportLspCloseFailure,
  lspRebindSavedDoc: (doc, previousUri) => lspController.rebindSavedDoc(doc, previousUri),
  lspStartWorkspace, lspStopSession: (reason) => lspController.stopSession(reason),
  ensureDocumentSession: lspController.ensureStandaloneSession,
  scheduleHoverPrewarm,
  resetUndoManagerForDocument,
  resetLegacyWorkspaceIndex,
  scheduleLegacyLintForOpen,
  scheduleLegacyLintFull,
  cancelLegacyLintJobs,
  isVectorLintEngine,
  isLegacyLintEngine,
  setLintDiagnostics, updateGridDiagnostics,
  resetWorkspaceView: () => shellController?.resetWorkspaceView(),
  scrollProblemsToActiveFile
});
const searchController = createSearchController({
  state,
  els,
  grid,
  activeDoc,
  updateActiveProblemHighlight,
  saveSelectionState,
  applyEdits,
  jsonSearch: jsonEditorController,
  focusActiveEditor
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
  selectAll: selectAllTable,
  addRows,
  insertRows,
  addColumns,
  insertColumns,
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
    openFolder: documentController.openFolder, closeAll: documentController.closeAll,
    saveFile: documentController.saveFile,
    saveAs: documentController.saveAs,
    undo,
    redo,
    showSearch: searchController.showSearch,
    findNext: searchController.findNext,
    findPrevious: searchController.findPrevious,
    showReplace: searchController.showReplace,
    goToRow,
    nextTab: () => shellController?.switchTab(1),
    previousTab: () => shellController?.switchTab(-1),
    copySelection,
    pasteSelection,
    cutSelection,
    selectAll,
    addRows,
    insertRows,
    cloneRows, cloneColumns,
    addColumns,
    insertColumns,
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
    showShortcutSettings: shortcutSettingsController.showShortcutSettings,
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
  activateDocument,
  focusActiveEditor,
  closeTab: documentController.closeTab,
  openDroppedNativePaths,
  updateGridDiagnostics,
  renderProblemsPanelIfNeeded,
  scrollProblemsToActiveFile,
  docDiagnosticSeverity,
  lintSummaryText,
  problemBadgeForPath,
  problemBadgeCountForPath,
  lintNotificationCount,
  renderLintControls,
  syncDockLayout,
  syncProblemsHeaderLayout,
  scheduleHoverPrewarm,
  ensureDocumentSession: lspController.ensureStandaloneSession, commitActiveEditor,
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
  hasOpenDocument,
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
  pasteSelection,
  selectAll,
  jsonEditorOwnsTarget: jsonEditorController.editorOwnsTarget,
  handleExternalChangeDialogClick: documentController.handleExternalChangeDialogClick,
  commitActiveEditor,
  focusActiveEditor
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
startupOpenPathsNative()
  .then((paths) => openDroppedNativePaths(paths))
  .catch(showError);

function activeDoc() { return state.docs[state.active] ?? EMPTY_DOC; }

function activateDocument(doc = activeDoc(), options) { return documentEditorController.activateDocument(doc, options); }
function commitActiveEditor() { documentEditorController.commitDocument(activeDoc()); }
function focusActiveEditor() { documentEditorController.focusDocument(activeDoc()); }

function hasOpenDocument() { return state.docs.length > 0 && state.active >= 0; }

function saveSelectionState(doc = activeDoc()) { if (hasOpenDocument() && doc !== EMPTY_DOC) documentEditorController.saveViewState(doc); }

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
  return effectiveVectorLspHover({ engine: state.lint.engine, lintEnabled: state.lint.enabled, vectorLspHover: state.vectorLspHover });
}

function execute(command) {
  if (!hasOpenDocument()) return showError(tText("error.openDocument"));
  if (!isTableDocument(activeDoc())) return showError(tText("error.tableOnly"));
  if (!command || command.isEmpty) return;
  const started = perfNow();
  const doc = activeDoc();
  command.redo(doc);
  documentEditorController.pushTableCommand(doc, command);
  finishCommand(doc, command, "edit", started);
}

function finishCommand(doc, command, context = "edit", started = perfNow()) {
  if (!isTableDocument(doc)) return;
  const contentChanged = command.contentChanged !== false;
  if (contentChanged) markLegacyLintDocChanged(doc);
  keepSelectionOnVisibleRow({ doc, selection: state.selection, clamp });
  saveSelectionState(doc);
  grid.layout();
  const lspChange = context === "undo" ? command.undoLspChange ?? command.lspChange : command.lspChange;
  const syncRoute = documentChangeSyncRoute(state.lint.engine, state.lint.enabled);
  if (contentChanged && syncRoute === "vector-update") {
    lspUpdateDoc(doc, lspChange).catch((error) => handleLspUpdateError(doc, error, context));
  } else if (contentChanged && syncRoute === "legacy-lint-edit" && !doc.largeFileMode) {
    scheduleLegacyLintForEdit(doc);
  }
  recordUiPerf("row-command", started, { changedRows: Array.isArray(lspChange) ? lspChange.length : lspChange?.rows?.length ?? 0, contentChanged });
  renderChrome();
}

function applyEdits(edits, label = "Edit Cells") {
  execute(makeCellCommand(label, activeDoc(), edits));
}

async function wireCloseHandler() { return documentController.wireCloseHandler(); }
async function addDocument(doc, options = {}) { return documentController.addDocument(doc, options); }
async function openDroppedNativePaths(paths, options = {}) { return documentController.openDroppedNativePaths(paths, options); }

function undo() {
  const doc = activeDoc();
  const command = documentEditorController.undoDocument(doc);
  if (command) finishCommand(doc, command, "undo");
}

function redo() {
  const doc = activeDoc();
  const command = documentEditorController.redoDocument(doc);
  if (command) finishCommand(doc, command, "redo");
}

function selectAll() {
  return documentEditorController.selectAllDocument(activeDoc(), selectAllTable);
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

async function lspStartWorkspace(workspacePath, options) {
  return lspController.startWorkspace(workspacePath, options);
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

async function lspCloseDoc(doc, options) {
  return lspController.closeDoc(doc, options);
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

function updateGridDiagnostics(options) {
  jsonEditorController.reconcileDiagnosticHighlight(state.lint.diagnostics);
  return diagnosticsController.updateGridDiagnostics(options);
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

function renderPalette() { return commandSurfaceController.renderPalette(); }
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
function renderDiagnosticsChrome() {
  return shellController.renderDiagnosticsChrome();
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

function problemBadgeCountForPath(path) {
  return diagnosticsController.problemBadgeCountForPath(path);
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
