export const SIDEBAR_VISIBILITY_KEY = "txteditor.sidebar";
export const PROBLEMS_VISIBILITY_KEY = "txteditor.problems";
export const SIDEBAR_WIDTH_KEY = "txteditor.sidebarWidth";
export const PROBLEMS_HEIGHT_KEY = "txteditor.problemsHeight";
export const DOCK_LAYOUT_KEY = "txteditor.layout.docks";
export const MIN_SIDEBAR_WIDTH = 260;
export const DEFAULT_PROBLEMS_HEIGHT = 260;
export const MIN_PROBLEMS_HEIGHT = 150;
export const MAX_SIDEBAR_WIDTH = 520;
export const MAX_PROBLEMS_HEIGHT = 520;

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function panelVisibilityStorageValue(visible) {
  return visible ? "visible" : "hidden";
}

export function nextPanelVisibility(visible) {
  return !visible;
}

export function panelStateFromStorage(storage, savedDockLayout) {
  return {
    sidebarVisible: storage.getItem(SIDEBAR_VISIBILITY_KEY) !== "hidden",
    sidebarWidth: clampValue(Number(storage.getItem(SIDEBAR_WIDTH_KEY)) || MIN_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH),
    sidebarHeight: savedDockLayout.sizes.explorerHeight,
    problemsVisible: storage.getItem(PROBLEMS_VISIBILITY_KEY) === "visible",
    problemsWidth: savedDockLayout.sizes.problemsWidth,
    problemsHeight: clampValue(Number(storage.getItem(PROBLEMS_HEIGHT_KEY)) || DEFAULT_PROBLEMS_HEIGHT, MIN_PROBLEMS_HEIGHT, MAX_PROBLEMS_HEIGHT),
    dockLayout: savedDockLayout
  };
}

export function problemsHeaderShouldUseNarrowLayout({
  dockEdge = "",
  hidden = false,
  scrollWidth = 0,
  clientWidth = 0,
  overflowTolerance = 2
} = {}) {
  const sideDocked = dockEdge === "left" || dockEdge === "right";
  return Boolean(sideDocked && !hidden && scrollWidth > clientWidth + overflowTolerance);
}
