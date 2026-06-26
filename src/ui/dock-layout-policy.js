export const MIN_DOCK_WIDTH = 180;
export const MIN_DOCK_HEIGHT = 150;
export const MIN_EDITOR_WIDTH = 320;
export const MIN_EDITOR_HEIGHT = 220;
export const DEFAULT_PANEL_HEIGHT = 260;
export const DEFAULT_PROBLEMS_WIDTH = 320;
export const DOCK_EDGES = ["left", "right", "top", "bottom"];
export const DOCK_PANELS = ["explorer", "problems"];
export const DEFAULT_DOCK_LAYOUT = Object.freeze({
  explorer: "left",
  problems: "bottom",
  splits: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 },
  sizes: { explorerHeight: DEFAULT_PANEL_HEIGHT, problemsWidth: DEFAULT_PROBLEMS_WIDTH }
});

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeDockEdge(value, fallback) {
  return DOCK_EDGES.includes(value) ? value : fallback;
}

export function normalizeDockLayout(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const splits = source.splits && typeof source.splits === "object" ? source.splits : {};
  const sizes = source.sizes && typeof source.sizes === "object" ? source.sizes : {};
  return {
    explorer: normalizeDockEdge(source.explorer, DEFAULT_DOCK_LAYOUT.explorer),
    problems: normalizeDockEdge(source.problems, DEFAULT_DOCK_LAYOUT.problems),
    splits: Object.fromEntries(DOCK_EDGES.map((edge) => [
      edge,
      clampValue(Number(splits[edge]) || DEFAULT_DOCK_LAYOUT.splits[edge], 0.15, 0.85)
    ])),
    sizes: {
      explorerHeight: clampValue(Number(sizes.explorerHeight) || DEFAULT_DOCK_LAYOUT.sizes.explorerHeight, MIN_DOCK_HEIGHT, 520),
      problemsWidth: clampValue(Number(sizes.problemsWidth) || DEFAULT_DOCK_LAYOUT.sizes.problemsWidth, MIN_DOCK_WIDTH, 640)
    }
  };
}

export function dockPanelEdge(layout, panel) {
  return normalizeDockEdge(layout?.[panel], DEFAULT_DOCK_LAYOUT[panel]);
}

export function resetDockLayoutState(layout) {
  return normalizeDockLayout({
    ...layout,
    explorer: DEFAULT_DOCK_LAYOUT.explorer,
    problems: DEFAULT_DOCK_LAYOUT.problems,
    splits: DEFAULT_DOCK_LAYOUT.splits
  });
}

export function panelsForDockEdge({ layout, edge, visiblePanels = new Set(DOCK_PANELS), visibleOnly = true } = {}) {
  return DOCK_PANELS.filter((panel) => (
    dockPanelEdge(layout, panel) === edge && (!visibleOnly || visiblePanels.has(panel))
  ));
}

export function dockSettingsControls({ layout = DEFAULT_DOCK_LAYOUT } = {}) {
  return DOCK_PANELS.map((panel) => ({
    panel,
    label: panel === "explorer" ? "Explorer Dock" : "Problems Dock",
    options: DOCK_EDGES.map((edge) => ({
      edge,
      label: `${edge[0].toUpperCase()}${edge.slice(1)}`,
      active: dockPanelEdge(layout, panel) === edge
    }))
  }));
}

export function fitDockPair(first, second, maxTotal, minSize) {
  if (!first && !second) return [0, 0];
  if (first + second <= maxTotal || maxTotal <= 0) return [first, second];
  if (first && second && maxTotal >= minSize * 2) {
    const share = first / (first + second);
    const fittedFirst = clampValue(Math.round(maxTotal * share), minSize, maxTotal - minSize);
    return [fittedFirst, maxTotal - fittedFirst];
  }
  if (first && second) return [Math.ceil(maxTotal / 2), Math.floor(maxTotal / 2)];
  return first ? [Math.max(minSize, maxTotal), 0] : [0, Math.max(minSize, maxTotal)];
}

export function dockPanelFlexStyle({ edge, count, index, splitRatio = 0.5 } = {}) {
  const style = {
    minWidth: edge === "top" || edge === "bottom" ? `${MIN_DOCK_WIDTH}px` : "0",
    minHeight: edge === "left" || edge === "right" ? `${MIN_DOCK_HEIGHT}px` : "0",
    flex: "1 1 auto"
  };
  if (count <= 1) return style;
  const ratio = clampValue(Number(splitRatio) || 0.5, 0.15, 0.85);
  const basis = index === 0 ? ratio * 100 : (1 - ratio) * 100;
  return { ...style, flex: `0 1 ${basis}%` };
}
