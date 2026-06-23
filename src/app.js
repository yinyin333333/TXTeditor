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
  lspGetDiagnostics,
  lspHover,
  lspDefinition,
  lspListen,
  lspLogListen,
  lspOpenFile,
  lspStart,
  lspUpdateFile,
  lspUpdateFileIncremental,
  openFilesNative,
  openNativePaths,
  openNativePathsBulk,
  openWorkspaceNative,
  pickFilePath,
  pickFolderPath,
  readFileAsDocument,
  saveConfig,
  saveDocumentNative
} from "./core/io.js";
import {
  createDefaultLintSettings,
  diagnosticsForDocument,
  groupDiagnosticsByCell,
  buildWorkspaceIndex,
  lintProfileOptions,
  lintRuleGroupsForProfile,
  normalizeLintSettings,
  runLintWithWorkspaceIndex
} from "./core/lint-engine.js";
import {
  cancelVectorHoverSample,
  finishVectorHoverSample,
  makeVectorHoverTarget,
  markVectorHoverRequested,
  markVectorHoverRetry,
  shouldAcceptVectorHoverResult,
  startVectorHoverSample
} from "./core/vector-hover.js";
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
const savedVectorLspHover = localStorage.getItem("txteditor.vectorLspHover") !== "off";
const savedLintEnabled = readJsonStorage("txteditor.lint.settings", {}).enabled !== false;
const LINT_ENGINE_VECTOR = "vector-lsp";
const LINT_ENGINE_LEGACY = "legacy";
const savedLintEngine = localStorage.getItem("txteditor.lint.engine") === LINT_ENGINE_LEGACY ? LINT_ENGINE_LEGACY : LINT_ENGINE_VECTOR;
const savedLegacyLintSettings = normalizeLintSettings(readJsonStorage("txteditor.legacyLint.settings", createDefaultLintSettings()));
const MIN_SIDEBAR_WIDTH = 260;
const MIN_DOCK_WIDTH = 180;
const MIN_DOCK_HEIGHT = 150;
const MIN_EDITOR_WIDTH = 320;
const MIN_EDITOR_HEIGHT = 220;
const DEFAULT_PANEL_HEIGHT = 260;
const DEFAULT_PROBLEMS_WIDTH = 320;
const DOCK_EDGES = ["left", "right", "top", "bottom"];
const DOCK_PANELS = ["explorer", "problems"];
const DEFAULT_DOCK_LAYOUT = Object.freeze({
  explorer: "left",
  problems: "bottom",
  splits: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 },
  sizes: { explorerHeight: DEFAULT_PANEL_HEIGHT, problemsWidth: DEFAULT_PROBLEMS_WIDTH }
});
const savedSidebarWidth = clamp(Number(localStorage.getItem("txteditor.sidebarWidth")) || MIN_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, 520);
const savedProblemsHeight = clamp(Number(localStorage.getItem("txteditor.problemsHeight")) || 260, 150, 520);
const savedDockLayout = normalizeDockLayout(readJsonStorage("txteditor.layout.docks", DEFAULT_DOCK_LAYOUT));
const savedFreeze = readJsonStorage("txteditor.freeze", {});
const collapsedProblemFiles = new Set();
const collapsedFileGroups = new Set();
const lspHoverCache = new Map();
const lspHoverSemanticCache = new Map();
const lspHoverPending = new Map();
const hoverPerfSamples = [];
const hoverPrewarmSamples = [];
const hoverQueueSamples = [];
const lintEngineEvents = [];
const lspReadiness = {
  byUri: {},
  events: []
};
const lspTraffic = {
  totals: {},
  byUri: {},
  events: []
};
let lspHoverCurrentTarget = null;
let lspHoverQueued = null;
let lspHoverActiveUserRequest = null;
let lspHoverLatestQueuedRequest = null;
let lspHoverGeneration = 0;
let diagnosticCellSetCache = null;
let hoverPrewarmTimer = null;
let hoverPrewarmGeneration = 0;
let hoverPrewarmActive = 0;
let hoverPrewarmQueue = [];
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
  sidebarHeight: savedDockLayout.sizes.explorerHeight,
  problemsVisible: localStorage.getItem("txteditor.problems") === "visible",
  problemsWidth: savedDockLayout.sizes.problemsWidth,
  problemsHeight: savedProblemsHeight,
  dockLayout: savedDockLayout,
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
  fontSelect: document.getElementById("fontSelect"),
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

const dockSplitters = new Map();

const isDevelopmentMode = ["localhost", "127.0.0.1", ""].includes(location.hostname);
const uiPerfSamples = [];
window.__txteditorPerf = uiPerfSamples;
window.__txteditorPerf.hoverSamples = hoverPerfSamples;
window.__txteditorPerf.hoverPrewarmSamples = hoverPrewarmSamples;
window.__txteditorPerf.hoverQueueSamples = hoverQueueSamples;
window.__txteditorPerf.lintEngineEvents = lintEngineEvents;
window.__txteditorPerf.lspTraffic = lspTraffic;
window.__txteditorPerf.lspReadiness = lspReadiness;

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
  ["open-settings", "Lint Options"]
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

syncDockLayout();

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
  onHoverRequest: (row, column, meta) => requestLspHover(row, column, meta).catch(() => {}),
  onHoverInvalidated: () => clearVisibleLspHover("grid-hover-cleared"),
  onViewportChanged: (reason) => scheduleHoverPrewarm(reason)
});

grid.setFontFamily(state.gridFont);
grid.setColorizeColumns(state.colorizeColumns);
grid.setVectorLspHoverEnabled(effectiveVectorLspHoverEnabled());
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

function perfNow() {
  return typeof performance === "undefined" ? 0 : performance.now();
}

function normalizeDockEdge(value, fallback) {
  return DOCK_EDGES.includes(value) ? value : fallback;
}

function normalizeDockLayout(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const splits = source.splits && typeof source.splits === "object" ? source.splits : {};
  const sizes = source.sizes && typeof source.sizes === "object" ? source.sizes : {};
  return {
    explorer: normalizeDockEdge(source.explorer, DEFAULT_DOCK_LAYOUT.explorer),
    problems: normalizeDockEdge(source.problems, DEFAULT_DOCK_LAYOUT.problems),
    splits: Object.fromEntries(DOCK_EDGES.map((edge) => [
      edge,
      clamp(Number(splits[edge]) || DEFAULT_DOCK_LAYOUT.splits[edge], 0.15, 0.85)
    ])),
    sizes: {
      explorerHeight: clamp(Number(sizes.explorerHeight) || DEFAULT_DOCK_LAYOUT.sizes.explorerHeight, MIN_DOCK_HEIGHT, 520),
      problemsWidth: clamp(Number(sizes.problemsWidth) || DEFAULT_DOCK_LAYOUT.sizes.problemsWidth, MIN_DOCK_WIDTH, 640)
    }
  };
}

function dockContainer(edge) {
  return {
    left: els.dockLeft,
    right: els.dockRight,
    top: els.dockTop,
    bottom: els.dockBottom
  }[edge] ?? els.dockLeft;
}

function panelElement(panel) {
  return panel === "explorer" ? els.sidebar : panel === "problems" ? els.problemsPanel : null;
}

function panelResizer(panel) {
  return panel === "explorer" ? els.sidebarResizer : panel === "problems" ? els.problemsResizer : null;
}

function isPanelVisible(panel) {
  return panel === "explorer" ? state.sidebarVisible : panel === "problems" ? state.problemsVisible : false;
}

function dockForPanel(panel) {
  return normalizeDockEdge(state.dockLayout?.[panel], DEFAULT_DOCK_LAYOUT[panel]);
}

function panelsForDock(edge, { visibleOnly = true } = {}) {
  return DOCK_PANELS.filter((panel) => dockForPanel(panel) === edge && (!visibleOnly || isPanelVisible(panel)));
}

function saveDockLayout() {
  state.dockLayout = normalizeDockLayout({
    explorer: state.dockLayout.explorer,
    problems: state.dockLayout.problems,
    splits: state.dockLayout.splits,
    sizes: {
      explorerHeight: state.sidebarHeight,
      problemsWidth: state.problemsWidth
    }
  });
  localStorage.setItem("txteditor.layout.docks", JSON.stringify(state.dockLayout));
}

function dockEdgeWidth(edge) {
  const panels = panelsForDock(edge);
  if (!panels.length) return 0;
  return Math.max(...panels.map((panel) => panel === "explorer" ? state.sidebarWidth : state.problemsWidth), MIN_DOCK_WIDTH);
}

function dockEdgeHeight(edge) {
  const panels = panelsForDock(edge);
  if (!panels.length) return 0;
  return Math.max(...panels.map((panel) => panel === "explorer" ? state.sidebarHeight : state.problemsHeight), MIN_DOCK_HEIGHT);
}

function fitDockPair(first, second, maxTotal, minSize) {
  if (!first && !second) return [0, 0];
  if (first + second <= maxTotal || maxTotal <= 0) return [first, second];
  if (first && second && maxTotal >= minSize * 2) {
    const share = first / (first + second);
    const fittedFirst = clamp(Math.round(maxTotal * share), minSize, maxTotal - minSize);
    return [fittedFirst, maxTotal - fittedFirst];
  }
  if (first && second) return [Math.ceil(maxTotal / 2), Math.floor(maxTotal / 2)];
  return first ? [Math.max(minSize, maxTotal), 0] : [0, Math.max(minSize, maxTotal)];
}

function applyDockVariables() {
  const root = document.documentElement;
  root.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  root.style.setProperty("--sidebar-height", `${state.sidebarHeight}px`);
  root.style.setProperty("--problems-width", `${state.problemsWidth}px`);
  root.style.setProperty("--problems-height", `${state.problemsHeight}px`);
  const layoutWidth = Math.max(MIN_EDITOR_WIDTH, els.layoutRoot?.clientWidth || window.innerWidth - 48);
  const layoutHeight = Math.max(MIN_EDITOR_HEIGHT, els.layoutRoot?.clientHeight || window.innerHeight);
  const [leftWidth, rightWidth] = fitDockPair(
    dockEdgeWidth("left"),
    dockEdgeWidth("right"),
    Math.max(0, layoutWidth - MIN_EDITOR_WIDTH),
    MIN_DOCK_WIDTH
  );
  const [topHeight, bottomHeight] = fitDockPair(
    dockEdgeHeight("top"),
    dockEdgeHeight("bottom"),
    Math.max(0, layoutHeight - MIN_EDITOR_HEIGHT),
    MIN_DOCK_HEIGHT
  );
  root.style.setProperty("--dock-left-width", `${leftWidth}px`);
  root.style.setProperty("--dock-right-width", `${rightWidth}px`);
  root.style.setProperty("--dock-top-height", `${topHeight}px`);
  root.style.setProperty("--dock-bottom-height", `${bottomHeight}px`);
}

function dockSplitter(edge) {
  let splitter = dockSplitters.get(edge);
  if (!splitter) {
    splitter = document.createElement("div");
    splitter.className = "dock-splitter";
    splitter.dataset.dockSplitter = edge;
    splitter.addEventListener("pointerdown", (event) => startDockSplitResize(edge, event));
    dockSplitters.set(edge, splitter);
  }
  return splitter;
}

function applyPanelFlex(panel, panelEl, edge, count, index) {
  panelEl.dataset.dockEdge = edge;
  panelEl.style.width = "";
  panelEl.style.height = "";
  panelEl.style.minWidth = edge === "top" || edge === "bottom" ? `${MIN_DOCK_WIDTH}px` : "0";
  panelEl.style.minHeight = edge === "left" || edge === "right" ? `${MIN_DOCK_HEIGHT}px` : "0";
  if (count <= 1) {
    panelEl.style.flex = "1 1 auto";
    return;
  }
  const ratio = clamp(Number(state.dockLayout.splits?.[edge]) || 0.5, 0.15, 0.85);
  const basis = index === 0 ? ratio * 100 : (1 - ratio) * 100;
  panelEl.style.flex = `0 1 ${basis}%`;
  panelEl.dataset.dockPanel = panel;
}

function syncDockLayout() {
  for (const panel of DOCK_PANELS) {
    const panelEl = panelElement(panel);
    if (!panelEl) continue;
    const edge = dockForPanel(panel);
    panelEl.classList.toggle("hidden", !isPanelVisible(panel));
    panelEl.dataset.dockPanel = panel;
    panelEl.dataset.dockEdge = edge;
    const resizer = panelResizer(panel);
    if (resizer) resizer.dataset.dockEdge = edge;
  }
  for (const edge of DOCK_EDGES) {
    const dock = dockContainer(edge);
    if (!dock) continue;
    const panels = panelsForDock(edge);
    dock.replaceChildren();
    dock.classList.toggle("dock-empty", panels.length === 0);
    dock.classList.toggle("dock-same-edge", panels.length > 1);
    panels.forEach((panel, index) => {
      const panelEl = panelElement(panel);
      if (!panelEl) return;
      applyPanelFlex(panel, panelEl, edge, panels.length, index);
      dock.append(panelEl);
      if (index < panels.length - 1) dock.append(dockSplitter(edge));
    });
  }
  applyDockVariables();
}

function setPanelDock(panel, edge) {
  if (!DOCK_PANELS.includes(panel)) return;
  const nextEdge = normalizeDockEdge(edge, dockForPanel(panel));
  if (dockForPanel(panel) === nextEdge) return;
  state.dockLayout = normalizeDockLayout({ ...state.dockLayout, [panel]: nextEdge });
  saveDockLayout();
  syncDockLayout();
  renderChrome();
  grid.layout();
}

function resetDockLayout() {
  state.dockLayout = normalizeDockLayout({
    ...state.dockLayout,
    explorer: DEFAULT_DOCK_LAYOUT.explorer,
    problems: DEFAULT_DOCK_LAYOUT.problems,
    splits: DEFAULT_DOCK_LAYOUT.splits
  });
  saveDockLayout();
  syncDockLayout();
  renderChrome();
  grid.layout();
}

function setDockSplitRatio(edge, ratio) {
  if (!DOCK_EDGES.includes(edge)) return;
  state.dockLayout = normalizeDockLayout({
    ...state.dockLayout,
    splits: { ...state.dockLayout.splits, [edge]: ratio }
  });
  saveDockLayout();
  syncDockLayout();
  grid.layout();
}

function startDockSplitResize(edge, event) {
  const dock = dockContainer(edge);
  const rect = dock?.getBoundingClientRect();
  const sameEdgePanels = panelsForDock(edge);
  if (!rect || sameEdgePanels.length < 2) return;
  event.preventDefault();
  const horizontal = edge === "top" || edge === "bottom";
  const size = horizontal ? rect.width : rect.height;
  if (size <= 0) return;
  const startPoint = horizontal ? event.clientX : event.clientY;
  const startRatio = clamp(Number(state.dockLayout.splits?.[edge]) || 0.5, 0.15, 0.85);
  const minRatio = clamp((horizontal ? MIN_DOCK_WIDTH : MIN_DOCK_HEIGHT) / size, 0.08, 0.45);
  const onMove = (moveEvent) => {
    const point = horizontal ? moveEvent.clientX : moveEvent.clientY;
    setDockSplitRatio(edge, clamp(startRatio + ((point - startPoint) / size), minRatio, 1 - minRatio));
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function setDockEdgeSize(edge, size) {
  const panels = panelsForDock(edge);
  if (!panels.length) return;
  for (const panel of panels) {
    if (edge === "left" || edge === "right") {
      if (panel === "explorer") setSidebarWidth(size);
      else setProblemsWidth(size);
    } else if (panel === "explorer") {
      setSidebarHeight(size);
    } else {
      setProblemsHeight(size);
    }
  }
}

function elapsedMs(started) {
  return Math.round((perfNow() - started) * 100) / 100;
}

function recordUiPerf(name, started, details = {}) {
  if (typeof performance === "undefined") return;
  uiPerfSamples.push({
    name,
    ms: Math.round((performance.now() - started) * 100) / 100,
    diagnostics: state.lint.diagnostics.length,
    problemsVisible: state.problemsVisible,
    bottomTab: state.bottomTab,
    ...details
  });
  if (uiPerfSamples.length > 200) uiPerfSamples.shift();
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
  return state.lint.engine === LINT_ENGINE_VECTOR;
}

function isLegacyLintEngine() {
  return state.lint.engine === LINT_ENGINE_LEGACY;
}

function lintActive() {
  return state.problemsVisible && state.lint.enabled;
}

function vectorLintEnabled() {
  return state.lint.enabled && isVectorLintEngine();
}

function vectorLintDisplayActive() {
  return lintActive() && isVectorLintEngine();
}

function legacyLintDisplayActive() {
  return lintActive() && isLegacyLintEngine();
}

function effectiveVectorLspHoverEnabled() {
  return isVectorLintEngine() && state.vectorLspHover;
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
  if (isVectorLintEngine()) lspUpdateDoc(doc, changedRows).catch(() => {});
  else scheduleLegacyLintForEdit(doc);
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
    renderChrome();
    return;
  }
  doc.undo = new UndoManager();
  doc.zoom = 1;
  doc.legacyLintVersion = doc.legacyLintVersion ?? 0;
  state.docs.push(doc);
  state.active = state.docs.length - 1;
  applyFreezeToDoc(doc);
  grid.setDocument(doc);
  if (!doc.initialColumnFitApplied) {
    grid.autoFitInitialColumns();
    doc.initialColumnFitApplied = true;
    grid.layout();
  }
  renderChrome();
  scrollProblemsToActiveFile();
  if (isVectorLintEngine()) {
    lspOpenDoc(doc).catch(() => {});
    scheduleHoverPrewarm("document-opened");
  } else {
    scheduleLegacyLintForOpen("file-opened");
  }
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
    resetLegacyWorkspaceIndex();
    if (isVectorLintEngine()) lspStartWorkspace(workspace.path).catch(showError);
    else scheduleLegacyLintFull("workspace-opened", 0);
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
  const doc = activeDoc();
  if (activeUndo().undo(doc)) {
    markLegacyLintDocChanged(doc);
    grid.layout();
    if (isVectorLintEngine()) lspUpdateDoc(doc).catch(() => {});
    else scheduleLegacyLintForEdit(doc);
    renderChrome();
  }
}

function redo() {
  const doc = activeDoc();
  if (activeUndo().redo(doc)) {
    markLegacyLintDocChanged(doc);
    grid.layout();
    if (isVectorLintEngine()) lspUpdateDoc(doc).catch(() => {});
    else scheduleLegacyLintForEdit(doc);
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
  const alwaysAvailable = new Set(["open-file", "open-folder", "open-settings", "open-app-settings", "toggle-sidebar", "toggle-theme", "toggle-colorize", "toggle-vector-lsp-hover", "toggle-lint", "toggle-lint-rules", "show-explorer", "show-problems", "zoom-in", "zoom-out", "zoom-reset", "load-fixture-20k", "load-fixture-200k"]);
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
  if (id === "toggle-vector-lsp-hover") return toggleVectorLspHover();
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
  if (id === "open-app-settings") return showAppSettings();
  if (id === "open-settings") return showSettings();
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

function toggleVectorLspHover() {
  setVectorLspHover(!state.vectorLspHover);
}

function setVectorLspHover(enabled) {
  state.vectorLspHover = Boolean(enabled);
  localStorage.setItem("txteditor.vectorLspHover", state.vectorLspHover ? "on" : "off");
  invalidateLspHover(!state.vectorLspHover, state.vectorLspHover ? "hover-enabled" : "hover-disabled");
  grid.setVectorLspHoverEnabled(effectiveVectorLspHoverEnabled());
  renderChrome();
}

function setLintEngine(engine) {
  const next = engine === LINT_ENGINE_LEGACY ? LINT_ENGINE_LEGACY : LINT_ENGINE_VECTOR;
  if (state.lint.engine === next) return;
  const previous = state.lint.engine;
  state.lint.engine = next;
  localStorage.setItem("txteditor.lint.engine", state.lint.engine);
  cancelLegacyLintJobs({ clearDiagnostics: false });
  invalidateLspHover(next !== LINT_ENGINE_VECTOR, `lint-engine-${next}`);
  setLintDiagnostics([]);
  updateGridDiagnostics();
  grid.setVectorLspHoverEnabled(effectiveVectorLspHoverEnabled());
  recordLintEngineEvent("engine-switch", { previous, next });
  if (isLegacyLintEngine()) {
    scheduleLegacyLintFull("engine-switched-legacy", 0);
  } else if (state.workspace?.path) {
    if (state.lsp.started) syncOpenDocsToVectorLsp().catch(showError);
    else lspStartWorkspace(state.workspace.path).catch(showError);
  } else if (state.lsp.started) {
    syncOpenDocsToVectorLsp().catch(showError);
  }
  renderChrome();
}

function invalidateLspHover(clearCache = false, reason = "hover-invalidated") {
  lspHoverGeneration += 1;
  cancelHoverPrewarm(reason);
  if (lspHoverQueued?.sample) cancelVectorHoverSample(lspHoverQueued.sample, reason, perfNow);
  if (lspHoverLatestQueuedRequest?.sample) cancelVectorHoverSample(lspHoverLatestQueuedRequest.sample, reason, perfNow);
  for (const pending of lspHoverPending.values()) {
    for (const waiter of pending.waiters ?? []) cancelVectorHoverSample(waiter.sample, reason, perfNow);
  }
  lspHoverCurrentTarget = null;
  lspHoverQueued = null;
  lspHoverActiveUserRequest = null;
  lspHoverLatestQueuedRequest = null;
  lspHoverPending.clear();
  if (clearCache) lspHoverCache.clear();
  grid.clearLspHovers();
}

function clearVisibleLspHover(reason = "hover-cleared") {
  cancelHoverPrewarm(reason);
  if (lspHoverQueued?.sample) cancelVectorHoverSample(lspHoverQueued.sample, reason, perfNow);
  if (lspHoverLatestQueuedRequest?.sample) cancelVectorHoverSample(lspHoverLatestQueuedRequest.sample, reason, perfNow);
  for (const pending of lspHoverPending.values()) {
    for (const waiter of pending.waiters ?? []) cancelVectorHoverSample(waiter.sample, reason, perfNow);
  }
  lspHoverCurrentTarget = null;
  lspHoverQueued = null;
  lspHoverLatestQueuedRequest = null;
  recordHoverQueueEvent({ reason, visibleClear: true, inFlight: lspHoverPending.size });
}

function recordHoverSample(sample) {
  if (!sample) return sample;
  hoverPerfSamples.push(sample);
  if (hoverPerfSamples.length > 2000) hoverPerfSamples.shift();
  return sample;
}

function recordHoverQueueEvent(event) {
  hoverQueueSamples.push({
    timestamp: perfNow(),
    active: Boolean(lspHoverActiveUserRequest),
    queued: Boolean(lspHoverLatestQueuedRequest),
    inFlight: lspHoverPending.size,
    ...event
  });
  if (hoverQueueSamples.length > 2000) hoverQueueSamples.shift();
}

function recordLspTraffic(uri, kind, details = {}) {
  const key = uri || "(unknown)";
  lspTraffic.totals[kind] = (lspTraffic.totals[kind] ?? 0) + 1;
  const perUri = lspTraffic.byUri[key] ?? {
    lsp_open_file: 0,
    lsp_update_file: 0,
    lsp_update_file_incremental: 0,
    lsp_get_diagnostics: 0,
    lsp_hover: 0,
    diagnostics_changed: 0,
    lsp_close_file: 0,
    hover_cache_hit: 0,
    hover_cache_miss: 0,
    hover_semantic_cache_hit: 0,
    hover_header_cache_hit: 0,
    hover_diagnostic_local_only: 0,
    hover_prewarm_queued: 0,
    hover_prewarm_canceled: 0
  };
  perUri[kind] = (perUri[kind] ?? 0) + 1;
  lspTraffic.byUri[key] = perUri;
  lspTraffic.events.push({ timestamp: perfNow(), uri: key, kind, ...details });
  if (lspTraffic.events.length > 5000) lspTraffic.events.shift();
}

function recordLspReadiness(uri, eventKind, details = {}) {
  const key = uri || "(unknown)";
  const event = { timestamp: perfNow(), uri: key, eventKind, ...details };
  lspReadiness.events.push(event);
  if (lspReadiness.events.length > 1000) lspReadiness.events.shift();
  lspReadiness.byUri[key] = {
    ...(lspReadiness.byUri[key] ?? {}),
    [eventKind]: event.timestamp,
    lastEventKind: eventKind,
    lastEventAt: event.timestamp,
    ...details
  };
}

function setLintDiagnostics(diagnostics) {
  state.lint.diagnostics = diagnostics;
  state.lint.version += 1;
  diagnosticCellSetCache = null;
}

function changeGridFont(value) {
  state.gridFont = normaliseGridFont(value);
  localStorage.setItem("txteditor.gridFont", state.gridFont);
  document.documentElement.style.setProperty("--grid-font", state.gridFont);
  grid.setFontFamily(state.gridFont);
  renderChrome();
}

function toggleLint() {
  state.lint.enabled = !state.lint.enabled;
  if (!state.lint.enabled) {
    cancelLegacyLintJobs({ clearDiagnostics: false });
    setLintDiagnostics([]);
    updateGridDiagnostics();
  } else if (isLegacyLintEngine() && state.problemsVisible) {
    scheduleLegacyLintFull("lint-enabled", 0);
  } else if (isVectorLintEngine() && state.workspace?.path && !state.lsp.started) {
    lspStartWorkspace(state.workspace.path).catch(showError);
  }
  saveLintSettings();
  renderChrome();
}

function toggleLintRules() {
  if (!isLegacyLintEngine()) return;
  state.lint.legacy.rulesOpen = !state.lint.legacy.rulesOpen;
  renderChrome();
}

function setLegacyLintProfile(profile) {
  state.lint.legacy.settings.profile = lintProfileOptions().includes(profile) ? profile : "RotW";
  setLintDiagnostics([]);
  updateGridDiagnostics();
  saveLegacyLintSettings();
  if (legacyLintDisplayActive()) scheduleLegacyLintFull("profile-changed", 0);
  renderChrome();
}

function setLegacyLintRuleEnabled(ruleId, enabled) {
  const rule = currentLegacyProfileRules()[ruleId];
  if (!rule) return;
  rule.enabled = Boolean(enabled);
  saveLegacyLintSettings();
  if (legacyLintDisplayActive()) scheduleLegacyLintFull("settings-changed", 120);
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
    if (isLegacyLintEngine() && state.lint.enabled) scheduleLegacyLintFull("problems-opened", 0);
  } else {
    cancelLegacyLintJobs({ clearDiagnostics: false });
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

function setSidebarWidth(width) {
  state.sidebarWidth = clamp(Math.round(width), MIN_SIDEBAR_WIDTH, 520);
  document.documentElement.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  localStorage.setItem("txteditor.sidebarWidth", String(state.sidebarWidth));
  syncDockLayout();
  grid.layout();
}

function setSidebarHeight(height) {
  const maxHeight = Math.max(MIN_DOCK_HEIGHT, Math.floor(window.innerHeight * 0.7));
  state.sidebarHeight = clamp(Math.round(height), MIN_DOCK_HEIGHT, maxHeight);
  document.documentElement.style.setProperty("--sidebar-height", `${state.sidebarHeight}px`);
  saveDockLayout();
  syncDockLayout();
  grid.layout();
}

function setProblemsWidth(width) {
  state.problemsWidth = clamp(Math.round(width), MIN_DOCK_WIDTH, 640);
  document.documentElement.style.setProperty("--problems-width", `${state.problemsWidth}px`);
  saveDockLayout();
  syncDockLayout();
  grid.layout();
}

function setProblemsHeight(height) {
  const maxHeight = Math.max(150, Math.floor(window.innerHeight * 0.7));
  state.problemsHeight = clamp(Math.round(height), 150, maxHeight);
  document.documentElement.style.setProperty("--problems-height", `${state.problemsHeight}px`);
  localStorage.setItem("txteditor.problemsHeight", String(state.problemsHeight));
  syncDockLayout();
  grid.layout();
}

function wirePaneResizers() {
  wirePanelResizer("explorer", els.sidebarResizer);
  wirePanelResizer("problems", els.problemsResizer);
}

function wirePanelResizer(panel, handle) {
  handle?.addEventListener("pointerdown", (event) => {
    if (!isPanelVisible(panel)) return;
    const edge = dockForPanel(panel);
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = edge === "left" || edge === "right" ? dockEdgeWidth(edge) : dockEdgeHeight(edge);
    const onMove = (moveEvent) => {
      const delta = edge === "left" ? moveEvent.clientX - startX
        : edge === "right" ? startX - moveEvent.clientX
          : edge === "top" ? moveEvent.clientY - startY
            : startY - moveEvent.clientY;
      setDockEdgeSize(edge, startSize + delta);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

// ── LSP integration ────────────────────────────────────────────────────────

function markLegacyLintDocChanged(doc) {
  if (!doc) return;
  doc.legacyLintVersion = (doc.legacyLintVersion ?? 0) + 1;
}

function scheduleLegacyLintForOpen(reason = "file-opened") {
  scheduleLegacyLintFull(reason, 0);
}

function scheduleLegacyLintForEdit(doc) {
  if (!legacyLintDisplayActive()) return;
  const hasDiagnostics = docHasDiagnostics(doc);
  const delay = hasDiagnostics ? 120 : 180;
  scheduleLegacyLintFull(hasDiagnostics ? "diagnostic-file-edited" : "file-edited", delay);
}

function scheduleLegacyLintFull(reason = "change", delay = 0) {
  if (!legacyLintDisplayActive()) return;
  clearTimeout(state.lint.legacy.timer);
  const version = ++state.lint.legacy.version;
  const scheduledAt = perfNow();
  state.lint.legacy.pendingRun = { version, reason, delay, scheduledAt };
  recordLintEngineEvent("legacy-lint-scheduled", {
    reason,
    version,
    delayMs: delay,
    scheduledAt,
    profile: state.lint.legacy.settings.profile
  });
  state.lint.legacy.timer = setTimeout(() => runLegacyLintNow(reason, version), delay);
}

async function runLegacyLintNow(reason = "lint", version = ++state.lint.legacy.version) {
  clearTimeout(state.lint.legacy.timer);
  state.lint.legacy.timer = 0;
  if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) return;
  const pendingRun = state.lint.legacy.pendingRun?.version === version
    ? state.lint.legacy.pendingRun
    : { reason, version, delay: 0, scheduledAt: perfNow() };
  const startedAt = perfNow();
  const timings = {
    reason,
    version,
    profile: state.lint.legacy.settings.profile,
    scheduledAt: pendingRun.scheduledAt,
    startedAt,
    queueDelayMs: elapsedMs(pendingRun.scheduledAt),
    scheduledDelayMs: pendingRun.delay,
    workspaceFileCount: 0,
    workspaceReadMs: 0,
    workspaceParseMs: 0,
    workspaceIndexMs: 0,
    runLintMs: 0,
    diagnosticsApplyMs: 0,
    renderMs: 0,
    totalMs: 0,
    diagnosticCount: 0,
    usedWorkspaceCache: false,
    usedWorkspaceIndexCache: false,
    bulkRead: false
  };
  let published = false;
  state.lint.legacy.running = true;
  state.lint.legacy.status = state.workspace?.files?.length ? "Indexing workspace..." : `Linting ${state.lint.legacy.settings.profile}...`;
  recordLintEngineEvent("legacy-lint-start", timings);
  timings.renderMs += measureRenderChrome();
  try {
    const workspaceStats = await ensureLegacyWorkspaceIndexed(version);
    timings.renderMs += workspaceStats.workspaceRenderMs ?? 0;
    delete workspaceStats.workspaceRenderMs;
    Object.assign(timings, workspaceStats);
    if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) return;
    state.lint.legacy.status = `Linting ${state.lint.legacy.settings.profile}...`;
    timings.renderMs += measureRenderChrome();
    await yieldToUi();
    const docs = activeLegacyLintDocuments();
    const indexResult = legacyLintWorkspaceIndexFor(docs, state.lint.legacy.settings.profile);
    timings.workspaceIndexMs = indexResult.ms;
    timings.usedWorkspaceIndexCache = indexResult.cached;
    const runStarted = perfNow();
    const diagnostics = runLintWithWorkspaceIndex(indexResult.index, state.lint.legacy.settings);
    timings.runLintMs = elapsedMs(runStarted);
    if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) {
      recordLintEngineEvent("legacy-lint-ignored", { reason, version, diagnostics: diagnostics.length });
      return;
    }
    const applyStarted = perfNow();
    setLintDiagnostics(diagnostics);
    timings.diagnosticsApplyMs = elapsedMs(applyStarted);
    timings.diagnosticCount = diagnostics.length;
    state.lint.legacy.lastRunAt = Date.now();
    published = true;
  } finally {
    if (version === state.lint.legacy.version) {
      state.lint.legacy.running = false;
      state.lint.legacy.status = "";
      timings.renderMs += measureRenderChrome();
      timings.totalMs = elapsedMs(timings.scheduledAt);
      if (published) recordLintEngineEvent("legacy-lint-finish", timings);
    }
  }
}

function measureRenderChrome() {
  const started = perfNow();
  renderChrome();
  return elapsedMs(started);
}

function activeLegacyLintDocuments() {
  return [...state.docs, ...state.lint.legacy.workspaceDocs];
}

function legacyLintWorkspaceIndexFor(docs, profile) {
  const signature = legacyLintIndexSignature(docs, profile);
  const cache = state.lint.legacy.workspaceIndexCache;
  if (cache.index && cache.signature === signature && cache.profile === profile) {
    return { index: cache.index, ms: 0, cached: true };
  }
  const started = perfNow();
  const index = buildWorkspaceIndex(docs, profile);
  const ms = elapsedMs(started);
  state.lint.legacy.workspaceIndexCache = { signature, profile, index };
  return { index, ms, cached: false };
}

function legacyLintIndexSignature(docs, profile) {
  return [
    profile,
    state.lint.legacy.workspaceLoad.signature ?? "",
    docs.map((doc) => [
      lintDocKey(doc),
      doc.legacyLintVersion ?? 0,
      doc.rowCount ?? 0,
      doc.columnCount ?? 0
    ].join(":")).join("\u001f")
  ].join("\u001e");
}

function currentLegacyProfileRules() {
  return state.lint.legacy.settings.profiles?.[state.lint.legacy.settings.profile]?.rules ?? {};
}

function cancelLegacyLintJobs({ clearDiagnostics = false } = {}) {
  clearTimeout(state.lint.legacy.timer);
  state.lint.legacy.timer = 0;
  state.lint.legacy.pendingRun = null;
  state.lint.legacy.version += 1;
  state.lint.legacy.running = false;
  state.lint.legacy.status = "";
  if (clearDiagnostics) {
    setLintDiagnostics([]);
    updateGridDiagnostics();
  }
  recordLintEngineEvent("legacy-lint-cancel", { clearDiagnostics });
}

function resetLegacyWorkspaceIndex() {
  state.lint.legacy.workspaceDocs = [];
  state.lint.legacy.workspaceLoad = { status: "not-started", files: [], error: "", signature: "" };
  state.lint.legacy.workspaceIndexCache = { signature: "", profile: "", index: null };
}

async function ensureLegacyWorkspaceIndexed(version) {
  if (!state.workspace?.files?.length) {
    return { workspaceFileCount: 0, usedWorkspaceCache: true };
  }
  const explorerFiles = legacyWorkspaceTxtFiles();
  const signature = legacyWorkspaceFileSignature(explorerFiles);
  if (!explorerFiles.length) {
    state.lint.legacy.workspaceDocs = [];
    state.lint.legacy.workspaceLoad = { status: "ready", files: [], error: "", signature };
    return { workspaceFileCount: 0, usedWorkspaceCache: true };
  }
  if (state.lint.legacy.workspaceLoad.status === "ready" && state.lint.legacy.workspaceLoad.signature === signature) {
    state.lint.legacy.workspaceDocs = mergeOpenLegacyWorkspaceDocs(state.lint.legacy.workspaceDocs);
    return { workspaceFileCount: explorerFiles.length, usedWorkspaceCache: true };
  }
  state.lint.legacy.workspaceLoad = { status: "loading", files: legacyWorkspaceFileStatesForExplorer(), error: "", signature };
  state.lint.legacy.workspaceDocs = [];
  let workspaceRenderMs = measureRenderChrome();
  const docs = [];
  const fileStates = [];
  const readStarted = perfNow();
  const results = await openNativePathsBulk(explorerFiles.map((file) => file.path), TableDocument);
  const readAndParseMs = elapsedMs(readStarted);
  const workspaceParseMs = results.reduce((total, result) => total + (result.parseMs ?? 0), 0);
  for (let index = 0; index < explorerFiles.length; index += 1) {
    if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) {
      return {
        workspaceFileCount: explorerFiles.length,
        workspaceReadMs: Math.max(0, readAndParseMs - workspaceParseMs),
        workspaceParseMs,
        bulkRead: results.some((result) => result.bulkRead),
        usedWorkspaceCache: false,
        workspaceRenderMs
      };
    }
    const file = explorerFiles[index];
    const result = results[index] ?? { error: "No native read result returned." };
    if (result.doc) docs.push(result.doc);
    fileStates.push({
      filePath: file.path,
      fileName: file.name,
      listedInExplorer: true,
      readForLint: true,
      loadedForIndex: true,
      parsedForLint: Boolean(result.doc && !result.error),
      parseError: result.error ?? ""
    });
  }
  if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) {
    return {
      workspaceFileCount: explorerFiles.length,
      workspaceReadMs: Math.max(0, readAndParseMs - workspaceParseMs),
      workspaceParseMs,
      bulkRead: results.some((result) => result.bulkRead),
      usedWorkspaceCache: false,
      workspaceRenderMs
    };
  }
  state.lint.legacy.workspaceDocs = mergeOpenLegacyWorkspaceDocs(docs);
  state.lint.legacy.workspaceLoad = { status: "ready", files: fileStates, error: "", signature };
  workspaceRenderMs += measureRenderChrome();
  return {
    workspaceFileCount: explorerFiles.length,
    workspaceReadMs: Math.max(0, readAndParseMs - workspaceParseMs),
    workspaceParseMs,
    bulkRead: results.some((result) => result.bulkRead),
    usedWorkspaceCache: false,
    workspaceRenderMs
  };
}

function legacyWorkspaceFileSignature(files) {
  return files.map((file) => [
    lintDocKey({ path: file.path, name: file.name }),
    file.modified_ms ?? file.modifiedMs ?? "",
    file.size ?? ""
  ].join(":")).join("\u001f");
}

function legacyWorkspaceTxtFiles() {
  return (state.workspace?.files ?? []).filter((file) => isTextLikePath(file.path || file.name));
}

function legacyWorkspaceFileStatesForExplorer() {
  return legacyWorkspaceTxtFiles().map((file) => ({
    filePath: file.path,
    fileName: file.name,
    listedInExplorer: true,
    loadedForIndex: false,
    parsedForLint: false,
    parseError: ""
  }));
}

function mergeOpenLegacyWorkspaceDocs(docs) {
  const openByKey = new Map(state.docs.map((doc) => [lintDocKey(doc), doc]));
  return docs.map((doc) => openByKey.get(lintDocKey(doc)) ?? doc);
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

const HOVER_READY_FALLBACK_MS = 1200;

function clearHoverReadyFallback(doc) {
  if (doc?._lspHoverReadyTimer != null) {
    clearTimeout(doc._lspHoverReadyTimer);
    doc._lspHoverReadyTimer = null;
  }
}

function scheduleHoverReadyFallback(doc, uri, reason) {
  clearHoverReadyFallback(doc);
  doc._lspHoverReadyTimer = setTimeout(() => {
    doc._lspHoverReadyTimer = null;
    if (docToUri(doc) !== uri || doc._lspOpenedUri !== uri) return;
    markDocHoverReady(doc, uri, reason);
  }, HOVER_READY_FALLBACK_MS);
}

function markDocHoverReady(doc, uri, reason) {
  clearHoverReadyFallback(doc);
  doc._lspReady = true;
  doc._lspHoverReady = true;
  recordLspReadiness(uri, "hoverReady", {
    fileName: doc?.name,
    documentVersion: doc?._lspVersion ?? 0,
    reason
  });
  retryQueuedLspHover(`hover-ready:${reason}`);
  if (doc === activeDoc()) scheduleHoverPrewarm(`hover-ready:${reason}`);
}

async function lspStartWorkspace(workspacePath) {
  if (!isVectorLintEngine()) {
    recordLintEngineEvent("vector-start-skipped", { workspacePath });
    return;
  }
  invalidateLspHover(true, "workspace-start");
  state.lspLogs = [];
  if (els.logList) els.logList.innerHTML = "";
  state.lint.status = "Connecting to linter...";
  renderChrome();
  state.lsp.started = false;
  await lspStart(workspacePath);
  state.lsp.started = true;
  state.lsp.openFileCount = 0;
  const docsWithPaths = state.docs.filter((d) => docToUri(d));
  for (const doc of docsWithPaths) {
    doc._lspVersion = 1;
    doc._lspReady = false;
    doc._lspOpened = false;
    doc._lspDiagnosticsReady = false;
    doc._lspHoverReady = false;
    doc._lspOpenedUri = null;
    doc._lspOpenedVersion = null;
    doc._lspOpenPromise = null;
    clearHoverReadyFallback(doc);
    await lspOpenDoc(doc).catch(() => {});
  }
  state.lint.status = "";
  renderChrome();
  retryQueuedLspHover("workspace-ready");
  scheduleHoverPrewarm("workspace-ready");
}

async function syncOpenDocsToVectorLsp() {
  if (!isVectorLintEngine() || !state.lsp.started) return;
  state.lsp.openFileCount = 0;
  for (const doc of state.docs.filter((d) => docToUri(d))) {
    doc._lspVersion ??= 1;
    await lspOpenDoc(doc).catch(() => {});
  }
  recordLintEngineEvent("vector-sync-open-docs", { docs: state.docs.length });
  renderChrome();
}

async function lspOpenDoc(doc) {
  if (!isVectorLintEngine()) {
    recordLintEngineEvent("vector-open-skipped-legacy", { fileName: doc?.name });
    return;
  }
  if (!state.lsp.started) return;
  const uri = docToUri(doc);
  if (!uri) return;
  doc._lspVersion ??= 1;
  const version = doc._lspVersion;
  if (doc._lspOpened && doc._lspOpenedUri === uri && doc._lspOpenedVersion === version) return;
  if (doc._lspOpenPromise) return doc._lspOpenPromise;
  clearHoverReadyFallback(doc);
  doc._lspReady = false;
  doc._lspOpened = false;
  doc._lspDiagnosticsReady = diagnosticsForDocument(state.lint.diagnostics, doc).length > 0;
  doc._lspHoverReady = doc._lspDiagnosticsReady;
  doc._lspOpenPromise = (async () => {
    recordLspTraffic(uri, "lsp_open_file", { fileName: doc.name, documentVersion: version });
    recordLspReadiness(uri, "didOpenSent", { fileName: doc.name, documentVersion: version });
    await lspOpenFile(uri, doc.toText());
    doc._lspOpened = true;
    doc._lspOpenedUri = uri;
    doc._lspOpenedVersion = version;
    if (doc._lspDiagnosticsReady) {
      markDocHoverReady(doc, uri, "existing-diagnostics");
    } else {
      scheduleHoverReadyFallback(doc, uri, "diagnostics-fallback");
    }
    state.lsp.openFileCount = (state.lsp.openFileCount ?? 0) + 1;
    renderChrome();
    retryQueuedLspHover("file-opened");
    if (doc === activeDoc()) scheduleHoverPrewarm("file-opened");
  })().catch((error) => {
    doc._lspReady = false;
    doc._lspOpened = false;
    throw error;
  }).finally(() => {
    doc._lspOpenPromise = null;
  });
  return doc._lspOpenPromise;
}

async function lspUpdateDoc(doc, changedRows = null) {
  if (!isVectorLintEngine()) {
    recordLintEngineEvent("vector-update-skipped-legacy", { fileName: doc?.name, changedRows: changedRows?.length ?? null });
    return;
  }
  if (!state.lsp.started) return;
  const uri = docToUri(doc);
  if (!uri) return;
  clearHoverCacheForUri(uri);
  doc._lspVersion = (doc._lspVersion ?? 0) + 1;
  invalidateLspHover(false, "document-version-changed");
  doc._lspReady = false;
  doc._lspDiagnosticsReady = false;
  doc._lspHoverReady = false;
  doc._lspOpenedVersion = doc._lspVersion;
  scheduleHoverReadyFallback(doc, uri, "post-change-diagnostics-fallback");
  if (changedRows && changedRows.length > 0) {
    const changes = changedRows.map((row) => ({
      range: { start: { line: row, character: 0 }, end: { line: row, character: 0xFFFFFF } },
      text: doc.rows[row]?.join("\t") ?? ""
    }));
    recordLspTraffic(uri, "lsp_update_file_incremental", { fileName: doc.name, documentVersion: doc._lspVersion, changedRows: changedRows.length });
    await lspUpdateFileIncremental(uri, doc._lspVersion, changes);
  } else {
    recordLspTraffic(uri, "lsp_update_file", { fileName: doc.name, documentVersion: doc._lspVersion });
    await lspUpdateFile(uri, doc._lspVersion, doc.toText());
  }
}

async function lspCloseDoc(doc) {
  if (!isVectorLintEngine()) {
    recordLintEngineEvent("vector-close-skipped-legacy", { fileName: doc?.name });
    return;
  }
  if (!state.lsp.started) return;
  const uri = docToUri(doc);
  if (!uri) return;
  recordLspTraffic(uri, "lsp_close_file", { fileName: doc.name });
  await lspCloseFile(uri);
  doc._lspReady = false;
  doc._lspOpened = false;
  doc._lspDiagnosticsReady = false;
  doc._lspHoverReady = false;
  doc._lspOpenedUri = null;
  doc._lspOpenedVersion = null;
  doc._lspOpenPromise = null;
  clearHoverReadyFallback(doc);
  clearHoverCacheForUri(uri);
  invalidateLspHover(false, "file-closed");
  // Clear diagnostics for this file
  const fileKey = uriToFileKey(uri);
  setLintDiagnostics(state.lint.diagnostics.filter((d) => d.fileKey !== fileKey));
  updateGridDiagnostics();
}

async function handleLspDiagnosticsChanged(uri) {
  if (!state.lint.enabled || !isVectorLintEngine()) {
    recordLintEngineEvent("vector-diagnostics-ignored", { uri });
    return;
  }
  recordLspTraffic(uri, "diagnostics_changed");
  recordLspTraffic(uri, "lsp_get_diagnostics");
  const rawDiags = await lspGetDiagnostics(uri).catch(() => []);
  const fileKey = uriToFileKey(uri);
  const doc = state.docs.find((d) => docToUri(d) === uri);
  const fileName = doc?.name ?? fileNameFromUri(uri);
  const filePath = doc?.path ?? pathFromUri(uri);
  recordLspReadiness(uri, "firstDiagnosticsReceived", { fileName, activeFile: activeDoc()?.name ?? "", diagnosticCount: rawDiags.length });

  const displayDiags = rawDiags.map((d, i) => ({
    id: `lsp:${uri}:${d.row}:${d.col}:${i}`,
    fileKey,
    fileName,
    filePath,
    rowIndex: d.row,
    columnIndex: d.col,
    severity: d.severity,
    message: d.message,
    ruleId: d.code ?? "",
    locationLabel: `Row ${d.row + 1}, Col ${d.col + 1}`
  }));

  setLintDiagnostics([
    ...state.lint.diagnostics.filter((d) => d.fileKey !== fileKey),
    ...displayDiags
  ]);

  updateGridDiagnostics();
  renderChrome();
  if (doc) {
    doc._lspDiagnosticsReady = true;
    markDocHoverReady(doc, uri, "diagnostics-ready");
  }
  if (doc === activeDoc()) scheduleHoverPrewarm("diagnostics-ready");
}

function computeCharOffset(doc, row, col) {
  let offset = 0;
  for (let c = 0; c < col; c++) {
    offset += doc.getCell(row, c).length + 1;
  }
  return offset;
}

function makeCurrentHoverTarget(doc, row, col) {
  const uri = docToUri(doc);
  if (!uri) return null;
  const cellValue = doc.getCell(row, col);
  return makeVectorHoverTarget({
    uri,
    fileName: doc.name,
    row,
    column: col,
    columnName: doc.headers?.[col] ?? doc.getCell(0, col) ?? "",
    cellValue,
    documentVersion: doc._lspVersion ?? 0,
    hasDiagnostics: diagnosticCellSetForDoc(doc).has(`${row}:${col}`)
  });
}

function isDocReadyForHover(doc) {
  return Boolean(effectiveVectorLspHoverEnabled() && state.lsp.started && docToUri(doc) && doc._lspOpened && doc._lspHoverReady);
}

function clearHoverCacheForUri(uri) {
  for (const key of [...lspHoverCache.keys()]) {
    if (key.startsWith(`${uri}\u001f`)) lspHoverCache.delete(key);
  }
  for (const key of [...lspHoverSemanticCache.keys()]) {
    if (key.startsWith(`${uri}\u001f`)) lspHoverSemanticCache.delete(key);
  }
}

function diagnosticCellSetForDoc(doc) {
  const uri = docToUri(doc) ?? "";
  const cacheKey = `${uri}\u001f${state.lint.version}`;
  if (diagnosticCellSetCache?.key === cacheKey) return diagnosticCellSetCache.set;
  const set = new Set(diagnosticsForDocument(state.lint.diagnostics, doc).map((d) => `${d.rowIndex}:${d.columnIndex}`));
  diagnosticCellSetCache = { key: cacheKey, set };
  return set;
}

function targetMatchesCurrentDocument(target) {
  const doc = state.docs.find((candidate) => docToUri(candidate) === target.uri);
  return Boolean(doc && doc.getCell(target.row, target.column) === target.cellValue);
}

const HOVER_NO_CONTENT_TTL_MS = 60_000;

function targetHasImmediateTooltip(target) {
  return Boolean(target?.hasDiagnostics || String(target?.cellValue ?? "").trim());
}

function makeHoverCacheEntry(target, text) {
  const hasContent = Boolean(text);
  return {
    text: hasContent ? text : null,
    hasContent,
    noContent: !hasContent,
    uri: target.uri,
    documentVersion: target.documentVersion,
    semanticKey: makeHoverSemanticCacheKey(target),
    cachedAt: perfNow()
  };
}

function makeHoverSemanticCacheKey(target) {
  if (!target) return "";
  const kind = target.targetKind === "diagnostic-cell" ? "cell" : target.targetKind;
  if (kind === "header") {
    return `${target.uri}\u001f${target.documentVersion}\u001fheader\u001f${target.column}\u001f${target.columnName}`;
  }
  return `${target.uri}\u001f${target.documentVersion}\u001f${kind}\u001f${target.columnName}\u001f${target.cellValue}`;
}

function isHoverCacheEntryUsable(entry, target) {
  if (!entry || entry.uri !== target.uri || entry.documentVersion !== target.documentVersion) return false;
  return !(entry.noContent && perfNow() - entry.cachedAt > HOVER_NO_CONTENT_TTL_MS);
}

function getHoverCacheEntry(target) {
  const entry = lspHoverCache.get(target.key);
  if (!isHoverCacheEntryUsable(entry, target)) {
    if (entry) lspHoverCache.delete(target.key);
  } else {
    return { ...entry, cacheSource: "exact" };
  }
  const semanticKey = makeHoverSemanticCacheKey(target);
  const semanticEntry = lspHoverSemanticCache.get(semanticKey);
  if (!isHoverCacheEntryUsable(semanticEntry, target)) {
    if (semanticEntry) lspHoverSemanticCache.delete(semanticKey);
    return null;
  }
  lspHoverCache.set(target.key, semanticEntry);
  return { ...semanticEntry, cacheSource: target.targetKind === "header" ? "header" : "semantic" };
}

function setHoverCacheEntry(target, text) {
  const entry = makeHoverCacheEntry(target, text);
  lspHoverCache.set(target.key, entry);
  lspHoverSemanticCache.set(entry.semanticKey, entry);
  return entry;
}

function queueLspHover(target, generation, sample) {
  if (sample) {
    sample.requestQueuedAt ??= perfNow();
    sample.prewarmQueueLength = lspHoverQueued ? 1 : 0;
  }
  if (lspHoverQueued?.sample && lspHoverQueued.target?.key !== target.key) {
    cancelVectorHoverSample(lspHoverQueued.sample, "replaced-by-latest-hover", perfNow);
  }
  lspHoverQueued = { target, generation, sample };
  recordHoverQueueEvent({ reason: "queued-until-ready", fileName: target.fileName, row: target.row, column: target.column, targetKind: target.targetKind });
}

function retryQueuedLspHover(_reason) {
  if (!lspHoverQueued) return;
  const { target, generation, sample } = lspHoverQueued;
  const doc = activeDoc();
  const currentUri = docToUri(doc);
  if (target.uri !== currentUri || lspHoverCurrentTarget?.key !== target.key || generation !== lspHoverGeneration) {
    cancelVectorHoverSample(sample, "target-changed-before-ready", perfNow);
    lspHoverQueued = null;
    return;
  }
  if (!isDocReadyForHover(doc)) return;
  lspHoverQueued = null;
  markVectorHoverRetry(sample);
  requestLspHover(target.row, target.column, { target, generation, sample, fromQueue: true }).catch(() => {});
}

async function requestLspHover(row, col, options = {}) {
  if (!effectiveVectorLspHoverEnabled()) {
    recordLintEngineEvent("vector-hover-skipped", { row, column: col });
    return;
  }
  cancelHoverPrewarm("user-hover");
  const doc = activeDoc();
  const target = options.target ?? makeCurrentHoverTarget(doc, row, col);
  if (!target) return;
  lspHoverCurrentTarget = target;
  const generation = options.generation ?? lspHoverGeneration;
  const ready = isDocReadyForHover(doc);
  const cacheEntry = getHoverCacheEntry(target);
  let sample = options.sample ?? recordHoverSample(startVectorHoverSample(target, {
    now: perfNow,
    vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
    cached: Boolean(cacheEntry),
    lspReady: ready,
    pointerEnterAt: options.pointerEnterAt,
    delayScheduledAt: options.delayScheduledAt,
    requestQueuedAt: options.requestQueuedAt,
    prewarmQueueLength: (lspHoverActiveUserRequest ? 1 : 0) + (lspHoverLatestQueuedRequest ? 1 : 0),
    wasUserInitiated: true
  }));
  sample.diagnosticsImmediate = Boolean(target.hasDiagnostics);
  recordLspReadiness(target.uri, "firstHoverRequested", {
    fileName: target.fileName,
    row,
    column: col,
    targetKind: target.targetKind,
    lspReady: ready,
    cacheState: cacheEntry?.cacheSource ?? "miss"
  });
  const acceptance = shouldAcceptVectorHoverResult({
    target,
    generation,
    currentTargetKey: lspHoverCurrentTarget?.matchKey ?? lspHoverCurrentTarget?.key,
    currentGeneration: lspHoverGeneration,
    vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
    contextMenuOpen: state.contextMenuOpen
  });
  if (!acceptance.accepted) {
    cancelVectorHoverSample(sample, acceptance.reason, perfNow);
    return;
  }
  if (cacheEntry) {
    sample.cached = true;
    sample.semanticCacheHit = cacheEntry.cacheSource === "semantic";
    sample.headerCacheHit = cacheEntry.cacheSource === "header";
    sample.cacheState = cacheEntry.noContent ? `${cacheEntry.cacheSource}-no-content-hit` : `${cacheEntry.cacheSource}-hit`;
    sample.responseAt = perfNow();
    sample.lspRequestSent = false;
    recordLspTraffic(target.uri, cacheEntry.cacheSource === "header" ? "hover_header_cache_hit" : cacheEntry.cacheSource === "semantic" ? "hover_semantic_cache_hit" : "hover_cache_hit", {
      fileName: target.fileName,
      row,
      column: col,
      targetKind: target.targetKind
    });
    grid.setLspHover(row, col, cacheEntry.text);
    finishVectorHoverSample(sample, {
      now: perfNow,
      contentReturned: cacheEntry.hasContent,
      rendered: cacheEntry.hasContent || targetHasImmediateTooltip(target),
      pointerStillOnTarget: true
    });
    if (target.hasDiagnostics && !cacheEntry.hasContent) recordLspTraffic(target.uri, "hover_diagnostic_local_only", { fileName: target.fileName, row, column: col });
    return;
  }
  recordLspTraffic(target.uri, "hover_cache_miss", { fileName: target.fileName, row, column: col, targetKind: target.targetKind });
  if (!ready) {
    queueLspHover(target, generation, sample);
    return;
  }
  enqueueUserHoverTarget(target, generation, sample);
}

function enqueueUserHoverTarget(target, generation, sample) {
  if (lspHoverPending.has(target.key)) {
    recordHoverQueueEvent({ reason: "attach-pending", fileName: target.fileName, row: target.row, column: target.column, targetKind: target.targetKind });
    fetchLspHoverTarget(target, { generation, sample, render: true }).catch(() => {});
    return;
  }
  const queuedAt = perfNow();
  sample.requestQueuedAt ??= queuedAt;
  sample.prewarmQueueLength = (lspHoverActiveUserRequest ? 1 : 0) + (lspHoverLatestQueuedRequest ? 1 : 0);
  const request = { target, generation, sample, queuedAt };
  if (!lspHoverActiveUserRequest) {
    dispatchUserHoverRequest(request);
    return;
  }
  if (lspHoverLatestQueuedRequest?.sample) {
    cancelVectorHoverSample(lspHoverLatestQueuedRequest.sample, "replaced-by-latest-hover", perfNow);
  }
  lspHoverLatestQueuedRequest = request;
  recordHoverQueueEvent({
    reason: "queued-latest-hover",
    fileName: target.fileName,
    row: target.row,
    column: target.column,
    targetKind: target.targetKind,
    replacements: 1
  });
}

function dispatchUserHoverRequest(request) {
  const { target, generation, sample, queuedAt } = request;
  const acceptance = shouldAcceptVectorHoverResult({
    target,
    generation,
    currentTargetKey: lspHoverCurrentTarget?.matchKey ?? lspHoverCurrentTarget?.key,
    currentGeneration: lspHoverGeneration,
    vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
    contextMenuOpen: state.contextMenuOpen
  });
  if (!acceptance.accepted || !targetMatchesCurrentDocument(target)) {
    cancelVectorHoverSample(sample, acceptance.accepted ? "document-version-changed" : acceptance.reason, perfNow);
    return;
  }
  const cacheEntry = getHoverCacheEntry(target);
  if (cacheEntry) {
    sample.cached = true;
    sample.semanticCacheHit = cacheEntry.cacheSource === "semantic";
    sample.headerCacheHit = cacheEntry.cacheSource === "header";
    sample.cacheState = cacheEntry.noContent ? `${cacheEntry.cacheSource}-no-content-hit` : `${cacheEntry.cacheSource}-hit`;
    sample.lspRequestSent = false;
    sample.responseAt = perfNow();
    recordLspTraffic(target.uri, cacheEntry.cacheSource === "header" ? "hover_header_cache_hit" : cacheEntry.cacheSource === "semantic" ? "hover_semantic_cache_hit" : "hover_cache_hit", {
      fileName: target.fileName,
      row: target.row,
      column: target.column,
      targetKind: target.targetKind
    });
    grid.setLspHover(target.row, target.column, cacheEntry.text);
    finishVectorHoverSample(sample, {
      now: perfNow,
      contentReturned: cacheEntry.hasContent,
      rendered: cacheEntry.hasContent || targetHasImmediateTooltip(target),
      pointerStillOnTarget: true
    });
    if (target.hasDiagnostics && !cacheEntry.hasContent) recordLspTraffic(target.uri, "hover_diagnostic_local_only", { fileName: target.fileName, row: target.row, column: target.column });
    recordHoverQueueEvent({ reason: "queued-cache-hit", fileName: target.fileName, row: target.row, column: target.column, targetKind: target.targetKind });
    return;
  }
  lspHoverActiveUserRequest = request;
  sample.queueWaitMs = Math.round((perfNow() - queuedAt) * 100) / 100;
  sample.lspRequestSent = true;
  recordHoverQueueEvent({
    reason: "dispatch-hover",
    fileName: target.fileName,
    row: target.row,
    column: target.column,
    targetKind: target.targetKind,
    queueWaitMs: sample.queueWaitMs
  });
  fetchLspHoverTarget(target, { generation, sample, render: true })
    .catch(() => {})
    .finally(() => {
      if (lspHoverActiveUserRequest === request) lspHoverActiveUserRequest = null;
      const next = lspHoverLatestQueuedRequest;
      lspHoverLatestQueuedRequest = null;
      if (next) dispatchUserHoverRequest(next);
    });
}

async function fetchLspHoverTarget(target, { generation, sample = null, render = false, prewarm = false } = {}) {
  const pending = lspHoverPending.get(target.key);
  if (pending) {
    if (render && sample) {
      markVectorHoverRequested(sample, () => pending.requestStarted);
      sample.lspRequestSent = false;
      sample.attachedToPending = true;
      pending.waiters.push({ generation, sample });
    }
    return pending.promise;
  }
  const waiters = render && sample ? [{ generation, sample }] : [];
  const requestStarted = perfNow();
  const promise = (async () => {
    for (const waiter of waiters) markVectorHoverRequested(waiter.sample, () => requestStarted);
    try {
      const doc = state.docs.find((candidate) => docToUri(candidate) === target.uri);
      if (!doc || !targetMatchesCurrentDocument(target)) return null;
      const charOffset = computeCharOffset(doc, target.row, target.column);
      recordLspTraffic(target.uri, "lsp_hover", { fileName: target.fileName, row: target.row, column: target.column, targetKind: target.targetKind });
      const text = await lspHover(target.uri, target.row, charOffset);
      const responseAt = perfNow();
      recordLspReadiness(target.uri, "firstHoverResponse", {
        fileName: target.fileName,
        row: target.row,
        column: target.column,
        targetKind: target.targetKind,
        lspResponseMs: Math.round((responseAt - requestStarted) * 100) / 100,
        hasContent: Boolean(text)
      });
      const currentPending = lspHoverPending.get(target.key);
      const currentWaiters = currentPending?.waiters ?? waiters;
      if (generation !== lspHoverGeneration || !targetMatchesCurrentDocument(target)) {
        const reason = generation !== lspHoverGeneration ? "generation-changed" : "document-version-changed";
        for (const waiter of currentWaiters) cancelVectorHoverSample(waiter.sample, reason, perfNow);
        return null;
      }
      const cacheEntry = setHoverCacheEntry(target, text);
      for (const waiter of currentWaiters) {
        waiter.sample.responseAt = responseAt;
        waiter.sample.cacheState = cacheEntry.noContent ? "no-content-stored" : "stored";
        const resultAcceptance = shouldAcceptVectorHoverResult({
          target,
          generation: waiter.generation,
          currentTargetKey: lspHoverCurrentTarget?.matchKey ?? lspHoverCurrentTarget?.key,
          currentGeneration: lspHoverGeneration,
          vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
          contextMenuOpen: state.contextMenuOpen
        });
        if (!resultAcceptance.accepted) {
          cancelVectorHoverSample(waiter.sample, resultAcceptance.reason, perfNow);
          continue;
        }
        if (text) {
          grid.setLspHover(target.row, target.column, text);
          finishVectorHoverSample(waiter.sample, { now: perfNow, contentReturned: true, rendered: true, pointerStillOnTarget: true });
        } else {
          grid.setLspHover(target.row, target.column, null);
          finishVectorHoverSample(waiter.sample, { now: perfNow, contentReturned: false, rendered: targetHasImmediateTooltip(target), pointerStillOnTarget: true });
        }
      }
      if (prewarm) recordHoverPrewarmSample(target, { requestStarted, responseAt, contentReturned: Boolean(text) });
      return text;
    } catch {
      const currentPending = lspHoverPending.get(target.key);
      for (const waiter of currentPending?.waiters ?? waiters) {
        const resultAcceptance = shouldAcceptVectorHoverResult({
          target,
          generation: waiter.generation,
          currentTargetKey: lspHoverCurrentTarget?.matchKey ?? lspHoverCurrentTarget?.key,
          currentGeneration: lspHoverGeneration,
          vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
          contextMenuOpen: state.contextMenuOpen
        });
        if (resultAcceptance.accepted) cancelVectorHoverSample(waiter.sample, "request-failed", perfNow);
        else cancelVectorHoverSample(waiter.sample, resultAcceptance.reason, perfNow);
      }
      return null;
    } finally {
      lspHoverPending.delete(target.key);
    }
  })();
  lspHoverPending.set(target.key, { generation, waiters, promise, requestStarted, prewarm: Boolean(prewarm) });
  return promise;
}

const HOVER_PREWARM_ENABLED = false;
const HOVER_PREWARM_DELAY_MS = 80;
const HOVER_PREWARM_CONCURRENCY = 2;
const HOVER_PREWARM_MAX_TARGETS = 90;

function scheduleHoverPrewarm(reason = "schedule") {
  if (!effectiveVectorLspHoverEnabled()) {
    cancelHoverPrewarm(reason);
    recordHoverPrewarmEvent({ reason, skipped: true, disabled: true, engine: state.lint.engine, queued: 0 });
    return;
  }
  if (!HOVER_PREWARM_ENABLED) {
    cancelHoverPrewarm(reason);
    recordLspTraffic(docToUri(activeDoc()), "hover_prewarm_canceled", { reason, disabled: true, activeFile: activeDoc()?.name ?? "" });
    recordHoverPrewarmEvent({ reason, skipped: true, disabled: true, queued: 0 });
    return;
  }
  if (hoverPrewarmTimer !== null) clearTimeout(hoverPrewarmTimer);
  hoverPrewarmTimer = setTimeout(() => {
    hoverPrewarmTimer = null;
    startHoverPrewarm(reason);
  }, HOVER_PREWARM_DELAY_MS);
}

function cancelHoverPrewarm(reason = "cancel") {
  hoverPrewarmGeneration += 1;
  hoverPrewarmQueue = [];
  hoverPrewarmActive = 0;
  if (hoverPrewarmTimer !== null) {
    clearTimeout(hoverPrewarmTimer);
    hoverPrewarmTimer = null;
  }
  recordHoverPrewarmEvent({ reason, canceled: true });
}

function startHoverPrewarm(reason = "visible") {
  const doc = activeDoc();
  if (!effectiveVectorLspHoverEnabled() || state.contextMenuOpen || !isDocReadyForHover(doc)) return;
  const targets = buildVisibleHoverPrewarmTargets(doc).filter((target) => !getHoverCacheEntry(target) && !lspHoverPending.has(target.key));
  if (!targets.length) return;
  hoverPrewarmGeneration += 1;
  hoverPrewarmQueue = targets.slice(0, HOVER_PREWARM_MAX_TARGETS);
  hoverPrewarmActive = 0;
  recordLspTraffic(uri, "hover_prewarm_queued", { reason, queued: hoverPrewarmQueue.length, fileName: doc.name });
  recordHoverPrewarmEvent({ reason, queued: hoverPrewarmQueue.length, fileName: doc.name });
  pumpHoverPrewarm(hoverPrewarmGeneration);
}

function pumpHoverPrewarm(generation) {
  if (generation !== hoverPrewarmGeneration) return;
  while (hoverPrewarmActive < HOVER_PREWARM_CONCURRENCY && hoverPrewarmQueue.length) {
    const target = hoverPrewarmQueue.shift();
    hoverPrewarmActive += 1;
    fetchLspHoverTarget(target, { generation: lspHoverGeneration, prewarm: true })
      .catch(() => {})
      .finally(() => {
        hoverPrewarmActive = Math.max(0, hoverPrewarmActive - 1);
        pumpHoverPrewarm(generation);
      });
  }
}

function buildVisibleHoverPrewarmTargets(doc) {
  const uri = docToUri(doc);
  if (!uri) return [];
  const rows = grid.visibleRowIndexes?.() ?? [];
  const columns = grid.visibleColumnIndexes?.() ?? [];
  const diagCells = diagnosticCellSetForDoc(doc);
  const targets = [];
  const seen = new Set();
  const push = (row, column) => {
    if (row < 0 || column < 0 || row >= doc.rowCount || column >= doc.columnCount) return;
    const target = makeVectorHoverTarget({
      uri,
      fileName: doc.name,
      row,
      column,
      columnName: doc.headers?.[column] ?? doc.getCell(0, column) ?? "",
      cellValue: doc.getCell(row, column),
      documentVersion: doc._lspVersion ?? 0,
      hasDiagnostics: diagCells.has(`${row}:${column}`)
    });
    if (seen.has(target.key)) return;
    seen.add(target.key);
    targets.push(target);
  };
  for (const column of columns.slice(0, 32)) push(0, column);
  for (const row of rows.filter((row) => row > 0).slice(0, 32)) push(row, 0);
  for (const row of rows.filter((row) => row > 0).slice(0, 8)) {
    for (const column of columns.filter((column) => column > 0).slice(0, 8)) push(row, column);
  }
  for (const key of diagCells) {
    const [row, column] = key.split(":").map(Number);
    if (rows.includes(row) && columns.includes(column)) push(row, column);
    if (targets.length >= HOVER_PREWARM_MAX_TARGETS) break;
  }
  return targets;
}

function recordHoverPrewarmEvent(event) {
  hoverPrewarmSamples.push({
    timestamp: perfNow(),
    ...event
  });
  if (hoverPrewarmSamples.length > 160) hoverPrewarmSamples.shift();
}

function recordHoverPrewarmSample(target, { requestStarted, responseAt, contentReturned }) {
  recordHoverPrewarmEvent({
    fileName: target.fileName,
    targetKind: target.targetKind,
    row: target.row,
    column: target.column,
    columnName: target.columnName,
    cellValue: target.cellValue,
    documentVersion: target.documentVersion,
    totalMs: Math.round((responseAt - requestStarted) * 100) / 100,
    contentReturned: Boolean(contentReturned),
    cacheState: contentReturned ? "filled" : "empty"
  });
}

// ── diagnostics helpers ────────────────────────────────────────────────────

function updateGridDiagnostics() {
  const started = perfNow();
  const diagnosticsByCell = lintActive()
    ? groupDiagnosticsByCell(diagnosticsForDocument(state.lint.diagnostics, activeDoc()))
    : new Map();
  grid.setDiagnostics(diagnosticsByCell);
  updateOverviewRuler();
  recordUiPerf("update-grid-diagnostics", started, { cellMarkers: diagnosticsByCell.size });
}

function severityOrder(severity) {
  return severity === "error" ? 2 : severity === "warning" ? 1 : 0;
}

function docDiagnosticSeverity(_doc) {
  return null;
}

function updateOverviewRuler() {
  const started = perfNow();
  const ruler = els.overviewRuler;
  if (!ruler) {
    recordUiPerf("update-overview-ruler", started, { skipped: true });
    return;
  }
  const hostRect = els.host.getBoundingClientRect();
  ruler.style.top = `${hostRect.top}px`;
  ruler.style.height = `${hostRect.height}px`;
  ruler.style.right = "0px";
  const doc = activeDoc();
  const diags = lintActive() ? diagnosticsForDocument(state.lint.diagnostics, doc) : [];
  const rowCount = doc.rowCount;
  if (!diags.length || !rowCount) {
    ruler.innerHTML = "";
    recordUiPerf("update-overview-ruler", started, { marks: 0 });
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
  recordUiPerf("update-overview-ruler", started, { marks: seenRows.size });
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
  if (!isVectorLintEngine() || !state.lsp.started) return false;
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
  if (!isVectorLintEngine() || !state.lsp.started) return;
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
  return diagnosticsForDocument(state.lint.diagnostics, doc).length > 0;
}

async function goToDiagnostic(id) {
  const diagnostic = state.lint.diagnostics.find((item) => item.id === id);
  if (!diagnostic) return;
  let index = state.docs.findIndex((doc) => lintDocKey(doc) === diagnostic.fileKey);
  if (index < 0 && isLegacyLintEngine()) {
    const workspaceDoc = state.lint.legacy.workspaceDocs.find((doc) => lintDocKey(doc) === diagnostic.fileKey);
    if (workspaceDoc) {
      await addDocument(workspaceDoc);
      index = state.active;
    }
  }
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
  grid.layout();
  els.host.focus();
}

async function loadConfig() {
  const config = await getConfig().catch(() => ({}));
  state.config = config ?? {};
}

function showAppSettings() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const fontOptions = FONT_OPTIONS.map(([label, value]) =>
    `<option value="${escapeHtml(value)}"${state.gridFont === value ? " selected" : ""}>${escapeHtml(label)}</option>`
  ).join("");
  const dockOptionsFor = (panel) => DOCK_EDGES.map((edge) => `
    <button class="${dockForPanel(panel) === edge ? "active" : ""}" data-settings-dock-panel="${panel}" data-settings-dock-edge="${edge}">${edge[0].toUpperCase()}${edge.slice(1)}</button>
  `).join("");
  backdrop.innerHTML = `
    <div class="modal settings-modal">
      <h2>Settings</h2>
      <div class="settings-stack">
        <label class="settings-checkbox-label">
          <input type="checkbox" id="settingsColorizeColumns"${state.colorizeColumns ? " checked" : ""} />
          Colorize columns
        </label>
        <div class="settings-label">Lint Engine</div>
        <div class="settings-segmented" role="group" aria-label="Lint Engine">
          <button class="${isVectorLintEngine() ? "active" : ""}" data-settings-lint-engine="vector-lsp">Vector-LSP</button>
          <button class="${isLegacyLintEngine() ? "active" : ""}" data-settings-lint-engine="legacy">Legacy Lint</button>
        </div>
        <label class="settings-checkbox-label">
          <input type="checkbox" id="settingsVectorLspHover"${state.vectorLspHover ? " checked" : ""}${isLegacyLintEngine() ? " disabled" : ""} />
          Vector-LSP Hover
        </label>
        <div class="settings-hint${isLegacyLintEngine() ? "" : " hidden"}" id="settingsVectorLspHoverHint">Vector-LSP Hover is only available when the Vector-LSP lint engine is selected.</div>
        <label class="settings-label" for="settingsGridFont">Font</label>
        <select class="modal-input settings-font-select" id="settingsGridFont">${fontOptions}</select>
        <div class="settings-label">Theme</div>
        <div class="settings-segmented" role="group" aria-label="Theme">
          <button class="${state.theme === "dark" ? "active" : ""}" data-settings-theme="dark">Dark</button>
          <button class="${state.theme === "light" ? "active" : ""}" data-settings-theme="light">Light</button>
        </div>
        <div class="settings-dock-row">
          <div>
            <div class="settings-label">Explorer Dock</div>
            <div class="settings-segmented" role="group" aria-label="Explorer Dock">${dockOptionsFor("explorer")}</div>
          </div>
          <div>
            <div class="settings-label">Problems Dock</div>
            <div class="settings-segmented" role="group" aria-label="Problems Dock">${dockOptionsFor("problems")}</div>
          </div>
        </div>
        <div class="settings-reset-row">
          <button data-settings-reset-layout>Reset Layout</button>
        </div>
      </div>
      <div class="modal-actions">
        <button data-settings-close>Close</button>
      </div>
    </div>`;
  document.body.append(backdrop);

  const colorizeInput = backdrop.querySelector("#settingsColorizeColumns");
  const hoverInput = backdrop.querySelector("#settingsVectorLspHover");
  const hoverHint = backdrop.querySelector("#settingsVectorLspHoverHint");
  const fontInput = backdrop.querySelector("#settingsGridFont");
  const lintEngineButtons = [...backdrop.querySelectorAll("[data-settings-lint-engine]")];
  const themeButtons = [...backdrop.querySelectorAll("[data-settings-theme]")];
  const dockButtons = [...backdrop.querySelectorAll("[data-settings-dock-panel]")];
  const refresh = () => {
    colorizeInput.checked = state.colorizeColumns;
    hoverInput.checked = state.vectorLspHover;
    hoverInput.disabled = isLegacyLintEngine();
    hoverHint?.classList.toggle("hidden", !isLegacyLintEngine());
    fontInput.value = state.gridFont;
    for (const button of lintEngineButtons) button.classList.toggle("active", button.dataset.settingsLintEngine === state.lint.engine);
    for (const button of themeButtons) button.classList.toggle("active", button.dataset.settingsTheme === state.theme);
    for (const button of dockButtons) button.classList.toggle("active", dockForPanel(button.dataset.settingsDockPanel) === button.dataset.settingsDockEdge);
  };
  colorizeInput.addEventListener("change", () => { setColorizeColumns(colorizeInput.checked); refresh(); });
  hoverInput.addEventListener("change", () => { setVectorLspHover(hoverInput.checked); refresh(); });
  fontInput.addEventListener("change", () => { changeGridFont(fontInput.value); refresh(); });
  for (const button of lintEngineButtons) {
    button.addEventListener("click", () => { setLintEngine(button.dataset.settingsLintEngine); refresh(); });
  }
  for (const button of themeButtons) {
    button.addEventListener("click", () => { setTheme(button.dataset.settingsTheme); refresh(); });
  }
  for (const button of dockButtons) {
    button.addEventListener("click", () => { setPanelDock(button.dataset.settingsDockPanel, button.dataset.settingsDockEdge); refresh(); });
  }
  backdrop.querySelector("[data-settings-reset-layout]")?.addEventListener("click", () => { resetDockLayout(); refresh(); });

  const close = () => {
    backdrop.remove();
    els.host.focus();
  };
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-settings-close]")) close();
  });
}

async function showSettings() {
  if (isLegacyLintEngine()) {
    state.lint.legacy.rulesOpen = true;
    renderChrome();
    return;
  }
  const config = await getConfig().catch(() => ({}));
  const mode = config.lintMode ?? "basic";
  const schemaVersion = config.schemaVersion ?? "3.2";
  const VERSIONS = ["3.2", "3.1", "2.4", "1.13"];
  const versionOptions = VERSIONS.map((v) =>
    `<option value="${escapeHtml(v)}"${schemaVersion === v ? " selected" : ""}>${escapeHtml(v)}</option>`
  ).join("");

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal settings-modal">
      <h2>Lint Options</h2>
      <div class="settings-tabs">
        <button class="settings-tab${mode === "basic" ? " active" : ""}" data-settings-tab="basic">Basic</button>
        <button class="settings-tab${mode === "advanced" ? " active" : ""}" data-settings-tab="advanced">Advanced</button>
      </div>
      <div id="settingsBasicSection" class="settings-tab-panel${mode !== "basic" ? " hidden" : ""}">
        <label class="settings-label">Schema Version</label>
        <select class="modal-input settings-version-select" id="settingsSchemaVersion">${versionOptions}</select>
      </div>
      <div id="settingsAdvancedSection" class="settings-tab-panel${mode !== "advanced" ? " hidden" : ""}">
        <label class="settings-label">Plugin Folder</label>
        <div class="settings-row">
          <input class="modal-input" id="settingsPluginPath"
            value="${escapeHtml(config.pluginPath ?? "")}"
            placeholder="Path to plugins directory" />
          ${isTauriRuntime() ? `<button class="settings-browse-btn" id="settingsBrowsePluginBtn">Browse…</button>` : ""}
        </div>
        <label class="settings-label">Schema Folder</label>
        <div class="settings-row">
          <input class="modal-input" id="settingsSchemaPath"
            value="${escapeHtml(config.schemaPath ?? "")}"
            placeholder="Path to schema directory" />
          ${isTauriRuntime() ? `<button class="settings-browse-btn" id="settingsBrowseSchemaBtn">Browse…</button>` : ""}
        </div>
        <label class="settings-label">Linter (vector-lsp) Path</label>
        <div class="settings-row">
          <input class="modal-input" id="settingsLspPath"
            value="${escapeHtml(config.vectorLspPath ?? "")}"
            placeholder="Path to vector-lsp executable (auto-detect if blank)" />
          ${isTauriRuntime() ? `<button class="settings-browse-btn" id="settingsBrowseLspBtn">Browse…</button>` : ""}
        </div>
      </div>
      <div class="settings-debug-row">
        <label class="settings-checkbox-label">
          <input type="checkbox" id="settingsDebugLogging"${config.debugLogging ? " checked" : ""} />
          Enable debug logging (shows in Log panel)
        </label>
      </div>
      <div class="modal-actions">
        <button data-settings-choice="save">Save</button>
        <button data-settings-choice="cancel">Cancel</button>
        ${state.lsp.started ? `<button data-settings-choice="restart-lsp" style="margin-left:auto">Restart LSP</button>` : ""}
      </div>
    </div>`;
  document.body.append(backdrop);

  const basicSection = backdrop.querySelector("#settingsBasicSection");
  const advancedSection = backdrop.querySelector("#settingsAdvancedSection");
  const tabs = backdrop.querySelectorAll(".settings-tab");
  const lspInput = backdrop.querySelector("#settingsLspPath");
  const schemaInput = backdrop.querySelector("#settingsSchemaPath");
  const pluginInput = backdrop.querySelector("#settingsPluginPath");
  const versionSelect = backdrop.querySelector("#settingsSchemaVersion");

  tabs.forEach((tab) => tab.addEventListener("click", () => {
    const isBasic = tab.dataset.settingsTab === "basic";
    tabs.forEach((t) => t.classList.toggle("active", t === tab));
    basicSection.classList.toggle("hidden", !isBasic);
    advancedSection.classList.toggle("hidden", isBasic);
  }));

  backdrop.querySelector("#settingsBrowsePluginBtn")?.addEventListener("click", async () => {
    const picked = await pickFolderPath().catch(() => null);
    if (picked) pluginInput.value = picked;
  });

  backdrop.querySelector("#settingsBrowseSchemaBtn")?.addEventListener("click", async () => {
    const picked = await pickFolderPath().catch(() => null);
    if (picked) schemaInput.value = picked;
  });

  backdrop.querySelector("#settingsBrowseLspBtn")?.addEventListener("click", async () => {
    const picked = await pickFilePath().catch(() => null);
    if (picked) lspInput.value = picked;
  });

  return new Promise((resolve) => {
    const finish = () => { backdrop.remove(); els.host.focus(); resolve(); };
    backdrop.addEventListener("click", async (event) => {
      const choice = event.target.closest("[data-settings-choice]")?.dataset.settingsChoice;
      if (choice === "save") {
        const selectedMode = backdrop.querySelector(".settings-tab.active")?.dataset.settingsTab ?? "basic";
        const debugLoggingEl = backdrop.querySelector("#settingsDebugLogging");
        const updated = {
          ...config,
          lintMode: selectedMode,
          schemaVersion: versionSelect?.value || "3.2",
          pluginPath: pluginInput?.value.trim() || undefined,
          schemaPath: schemaInput?.value.trim() || undefined,
          vectorLspPath: lspInput?.value.trim() || undefined,
          debugLogging: debugLoggingEl?.checked ?? false
        };
        await saveConfig(updated).catch((err) => showError(`Failed to save lint options: ${err}`));
        state.config = updated;
        finish();
        if (state.workspace) {
          setLintDiagnostics([]);
          updateGridDiagnostics();
          lspStartWorkspace(state.workspace.path).catch(showError);
        }
      }
      if (choice === "cancel") finish();
      if (choice === "restart-lsp") {
        finish();
        if (state.workspace) lspStartWorkspace(state.workspace.path).catch(showError);
      }
    });
  });
}

function saveLintSettings() {
  localStorage.setItem("txteditor.lint.settings", JSON.stringify({ enabled: state.lint.enabled }));
}

function saveLegacyLintSettings() {
  localStorage.setItem("txteditor.legacyLint.settings", JSON.stringify(state.lint.legacy.settings));
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
  setContextMenuOpen(true);
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
  setContextMenuOpen(false);
  for (const group of els.contextMenu.querySelectorAll(".menu-group.active")) group.classList.remove("active");
}

function setContextMenuOpen(open) {
  state.contextMenuOpen = Boolean(open);
  if (state.contextMenuOpen) clearVisibleLspHover("context-menu-open");
  grid.setHoverSuspended(state.contextMenuOpen);
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
    { id: "hide-row", label: "Hide Row(s)" },
    { id: "delete-row", label: "Delete Row(s)" },
    { id: "clone-row", label: "Clone Row", disabled: rowsForContextOperation().filter((row) => row > 0 && row < activeDoc().rowCount).length === 0 }
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

function renderLintControls() {
  if (!els.lintControls) return;
  const lintButton = `<button class="toggle-button${state.lint.enabled ? " active" : ""}" data-command="toggle-lint">${state.lint.enabled ? "Lint: On" : "Lint: Off"}</button>`;
  if (isLegacyLintEngine()) {
    const options = lintProfileOptions().map((profile) =>
      `<option value="${escapeHtml(profile)}"${state.lint.legacy.settings.profile === profile ? " selected" : ""}>${escapeHtml(profile)}</option>`
    ).join("");
    els.lintControls.innerHTML = `
      ${lintButton}
      <select id="lintProfileSelect" class="profile-select" title="D2R lint profile">${options}</select>
      <button data-command="toggle-lint-rules" class="${state.lint.legacy.rulesOpen ? "active" : ""}">Rules</button>
    `;
    const select = els.lintControls.querySelector("#lintProfileSelect");
    select?.addEventListener("change", () => setLegacyLintProfile(select.value));
    renderLegacyLintRulesPanel();
    return;
  }
  els.lintControls.innerHTML = `
    ${lintButton}
    <button data-command="open-settings" title="Lint options">Lint Options</button>
  `;
  if (els.lintRulesPanel) {
    els.lintRulesPanel.classList.add("hidden");
    els.lintRulesPanel.innerHTML = "";
  }
}

function renderLegacyLintRulesPanel() {
  if (!els.lintRulesPanel) return;
  if (!isLegacyLintEngine() || !state.lint.legacy.rulesOpen) {
    els.lintRulesPanel.classList.add("hidden");
    els.lintRulesPanel.innerHTML = "";
    return;
  }
  els.lintRulesPanel.classList.remove("hidden");
  els.lintRulesPanel.innerHTML = lintRuleGroupsForProfile(state.lint.legacy.settings.profile).map((group) => `
    <section class="lint-rule-group">
      <h3>${escapeHtml(group.group)}</h3>
      ${group.rules.map((entry) => {
        const setting = currentLegacyProfileRules()[entry.id];
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
  for (const input of els.lintRulesPanel.querySelectorAll("[data-lint-rule]")) {
    input.addEventListener("change", () => setLegacyLintRuleEnabled(input.dataset.lintRule, input.checked));
  }
}

function renderChrome() {
  const started = perfNow();
  syncDockLayout();
  els.shell.classList.toggle("sidebar-hidden", !state.sidebarVisible);
  els.shell.classList.toggle("problems-open", state.problemsVisible);
  els.sidebar?.classList.toggle("hidden", !state.sidebarVisible);
  els.problemsPanel?.classList.toggle("hidden", !state.problemsVisible);
  for (const btn of document.querySelectorAll("[data-bottom-tab]")) {
    btn.classList.toggle("active", btn.dataset.bottomTab === state.bottomTab);
  }
  if (els.problemsList) els.problemsList.classList.toggle("hidden", state.bottomTab !== "problems");
  if (els.logList) els.logList.classList.toggle("hidden", state.bottomTab !== "log");
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
    button.classList.toggle("active", state.freezeRow);
  }
  for (const button of document.querySelectorAll("[data-command='toggle-freeze-column']")) {
    button.classList.toggle("active", state.freezeColumn);
  }
  for (const button of document.querySelectorAll("[data-command='toggle-colorize']")) {
    button.classList.toggle("active", state.colorizeColumns);
  }
  renderLintControls();
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
  els.tabs.innerHTML = state.docs
    .map((doc, index) => {
      const sev = docDiagnosticSeverity(doc);
      const titleClass = sev ? `tab-title tab-title-${sev}` : "tab-title";
      return `<button class="${index === state.active ? "active" : ""}" data-tab="${index}"><span class="${titleClass}">${escapeHtml(doc.name)}${doc.dirty ? "*" : ""}</span><span class="tab-close" data-close-tab="${index}" title="Close">x</span></button>`;
    })
    .join("");
  const workspaceFiles = renderWorkspaceFileList(state.docs);
  els.fileList.innerHTML = state.docs
    .map((doc, index) => `<button class="${index === state.active ? "active" : ""}" data-tab="${index}">${escapeHtml(doc.name)}${problemBadgeForPath(doc.path || doc.name)}</button>`)
    .join("") + (workspaceFiles ? `<div class="separator"></div>${workspaceFiles}` : "");
  renderProblemsPanelIfNeeded();
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
      scheduleHoverPrewarm("tab-switch");
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
  recordUiPerf("render-chrome", started, { docs: state.docs.length });
}

function renderProblemsPanelIfNeeded() {
  const started = perfNow();
  if (!els.problemsList || !state.problemsVisible || state.bottomTab !== "problems") {
    recordUiPerf("render-problems-panel", started, { skipped: true });
    return;
  }
  const key = problemsPanelRenderKey();
  if (els.problemsList.dataset.renderKey === key) {
    recordUiPerf("render-problems-panel", started, { cached: true });
    return;
  }
  els.problemsList.innerHTML = renderProblemsPanel();
  els.problemsList.dataset.renderKey = key;
  for (const details of els.problemsList.querySelectorAll("details[data-file-name]")) {
    details.addEventListener("toggle", () => {
      const fn = details.dataset.fileName;
      if (details.open) collapsedProblemFiles.delete(fn);
      else collapsedProblemFiles.add(fn);
    });
  }
  for (const button of els.problemsList.querySelectorAll("[data-diagnostic-id]")) {
    button.addEventListener("click", async () => goToDiagnostic(button.dataset.diagnosticId).catch(showError));
  }
  recordUiPerf("render-problems-panel", started, { rendered: true });
}

function problemsPanelRenderKey() {
  return [
    state.lint.engine,
    state.lint.enabled ? "on" : "off",
    state.lsp.started ? "started" : "stopped",
    state.lint.status,
    state.lint.legacy.status,
    state.lint.legacy.rulesOpen ? "rules-open" : "rules-closed",
    state.lint.legacy.settings.profile,
    state.lint.version,
    [...collapsedProblemFiles].sort().join("\u001f")
  ].join("\u001e");
}

function renderProblemsPanel() {
  if (!state.lint.enabled) return `<div class="empty-problems">Lint is off.</div>`;
  if (isVectorLintEngine() && !state.lsp.started) return `<div class="empty-problems">Open a folder to enable linting.</div>`;
  if (!state.lint.diagnostics.length) return `<div class="empty-problems">No problems.</div>`;
  return groupDiagnosticsByFile(state.lint.diagnostics).map(([fileName, diagnostics]) => `
    <details class="problem-file-group" data-file-name="${escapeHtml(fileName)}"${collapsedProblemFiles.has(fileName) ? "" : " open"}>
      <summary class="problem-file-header">${escapeHtml(fileName)} <span class="problem-file-count">(${diagnostics.length})</span></summary>
      ${diagnostics.map((diagnostic) => `
        <button class="problem-item" data-severity="${escapeHtml(diagnostic.severity)}" data-diagnostic-id="${escapeHtml(diagnostic.id)}">
          <span class="problem-location">R${diagnostic.rowIndex + 1}:C${diagnostic.columnIndex + 1}</span>
          <span class="problem-message">${escapeHtml(diagnostic.message)}</span>
          ${diagnostic.ruleId ? `<span class="problem-rule">${escapeHtml(diagnostic.ruleId)}</span>` : ""}
          ${diagnostic.profile ? `<span class="problem-rule">${escapeHtml(diagnostic.profile)}</span>` : ""}
        </button>
      `).join("")}
    </details>
  `).join("");
}

function lintSummaryText() {
  if (!state.lint.enabled) return "Lint off";
  if (isLegacyLintEngine()) {
    if (state.lint.legacy.status) return state.lint.legacy.status;
    if (state.lint.legacy.workspaceLoad.status === "failed") return `Workspace index failed - ${state.lint.legacy.settings.profile}`;
    const counts = diagnosticCounts(state.lint.diagnostics);
    if (!state.lint.diagnostics.length) return `No problems - ${state.lint.legacy.settings.profile}`;
    return `${counts.error} errors, ${counts.warning} warnings, ${counts.info} info - ${state.lint.legacy.settings.profile}`;
  }
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
  const count = state.lint.diagnostics.filter((diagnostic) => diagnostic.fileKey === key).length;
  return count ? ` <span class="file-problem-badge">${count}</span>` : "";
}

function lintNotificationsVisible() {
  return state.problemsVisible && state.lint.enabled && state.lint.diagnostics.length > 0;
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
  if (isVectorLintEngine()) lspCloseDoc(doc).catch(() => {});
  else cancelLegacyLintJobs({ clearDiagnostics: false });
  state.docs.splice(index, 1);
  if (!state.docs.length) {
    state.active = -1;
    grid.setDocument(EMPTY_DOC);
  } else {
    state.active = clamp(index <= state.active ? state.active - 1 : state.active, 0, state.docs.length - 1);
    grid.setDocument(activeDoc());
  }
  if (isLegacyLintEngine()) scheduleLegacyLintFull("tab-closed", 0);
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
