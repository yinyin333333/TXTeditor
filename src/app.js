import { TableDocument, clamp } from "./core/table-model.js";
import { SelectionModel } from "./core/selection.js";
import { UndoManager, makeCellCommand, makeCustomCommand } from "./core/undo.js";
import { findInTable } from "./core/search.js";
import {
  addColumnsCommand,
  addRowsCommand,
  arithmeticRangesCommand,
  arithmeticCommand,
  clearRangeCommand,
  clearRangesCommand,
  cloneRowsCommand,
  copyRange,
  copyRanges,
  deleteColumnsCommand,
  deleteRowsCommand,
  fillSelectedCellsCommand,
  hiddenColumnsCommand,
  hiddenRowsCommand,
  incrementFillSelectedCellsCommand,
  incrementFillRangesCommand,
  incrementFillCommand,
  insertColumnCommand,
  insertRowCommand,
  pasteTextToRangesCommand,
  pasteTextCommand,
  resizeColumnCommand,
  resizeRowCommand
} from "./core/operations.js";
import {
  closeWindow,
  downloadText,
  getConfig,
  isTauriRuntime,
  listenForNativeDrops,
  lspCloseFile,
  lspHover,
  lspDefinition,
  lspListen,
  lspLogListen,
  lspOpenFile,
  lspStart,
  lspStop,
  lspUpdateFile,
  openFilesNative,
  openNativePaths,
  openWorkspaceNative,
  pickFilePath,
  pickFolderPath,
  readFileAsDocument,
  saveConfig,
  saveDocumentNative
} from "./core/io.js";
import { groupDiagnosticsByCell } from "./core/diagnostics.js";
import { CanvasGrid } from "./ui/canvas-grid.js";

const DEFAULT_GRID_FONT = "'Cascadia Mono', Consolas, 'Segoe UI Mono', monospace";
const FONT_OPTIONS = [
  ["Cascadia Mono", "'Cascadia Mono', Consolas, 'Segoe UI Mono', monospace"],
  ["Cascadia Code", "'Cascadia Code', 'Cascadia Mono', Consolas, monospace"],
  ["Consolas", "Consolas, 'Cascadia Mono', monospace"],
  ["Segoe UI Mono", "'Segoe UI Mono', Consolas, monospace"],
  ["JetBrains Mono", "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"],
  ["Fira Code", "'Fira Code', 'Cascadia Code', Consolas, monospace"],
  ["Roboto Mono", "'Roboto Mono', Consolas, monospace"],
  ["Noto Sans Mono", "'Noto Sans Mono', Consolas, monospace"],
  ["Lucida Console", "'Lucida Console', Consolas, monospace"],
  ["Lucida Sans Typewriter", "'Lucida Sans Typewriter', 'Lucida Console', monospace"],
  ["Courier New", "'Courier New', Consolas, monospace"],
  ["Arial", "Arial, 'Segoe UI', sans-serif"],
  ["Arial Black", "'Arial Black', Arial, sans-serif"],
  ["Arial Narrow", "'Arial Narrow', Arial, sans-serif"],
  ["Aptos", "Aptos, Calibri, 'Segoe UI', sans-serif"],
  ["Aptos Mono", "'Aptos Mono', 'Cascadia Mono', Consolas, monospace"],
  ["Bahnschrift", "Bahnschrift, 'Segoe UI', sans-serif"],
  ["Book Antiqua", "'Book Antiqua', Palatino, serif"],
  ["Bookman Old Style", "'Bookman Old Style', Georgia, serif"],
  ["Calibri", "Calibri, Aptos, 'Segoe UI', sans-serif"],
  ["Cambria", "Cambria, Georgia, serif"],
  ["Candara", "Candara, Calibri, 'Segoe UI', sans-serif"],
  ["Century Gothic", "'Century Gothic', Arial, sans-serif"],
  ["Corbel", "Corbel, Calibri, 'Segoe UI', sans-serif"],
  ["Franklin Gothic Medium", "'Franklin Gothic Medium', Arial, sans-serif"],
  ["Georgia", "Georgia, Cambria, serif"],
  ["Lucida Sans Unicode", "'Lucida Sans Unicode', 'Lucida Grande', sans-serif"],
  ["Microsoft Sans Serif", "'Microsoft Sans Serif', 'Segoe UI', sans-serif"],
  ["Segoe UI", "'Segoe UI', Arial, sans-serif"],
  ["Segoe UI Variable", "'Segoe UI Variable', 'Segoe UI', Arial, sans-serif"],
  ["Segoe UI Semibold", "'Segoe UI Semibold', 'Segoe UI', Arial, sans-serif"],
  ["Tahoma", "Tahoma, 'Segoe UI', sans-serif"],
  ["Times New Roman", "'Times New Roman', Cambria, serif"],
  ["Trebuchet MS", "'Trebuchet MS', Arial, sans-serif"],
  ["Verdana", "Verdana, 'Segoe UI', sans-serif"],
  ["Yu Gothic UI", "'Yu Gothic UI', 'Segoe UI', sans-serif"],
  ["Malgun Gothic", "'Malgun Gothic', 'Segoe UI', sans-serif"],
  ["Microsoft YaHei UI", "'Microsoft YaHei UI', 'Segoe UI', sans-serif"],
  ["Microsoft JhengHei UI", "'Microsoft JhengHei UI', 'Segoe UI', sans-serif"],
  ["Meiryo", "Meiryo, 'Segoe UI', sans-serif"],
  ["MS Gothic", "'MS Gothic', monospace"],
  ["MS Mincho", "'MS Mincho', serif"]
];
const savedTheme = localStorage.getItem("txteditor.theme") === "light" ? "light" : "dark";
const savedGridFont = normaliseGridFont(localStorage.getItem("txteditor.gridFont"));
const savedColorize = localStorage.getItem("txteditor.colorize") === "on";
const savedVectorLspHover = localStorage.getItem("txteditor.vectorLspHover") === "on";
const savedLintEnabled = readJsonStorage("txteditor.lint.settings", {}).enabled !== false;
const MIN_SIDEBAR_WIDTH = 260;
const savedSidebarWidth = clamp(Number(localStorage.getItem("txteditor.sidebarWidth")) || MIN_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, 520);
const savedProblemsHeight = clamp(Number(localStorage.getItem("txteditor.problemsHeight")) || 260, 150, 520);
const savedFreeze = readJsonStorage("txteditor.freeze", {});
const collapsedProblemFiles = new Set();
const collapsedFileGroups = new Set();
const lspHoverCache = new Map();
const lspHoverPending = new Set();
let lspHoverCurrentKey = null;
let lspHoverGeneration = 0;
const pendingLspDiagnostics = new Map();
let diagnosticsFlushTimer = 0;
const staleLspSessions = new Set();
document.documentElement.dataset.theme = savedTheme;
document.documentElement.style.setProperty("--grid-font", savedGridFont);
document.documentElement.style.setProperty("--sidebar-width", `${savedSidebarWidth}px`);
document.documentElement.style.setProperty("--problems-height", `${savedProblemsHeight}px`);

const state = {
  docs: [],
  active: 0,
  selection: new SelectionModel(),
  workspace: null,
  search: {
    lastQuery: ""
  },
  sidebarVisible: localStorage.getItem("txteditor.sidebar") !== "hidden",
  sidebarWidth: savedSidebarWidth,
  problemsVisible: localStorage.getItem("txteditor.problems") === "visible",
  problemsHeight: savedProblemsHeight,
  freezeRow: savedFreeze.row ?? false,
  freezeColumn: savedFreeze.column ?? false,
  contextHit: null,
  contextMenuActiveGroup: "",
  theme: savedTheme,
  gridFont: savedGridFont,
  colorizeColumns: savedColorize,
  vectorLspHover: savedVectorLspHover,
  lint: {
    enabled: savedLintEnabled,
    diagnostics: [],
    diagnosticsByFileKey: new Map(),
    diagnosticCountByFileKey: new Map(),
    diagnosticById: new Map(),
    diagnosticsVersion: 0,
    workspaceKey: "",
    status: ""
  },
  lsp: {
    started: false,
    sessionId: 0,
    startupToken: 0,
    diagnosticsStartup: false,
    diagnosticsComplete: false,
    diagnosticsStartupFirstAt: 0,
    diagnosticsStartupFlushes: 0,
    diagnosticsStats: {
      folderOpenedAt: 0,
      folderOpenToProcessStartMs: 0,
      processStartMs: 0,
      initializeMs: 0,
      initializedMs: 0,
      initialDiagnosticsMs: 0,
      filesScanned: 0,
      diagnosticsGenerated: 0,
      expectedFileCount: 0,
      publishNotifications: 0,
      frontendFlushes: 0,
      renderChromeDuringStartup: 0,
      tauriInvokesDuringStartup: 0,
      schemaDiagnosticsMs: null,
      pluginDiagnosticsMs: null
    }
  },
  config: {},
  bottomTab: "problems",
  lspLogs: []
};

const els = {
  shell: document.getElementById("app"),
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
  fontSelect: document.getElementById("fontSelect"),
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

const isDevelopmentMode = ["localhost", "127.0.0.1", ""].includes(location.hostname);
if (isDevelopmentMode) {
  window.__txteditorDiagnosticsStats = () => ({ ...state.lsp.diagnosticsStats });
}

const commandLabelsBase = [
  ["open-file", "Open File"],
  ["open-folder", "Open Folder / Workspace"],
  ["save-file", "Save"],
  ["save-as", "Save As"],
  ["search", "Find/Search"],
  ["find-next", "Find Next"],
  ["undo", "Undo"],
  ["redo", "Redo"],
  ["copy", "Copy"],
  ["paste", "Paste"],
  ["cut", "Cut"],
  ["clear-selection", "Clear Cell(s)"],
  ["select-all", "Select All"],
  ["add-row", "Add Row"],
  ["insert-row", "Insert Row"],
  ["clone-row", "Clone Row"],
  ["delete-row", "Delete Row"],
  ["clear-row", "Clear Row"],
  ["hide-row", "Hide Row"],
  ["unhide-all", "Unhide All"],
  ["add-column", "Add Column"],
  ["insert-column", "Insert Column"],
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
  ["toggle-lint", "Toggle Lint"],
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
  ["open-settings", "Settings"],
  ["open-lint-options", "Lint Options"]
];

const commandLabels = [
  ...commandLabelsBase,
  ...(isDevelopmentMode ? [
  ["load-fixture-20k", "Load 20k Fixture"],
  ["load-fixture-200k", "Load 200k Fixture"]
  ] : [])
];

const commands = Object.fromEntries(commandLabels.map(([id]) => [id, () => runCommand(id)]));

const EMPTY_DOC = TableDocument.fromText("Empty", "");

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
  onHoverRequest: (row, column) => requestLspHover(row, column).catch(() => {})
});

grid.setFontFamily(state.gridFont);
grid.setColorizeColumns(state.colorizeColumns);
grid.setVectorLspHoverEnabled(state.vectorLspHover);
populateFontSelect();
renderChrome();
wireEvents();
wireCloseHandler().catch(() => {});
loadConfig().catch(() => {});
listenForNativeDrops((paths) => openDroppedNativePaths(paths)).catch(showError);
lspListen(handleLspDiagnosticsChanged).catch(showError);
lspLogListen((msg) => appendLspLog(msg)).catch(() => {});

function activeDoc() {
  return state.docs[state.active] ?? EMPTY_DOC;
}

function hasOpenDocument() {
  return state.docs.length > 0 && state.active >= 0;
}

function activeUndo() {
  if (!activeDoc().undo) activeDoc().undo = new UndoManager();
  return activeDoc().undo;
}

function execute(command) {
  if (!hasOpenDocument()) return showError("Open a file before editing.");
  if (!command || command.isEmpty) return;
  const doc = activeDoc();
  command.redo(activeDoc());
  activeUndo().push(command);
  grid.layout();
  lspUpdateDoc(doc).catch(() => {});
  renderChrome();
}

function applyEdits(edits, label = "Edit Cells") {
  execute(makeCellCommand(label, activeDoc(), edits));
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
    const choice = event.target.closest("[data-close-choice]")?.dataset.closeChoice;
    if (choice && pendingCloseResolve) {
      pendingCloseResolve(choice);
      pendingCloseResolve = null;
      els.closeDialog.classList.add("hidden");
    }
  });
  els.tabs.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    const tab = event.target.closest("[data-tab]");
    if (tab) closeTab(Number(tab.dataset.tab)).catch(showError);
  });
  document.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("resize", () => { positionContextMenu(); updateOverviewRuler(); });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", async (event) => {
    event.preventDefault();
    if (isTauriRuntime()) return;
    const files = Array.from(event.dataTransfer?.files ?? []).filter(isTextLikeFile);
    for (const file of files) await addDocument(await readFileAsDocument(file, TableDocument));
  });
  els.fileInput.addEventListener("change", async () => {
    const files = Array.from(els.fileInput.files ?? []).filter(isTextLikeFile);
    for (const file of files) await addDocument(await readFileAsDocument(file, TableDocument));
    els.fileInput.value = "";
  });
  els.fontSelect?.addEventListener("change", () => changeGridFont(els.fontSelect.value));
  wirePaneResizers();
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      findNext();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  });
  els.searchInput.addEventListener("input", () => {
    state.search.lastQuery = "";
  });
  els.searchPanel.addEventListener("click", (event) => {
    if (event.target === els.searchPanel || event.target.closest("[data-search-close]")) closeSearch();
  });
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
  if (!isTauriRuntime()) return;
  const tauri = window.__TAURI__;
  if (!tauri?.event?.listen) return;
  await tauri.event.listen("app-close-requested", async () => {
    const unsaved = state.docs.filter((d) => d.dirty);
    if (!unsaved.length) {
      closeWindow().catch(() => {});
      return;
    }
    for (const doc of [...unsaved]) {
      const index = state.docs.indexOf(doc);
      if (index >= 0) {
        state.active = index;
        applyFreezeToDoc(activeDoc());
        grid.setDocument(activeDoc());
        updateGridDiagnostics();
        renderChrome();
      }
      const choice = await askCloseChoice(doc);
      if (choice === "cancel") return;
      if (choice === "save") {
        const saved = await saveFile().catch(() => false);
        if (!saved || doc.dirty) return;
      }
    }
    closeWindow().catch(() => {});
  });
}

function handleGlobalKeydown(event) {
  if (event.defaultPrevented) return;
  const key = event.key.toLowerCase();
  const editingCell = els.editor.classList.contains("active");
  if (event.key === "Escape" && !els.contextMenu.classList.contains("hidden")) {
    event.preventDefault();
    hideContextMenu();
    return;
  }
  if (event.key === "Escape" && !els.searchPanel.classList.contains("hidden")) {
    event.preventDefault();
    closeSearch();
    return;
  }
  if (event.key === "Escape" && !els.palette.classList.contains("hidden")) {
    event.preventDefault();
    els.palette.classList.add("hidden");
    els.host.focus();
    return;
  }
  if (editingCell && !(event.ctrlKey && ["s", "w", "h", "l"].includes(key))) return;
  if (!editingCell && isTextInputTarget(event.target)) return;
  if (event.ctrlKey && (key === "+" || key === "=")) return prevent(event, () => runCommand("zoom-in"));
  if (event.ctrlKey && key === "-") return prevent(event, () => runCommand("zoom-out"));
  if (event.ctrlKey && key === "0") return prevent(event, () => runCommand("zoom-reset"));
  if (event.ctrlKey && key === "o") return prevent(event, openFile);
  if (event.ctrlKey && key === "b") return prevent(event, toggleSidebar);
  if (event.ctrlKey && key === "l") return prevent(event, toggleProblemsPanel);
  if (event.ctrlKey && key === "h") return prevent(event, resetRowHeights);
  if (event.ctrlKey && key === "s" && event.shiftKey) return prevent(event, saveAs);
  if (event.ctrlKey && key === "s") return prevent(event, saveFile);
  if (event.ctrlKey && key === "f") return prevent(event, showSearch);
  if (event.ctrlKey && key === "z" && event.shiftKey) return prevent(event, redo);
  if (event.ctrlKey && key === "z") return prevent(event, undo);
  if (event.ctrlKey && key === "y") return prevent(event, redo);
  if (event.ctrlKey && key === "p") return prevent(event, showPalette);
  if (event.ctrlKey && key === "w") return prevent(event, () => closeTab(state.active));
  if (event.ctrlKey && key === "c") return prevent(event, copySelection);
  if (event.ctrlKey && key === "x") return prevent(event, cutSelection);
  if (event.ctrlKey && key === "v") return prevent(event, pasteSelection);
  if (!event.ctrlKey && !event.altKey && key === "delete" && !els.editor.classList.contains("active")) {
    return prevent(event, () => runCommand("clear-selection"));
  }
}

function prevent(event, fn) {
  event.preventDefault();
  Promise.resolve(fn()).catch(showError);
}

async function addDocument(doc) {
  const existing = doc.path ? state.docs.findIndex((openDoc) => openDoc.path === doc.path) : -1;
  if (existing >= 0) {
    state.active = existing;
    grid.setDocument(activeDoc());
    updateGridDiagnostics();
    renderChrome();
    return;
  }
  doc.undo = new UndoManager();
  doc.zoom = 1;
  state.docs.push(doc);
  state.active = state.docs.length - 1;
  applyFreezeToDoc(doc);
  grid.setDocument(doc);
  updateGridDiagnostics();
  if (!doc.initialColumnFitApplied) {
    grid.autoFitInitialColumns();
    doc.initialColumnFitApplied = true;
    grid.layout();
  }
  renderChrome();
  scrollProblemsToActiveFile();
  lspOpenDoc(doc).catch(() => {});
}

async function openFile() {
  try {
    if (isTauriRuntime()) {
      const docs = await openFilesNative(TableDocument);
      for (const doc of docs) await addDocument(doc);
    } else if ("showOpenFilePicker" in window) {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: "Structured text", accept: { "text/plain": [".txt", ".tsv", ".tbl", ".csv"] } }]
      });
      for (const handle of handles) {
        const file = await handle.getFile();
        const doc = await readFileAsDocument(file, TableDocument);
        doc.handle = handle;
        await addDocument(doc);
      }
    } else {
      els.fileInput.click();
    }
  } catch (error) {
    showError(error);
  }
}

async function openDroppedNativePaths(paths) {
  try {
    const docs = await openNativePaths(paths.filter(isTextLikePath), TableDocument);
    for (const doc of docs) await addDocument(doc);
  } catch (error) {
    showError(error);
  }
}

async function openFolder() {
  try {
    if (!isTauriRuntime()) {
      showError("Open Folder is available in the desktop app.");
      return;
    }
    const workspace = await openWorkspaceNative();
    if (!workspace) return;
    state.workspace = workspace;
    resetDiagnosticsStats();
    state.lsp.diagnosticsStats.folderOpenedAt = performance.now();
    if (diagnosticsActive()) startDiagnosticsForWorkspace();
    renderChrome();
  } catch (error) {
    showError(error);
  }
}

async function saveFile() {
  try {
    const doc = activeDoc();
    if (!hasOpenDocument()) {
      showError("No file is open.");
      return false;
    }
    if (isTauriRuntime()) {
      const saved = await saveDocumentNative(doc, false);
      if (!saved) return false;
      grid.draw();
      renderChrome();
      return true;
    }
    if (doc.handle?.createWritable) {
      const writable = await doc.handle.createWritable();
      await writable.write(doc.toText());
      await writable.close();
      doc.dirty = false;
      renderChrome();
      return true;
    }
    return saveAs();
  } catch (error) {
    showError(error);
    return false;
  }
}

async function saveAs() {
  try {
    const doc = activeDoc();
    if (!hasOpenDocument()) {
      showError("No file is open.");
      return false;
    }
    if (isTauriRuntime()) {
      const saved = await saveDocumentNative(doc, true);
      if (!saved) return false;
      grid.draw();
      renderChrome();
      return true;
    } else if ("showSaveFilePicker" in window) {
      const handle = await window.showSaveFilePicker({ suggestedName: doc.name });
      const writable = await handle.createWritable();
      await writable.write(doc.toText());
      await writable.close();
      doc.handle = handle;
      doc.name = handle.name ?? doc.name;
      doc.dirty = false;
      renderChrome();
      return true;
    } else {
      downloadText(doc.name, doc.toText());
      doc.dirty = false;
      renderChrome();
      return true;
    }
  } catch (error) {
    showError(error);
    return false;
  }
}

async function loadFixture(size) {
  const name = size === 200000 ? "d2_200k.tsv" : "d2_20k.tsv";
  const response = await fetch(`./fixtures/${name}`);
  const text = await response.text();
  await addDocument(TableDocument.fromText(name, text));
}

function undo() {
  if (activeUndo().undo(activeDoc())) {
    grid.layout();
    lspUpdateDoc(activeDoc()).catch(() => {});
    renderChrome();
  }
}

function redo() {
  if (activeUndo().redo(activeDoc())) {
    grid.layout();
    lspUpdateDoc(activeDoc()).catch(() => {});
    renderChrome();
  }
}

function showSearch() {
  els.searchPanel.classList.remove("hidden");
  els.searchInput.focus();
  els.searchInput.select();
}

function closeSearch() {
  els.searchPanel.classList.add("hidden");
  els.host.focus();
}

function findNext() {
  const query = els.searchInput.value;
  const includeStart = query !== state.search.lastQuery;
  const found = findInTable(activeDoc(), query, state.selection.focus, { includeStart });
  if (!found) {
    els.searchStatus.textContent = "No results";
    return;
  }
  state.search.lastQuery = query;
  state.selection.set(found.row, found.column);
  grid.scrollCellIntoView(found.row, found.column);
  grid.draw();
  els.searchStatus.textContent = `R${found.row + 1}:C${found.column + 1}`;
}

function runCommand(id) {
  const alwaysAvailable = new Set(["open-file", "open-folder", "open-settings", "open-lint-options", "toggle-sidebar", "toggle-theme", "toggle-colorize", "toggle-lint", "show-explorer", "show-problems", "zoom-in", "zoom-out", "zoom-reset", "load-fixture-20k", "load-fixture-200k"]);
  if (!hasOpenDocument() && !alwaysAvailable.has(id)) return showError("Open a file before using that command.");
  const doc = activeDoc();
  const rect = state.selection.rect;
  if (id === "open-file") return openFile();
  if (id === "open-folder") return openFolder();
  if (id === "save-file") return saveFile();
  if (id === "save-as") return saveAs();
  if (id === "load-fixture-20k") return loadFixture(20000);
  if (id === "load-fixture-200k") return loadFixture(200000);
  if (id === "undo") return undo();
  if (id === "redo") return redo();
  if (id === "search") return showSearch();
  if (id === "find-next") return findNext();
  if (id === "copy") return copySelection();
  if (id === "paste") return pasteSelection();
  if (id === "cut") return cutSelection();
  if (id === "select-all") return selectAll();
  if (id === "clear-selection") return execute(clearRangesCommand(doc, state.selection.ranges));
  if (id === "add-row") return addRows();
  if (id === "insert-row") return execute(insertRowCommand(doc, rect.top));
  if (id === "clone-row") return cloneRows();
  if (id === "delete-row") return execute(deleteRowsCommand(doc, rect.top, rect.bottom - rect.top + 1));
  if (id === "clear-row") return execute(clearRangeCommand(doc, { top: rect.top, bottom: rect.bottom, left: 0, right: doc.columnCount - 1 }, "Clear Row"));
  if (id === "hide-row") return execute(hiddenRowsCommand(rowsFromSelection(), true));
  if (id === "unhide-rows") return execute(hiddenRowsCommand([...doc.hiddenRows], false));
  if (id === "add-column") return addColumns();
  if (id === "insert-column") return execute(insertColumnCommand(doc, rect.left));
  if (id === "delete-column") return execute(deleteColumnsCommand(doc, rect.left, rect.right - rect.left + 1));
  if (id === "clear-column") return execute(clearRangeCommand(doc, { top: 0, bottom: doc.rowCount - 1, left: rect.left, right: rect.right }, "Clear Column"));
  if (id === "hide-column") return execute(hiddenColumnsCommand(columnsFromSelection(), true));
  if (id === "unhide-columns") return execute(hiddenColumnsCommand([...doc.hiddenColumns], false));
  if (id === "unhide-all") return unhideAll();
  if (id === "fill") return execute(fillSelectedCellsCommand(doc, state.selection.ranges, state.selection.anchor));
  if (id === "increment-fill") return execute(incrementFillSelectedCellsCommand(doc, state.selection.ranges, state.selection.anchor));
  if (id.startsWith("math-")) return math(id.replace("math-", ""));
  if (id === "toggle-freeze-row") return toggleFreeze("row");
  if (id === "toggle-freeze-column") return toggleFreeze("column");
  if (id === "toggle-colorize") return toggleColorize();
  if (id === "toggle-lint") return toggleLint();
  if (id === "show-explorer") return toggleExplorerPane();
  if (id === "show-problems") return toggleProblemsPanel();
  if (id === "zoom-in") return zoomBy(0.1);
  if (id === "zoom-out") return zoomBy(-0.1);
  if (id === "zoom-reset") return zoomReset();
  if (id === "resize-fit") return resizeFit(false);
  if (id === "resize-selected-fit") return resizeFit(true);
  if (id === "reset-row-heights") return resetRowHeights();
  if (id === "toggle-sidebar") return toggleSidebar();
  if (id === "toggle-theme") return toggleTheme();
  if (id === "open-settings") return showSettings();
  if (id === "open-lint-options") return showLintOptions();
  if (id === "go-to-definition") return goToDefinition();
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
  setTheme(state.theme === "dark" ? "light" : "dark");
}

function setTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem("txteditor.theme", state.theme);
  grid.syncTheme();
  grid.draw();
  renderChrome();
}

function toggleColorize() {
  setColorizeColumns(!state.colorizeColumns);
}

function setColorizeColumns(enabled) {
  state.colorizeColumns = Boolean(enabled);
  localStorage.setItem("txteditor.colorize", state.colorizeColumns ? "on" : "off");
  grid.setColorizeColumns(state.colorizeColumns);
  renderChrome();
}

function changeGridFont(value) {
  state.gridFont = normaliseGridFont(value);
  localStorage.setItem("txteditor.gridFont", state.gridFont);
  document.documentElement.style.setProperty("--grid-font", state.gridFont);
  grid.setFontFamily(state.gridFont);
  renderChrome();
}

function setVectorLspHover(enabled) {
  state.vectorLspHover = Boolean(enabled);
  localStorage.setItem("txteditor.vectorLspHover", state.vectorLspHover ? "on" : "off");
  clearLspHoverState();
  grid.setVectorLspHoverEnabled(state.vectorLspHover);
  renderChrome();
}

function toggleLint() {
  state.lint.enabled = !state.lint.enabled;
  if (!state.lint.enabled) {
    stopDiagnosticsSession({ clearModel: true });
  } else if (diagnosticsActive() && state.workspace) {
    startDiagnosticsForWorkspace();
  }
  saveLintSettings();
  renderChrome();
}

async function toggleExplorerPane() {
  const gridHadFocus = document.activeElement === els.host;
  state.sidebarVisible = !state.sidebarVisible;
  localStorage.setItem("txteditor.sidebar", state.sidebarVisible ? "visible" : "hidden");
  renderChrome();
  grid.layout();
  if (!state.sidebarVisible && gridHadFocus) els.host.focus();
}

async function toggleProblemsPanel() {
  const gridHadFocus = document.activeElement === els.host;
  state.problemsVisible = !state.problemsVisible;
  localStorage.setItem("txteditor.problems", state.problemsVisible ? "visible" : "hidden");
  if (state.problemsVisible) {
    if (diagnosticsActive() && state.workspace) startDiagnosticsForWorkspace();
  } else {
    hideDiagnosticsSession();
  }
  renderChrome();
  grid.layout();
  if (!state.problemsVisible && gridHadFocus) els.host.focus();
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

const MAX_LOG_ENTRIES = 500;

function appendLspLog(msg) {
  state.lspLogs.push(msg);
  if (state.lspLogs.length > MAX_LOG_ENTRIES) state.lspLogs.shift();
  if (state.bottomTab === "log" && els.logList) {
    const entry = document.createElement("div");
    entry.className = "log-entry";
    entry.textContent = msg;
    els.logList.appendChild(entry);
    els.logList.scrollTop = els.logList.scrollHeight;
  }
}

function clearLspHoverState() {
  lspHoverGeneration += 1;
  lspHoverCache.clear();
  lspHoverPending.clear();
  lspHoverCurrentKey = null;
  grid?.clearLspHover?.();
}

function clearLspHoverForUri(uri) {
  for (const key of [...lspHoverCache.keys()]) {
    if (key.startsWith(`${uri}:`)) lspHoverCache.delete(key);
  }
  for (const key of [...lspHoverPending]) {
    if (key.startsWith(`${uri}:`)) lspHoverPending.delete(key);
  }
  if (lspHoverCurrentKey?.startsWith(`${uri}:`)) {
    lspHoverGeneration += 1;
    lspHoverCurrentKey = null;
    grid?.clearLspHover?.();
  }
}

function setSidebarWidth(width) {
  state.sidebarWidth = clamp(Math.round(width), MIN_SIDEBAR_WIDTH, 520);
  document.documentElement.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  localStorage.setItem("txteditor.sidebarWidth", String(state.sidebarWidth));
  grid.layout();
}

function setProblemsHeight(height) {
  const maxHeight = Math.max(150, Math.floor(window.innerHeight * 0.7));
  state.problemsHeight = clamp(Math.round(height), 150, maxHeight);
  document.documentElement.style.setProperty("--problems-height", `${state.problemsHeight}px`);
  localStorage.setItem("txteditor.problemsHeight", String(state.problemsHeight));
  grid.layout();
}

function wirePaneResizers() {
  els.sidebarResizer?.addEventListener("pointerdown", (event) => {
    if (!state.sidebarVisible) return;
    event.preventDefault();
    els.sidebarResizer.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = state.sidebarWidth;
    const onMove = (moveEvent) => setSidebarWidth(startWidth + moveEvent.clientX - startX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
  els.problemsResizer?.addEventListener("pointerdown", (event) => {
    if (!state.problemsVisible) return;
    event.preventDefault();
    els.problemsResizer.setPointerCapture?.(event.pointerId);
    const startY = event.clientY;
    const startHeight = state.problemsHeight;
    const onMove = (moveEvent) => setProblemsHeight(startHeight + startY - moveEvent.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

// ── LSP integration ────────────────────────────────────────────────────────

function docToUri(doc) {
  if (!doc?.path) return null;
  const normalized = doc.path.replace(/\\/g, "/");
  const base = normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
  try { return new URL(base).href; } catch { return base; }
}

function uriToFileKey(uri) {
  return lintPathKey(decodeURIComponent(uri.replace(/^file:\/\/\//, "").replace(/^file:\/\//, "/")));
}

function pathFromUri(uri) {
  if (uri.startsWith("file:///")) return decodeURIComponent(uri.slice(8));
  if (uri.startsWith("file://")) return decodeURIComponent(uri.slice(7));
  return null;
}

function fileNameFromUri(uri) {
  return decodeURIComponent(uri.split("/").pop() || uri);
}

function resetDiagnosticsStats(folderOpenedAt = state.lsp?.diagnosticsStats?.folderOpenedAt ?? 0) {
  state.lsp.diagnosticsStats = {
    folderOpenedAt,
    folderOpenToProcessStartMs: 0,
    processStartMs: 0,
    initializeMs: 0,
    initializedMs: 0,
    initialDiagnosticsMs: 0,
    filesScanned: 0,
    diagnosticsGenerated: 0,
    expectedFileCount: 0,
    publishNotifications: 0,
    frontendFlushes: 0,
    renderChromeDuringStartup: 0,
    tauriInvokesDuringStartup: 0,
    schemaDiagnosticsMs: null,
    pluginDiagnosticsMs: null
  };
}

function startDiagnosticsForWorkspace() {
  if (!diagnosticsActive() || !state.workspace?.path) return;
  if (hasReusableDiagnosticsSnapshot(state.workspace.path)) {
    updateGridDiagnostics();
    renderDiagnosticsChrome();
    return;
  }
  lspStartWorkspace(state.workspace.path).catch(showError);
}

function hideDiagnosticsSession() {
  pendingLspDiagnostics.clear();
  if (diagnosticsFlushTimer) {
    clearTimeout(diagnosticsFlushTimer);
    diagnosticsFlushTimer = 0;
  }
  if (state.lsp.diagnosticsStartup || !state.lsp.diagnosticsComplete) {
    invalidateDiagnosticsSession();
    state.lsp.started = false;
    lspStop().catch(() => {});
  }
  state.lsp.diagnosticsStartup = false;
  state.lint.status = "";
  updateGridDiagnostics();
  if (els.problemsList) els.problemsList.innerHTML = "";
}

async function stopDiagnosticsSession({ clearModel = true } = {}) {
  if (clearModel) clearDiagnosticsState({ invalidateSession: true });
  else invalidateDiagnosticsSession();
  state.lsp.started = false;
  state.lsp.openFileCount = 0;
  state.lsp.diagnosticsStartup = false;
  state.lsp.diagnosticsComplete = false;
  state.lint.status = "";
  clearLspHoverState();
  updateGridDiagnostics();
  if (els.problemsList && !state.problemsVisible) els.problemsList.innerHTML = "";
  lspStop().catch(() => {});
}

function hasReusableDiagnosticsSnapshot(workspacePath) {
  return state.lsp.diagnosticsComplete
    && state.lint.diagnosticsVersion > 0
    && state.lint.workspaceKey === lintPathKey(workspacePath)
    && (state.lint.diagnostics.length > 0 || state.lsp.diagnosticsStats.filesScanned > 0);
}

async function lspStartWorkspace(workspacePath) {
  if (!diagnosticsActive()) {
    hideDiagnosticsSession();
    return;
  }
  clearLspHoverState();
  clearDiagnosticsState({ invalidateSession: true });
  state.lint.workspaceKey = lintPathKey(workspacePath);
  const startupToken = state.lsp.startupToken + 1;
  state.lsp.startupToken = startupToken;
  resetDiagnosticsStats(state.lsp.diagnosticsStats.folderOpenedAt);
  state.lspLogs = [];
  if (els.logList) els.logList.innerHTML = "";
  state.lint.status = "Connecting to linter...";
  state.lsp.diagnosticsStartup = true;
  state.lsp.diagnosticsStartupFirstAt = 0;
  state.lsp.diagnosticsStartupFlushes = 0;
  updateGridDiagnostics();
  renderChrome();
  const processRequestedAt = performance.now();
  state.lsp.diagnosticsStats.tauriInvokesDuringStartup += 1;
  const result = await lspStart(workspacePath);
  if (!diagnosticsActive() || startupToken !== state.lsp.startupToken) return;
  state.lsp.sessionId = Number(result?.sessionId) || state.lsp.sessionId || 0;
  const folderOpenedAt = state.lsp.diagnosticsStats.folderOpenedAt || processRequestedAt;
  state.lsp.diagnosticsStats.folderOpenToProcessStartMs = Math.round(processRequestedAt - folderOpenedAt);
  state.lsp.diagnosticsStats.processStartMs = Number(result?.processStartMs) || 0;
  state.lsp.diagnosticsStats.initializeMs = Number(result?.initializeMs) || 0;
  state.lsp.diagnosticsStats.initializedMs = Number(result?.initializedMs) || 0;
  state.lsp.diagnosticsStats.expectedFileCount = Number(result?.expectedFileCount) || 0;
  state.lsp.openFileCount = state.lsp.diagnosticsStats.expectedFileCount;
  state.lsp.started = true;
  const docsToOpen = state.docs.filter((doc) => shouldOpenDocDuringWorkspaceStartup(doc, workspacePath));
  for (const doc of docsToOpen) {
    if (!diagnosticsActive() || startupToken !== state.lsp.startupToken) return;
    const uri = docToUri(doc);
    doc._lspVersion = 1;
    await lspOpenFile(uri, doc.toText()).catch(() => {});
    state.lsp.diagnosticsStats.tauriInvokesDuringStartup += 1;
    state.lsp.openFileCount = (state.lsp.openFileCount ?? 0) + 1;
  }
  state.lint.status = "";
  renderChrome();
}

function shouldOpenDocDuringWorkspaceStartup(doc, workspacePath) {
  if (!docToUri(doc)) return false;
  if (doc.dirty) return true;
  return !workspaceScanCoversDoc(doc, workspacePath);
}

function workspaceScanCoversDoc(doc, workspacePath) {
  if (!doc?.path || !workspacePath) return false;
  const filePath = lintPathKey(doc.path);
  const rootPath = lintPathKey(workspacePath).replace(/\/$/, "");
  const slash = filePath.lastIndexOf("/");
  if (slash < 0) return false;
  const parent = filePath.slice(0, slash);
  return parent === rootPath && /\.txt$/i.test(filePath);
}

async function lspOpenDoc(doc) {
  if (!diagnosticsActive() || !state.lsp.started) return;
  const uri = docToUri(doc);
  if (!uri) return;
  doc._lspVersion = 1;
  await lspOpenFile(uri, doc.toText());
  state.lsp.openFileCount = (state.lsp.openFileCount ?? 0) + 1;
  renderChrome();
}

async function lspUpdateDoc(doc) {
  if (!diagnosticsActive() || !state.lsp.started) return;
  const uri = docToUri(doc);
  if (!uri) return;
  doc._lspVersion = ((doc._lspVersion ?? 0) + 1);
  await lspUpdateFile(uri, doc._lspVersion, doc.toText());
}

async function lspCloseDoc(doc) {
  if (!state.lsp.started) return;
  const uri = docToUri(doc);
  if (!uri) return;
  await lspCloseFile(uri);
  clearLspHoverForUri(uri);
  const fileKey = uriToFileKey(uri);
  clearDiagnosticsForFileKey(fileKey);
  updateGridDiagnostics();
}

function handleLspDiagnosticsChanged(payload) {
  if (!diagnosticsActive() || !payloadSessionIsCurrent(payload)) return;
  if (Array.isArray(payload?.entries)) {
    applyDiagnosticsSnapshot(payload);
    return;
  }
  const uri = typeof payload === "string" ? payload : payload?.uri;
  if (!uri) return;
  const diagnostics = typeof payload === "string" ? [] : payload?.diagnostics;
  state.lsp.diagnosticsStats.publishNotifications += 1;
  pendingLspDiagnostics.set(uri, Array.isArray(diagnostics) ? diagnostics : []);
  scheduleDiagnosticsFlush({ startup: state.lsp.diagnosticsStartup });
}

function payloadSessionIsCurrent(payload) {
  const sessionId = Number(payload?.sessionId) || 0;
  if (!sessionId) return true;
  if (staleLspSessions.has(sessionId)) return false;
  if (state.lsp.sessionId && sessionId !== state.lsp.sessionId) return false;
  if (!state.lsp.sessionId) state.lsp.sessionId = sessionId;
  return true;
}

function applyDiagnosticsSnapshot(payload) {
  pendingLspDiagnostics.clear();
  if (diagnosticsFlushTimer) {
    clearTimeout(diagnosticsFlushTimer);
    diagnosticsFlushTimer = 0;
  }
  const activeKey = lintDocKey(activeDoc());
  const affectedFileKeys = new Set();
  for (const entry of payload.entries) {
    const uri = entry?.uri;
    if (!uri) continue;
    const fileKey = setDiagnosticsForUri(uri, Array.isArray(entry.diagnostics) ? entry.diagnostics : []);
    if (fileKey) affectedFileKeys.add(fileKey);
  }
  rebuildFlatDiagnosticsFromMap();
  rebuildDiagnosticIndexes();
  state.lint.diagnosticsVersion += 1;
  state.lsp.diagnosticsStartup = false;
  state.lsp.diagnosticsComplete = true;
  state.lsp.diagnosticsStats.publishNotifications += Number(payload.publishCount) || payload.entries.length;
  state.lsp.diagnosticsStats.frontendFlushes += 1;
  state.lsp.diagnosticsStats.expectedFileCount = Number(payload.expectedFileCount) || state.lsp.diagnosticsStats.expectedFileCount;
  state.lsp.diagnosticsStats.filesScanned = Number(payload.fileCount) || payload.entries.length;
  state.lsp.diagnosticsStats.diagnosticsGenerated = Number(payload.diagnosticCount) || state.lint.diagnostics.length;
  state.lsp.diagnosticsStats.initialDiagnosticsMs = Number(payload.elapsedMs) || 0;
  state.lsp.openFileCount = state.lsp.diagnosticsStats.filesScanned || state.lsp.diagnosticsStats.expectedFileCount || state.lsp.openFileCount;
  state.lint.status = "";
  if (affectedFileKeys.has(activeKey)) updateGridDiagnostics();
  renderDiagnosticsChrome();
}

function scheduleDiagnosticsFlush({ startup = false } = {}) {
  const now = performance.now();
  if (startup && !state.lsp.diagnosticsStartupFirstAt) {
    state.lsp.diagnosticsStartupFirstAt = now;
  }
  const startupElapsed = startup ? now - state.lsp.diagnosticsStartupFirstAt : 0;
  const delay = startup && startupElapsed < 1400 ? 350 : 80;
  if (diagnosticsFlushTimer) clearTimeout(diagnosticsFlushTimer);
  diagnosticsFlushTimer = window.setTimeout(flushDiagnosticsBatch, delay);
}

function flushDiagnosticsBatch() {
  diagnosticsFlushTimer = 0;
  if (!diagnosticsActive() || pendingLspDiagnostics.size === 0) return;
  const activeKey = lintDocKey(activeDoc());
  const affectedFileKeys = new Set();
  for (const [uri, rawDiags] of pendingLspDiagnostics.entries()) {
    const fileKey = setDiagnosticsForUri(uri, rawDiags);
    if (fileKey) affectedFileKeys.add(fileKey);
  }
  pendingLspDiagnostics.clear();
  rebuildFlatDiagnosticsFromMap();
  rebuildDiagnosticIndexes();
  state.lint.diagnosticsVersion += 1;
  state.lsp.diagnosticsStats.frontendFlushes += 1;
  state.lsp.diagnosticsStats.diagnosticsGenerated = state.lint.diagnostics.length;
  state.lsp.diagnosticsStats.filesScanned = state.lint.diagnosticsByFileKey.size;
  state.lsp.openFileCount = Math.max(state.lsp.openFileCount ?? 0, state.lsp.diagnosticsStats.filesScanned);
  if (affectedFileKeys.has(activeKey)) updateGridDiagnostics();
  renderDiagnosticsChrome();
  if (state.lsp.diagnosticsStartup) {
    state.lsp.diagnosticsStartupFlushes += 1;
    window.setTimeout(() => {
      if (pendingLspDiagnostics.size === 0) {
        state.lsp.diagnosticsStartup = false;
        state.lsp.diagnosticsComplete = true;
      }
    }, 500);
  }
}

function setDiagnosticsForUri(uri, rawDiags) {
  const fileKey = uriToFileKey(uri);
  const doc = state.docs.find((d) => docToUri(d) === uri);
  const fileName = doc?.name ?? fileNameFromUri(uri);
  const filePath = doc?.path ?? pathFromUri(uri);

  const displayDiags = (rawDiags ?? []).map((d, i) => {
    const row = Number.isFinite(Number(d.row)) ? Number(d.row) : 0;
    const col = resolveDiagnosticColumn(doc, row, d);
    const character = diagnosticNumber(d.character);
    const endCharacter = diagnosticNumber(d.endCharacter);
    return {
      id: `lsp:${uri}:${row}:${col}:${i}`,
      fileKey,
      fileName,
      filePath,
      rowIndex: row,
      columnIndex: col,
      character,
      endCharacter,
      severity: ["error", "warning", "info"].includes(d.severity) ? d.severity : "warning",
      message: d.message ?? "",
      ruleId: d.code ?? "",
      locationLabel: `Row ${row + 1}, Col ${col + 1}`
    };
  });

  if (displayDiags.length) state.lint.diagnosticsByFileKey.set(fileKey, displayDiags);
  else state.lint.diagnosticsByFileKey.delete(fileKey);
  return fileKey;
}

function resolveDiagnosticColumn(doc, row, diagnostic) {
  const fallback = diagnosticNumber(diagnostic?.col);
  const boundedFallback = doc
    ? clamp(fallback, 0, Math.max(0, doc.columnCount - 1))
    : Math.max(0, fallback);
  const character = maybeDiagnosticNumber(diagnostic?.character);
  if (!doc || character === null || character < 0 || row < 0 || row >= doc.rowCount) return boundedFallback;
  return diagnosticCharacterToColumn(doc, row, character, boundedFallback);
}

function diagnosticCharacterToColumn(doc, row, character, fallback = 0) {
  const cells = doc.rows[row] ?? [];
  let offset = 0;
  const width = Math.max(doc.columnCount, cells.length, 1);
  for (let col = 0; col < width; col++) {
    const length = stringCharacterLength(cells[col] ?? "");
    const start = offset;
    const end = start + length;
    if (character >= start && character <= end) return clamp(col, 0, Math.max(0, doc.columnCount - 1));
    offset = end + 1;
  }
  return clamp(fallback, 0, Math.max(0, doc.columnCount - 1));
}

function diagnosticNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function maybeDiagnosticNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringCharacterLength(value) {
  return Array.from(String(value ?? "")).length;
}

function diagnosticsActive() {
  return state.problemsVisible && state.lint.enabled;
}

function computeCharOffset(doc, row, col) {
  let offset = 0;
  for (let c = 0; c < col; c++) {
    offset += doc.getCell(row, c).length + 1;
  }
  return offset;
}

async function requestLspHover(row, col) {
  if (!state.vectorLspHover) return;
  if (!state.lsp.started) return;
  const doc = activeDoc();
  const uri = docToUri(doc);
  if (!uri) return;
  const key = `${uri}:${row}:${col}`;
  lspHoverCurrentKey = key;
  const requestGeneration = lspHoverGeneration;
  if (lspHoverCache.has(key)) {
    const cached = lspHoverCache.get(key);
    if (state.vectorLspHover && requestGeneration === lspHoverGeneration && cached != null) {
      grid.setLspHover(row, col, cached);
    }
    return;
  }
  if (lspHoverPending.has(key)) return;
  lspHoverPending.add(key);
  try {
    const charOffset = computeCharOffset(doc, row, col);
    let text = await lspHover(uri, row, charOffset);
    if (!state.vectorLspHover || requestGeneration !== lspHoverGeneration || lspHoverCurrentKey !== key) return;
    lspHoverCache.set(key, text || null);
    if (text) {
      const cellValue = doc.getCell(row, col);
      if (cellValue && text.startsWith(cellValue)) {
        text = text.slice(cellValue.length).replace(/^\s*\n?/, "");
      }
      grid.setLspHover(row, col, text);
    }
  } catch {
    lspHoverCache.set(key, null);
  } finally {
    lspHoverPending.delete(key);
  }
}

// ── diagnostics helpers ────────────────────────────────────────────────────

function updateGridDiagnostics() {
  if (!diagnosticsActive()) {
    grid.setDiagnostics(new Map());
    updateOverviewRuler();
    return;
  }
  grid.setDiagnostics(groupDiagnosticsByCell(diagnosticsForDoc(activeDoc())));
  updateOverviewRuler();
}

function diagnosticsForDoc(doc) {
  return diagnosticsForFileKey(lintDocKey(doc));
}

function diagnosticsForFileKey(fileKey) {
  if (!diagnosticsActive()) return [];
  return state.lint.diagnosticsByFileKey.get(fileKey) ?? [];
}

function diagnosticCountForFileKey(fileKey) {
  if (!diagnosticsActive()) return 0;
  return state.lint.diagnosticCountByFileKey.get(fileKey) ?? 0;
}

function clearDiagnosticsState({ invalidateSession = false } = {}) {
  pendingLspDiagnostics.clear();
  if (diagnosticsFlushTimer) {
    clearTimeout(diagnosticsFlushTimer);
    diagnosticsFlushTimer = 0;
  }
  if (invalidateSession) invalidateDiagnosticsSession();
  state.lint.diagnostics = [];
  state.lint.diagnosticsByFileKey.clear();
  state.lint.diagnosticCountByFileKey.clear();
  state.lint.diagnosticById.clear();
  state.lint.workspaceKey = "";
  state.lint.diagnosticsVersion += 1;
}

function invalidateDiagnosticsSession() {
  if (state.lsp.sessionId) staleLspSessions.add(state.lsp.sessionId);
  state.lsp.sessionId = 0;
  state.lsp.startupToken += 1;
  state.lsp.diagnosticsStartup = false;
  state.lsp.diagnosticsComplete = false;
  state.lsp.diagnosticsStartupFirstAt = 0;
  state.lsp.diagnosticsStartupFlushes = 0;
}

function clearDiagnosticsForFileKey(fileKey) {
  state.lint.diagnosticsByFileKey.delete(fileKey);
  rebuildFlatDiagnosticsFromMap();
  rebuildDiagnosticIndexes();
  state.lint.diagnosticsVersion += 1;
}

function rebuildFlatDiagnosticsFromMap() {
  state.lint.diagnostics = [...state.lint.diagnosticsByFileKey.values()]
    .flat()
    .sort(compareDisplayDiagnostics);
}

function rebuildDiagnosticIndexes() {
  state.lint.diagnosticCountByFileKey.clear();
  state.lint.diagnosticById.clear();
  for (const diagnostic of state.lint.diagnostics) {
    state.lint.diagnosticById.set(diagnostic.id, diagnostic);
    state.lint.diagnosticCountByFileKey.set(
      diagnostic.fileKey,
      (state.lint.diagnosticCountByFileKey.get(diagnostic.fileKey) ?? 0) + 1
    );
  }
}

function compareDisplayDiagnostics(a, b) {
  return a.fileName.localeCompare(b.fileName)
    || a.rowIndex - b.rowIndex
    || a.columnIndex - b.columnIndex
    || severityOrder(b.severity) - severityOrder(a.severity)
    || a.message.localeCompare(b.message);
}

function severityOrder(severity) {
  return severity === "error" ? 2 : severity === "warning" ? 1 : 0;
}

function updateOverviewRuler() {
  const ruler = els.overviewRuler;
  if (!ruler) return;
  const hostRect = els.host.getBoundingClientRect();
  ruler.style.top = `${hostRect.top}px`;
  ruler.style.height = `${hostRect.height}px`;
  ruler.style.right = "0px";
  const doc = activeDoc();
  const diags = diagnosticsForDoc(doc);
  const rowCount = doc.rowCount;
  if (!diagnosticsActive() || !diags.length || !rowCount) {
    ruler.innerHTML = "";
    return;
  }
  const seenRows = new Map();
  for (const diag of diags) {
    const existing = seenRows.get(diag.rowIndex);
    if (!existing || severityOrder(diag.severity) > severityOrder(existing)) {
      seenRows.set(diag.rowIndex, diag.severity);
    }
  }
  ruler.innerHTML = [...seenRows.entries()].map(([row, severity]) => {
    const pct = (row + 0.5) / rowCount * 100;
    return `<div class="ruler-mark ruler-mark-${severity}" style="top:${pct}%"></div>`;
  }).join("");
}

function applyFreezeToDoc(doc) {
  doc.freezeFirstRow = state.freezeRow;
  doc.freezeFirstColumn = state.freezeColumn;
}

function scrollProblemsToActiveFile() {
  if (!state.problemsVisible || !els.problemsList) return;
  const doc = activeDoc();
  if (!doc?.name) return;
  const target = els.problemsList.querySelector(`details[data-file-name="${CSS.escape(doc.name)}"]`);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function cellHasReference(row, col) {
  if (!state.lsp.started) return false;
  return Boolean(docToUri(activeDoc()));
}

function charOffsetToColumn(doc, row, charOffset) {
  let offset = 0;
  for (let col = 0; col < doc.columnCount; col++) {
    if (offset >= charOffset) return col;
    offset += doc.getCell(row, col).length + 1;
  }
  return Math.max(0, doc.columnCount - 1);
}

async function goToDefinition() {
  if (!state.lsp.started) return;
  const doc = activeDoc();
  const uri = docToUri(doc);
  if (!uri) return;
  const hit = state.contextHit;
  const row = hit?.row ?? state.selection.focus.row;
  const col = hit?.column ?? state.selection.focus.column;
  const charOffset = computeCharOffset(doc, row, col);
  const result = await lspDefinition(uri, row, charOffset).catch(() => null);
  if (!result) {
    showToast("No definition found.");
    return;
  }
  const targetPath = pathFromUri(result.uri);
  if (!targetPath) return;
  let index = state.docs.findIndex((d) => d.path === targetPath);
  if (index < 0 && isTauriRuntime()) {
    const newDocs = await openNativePaths([targetPath], TableDocument).catch(() => []);
    if (newDocs.length) {
      await addDocument(newDocs[0]);
      index = state.active;
    }
  }
  if (index >= 0 && index !== state.active) {
    state.active = index;
    applyFreezeToDoc(activeDoc());
    grid.setDocument(activeDoc());
    updateGridDiagnostics();
  }
  const targetDoc = activeDoc();
  const targetRow = clamp(result.line, 0, Math.max(0, targetDoc.rowCount - 1));
  const targetCol = clamp(charOffsetToColumn(targetDoc, targetRow, result.character), 0, Math.max(0, targetDoc.columnCount - 1));
  state.selection.set(targetRow, targetCol);
  grid.scrollCellIntoView(targetRow, targetCol);
  grid.draw();
  renderChrome();
  els.host.focus();
}

function docHasDiagnostics(doc) {
  if (!diagnosticsActive()) return false;
  return diagnosticsForDoc(doc).length > 0;
}

async function goToDiagnostic(id) {
  const diagnostic = state.lint.diagnosticById.get(id);
  if (!diagnostic) return;
  let index = state.docs.findIndex((doc) => lintDocKey(doc) === diagnostic.fileKey);
  if (index < 0 && diagnostic.filePath && isTauriRuntime()) {
    const [doc] = await openNativePaths([diagnostic.filePath], TableDocument);
    if (doc) {
      await addDocument(doc);
      index = state.active;
    }
  }
  if (index >= 0) state.active = index;
  grid.setDocument(activeDoc());
  state.selection.set(
    clamp(diagnostic.rowIndex, 0, Math.max(0, activeDoc().rowCount - 1)),
    clamp(diagnostic.columnIndex, 0, Math.max(0, activeDoc().columnCount - 1))
  );
  updateGridDiagnostics();
  grid.scrollCellIntoView(state.selection.focus.row, state.selection.focus.column);
  grid.draw();
  state.problemsVisible = true;
  localStorage.setItem("txteditor.problems", "visible");
  renderChrome();
  els.host.focus();
}

async function loadConfig() {
  const config = await getConfig().catch(() => ({}));
  state.config = config ?? {};
}

function showSettings() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal settings-modal">
      <div class="settings-title-row">
        <h2>Settings</h2>
        <button class="settings-close-btn" type="button" data-settings-close aria-label="Close settings">x</button>
      </div>
      <div class="settings-section">
        <label class="settings-checkbox-label">
          <input type="checkbox" id="settingsColorize"${state.colorizeColumns ? " checked" : ""} />
          Colorize columns
        </label>
        <label class="settings-checkbox-label">
          <input type="checkbox" id="settingsVectorLspHover"${state.vectorLspHover ? " checked" : ""} />
          Vector-LSP Hover
        </label>
        <label class="settings-label" for="settingsFont">Font</label>
        <select class="modal-input settings-font-select" id="settingsFont">${fontOptionsHtml()}</select>
        <label class="settings-label">Theme</label>
        <div class="settings-segmented" role="group" aria-label="Theme">
          <button type="button" data-settings-theme="dark"${state.theme === "dark" ? " class=\"active\"" : ""}>Dark</button>
          <button type="button" data-settings-theme="light"${state.theme === "light" ? " class=\"active\"" : ""}>Light</button>
        </div>
      </div>
    </div>`;
  document.body.append(backdrop);

  const colorizeInput = backdrop.querySelector("#settingsColorize");
  const vectorHoverInput = backdrop.querySelector("#settingsVectorLspHover");
  const fontSelect = backdrop.querySelector("#settingsFont");
  if (fontSelect) fontSelect.value = state.gridFont;

  colorizeInput?.addEventListener("change", () => setColorizeColumns(colorizeInput.checked));
  vectorHoverInput?.addEventListener("change", () => setVectorLspHover(vectorHoverInput.checked));
  fontSelect?.addEventListener("change", () => changeGridFont(fontSelect.value));
  for (const button of backdrop.querySelectorAll("[data-settings-theme]")) {
    button.addEventListener("click", () => {
      setTheme(button.dataset.settingsTheme);
      for (const candidate of backdrop.querySelectorAll("[data-settings-theme]")) {
        candidate.classList.toggle("active", candidate === button);
      }
    });
  }

  const finish = () => {
    backdrop.remove();
    els.host.focus();
  };
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-settings-close]")) finish();
  });
}

function saveLintSettings() {
  localStorage.setItem("txteditor.lint.settings", JSON.stringify({ enabled: state.lint.enabled }));
}

function showLintOptions() {
  const config = state.config ?? {};
  const mode = config.lintMode === "advanced" ? "advanced" : "basic";
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal settings-modal lint-options-modal">
      <div class="settings-title-row">
        <h2>Lint Options</h2>
        <button class="settings-close-btn" type="button" data-lint-options-close aria-label="Close lint options">x</button>
      </div>
      <div class="settings-section">
        <label class="settings-label" for="lintMode">Mode</label>
        <select class="modal-input" id="lintMode">
          <option value="basic"${mode === "basic" ? " selected" : ""}>Basic</option>
          <option value="advanced"${mode === "advanced" ? " selected" : ""}>Advanced</option>
        </select>
        <label class="settings-label" for="schemaVersion">Schema Version</label>
        <input class="modal-input" id="schemaVersion" value="${escapeHtml(config.schemaVersion ?? "")}" placeholder="RotW or 2.4" />
        <label class="settings-label" for="vectorLspPath">vector-lsp path</label>
        <div class="path-row">
          <input class="modal-input" id="vectorLspPath" value="${escapeHtml(config.vectorLspPath ?? "")}" placeholder="Auto-detect" />
          <button type="button" data-pick-path="vector">Browse</button>
        </div>
        <label class="settings-label" for="schemaPath">Schema folder</label>
        <div class="path-row">
          <input class="modal-input" id="schemaPath" value="${escapeHtml(config.schemaPath ?? "")}" placeholder="Optional" />
          <button type="button" data-pick-path="schema">Browse</button>
        </div>
        <label class="settings-label" for="pluginPath">Plugin folder</label>
        <div class="path-row">
          <input class="modal-input" id="pluginPath" value="${escapeHtml(config.pluginPath ?? "")}" placeholder="Optional" />
          <button type="button" data-pick-path="plugin">Browse</button>
        </div>
        <label class="settings-checkbox-label">
          <input type="checkbox" id="debugLogging"${config.debugLogging ? " checked" : ""} />
          Debug logging
        </label>
        <div class="modal-actions">
          <button type="button" data-lint-options-save>Save</button>
          <button type="button" data-lint-options-restart>Save and Restart LSP</button>
        </div>
      </div>
    </div>`;
  document.body.append(backdrop);

  const valueOf = (selector) => backdrop.querySelector(selector)?.value?.trim() ?? "";
  const nextConfig = () => ({
    ...state.config,
    lintMode: valueOf("#lintMode") || "basic",
    schemaVersion: valueOf("#schemaVersion"),
    vectorLspPath: valueOf("#vectorLspPath"),
    schemaPath: valueOf("#schemaPath"),
    pluginPath: valueOf("#pluginPath"),
    debugLogging: Boolean(backdrop.querySelector("#debugLogging")?.checked)
  });
  const finish = () => {
    backdrop.remove();
    els.host.focus();
  };
  const saveOptions = async ({ restart = false } = {}) => {
    state.config = nextConfig();
    await saveConfig(state.config);
    if ((restart || diagnosticsActive()) && diagnosticsActive() && state.workspace) startDiagnosticsForWorkspace();
    finish();
  };
  for (const button of backdrop.querySelectorAll("[data-pick-path]")) {
    button.addEventListener("click", async () => {
      const kind = button.dataset.pickPath;
      const input = backdrop.querySelector(kind === "vector" ? "#vectorLspPath" : kind === "schema" ? "#schemaPath" : "#pluginPath");
      const selected = kind === "vector" ? await pickFilePath() : await pickFolderPath();
      if (selected && input) input.value = selected;
    });
  }
  backdrop.querySelector("[data-lint-options-save]")?.addEventListener("click", () => saveOptions().catch(showError));
  backdrop.querySelector("[data-lint-options-restart]")?.addEventListener("click", () => saveOptions({ restart: true }).catch(showError));
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-lint-options-close]")) finish();
  });
}

function normaliseGridFont(value) {
  if (!value || value === "custom") return DEFAULT_GRID_FONT;
  return String(value).trim() || DEFAULT_GRID_FONT;
}

function fontOptionsHtml() {
  const seen = new Set();
  const options = [];
  for (const [label, value] of FONT_OPTIONS) {
    if (seen.has(value)) continue;
    seen.add(value);
    options.push(`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`);
  }
  if (!seen.has(state.gridFont)) {
    options.unshift(`<option value="${escapeHtml(state.gridFont)}">${escapeHtml(fontLabelFromFamily(state.gridFont))}</option>`);
  }
  return options.join("");
}

function populateFontSelect() {
  if (!els.fontSelect) return;
  els.fontSelect.innerHTML = fontOptionsHtml();
}

function fontLabelFromFamily(fontFamily) {
  return String(fontFamily).split(",")[0].replaceAll("'", "").replaceAll("\"", "").trim() || "Selected Font";
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

function toggleSidebar() {
  toggleExplorerPane();
}

function showPalette() {
  hideContextMenu();
  els.palette.classList.remove("hidden");
  els.paletteInput.value = "";
  renderPalette();
  els.paletteInput.focus();
}

function renderPalette() {
  const q = els.paletteInput.value.toLowerCase();
  const labels = commandLabels.filter(([, label]) => label.toLowerCase().includes(q));
  els.paletteResults.innerHTML = labels.map(([id, label]) => `<button data-run="${id}">${label}</button>`).join("");
  for (const button of els.paletteResults.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      Promise.resolve(runCommand(button.dataset.run)).catch(showError);
      els.palette.classList.add("hidden");
    });
  }
}

function showContextMenu({ x, y, hit }) {
  state.contextHit = hit;
  state.contextMenuActiveGroup = "";
  const canUnhide = activeDoc().hiddenRows.size > 0 || activeDoc().hiddenColumns.size > 0;
  const focusRow = hit?.row ?? state.selection.focus.row;
  const focusCol = hit?.column ?? state.selection.focus.column;
  const entries = [
    { id: "go-to-definition", label: "Go To Definition", disabled: !cellHasReference(focusRow, focusCol) },
    { type: "submenu", label: "Column Operations", items: colItems() },
    { type: "submenu", label: "Row Operations", items: rowItems() },
    { id: "resize-fit", label: "Resize To Fit" },
    { id: "resize-selected-fit", label: "Resize Selected To Fit" },
    { id: "unhide-all", label: "Unhide All", disabled: !canUnhide },
    { type: "submenu", label: "Fill", items: fillItems() },
    { type: "submenu", label: "Math", items: mathItems() },
    { id: "cut", label: "Cut", shortcut: "Ctrl+X" },
    { id: "copy", label: "Copy", shortcut: "Ctrl+C" },
    { id: "paste", label: "Paste", shortcut: "Ctrl+V" }
  ];
  els.contextMenu.innerHTML = entries.map(menuEntry).join("");
  for (const button of els.contextMenu.querySelectorAll("button[data-run]")) {
    button.addEventListener("click", () => {
      Promise.resolve(runCommand(button.dataset.run)).catch(showError);
      hideContextMenu();
    });
  }
  for (const group of els.contextMenu.querySelectorAll(".menu-group")) {
    const activate = () => openContextSubmenu(group);
    group.addEventListener("mouseenter", activate);
    group.querySelector(".submenu-label")?.addEventListener("focus", activate);
    group.querySelector(".submenu-label")?.addEventListener("click", (event) => {
      event.preventDefault();
      activate();
    });
  }
  els.contextMenu.classList.remove("hidden");
  els.contextMenu.dataset.x = String(x);
  els.contextMenu.dataset.y = String(y);
  positionContextMenu();
}

function positionContextMenu() {
  if (els.contextMenu.classList.contains("hidden")) return;
  const requestedX = Number(els.contextMenu.dataset.x);
  const requestedY = Number(els.contextMenu.dataset.y);
  const rect = els.contextMenu.getBoundingClientRect();
  const margin = 8;
  const left = requestedX + rect.width + margin > window.innerWidth ? requestedX - rect.width : requestedX;
  const top = requestedY + rect.height + margin > window.innerHeight ? requestedY - rect.height : requestedY;
  els.contextMenu.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin))}px`;
  els.contextMenu.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin))}px`;
  for (const group of els.contextMenu.querySelectorAll(".menu-group.active")) positionSubmenu(group);
}

function openContextSubmenu(group) {
  if (!group) return;
  state.contextMenuActiveGroup = group.dataset.menuGroup ?? "";
  for (const candidate of els.contextMenu.querySelectorAll(".menu-group")) {
    candidate.classList.toggle("active", candidate === group);
  }
  positionSubmenu(group);
}

function positionSubmenu(group) {
  const submenu = group.querySelector(".submenu");
  if (!submenu) return;
  submenu.style.left = "100%";
  submenu.style.right = "auto";
  submenu.style.top = "0px";
  submenu.dataset.side = "right";
  const groupRect = group.getBoundingClientRect();
  const submenuRect = submenu.getBoundingClientRect();
  const margin = 8;
  if (groupRect.right + submenuRect.width + margin > window.innerWidth) {
    submenu.style.left = "auto";
    submenu.style.right = "100%";
    submenu.dataset.side = "left";
  }
  const overflowBottom = groupRect.top + submenuRect.height + margin - window.innerHeight;
  const overflowTop = groupRect.top - Math.max(0, overflowBottom);
  if (overflowBottom > 0) submenu.style.top = `${-overflowBottom}px`;
  if (overflowTop < margin) submenu.style.top = `${Number.parseFloat(submenu.style.top) + (margin - overflowTop)}px`;
}

function hideContextMenu() {
  els.contextMenu.classList.add("hidden");
  state.contextMenuActiveGroup = "";
  for (const group of els.contextMenu.querySelectorAll(".menu-group.active")) group.classList.remove("active");
}

function menuButton(item) {
  return `<button data-run="${item.id}" ${item.disabled ? "disabled" : ""}><span>${item.checked ? "[x] " : ""}${item.label}</span><span>${item.shortcut ?? ""}</span></button>`;
}

function menuEntry(entry) {
  if (entry.type === "submenu") return submenu(entry.label, entry.items);
  return menuButton(entry);
}

function submenu(label, items) {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `<div class="menu-group" data-menu-group="${key}"><button class="submenu-label"><span>${label}</span><span class="menu-arrow">></span></button><div class="submenu">${items.map(menuButton).join("")}</div></div>`;
}

function rowItems() {
  return [
    { id: "add-row", label: "Add Rows..." },
    { id: "insert-row", label: "Insert Row" },
    { id: "clone-row", label: "Clone Row", disabled: rowsForContextOperation().filter((row) => row > 0 && row < activeDoc().rowCount).length === 0 },
    { id: "hide-row", label: "Hide Row(s)" },
    { id: "delete-row", label: "Delete Row(s)" }
  ];
}

function colItems() {
  return [
    { id: "add-column", label: "Add Columns..." },
    { id: "insert-column", label: "Insert Column" },
    { id: "hide-column", label: "Hide Column(s)" },
    { id: "delete-column", label: "Delete Column(s)" }
  ];
}

function fillItems() {
  return [
    { id: "fill", label: "Fill" },
    { id: "increment-fill", label: "Increment Fill" }
  ];
}

function mathItems() {
  return [
    { id: "math-add", label: "Add" },
    { id: "math-subtract", label: "Subtract" },
    { id: "math-multiply", label: "Multiply" },
    { id: "math-divide", label: "Divide" }
  ];
}

function renderChrome() {
  if (state.lsp.diagnosticsStartup && diagnosticsActive()) {
    state.lsp.diagnosticsStats.renderChromeDuringStartup += 1;
  }
  els.shell.classList.toggle("sidebar-hidden", !state.sidebarVisible);
  els.shell.classList.toggle("problems-open", state.problemsVisible);
  els.problemsPanel?.classList.toggle("hidden", !state.problemsVisible);
  for (const btn of document.querySelectorAll("[data-bottom-tab]")) {
    btn.classList.toggle("active", btn.dataset.bottomTab === state.bottomTab);
  }
  if (els.problemsList) els.problemsList.classList.toggle("hidden", state.bottomTab !== "problems");
  if (els.logList) els.logList.classList.toggle("hidden", state.bottomTab !== "log");
  els.emptyState.classList.toggle("hidden", hasOpenDocument());
  updateChromeButtonStates();
  renderTabsAndFileList();
  if (state.problemsVisible) renderProblemsOnly();
  else if (els.problemsList) els.problemsList.innerHTML = "";
  bindChromeListEvents();
}

function renderDiagnosticsChrome() {
  updateChromeButtonStates();
  renderTabsAndFileList();
  if (state.problemsVisible && state.bottomTab === "problems") renderProblemsOnly();
  else if (!state.problemsVisible && els.problemsList) els.problemsList.innerHTML = "";
  bindChromeListEvents();
}

function updateChromeButtonStates() {
  for (const button of document.querySelectorAll("[data-command='show-explorer']")) {
    button.classList.toggle("active", state.sidebarVisible);
    const count = lintNotificationCount();
    if (count) {
      button.dataset.badge = String(count);
      button.title = `Explorer (${count} problems)`;
    } else {
      delete button.dataset.badge;
      button.title = "Explorer";
    }
  }
  for (const button of document.querySelectorAll("[data-command='show-problems']")) {
    button.classList.toggle("active", state.problemsVisible);
    button.textContent = "P";
    const count = lintNotificationCount();
    button.title = count ? `Problems (${count})` : "Problems";
  }
  for (const button of document.querySelectorAll("[data-command='toggle-freeze-row']")) {
    button.classList.toggle("active", state.freezeRow);
  }
  for (const button of document.querySelectorAll("[data-command='toggle-freeze-column']")) {
    button.classList.toggle("active", state.freezeColumn);
  }
  for (const button of document.querySelectorAll("[data-command='toggle-colorize']")) {
    button.classList.toggle("active", state.colorizeColumns);
  }
  for (const button of document.querySelectorAll("[data-command='open-settings']")) {
    button.classList.remove("active");
  }
  for (const button of document.querySelectorAll("[data-command='open-lint-options']")) {
    button.classList.remove("active");
  }
  for (const button of document.querySelectorAll("[data-command='toggle-lint']")) {
    button.classList.toggle("active", state.lint.enabled);
    button.textContent = state.lint.enabled ? "Lint: On" : "Lint: Off";
  }
  for (const button of document.querySelectorAll("[data-command='toggle-theme']")) {
    button.textContent = state.theme === "dark" ? "Light Mode" : "Dark Mode";
    button.classList.remove("active");
  }
  if (els.lintSummary) els.lintSummary.textContent = lintSummaryText();
  if (els.fontSelect) {
    const hasOption = [...els.fontSelect.options].some((option) => option.value === state.gridFont);
    if (!hasOption) populateFontSelect();
    els.fontSelect.value = state.gridFont;
  }
}

function renderTabsAndFileList() {
  els.tabs.innerHTML = state.docs
    .map((doc, index) => `<button class="${index === state.active ? "active" : ""}" data-tab="${index}"><span class="tab-title">${escapeHtml(doc.name)}${doc.dirty ? "*" : ""}</span><span class="tab-close" data-close-tab="${index}" title="Close">x</span></button>`)
    .join("");
  const workspaceFiles = renderWorkspaceFileList(state.docs);
  els.fileList.innerHTML = state.docs
    .map((doc, index) => `<button class="${index === state.active ? "active" : ""}" data-tab="${index}">${escapeHtml(doc.name)}${problemBadgeForPath(doc.path || doc.name)}</button>`)
    .join("") + (workspaceFiles ? `<div class="separator"></div>${workspaceFiles}` : "");
}

function renderProblemsOnly() {
  if (els.problemsList) {
    els.problemsList.innerHTML = renderProblemsPanel();
    for (const details of els.problemsList.querySelectorAll("details[data-file-name]")) {
      details.addEventListener("toggle", () => {
        const fn = details.dataset.fileName;
        if (details.open) collapsedProblemFiles.delete(fn);
        else collapsedProblemFiles.add(fn);
      });
    }
  }
}

function bindChromeListEvents() {
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.addEventListener("click", (event) => {
      if (event?.target?.closest("[data-close-tab]")) return;
      state.active = Number(button.dataset.tab);
      state.selection.set(0, 0);
      applyFreezeToDoc(activeDoc());
      grid.setDocument(activeDoc());
      updateGridDiagnostics();
      renderChrome();
      scrollProblemsToActiveFile();
    });
  }
  for (const button of document.querySelectorAll("[data-close-tab]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(Number(button.dataset.closeTab)).catch(showError);
    });
  }
  for (const button of document.querySelectorAll("[data-open-path]")) {
    button.addEventListener("click", async () => openDroppedNativePaths([button.dataset.openPath]).catch(showError));
  }
  for (const details of els.fileList.querySelectorAll("details[data-file-group]")) {
    details.addEventListener("toggle", () => {
      const g = details.dataset.fileGroup;
      if (details.open) collapsedFileGroups.delete(g);
      else collapsedFileGroups.add(g);
    });
  }
  for (const button of document.querySelectorAll("[data-diagnostic-id]")) {
    button.addEventListener("click", async () => goToDiagnostic(button.dataset.diagnosticId).catch(showError));
  }
}

function renderProblemsPanel() {
  if (!state.problemsVisible) return "";
  if (!state.lint.enabled) return `<div class="empty-problems">Lint is off.</div>`;
  if (!state.lsp.started) return `<div class="empty-problems">Open a folder to enable linting.</div>`;
  if (!state.lint.diagnostics.length) return `<div class="empty-problems">No problems.</div>`;
  return groupDiagnosticsByFile(state.lint.diagnostics).map(([fileName, diagnostics]) => `
    <details class="problem-file-group" data-file-name="${escapeHtml(fileName)}"${collapsedProblemFiles.has(fileName) ? "" : " open"}>
      <summary class="problem-file-header">${escapeHtml(fileName)} <span class="problem-file-count">(${diagnostics.length})</span></summary>
      ${diagnostics.map((diagnostic) => `
        <button class="problem-item" data-severity="${escapeHtml(diagnostic.severity)}" data-diagnostic-id="${escapeHtml(diagnostic.id)}">
          <span class="problem-location">R${diagnostic.rowIndex + 1}:C${diagnostic.columnIndex + 1}</span>
          <span class="problem-message">${escapeHtml(diagnostic.message)}</span>
          ${diagnostic.ruleId ? `<span class="problem-rule">${escapeHtml(diagnostic.ruleId)}</span>` : ""}
        </button>
      `).join("")}
    </details>
  `).join("");
}

function lintSummaryText() {
  if (!state.problemsVisible) return "";
  if (!state.lint.enabled) return "Lint off";
  if (!state.lsp.started) return "Open a folder to enable linting";
  if (state.lint.status) return state.lint.status;
  const counts = diagnosticCounts(state.lint.diagnostics);
  const fileCount = state.lsp.openFileCount ?? 0;
  if (!state.lint.diagnostics.length) return `No problems (${fileCount} file${fileCount === 1 ? "" : "s"} linted)`;
  return `${counts.error} errors, ${counts.warning} warnings, ${counts.info} info (${fileCount} files)`;
}

function diagnosticCounts(diagnostics) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of diagnostics) counts[diagnostic.severity] = (counts[diagnostic.severity] ?? 0) + 1;
  return counts;
}

function groupDiagnosticsByFile(diagnostics) {
  const groups = new Map();
  for (const diagnostic of diagnostics) {
    if (!groups.has(diagnostic.fileName)) groups.set(diagnostic.fileName, []);
    groups.get(diagnostic.fileName).push(diagnostic);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function problemBadgeForPath(path) {
  if (!lintNotificationsVisible()) return "";
  if (!path) return "";
  const key = lintPathKey(path);
  const count = diagnosticCountForFileKey(key);
  return count ? ` <span class="file-problem-badge">${count}</span>` : "";
}

function lintNotificationsVisible() {
  return diagnosticsActive() && state.lint.diagnostics.length > 0;
}

function lintNotificationCount() {
  return lintNotificationsVisible() ? state.lint.diagnostics.length : 0;
}

async function closeTab(index) {
  if (index < 0 || index >= state.docs.length) return;
  const doc = state.docs[index];
  if (doc.dirty) {
    const choice = await askCloseChoice(doc);
    if (choice === "cancel") return;
    if (choice === "save") {
      const previous = state.active;
      state.active = index;
      grid.setDocument(activeDoc());
      const saved = await saveFile();
      state.active = previous;
      if (!saved || doc.dirty) {
        grid.setDocument(activeDoc());
        updateGridDiagnostics();
        renderChrome();
        return;
      }
    }
  }
  lspCloseDoc(doc).catch(() => {});
  state.docs.splice(index, 1);
  if (!state.docs.length) {
    state.active = -1;
    grid.setDocument(EMPTY_DOC);
  } else {
    state.active = clamp(index <= state.active ? state.active - 1 : state.active, 0, state.docs.length - 1);
    grid.setDocument(activeDoc());
  }
  updateGridDiagnostics();
  renderChrome();
}

let pendingCloseResolve = null;
function askCloseChoice(doc) {
  els.closeDialogText.textContent = `${doc.name} has unsaved changes.`;
  els.closeDialog.classList.remove("hidden");
  return new Promise((resolve) => {
    pendingCloseResolve = resolve;
  });
}

function rowsFromRect(rect) {
  return range(rect.top, rect.bottom);
}

function columnsFromRect(rect) {
  return range(rect.left, rect.right);
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

function isTextInputTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

function isTextLikeFile(file) {
  return isTextLikePath(file.name);
}

function renderWorkspaceFileList(docs) {
  if (!state.workspace?.files?.length) return "";
  const seenKeys = new Set(docs.map((d) => lintPathKey(d.path || "")));
  const wsKey = lintPathKey(state.workspace.path).replace(/\/$/, "");
  const rootFiles = [];
  const subDirMap = new Map();
  for (const file of state.workspace.files) {
    const key = lintPathKey(file.path);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    let rel = key.startsWith(wsKey + "/") ? key.slice(wsKey.length + 1) : file.name;
    const slash = rel.indexOf("/");
    if (slash < 0) {
      rootFiles.push(file);
    } else {
      const dir = rel.slice(0, slash);
      if (!subDirMap.has(dir)) subDirMap.set(dir, []);
      subDirMap.get(dir).push(file);
    }
  }
  const fileBtn = (file) => `<button data-open-path="${escapeHtml(file.path)}">${escapeHtml(file.name)}${problemBadgeForPath(file.path)}</button>`;
  if (subDirMap.size === 0) {
    return rootFiles.map(fileBtn).join("");
  }
  const group = (label, files) => {
    const open = !collapsedFileGroups.has(label);
    return `<details class="file-group"${open ? " open" : ""} data-file-group="${escapeHtml(label)}"><summary class="file-group-label">${escapeHtml(label)}</summary><div class="file-group-content">${files.map(fileBtn).join("")}</div></details>`;
  };
  return (rootFiles.length ? group("Data Files", rootFiles) : "") +
    [...subDirMap.entries()].map(([dir, files]) => group(dir, files)).join("");
}

function isTextLikePath(path) {
  return /\.(txt|tsv|tbl|csv)$/i.test(path);
}

function lintDocKey(doc) {
  return lintPathKey(doc?.path || doc?.name || "");
}

function lintPathKey(path) {
  return String(path || "").replace(/\\/g, "/").toLowerCase();
}

function readJsonStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

let toastTimer = 0;
function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  els.toast.textContent = message || "Action failed.";
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 5200);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2600);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
