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
  insertColumnCommand,
  insertRowCommand,
  pasteTextToRangesCommand,
  pasteTextCommand,
  resizeColumnCommand,
  resizeRowCommand
} from "./core/operations.js";
import {
  downloadText,
  isTauriRuntime,
  listenForNativeDrops,
  openFilesNative,
  openNativePaths,
  openWorkspaceNative,
  readFileAsDocument,
  saveDocumentNative
} from "./core/io.js";
import {
  createDefaultLintSettings,
  diagnosticsForDocument,
  groupDiagnosticsByCell,
  lintRuleGroupsForProfile,
  lintProfileOptions,
  normalizeLintSettings,
  runLint
} from "./core/lint-engine.js";
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
const savedLintSettings = normalizeLintSettings(readJsonStorage("txteditor.lint.settings", createDefaultLintSettings()));
const MIN_SIDEBAR_WIDTH = 260;
const savedSidebarWidth = clamp(Number(localStorage.getItem("txteditor.sidebarWidth")) || MIN_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, 520);
const savedProblemsHeight = clamp(Number(localStorage.getItem("txteditor.problemsHeight")) || 260, 150, 520);
document.documentElement.dataset.theme = savedTheme;
document.documentElement.style.setProperty("--grid-font", savedGridFont);
document.documentElement.style.setProperty("--sidebar-width", `${savedSidebarWidth}px`);
document.documentElement.style.setProperty("--problems-height", `${savedProblemsHeight}px`);

const state = {
  docs: [],
  active: 0,
  selection: new SelectionModel(),
  workspace: null,
  workspaceDocs: [],
  workspaceLoad: {
    status: "not-started",
    files: [],
    error: ""
  },
  search: {
    lastQuery: ""
  },
  sidebarVisible: localStorage.getItem("txteditor.sidebar") !== "hidden",
  sidebarWidth: savedSidebarWidth,
  problemsVisible: localStorage.getItem("txteditor.problems") === "visible",
  problemsHeight: savedProblemsHeight,
  contextHit: null,
  contextMenuActiveGroup: "",
  theme: savedTheme,
  gridFont: savedGridFont,
  colorizeColumns: savedColorize,
  lint: {
    settings: savedLintSettings,
    diagnostics: [],
    timer: 0,
    version: 0,
    running: false,
    status: "",
    rulesOpen: false,
    lastRunAt: 0
  }
};

const els = {
  shell: document.getElementById("app"),
  sidebar: document.getElementById("sidebar"),
  sidebarResizer: document.getElementById("sidebarResizer"),
  problemsPanel: document.getElementById("problemsPanel"),
  problemsResizer: document.getElementById("problemsResizer"),
  problemsList: document.getElementById("problemsList"),
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
  lintProfileSelect: document.getElementById("lintProfileSelect"),
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
  closeDialogText: document.getElementById("closeDialogText")
};

const isDevelopmentMode = ["localhost", "127.0.0.1", ""].includes(location.hostname);

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
  ["toggle-theme", "Toggle Light/Dark Mode"]
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
  onResizeCommand: commitResize
});

grid.setFontFamily(state.gridFont);
grid.setColorizeColumns(state.colorizeColumns);
populateFontSelect();
renderChrome();
wireEvents();
listenForNativeDrops((paths) => openDroppedNativePaths(paths)).catch(showError);

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
  scheduleLintForChange(doc);
  renderChrome();
}

function applyEdits(edits, label = "Edit Cells") {
  execute(makeCellCommand(label, activeDoc(), edits));
}

function wireEvents() {
  document.addEventListener("click", (event) => {
    const command = event.target.closest("[data-command]")?.dataset.command;
    if (command) Promise.resolve(commands[command]?.()).catch(showError);
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
  window.addEventListener("resize", () => positionContextMenu());
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
  els.fontSelect.addEventListener("change", () => changeGridFont(els.fontSelect.value));
  els.lintProfileSelect?.addEventListener("change", () => setLintProfile(els.lintProfileSelect.value));
  els.lintRulesPanel?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-lint-rule]");
    if (input) setLintRuleEnabled(input.dataset.lintRule, input.checked);
  });
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
    renderChrome();
    return;
  }
  doc.undo = new UndoManager();
  doc.zoom = 1;
  state.docs.push(doc);
  state.active = state.docs.length - 1;
  grid.setDocument(doc);
  if (!doc.initialColumnFitApplied) {
    grid.autoFitInitialColumns();
    doc.initialColumnFitApplied = true;
    grid.layout();
  }
  renderChrome();
  if (lintActive()) scheduleLintFull("open-document");
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
    state.workspace = await openWorkspaceNative();
    state.workspaceDocs = [];
    state.workspaceLoad = { status: "not-started", files: workspaceFileStatesForExplorer(), error: "" };
    cancelLintJobs({ clearDiagnostics: true });
    if (lintActive()) scheduleLintFull("open-workspace", 0);
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
    scheduleLintForChange(activeDoc());
    renderChrome();
  }
}

function redo() {
  if (activeUndo().redo(activeDoc())) {
    grid.layout();
    scheduleLintForChange(activeDoc());
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
  const alwaysAvailable = new Set(["open-file", "open-folder", "toggle-sidebar", "toggle-theme", "toggle-colorize", "toggle-lint", "toggle-lint-rules", "show-explorer", "show-problems", "zoom-in", "zoom-out", "zoom-reset", "load-fixture-20k", "load-fixture-200k"]);
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
  if (id === "toggle-lint-rules") return toggleLintRules();
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
  const doc = activeDoc();
  if (kind === "row") doc.freezeFirstRow = !doc.freezeFirstRow;
  if (kind === "column") doc.freezeFirstColumn = !doc.freezeFirstColumn;
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
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem("txteditor.theme", state.theme);
  grid.syncTheme();
  grid.draw();
  renderChrome();
}

function toggleColorize() {
  state.colorizeColumns = !state.colorizeColumns;
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

function toggleLint() {
  state.lint.settings.enabled = !state.lint.settings.enabled;
  if (!state.lint.settings.enabled) {
    cancelLintJobs({ clearDiagnostics: true });
  } else {
    if (state.problemsVisible) scheduleLintFull("lint-enabled", 0);
  }
  saveLintSettings();
  renderChrome();
}

function toggleLintRules() {
  state.lint.rulesOpen = !state.lint.rulesOpen;
  renderChrome();
}

function setLintProfile(profile) {
  state.lint.settings.profile = lintProfileOptions().includes(profile) ? profile : "RotW";
  state.lint.diagnostics = [];
  updateGridDiagnostics();
  saveLintSettings();
  if (lintActive()) scheduleLintFull("profile-changed", 0);
  renderChrome();
}

function setLintRuleEnabled(ruleId, enabled) {
  const rule = currentProfileRules()[ruleId];
  if (!rule) return;
  rule.enabled = Boolean(enabled);
  saveLintSettings();
  if (lintActive()) scheduleLintFull("settings-changed", 120);
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
  if (state.problemsVisible && state.lint.settings.enabled) {
    scheduleLintFull("problems-opened", 0);
  } else if (!state.problemsVisible) {
    cancelLintJobs({ clearDiagnostics: false });
  }
  renderChrome();
  grid.layout();
  if (!state.problemsVisible && gridHadFocus) els.host.focus();
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

function scheduleLintForChange(doc) {
  if (!lintActive()) return;
  scheduleLintFull(docHasDiagnostics(doc) ? "diagnostic-file-edited" : "file-edited", 360);
}

function scheduleLintFull(reason = "change", delay = 420) {
  if (!lintActive()) return;
  clearTimeout(state.lint.timer);
  const version = ++state.lint.version;
  state.lint.timer = setTimeout(() => runLintNow(reason, version), delay);
}

async function runLintNow(reason = "lint", version = ++state.lint.version) {
  clearTimeout(state.lint.timer);
  state.lint.timer = 0;
  if (!lintActive() || version !== state.lint.version) return;
  state.lint.running = true;
  state.lint.status = state.workspace?.files?.length ? "Indexing workspace..." : `Linting ${state.lint.settings.profile}...`;
  renderChrome();
  try {
    await ensureWorkspaceIndexed(version);
    if (!lintActive() || version !== state.lint.version) return;
    state.lint.status = `Linting ${state.lint.settings.profile}...`;
    renderChrome();
    await yieldToUi();
    const diagnostics = runLint(activeLintDocuments(), state.lint.settings);
    if (version !== state.lint.version) return;
    state.lint.diagnostics = diagnostics;
    state.lint.lastRunAt = Date.now();
    updateGridDiagnostics();
  } finally {
    if (version === state.lint.version) {
      state.lint.running = false;
      state.lint.status = "";
      renderChrome();
    }
  }
}

function activeLintDocuments() {
  return [...state.docs, ...state.workspaceDocs];
}

function currentProfileRules() {
  return state.lint.settings.profiles?.[state.lint.settings.profile]?.rules ?? {};
}

function lintActive() {
  return state.problemsVisible && state.lint.settings.enabled;
}

function cancelLintJobs({ clearDiagnostics = false } = {}) {
  clearTimeout(state.lint.timer);
  state.lint.timer = 0;
  state.lint.version += 1;
  state.lint.running = false;
  state.lint.status = "";
  if (clearDiagnostics) {
    state.lint.diagnostics = [];
    updateGridDiagnostics();
  }
}

async function ensureWorkspaceIndexed(version) {
  if (!state.workspace?.files?.length) return;
  if (state.workspaceLoad.status === "ready" && state.workspaceDocs.length) return;
  const explorerFiles = workspaceTxtFiles();
  state.workspaceLoad = { status: "loading", files: workspaceFileStatesForExplorer(), error: "" };
  state.workspaceDocs = [];
  renderChrome();
  const docs = [];
  const fileStates = [];
  for (let index = 0; index < explorerFiles.length; index += 1) {
    if (!lintActive() || version !== state.lint.version) return;
    const file = explorerFiles[index];
    try {
      const [doc] = await openNativePaths([file.path], TableDocument);
      if (doc) {
        docs.push(doc);
        fileStates.push({
          filePath: file.path,
          fileName: file.name,
          listedInExplorer: true,
          loadedForIndex: true,
          parsedForLint: true,
          parseError: ""
        });
      }
    } catch (error) {
      fileStates.push({
        filePath: file.path,
        fileName: file.name,
        listedInExplorer: true,
        loadedForIndex: true,
        parsedForLint: false,
        parseError: error instanceof Error ? error.message : String(error)
      });
    }
    if (index % 20 === 19) await yieldToUi();
  }
  if (!lintActive() || version !== state.lint.version) return;
  state.workspaceDocs = mergeOpenWorkspaceDocs(docs);
  state.workspaceLoad = { status: "ready", files: fileStates, error: "" };
  renderChrome();
}

function workspaceTxtFiles() {
  return (state.workspace?.files ?? []).filter((file) => isTextLikePath(file.path || file.name));
}

function workspaceFileStatesForExplorer() {
  return workspaceTxtFiles().map((file) => ({
    filePath: file.path,
    fileName: file.name,
    listedInExplorer: true,
    loadedForIndex: false,
    parsedForLint: false,
    parseError: ""
  }));
}

function mergeOpenWorkspaceDocs(docs) {
  const openByKey = new Map(state.docs.map((doc) => [lintDocKey(doc), doc]));
  return docs.map((doc) => openByKey.get(lintDocKey(doc)) ?? doc);
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function updateGridDiagnostics() {
  grid.setDiagnostics(groupDiagnosticsByCell(diagnosticsForDocument(state.lint.diagnostics, activeDoc())));
}

function docHasDiagnostics(doc) {
  return diagnosticsForDocument(state.lint.diagnostics, doc).length > 0;
}

async function goToDiagnostic(id) {
  const diagnostic = state.lint.diagnostics.find((item) => item.id === id);
  if (!diagnostic) return;
  let index = state.docs.findIndex((doc) => lintDocKey(doc) === diagnostic.fileKey);
  if (index < 0) {
    const workspaceDoc = state.workspaceDocs.find((doc) => lintDocKey(doc) === diagnostic.fileKey);
    if (workspaceDoc) {
      await addDocument(workspaceDoc);
      index = state.active;
    } else if (diagnostic.filePath && isTauriRuntime()) {
      const [doc] = await openNativePaths([diagnostic.filePath], TableDocument);
      if (doc) {
        await addDocument(doc);
        index = state.active;
      }
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

function saveLintSettings() {
  localStorage.setItem("txteditor.lint.settings", JSON.stringify(state.lint.settings));
}

function normaliseGridFont(value) {
  if (!value || value === "custom") return DEFAULT_GRID_FONT;
  return String(value).trim() || DEFAULT_GRID_FONT;
}

function populateFontSelect() {
  if (!els.fontSelect) return;
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
  els.fontSelect.innerHTML = options.join("");
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
  showToast(`Resizing ${targets.length} column${targets.length === 1 ? "" : "s"} to fit...`);
  const before = targets.map((column) => doc.columnWidths[column]);
  const after = [];
  for (const column of targets) after.push(await grid.measureColumnFitWidth(column));
  const command = makeCustomCommand("Resize Column(s) to Fit", {
    empty: targets.every((column, index) => before[index] === after[index]),
    redo(target) {
      targets.forEach((column, index) => target.setColumnWidth(column, after[index]));
    },
    undo(target) {
      targets.forEach((column, index) => target.setColumnWidth(column, before[index]));
    }
  });
  execute(command);
  showToast("Resize to fit complete.");
}

function autoFitRows(rows) {
  const doc = activeDoc();
  const targets = [...new Set(rows)].filter((row) => row >= 0 && row < doc.rowCount && !doc.hiddenRows.has(row));
  const before = targets.map((row) => doc.rowHeights[row]);
  const after = targets.map(() => doc.defaultRowHeight);
  const command = makeCustomCommand("Resize Row(s) to Fit", {
    empty: targets.every((row, index) => before[index] === after[index]),
    redo(target) {
      targets.forEach((row, index) => target.setRowHeight(row, after[index]));
    },
    undo(target) {
      targets.forEach((row, index) => target.setRowHeight(row, before[index]));
    }
  });
  execute(command);
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
  const command = resize.kind === "column"
    ? resizeColumnCommand(resize.index, resize.before, resize.current)
    : resizeRowCommand(resize.index, resize.before, resize.current);
  activeUndo().push(command);
  activeDoc().dirty = true;
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
  const entries = [
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
  els.shell.classList.toggle("sidebar-hidden", !state.sidebarVisible);
  els.shell.classList.toggle("problems-open", state.problemsVisible);
  els.problemsPanel?.classList.toggle("hidden", !state.problemsVisible);
  els.emptyState.classList.toggle("hidden", hasOpenDocument());
  updateGridDiagnostics();
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
    button.title = state.lint.diagnostics.length ? `Problems (${state.lint.diagnostics.length})` : "Problems";
  }
  for (const button of document.querySelectorAll("[data-command='toggle-freeze-row']")) {
    button.classList.toggle("active", hasOpenDocument() && activeDoc().freezeFirstRow);
  }
  for (const button of document.querySelectorAll("[data-command='toggle-freeze-column']")) {
    button.classList.toggle("active", hasOpenDocument() && activeDoc().freezeFirstColumn);
  }
  for (const button of document.querySelectorAll("[data-command='toggle-colorize']")) {
    button.classList.toggle("active", state.colorizeColumns);
  }
  for (const button of document.querySelectorAll("[data-command='toggle-lint']")) {
    button.classList.toggle("active", state.lint.settings.enabled);
    button.textContent = state.lint.settings.enabled ? "Lint: On" : "Lint: Off";
  }
  for (const button of document.querySelectorAll("[data-command='toggle-lint-rules']")) {
    button.classList.toggle("active", state.lint.rulesOpen);
  }
  for (const button of document.querySelectorAll("[data-command='toggle-theme']")) {
    button.textContent = state.theme === "dark" ? "Light Mode" : "Dark Mode";
    button.classList.remove("active");
  }
  if (els.lintProfileSelect) els.lintProfileSelect.value = state.lint.settings.profile;
  if (els.lintSummary) els.lintSummary.textContent = lintSummaryText();
  if (els.lintRulesPanel) {
    els.lintRulesPanel.classList.toggle("hidden", !state.lint.rulesOpen);
    els.lintRulesPanel.innerHTML = renderLintRulesPanel();
  }
  if (els.fontSelect) {
    const hasOption = [...els.fontSelect.options].some((option) => option.value === state.gridFont);
    if (!hasOption) populateFontSelect();
    els.fontSelect.value = state.gridFont;
  }
  els.tabs.innerHTML = state.docs
    .map((doc, index) => `<button class="${index === state.active ? "active" : ""}" data-tab="${index}"><span class="tab-title">${escapeHtml(doc.name)}${doc.dirty ? "*" : ""}</span><span class="tab-close" data-close-tab="${index}" title="Close">x</span></button>`)
    .join("");
  const workspaceFiles = state.workspace?.files?.map((file) => `<button data-open-path="${escapeHtml(file.path)}">${escapeHtml(file.name)}${problemBadgeForPath(file.path)}</button>`).join("") ?? "";
  els.fileList.innerHTML = state.docs
    .map((doc, index) => `<button class="${index === state.active ? "active" : ""}" data-tab="${index}">${escapeHtml(doc.name)}${problemBadgeForPath(doc.path || doc.name)}</button>`)
    .join("") + (workspaceFiles ? `<div class="separator"></div>${workspaceFiles}` : "");
  if (els.problemsList) els.problemsList.innerHTML = renderProblemsPanel();
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.addEventListener("click", (event) => {
      if (event?.target?.closest("[data-close-tab]")) return;
      state.active = Number(button.dataset.tab);
      state.selection.set(0, 0);
      grid.setDocument(activeDoc());
      updateGridDiagnostics();
      renderChrome();
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
  for (const button of document.querySelectorAll("[data-diagnostic-id]")) {
    button.addEventListener("click", async () => goToDiagnostic(button.dataset.diagnosticId).catch(showError));
  }
}

function renderLintRulesPanel() {
  return lintRuleGroupsForProfile(state.lint.settings.profile).map((group) => `
    <section class="lint-rule-group">
      <h3>${escapeHtml(group.group)}</h3>
      ${group.rules.map((entry) => {
        const setting = currentProfileRules()[entry.id];
        const checked = setting?.enabled ? "checked" : "";
        const disabled = entry.implemented ? "" : "disabled";
        const note = entry.note ? `<span class="lint-rule-note">${escapeHtml(entry.note)}</span>` : `<span class="lint-rule-note">${escapeHtml(entry.id)}</span>`;
        return `
          <div class="lint-rule">
            <input id="lint-${escapeHtml(entry.id)}" type="checkbox" data-lint-rule="${escapeHtml(entry.id)}" ${checked} ${disabled} />
            <label for="lint-${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</label>
            ${note}
          </div>`;
      }).join("")}
    </section>
  `).join("");
}

function renderProblemsPanel() {
  if (!state.lint.settings.enabled) return `<div class="empty-problems">Lint is off.</div>`;
  if (!state.lint.diagnostics.length) return `<div class="empty-problems">No problems.</div>`;
  return groupDiagnosticsByFile(state.lint.diagnostics).map(([fileName, diagnostics]) => `
    <section class="problem-file-group">
      <div class="problem-file-header">${escapeHtml(fileName)} (${diagnostics.length})</div>
      ${diagnostics.map((diagnostic) => `
        <button class="problem-item" data-severity="${escapeHtml(diagnostic.severity)}" data-diagnostic-id="${escapeHtml(diagnostic.id)}">
          <span class="problem-title">${escapeHtml(diagnostic.locationLabel || diagnostic.rowLabel || diagnostic.fileName)}</span>
          <span class="problem-message">${escapeHtml(diagnostic.message)}</span>
          <span class="problem-meta">${escapeHtml(diagnostic.ruleId)} - ${escapeHtml(diagnostic.profile)} - row ${diagnostic.rowIndex + 1}, column ${diagnostic.columnIndex + 1}</span>
        </button>
      `).join("")}
    </section>
  `).join("");
}

function lintSummaryText() {
  if (!state.lint.settings.enabled) return "Lint off";
  if (state.lint.status) return state.lint.status;
  if (state.workspaceLoad.status === "failed") return `Workspace index failed - ${state.lint.settings.profile}`;
  const counts = diagnosticCounts(state.lint.diagnostics);
  if (!state.lint.diagnostics.length) return `No problems - ${state.lint.settings.profile}`;
  return `${counts.error} errors, ${counts.warning} warnings, ${counts.info} info - ${state.lint.settings.profile}`;
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
  return [...groups.entries()];
}

function problemBadgeForPath(path) {
  if (!lintNotificationsVisible()) return "";
  if (!path) return "";
  const key = lintPathKey(path);
  const count = state.lint.diagnostics.filter((diagnostic) => diagnostic.fileKey === key).length;
  return count ? ` <span class="file-problem-badge">${count}</span>` : "";
}

function lintNotificationsVisible() {
  return state.problemsVisible && state.lint.settings.enabled && state.lint.diagnostics.length > 0;
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
        renderChrome();
        return;
      }
    }
  }
  state.docs.splice(index, 1);
  if (!state.docs.length) {
    state.active = -1;
    grid.setDocument(EMPTY_DOC);
  } else {
    state.active = clamp(index <= state.active ? state.active - 1 : state.active, 0, state.docs.length - 1);
    grid.setDocument(activeDoc());
  }
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
