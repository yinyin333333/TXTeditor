import { clamp } from "../../core/table-model.js";
import {
  DOCK_EDGES,
  DOCK_PANELS,
  MIN_DOCK_HEIGHT,
  MIN_DOCK_WIDTH,
  MIN_EDITOR_HEIGHT,
  MIN_EDITOR_WIDTH,
  dockPanelEdge,
  dockPanelFlexStyle,
  fitDockPair,
  normalizeDockEdge,
  normalizeDockLayout,
  panelsForDockEdge,
  resetDockLayoutState
} from "../dock-layout-policy.js";
import { syncDockChildren } from "../dock-sync.js";
import {
  DOCK_LAYOUT_KEY,
  MIN_PROBLEMS_HEIGHT,
  MIN_SIDEBAR_WIDTH,
  PROBLEMS_HEIGHT_KEY,
  PROBLEMS_VISIBILITY_KEY,
  SIDEBAR_VISIBILITY_KEY,
  SIDEBAR_WIDTH_KEY,
  nextPanelVisibility,
  panelVisibilityStorageValue,
  problemsHeaderShouldUseNarrowLayout
} from "../panel-state-policy.js";

export function createDockController({
  state,
  els,
  renderChrome,
  layoutGrid,
  onProblemsOpened,
  onProblemsClosed
}) {
  const dockSplitters = new Map();

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
    return dockPanelEdge(state.dockLayout, panel);
  }

  function panelsForDock(edge, { visibleOnly = true } = {}) {
    const visiblePanels = new Set(DOCK_PANELS.filter((panel) => isPanelVisible(panel)));
    return panelsForDockEdge({
      layout: state.dockLayout,
      edge,
      visiblePanels,
      visibleOnly
    });
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
    localStorage.setItem(DOCK_LAYOUT_KEY, JSON.stringify(state.dockLayout));
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
    const style = dockPanelFlexStyle({ edge, count, index, splitRatio: state.dockLayout.splits?.[edge] });
    panelEl.style.minWidth = style.minWidth;
    panelEl.style.minHeight = style.minHeight;
    panelEl.style.flex = style.flex;
    panelEl.dataset.dockPanel = panel;
  }

  function syncDockLayout() {
    for (const panel of DOCK_PANELS) {
      const panelEl = panelElement(panel);
      if (!panelEl) continue;
      const edge = dockForPanel(panel);
      panelEl.classList.toggle("hidden", !isPanelVisible(panel));
      panelEl.dataset.dockEdge = edge;
      panelEl.dataset.dockPanel = panel;
      const resizer = panelResizer(panel);
      if (resizer) resizer.dataset.dockEdge = edge;
    }
    for (const edge of DOCK_EDGES) {
      const dock = dockContainer(edge);
      if (!dock) continue;
      const panels = panelsForDock(edge);
      dock.classList.toggle("dock-empty", panels.length === 0);
      dock.classList.toggle("dock-same-edge", panels.length > 1);
      const children = [];
      panels.forEach((panel, index) => {
        const panelEl = panelElement(panel);
        if (!panelEl) return;
        applyPanelFlex(panel, panelEl, edge, panels.length, index);
        children.push(panelEl);
        if (index < panels.length - 1) children.push(dockSplitter(edge));
      });
      syncDockChildren(dock, children);
    }
    applyDockVariables();
    syncProblemsHeaderLayout();
  }

  function syncProblemsHeaderLayout() {
    const panel = els.problemsPanel;
    const header = panel?.querySelector(".problems-header");
    if (!panel || !header) return;
    panel.classList.remove("problems-panel-narrow");
    if (problemsHeaderShouldUseNarrowLayout({
      dockEdge: panel.dataset.dockEdge,
      hidden: panel.classList.contains("hidden"),
      scrollWidth: header.scrollWidth,
      clientWidth: header.clientWidth
    })) {
      panel.classList.add("problems-panel-narrow");
    }
  }

  function setPanelDock(panel, edge) {
    if (!DOCK_PANELS.includes(panel)) return;
    const nextEdge = normalizeDockEdge(edge, dockForPanel(panel));
    if (dockForPanel(panel) === nextEdge) return;
    state.dockLayout = normalizeDockLayout({ ...state.dockLayout, [panel]: nextEdge });
    saveDockLayout();
    syncDockLayout();
    renderChrome();
    layoutGrid();
  }

  function resetDockLayout() {
    state.dockLayout = resetDockLayoutState(state.dockLayout);
    saveDockLayout();
    syncDockLayout();
    renderChrome();
    layoutGrid();
  }

  function setDockSplitRatio(edge, ratio) {
    if (!DOCK_EDGES.includes(edge)) return;
    state.dockLayout = normalizeDockLayout({
      ...state.dockLayout,
      splits: { ...state.dockLayout.splits, [edge]: ratio }
    });
    saveDockLayout();
    syncDockLayout();
    layoutGrid();
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

  function setSidebarWidth(width) {
    state.sidebarWidth = clamp(Math.round(width), MIN_SIDEBAR_WIDTH, 520);
    document.documentElement.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(state.sidebarWidth));
    syncDockLayout();
    layoutGrid();
  }

  function setSidebarHeight(height) {
    const maxHeight = Math.max(MIN_DOCK_HEIGHT, Math.floor(window.innerHeight * 0.7));
    state.sidebarHeight = clamp(Math.round(height), MIN_DOCK_HEIGHT, maxHeight);
    document.documentElement.style.setProperty("--sidebar-height", `${state.sidebarHeight}px`);
    saveDockLayout();
    syncDockLayout();
    layoutGrid();
  }

  function setProblemsWidth(width) {
    state.problemsWidth = clamp(Math.round(width), MIN_DOCK_WIDTH, 640);
    document.documentElement.style.setProperty("--problems-width", `${state.problemsWidth}px`);
    saveDockLayout();
    syncDockLayout();
    layoutGrid();
  }

  function setProblemsHeight(height) {
    const maxHeight = Math.max(MIN_PROBLEMS_HEIGHT, Math.floor(window.innerHeight * 0.7));
    state.problemsHeight = clamp(Math.round(height), MIN_PROBLEMS_HEIGHT, maxHeight);
    document.documentElement.style.setProperty("--problems-height", `${state.problemsHeight}px`);
    localStorage.setItem(PROBLEMS_HEIGHT_KEY, String(state.problemsHeight));
    syncDockLayout();
    layoutGrid();
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

  async function toggleExplorerPane() {
    const gridHadFocus = document.activeElement === els.host;
    state.sidebarVisible = nextPanelVisibility(state.sidebarVisible);
    localStorage.setItem(SIDEBAR_VISIBILITY_KEY, panelVisibilityStorageValue(state.sidebarVisible));
    renderChrome();
    layoutGrid();
    if (!state.sidebarVisible && gridHadFocus) els.host.focus();
  }

  async function toggleProblemsPanel() {
    const gridHadFocus = document.activeElement === els.host;
    state.problemsVisible = nextPanelVisibility(state.problemsVisible);
    localStorage.setItem(PROBLEMS_VISIBILITY_KEY, panelVisibilityStorageValue(state.problemsVisible));
    if (state.problemsVisible) onProblemsOpened();
    else onProblemsClosed();
    renderChrome();
    layoutGrid();
    if (!state.problemsVisible && gridHadFocus) els.host.focus();
  }

  function toggleSidebar() {
    toggleExplorerPane();
  }

  return {
    dockForPanel,
    resetDockLayout,
    setPanelDock,
    syncDockLayout,
    syncProblemsHeaderLayout,
    toggleExplorerPane,
    toggleProblemsPanel,
    toggleSidebar,
    wirePaneResizers
  };
}
