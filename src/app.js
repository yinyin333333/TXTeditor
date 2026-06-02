import { TableDocument, clamp } from "./core/table-model.js";
import { SelectionModel } from "./core/selection.js";
import { UndoManager, makeCellCommand, makeCustomCommand } from "./core/undo.js";
import { findInTable } from "./core/search.js";
import {
  addColumnsCommand,
  addRowsCommand,
  arithmeticCommand,
  clearRangeCommand,
  copyRange,
  deleteColumnsCommand,
  deleteRowsCommand,
  fillSelectionCommand,
  hiddenColumnsCommand,
  hiddenRowsCommand,
  incrementFillCommand,
  insertColumnCommand,
  insertRowCommand,
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
document.documentElement.dataset.theme = savedTheme;
document.documentElement.style.setProperty("--grid-font", savedGridFont);

const state = {
  docs: [],
  active: 0,
  selection: new SelectionModel(),
  workspace: null,
  sidebarVisible: localStorage.getItem("txteditor.sidebar") !== "hidden",
  contextHit: null,
  theme: savedTheme,
  gridFont: savedGridFont,
  colorizeColumns: savedColorize
};

const els = {
  shell: document.getElementById("app"),
  sidebar: document.getElementById("sidebar"),
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
  ["zoom-in", "Zoom In"],
  ["zoom-out", "Zoom Out"],
  ["zoom-reset", "Reset Zoom"],
  ["resize-fit", "Resize To Fit"],
  ["resize-selected-fit", "Resize Selected To Fit"],
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
  command.redo(activeDoc());
  activeUndo().push(command);
  grid.layout();
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
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") findNext();
    if (event.key === "Escape") els.searchPanel.classList.add("hidden");
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
  if (event.key === "Escape" && !els.contextMenu.classList.contains("hidden")) {
    event.preventDefault();
    hideContextMenu();
    return;
  }
  if (event.key === "Escape" && !els.searchPanel.classList.contains("hidden")) {
    event.preventDefault();
    els.searchPanel.classList.add("hidden");
    els.host.focus();
    return;
  }
  if (event.key === "Escape" && !els.palette.classList.contains("hidden")) {
    event.preventDefault();
    els.palette.classList.add("hidden");
    els.host.focus();
    return;
  }
  const key = event.key.toLowerCase();
  const editingCell = els.editor.classList.contains("active");
  if (editingCell && !(event.ctrlKey && ["s", "w"].includes(key))) return;
  if (event.ctrlKey && (key === "+" || key === "=")) return prevent(event, () => runCommand("zoom-in"));
  if (event.ctrlKey && key === "-") return prevent(event, () => runCommand("zoom-out"));
  if (event.ctrlKey && key === "0") return prevent(event, () => runCommand("zoom-reset"));
  if (event.ctrlKey && key === "o") return prevent(event, openFile);
  if (event.ctrlKey && key === "b") return prevent(event, toggleSidebar);
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
    renderChrome();
  }
}

function redo() {
  if (activeUndo().redo(activeDoc())) {
    grid.layout();
    renderChrome();
  }
}

function showSearch() {
  els.searchPanel.classList.remove("hidden");
  els.searchInput.focus();
  els.searchInput.select();
}

function findNext() {
  const found = findInTable(activeDoc(), els.searchInput.value, state.selection.focus);
  if (!found) {
    els.searchStatus.textContent = "No results";
    return;
  }
  state.selection.set(found.row, found.column);
  grid.scrollCellIntoView(found.row, found.column);
  grid.draw();
  els.searchStatus.textContent = `R${found.row + 1}:C${found.column + 1}`;
}

function runCommand(id) {
  const alwaysAvailable = new Set(["open-file", "open-folder", "toggle-sidebar", "toggle-theme", "toggle-colorize", "zoom-in", "zoom-out", "zoom-reset", "load-fixture-20k", "load-fixture-200k"]);
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
  if (id === "clear-selection") return execute(clearRangeCommand(doc, rect));
  if (id === "add-row") return addRows();
  if (id === "insert-row") return execute(insertRowCommand(doc, rect.top));
  if (id === "delete-row") return execute(deleteRowsCommand(doc, rect.top, rect.bottom - rect.top + 1));
  if (id === "clear-row") return execute(clearRangeCommand(doc, { top: rect.top, bottom: rect.bottom, left: 0, right: doc.columnCount - 1 }, "Clear Row"));
  if (id === "hide-row") return execute(hiddenRowsCommand(rowsFromRect(rect), true));
  if (id === "unhide-rows") return execute(hiddenRowsCommand([...doc.hiddenRows], false));
  if (id === "add-column") return addColumns();
  if (id === "insert-column") return execute(insertColumnCommand(doc, rect.left));
  if (id === "delete-column") return execute(deleteColumnsCommand(doc, rect.left, rect.right - rect.left + 1));
  if (id === "clear-column") return execute(clearRangeCommand(doc, { top: 0, bottom: doc.rowCount - 1, left: rect.left, right: rect.right }, "Clear Column"));
  if (id === "hide-column") return execute(hiddenColumnsCommand(columnsFromRect(rect), true));
  if (id === "unhide-columns") return execute(hiddenColumnsCommand([...doc.hiddenColumns], false));
  if (id === "unhide-all") return unhideAll();
  if (id === "fill") return execute(fillSelectionCommand(doc, rect));
  if (id === "increment-fill") return execute(incrementFillCommand(doc, rect));
  if (id.startsWith("math-")) return math(id.replace("math-", ""));
  if (id === "toggle-freeze-row") return toggleFreeze("row");
  if (id === "toggle-freeze-column") return toggleFreeze("column");
  if (id === "toggle-colorize") return toggleColorize();
  if (id === "zoom-in") return zoomBy(0.1);
  if (id === "zoom-out") return zoomBy(-0.1);
  if (id === "zoom-reset") return zoomReset();
  if (id === "resize-fit") return resizeFit(false);
  if (id === "resize-selected-fit") return resizeFit(true);
  if (id === "toggle-sidebar") return toggleSidebar();
  if (id === "toggle-theme") return toggleTheme();
}

async function copySelection() {
  if (!hasOpenDocument()) return;
  await navigator.clipboard.writeText(copyRange(activeDoc(), state.selection.rect));
}

async function cutSelection() {
  await copySelection();
  execute(clearRangeCommand(activeDoc(), state.selection.rect, "Cut"));
}

async function pasteSelection() {
  if (!hasOpenDocument()) return;
  const text = await navigator.clipboard.readText();
  execute(pasteTextCommand(activeDoc(), state.selection.focus, text));
}

function selectAll() {
  state.selection.selectAll(activeDoc().rowCount, activeDoc().columnCount);
  grid.draw();
}

function addRows() {
  const count = promptCount("Add Rows", "How many rows do you want to add?", 1);
  if (count !== null) execute(addRowsCommand(activeDoc(), count));
}

function addColumns() {
  const count = promptCount("Add Columns", "How many columns do you want to add?", 1);
  if (count !== null) execute(addColumnsCommand(activeDoc(), count));
}

function promptCount(title, message, fallback) {
  const raw = prompt(`${title}\n${message}`, String(fallback));
  if (raw === null) return null;
  const count = Number.parseInt(raw, 10);
  if (!Number.isFinite(count) || count <= 0) {
    showError("Enter a positive whole number.");
    return null;
  }
  return count;
}

function math(kind) {
  const operator = { add: "+", subtract: "-", multiply: "*", divide: "/" }[kind];
  const operand = prompt(`Apply ${operator} to numeric selected cells:`);
  if (operand !== null) execute(arithmeticCommand(activeDoc(), state.selection.rect, operator, operand));
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
    const rows = useSelection ? rowsFromRect(rect) : [hit?.row ?? state.selection.focus.row];
    return autoFitRows(rows);
  }
  if (isFullColumnSelection(rect, doc) || hit?.row === 0 || hit?.kind === "column-header") {
    const columns = useSelection ? columnsFromRect(rect) : [hit?.column ?? state.selection.focus.column];
    return autoFitColumns(columns);
  }
  return autoFitColumns(useSelection ? columnsFromRect(rect) : [state.selection.focus.column]);
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
  state.sidebarVisible = !state.sidebarVisible;
  localStorage.setItem("txteditor.sidebar", state.sidebarVisible ? "visible" : "hidden");
  renderChrome();
  grid.layout();
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
    group.addEventListener("mouseenter", () => positionSubmenu(group));
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
  for (const group of els.contextMenu.querySelectorAll(".menu-group")) positionSubmenu(group);
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
}

function menuButton(item) {
  return `<button data-run="${item.id}" ${item.disabled ? "disabled" : ""}><span>${item.checked ? "[x] " : ""}${item.label}</span><span>${item.shortcut ?? ""}</span></button>`;
}

function menuEntry(entry) {
  if (entry.type === "submenu") return submenu(entry.label, entry.items);
  return menuButton(entry);
}

function submenu(label, items) {
  return `<div class="menu-group"><button class="submenu-label"><span>${label}</span><span class="menu-arrow">></span></button><div class="submenu">${items.map(menuButton).join("")}</div></div>`;
}

function rowItems() {
  return [
    { id: "add-row", label: "Add Rows..." },
    { id: "insert-row", label: "Insert Row" },
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
  els.emptyState.classList.toggle("hidden", hasOpenDocument());
  for (const button of document.querySelectorAll("[data-command='toggle-freeze-row']")) {
    button.classList.toggle("active", hasOpenDocument() && activeDoc().freezeFirstRow);
  }
  for (const button of document.querySelectorAll("[data-command='toggle-freeze-column']")) {
    button.classList.toggle("active", hasOpenDocument() && activeDoc().freezeFirstColumn);
  }
  for (const button of document.querySelectorAll("[data-command='toggle-colorize']")) {
    button.classList.toggle("active", state.colorizeColumns);
  }
  for (const button of document.querySelectorAll("[data-command='toggle-theme']")) {
    button.textContent = state.theme === "dark" ? "Light Mode" : "Dark Mode";
    button.classList.remove("active");
  }
  if (els.fontSelect) {
    const hasOption = [...els.fontSelect.options].some((option) => option.value === state.gridFont);
    if (!hasOption) populateFontSelect();
    els.fontSelect.value = state.gridFont;
  }
  els.tabs.innerHTML = state.docs
    .map((doc, index) => `<button class="${index === state.active ? "active" : ""}" data-tab="${index}"><span class="tab-title">${escapeHtml(doc.name)}${doc.dirty ? "*" : ""}</span><span class="tab-close" data-close-tab="${index}" title="Close">x</span></button>`)
    .join("");
  const workspaceFiles = state.workspace?.files?.map((file) => `<button data-open-path="${escapeHtml(file.path)}">${escapeHtml(file.name)}</button>`).join("") ?? "";
  els.fileList.innerHTML = state.docs
    .map((doc, index) => `<button class="${index === state.active ? "active" : ""}" data-tab="${index}">${escapeHtml(doc.name)}</button>`)
    .join("") + (workspaceFiles ? `<div class="separator"></div>${workspaceFiles}` : "");
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.addEventListener("click", (event) => {
      if (event?.target?.closest("[data-close-tab]")) return;
      state.active = Number(button.dataset.tab);
      state.selection.set(0, 0);
      grid.setDocument(activeDoc());
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

function isFullRowSelection(rect, doc) {
  return rect.left === 0 && rect.right >= doc.columnCount - 1;
}

function isFullColumnSelection(rect, doc) {
  return rect.top === 0 && rect.bottom >= doc.rowCount - 1;
}

function range(start, end) {
  const values = [];
  for (let value = start; value <= end; value++) values.push(value);
  return values;
}

function isTextLikeFile(file) {
  return isTextLikePath(file.name);
}

function isTextLikePath(path) {
  return /\.(txt|tsv|tbl|csv)$/i.test(path);
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
