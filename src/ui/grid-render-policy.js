import { columnColorIndex } from "./grid-geometry.js";

export const GRID_COLORS = {
  background: "#1e1e1e",
  rowOdd: "#1f1f1f",
  rowEven: "#222426",
  header: "#2a2d2e",
  firstColumn: "#252b33",
  firstColumnFrozen: "#303d4b",
  firstColumnText: "#e0e6ed",
  firstColumnBorder: "#4f5c6a",
  activeHeader: "#315f8f",
  activeHeaderText: "#ffffff",
  activeRowHeaderHighlight: "rgba(255, 255, 255, .28)",
  activeRowHeaderShadow: "rgba(4, 16, 28, .42)",
  activeRowHeaderSheen: "rgba(255, 255, 255, .08)",
  frozen: "#252a31",
  frozenHeader: "#30343b",
  grid: "#3a3d41",
  gridFrozen: "#505863",
  rowHeader: "#252526",
  rowHeaderFrozen: "#30343b",
  selection: "#264f78",
  selectionFrozen: "#2d5d86",
  active: "#3794ff",
  columnTextA: "#9cdcfe",
  columnTextB: "#b5cea8",
  columnTextC: "#d7ba7d",
  columnTextD: "#c586c0",
  columnTextE: "#4ec9b0",
  rowText: "#aeb4bb",
  text: "#d4d4d4",
  textSelected: "#ffffff",
  textEmpty: "#6f747b",
  textHeader: "#d8d8d8",
  frozenDivider: "#6a7b90",
  frozenEdgeHighlight: "rgba(255, 255, 255, .22)",
  frozenEdgeShadow: "rgba(18, 31, 45, .24)",
  frozenEdgeAmbient: "rgba(18, 31, 45, .10)"
};

export const GRID_CSS_VARS = {
  background: "--grid-bg",
  rowOdd: "--grid-row-odd",
  rowEven: "--grid-row-even",
  header: "--grid-header-bg",
  firstColumn: "--grid-first-column-bg",
  firstColumnFrozen: "--grid-first-column-frozen-bg",
  firstColumnText: "--grid-first-column-text",
  firstColumnBorder: "--grid-first-column-border",
  activeHeader: "--grid-active-header-bg",
  activeHeaderText: "--grid-active-header-text",
  activeRowHeaderHighlight: "--grid-active-row-header-highlight",
  activeRowHeaderShadow: "--grid-active-row-header-shadow",
  activeRowHeaderSheen: "--grid-active-row-header-sheen",
  frozen: "--grid-frozen-bg",
  frozenHeader: "--grid-frozen-header-bg",
  grid: "--grid-line",
  gridFrozen: "--grid-line-frozen",
  rowHeader: "--grid-row-header-bg",
  rowHeaderFrozen: "--grid-row-header-frozen-bg",
  selection: "--grid-selection",
  selectionFrozen: "--grid-selection-frozen",
  active: "--grid-active",
  columnTextA: "--columnTextA",
  columnTextB: "--columnTextB",
  columnTextC: "--columnTextC",
  columnTextD: "--columnTextD",
  columnTextE: "--columnTextE",
  rowText: "--grid-row-text",
  text: "--grid-text",
  textSelected: "--grid-text-selected",
  textEmpty: "--grid-text-empty",
  textHeader: "--grid-header-text",
  frozenDivider: "--grid-frozen-divider",
  frozenEdgeHighlight: "--grid-frozen-edge-highlight",
  frozenEdgeShadow: "--grid-frozen-edge-shadow",
  frozenEdgeAmbient: "--grid-frozen-edge-ambient"
};

export function gridColor(name) {
  return GRID_COLORS[name];
}

export function syncGridThemeFromStyle(style, colors = GRID_COLORS) {
  for (const [key, variable] of Object.entries(GRID_CSS_VARS)) {
    const value = style.getPropertyValue(variable).trim();
    if (value) colors[key] = value;
  }
  return colors;
}

export function rowHeaderRenderState(selection, row) {
  return {
    activeHeader: selection.focus.row === row
  };
}

export function columnHeaderRenderState({ selection, row, column, editingThisCell }) {
  return {
    activeColumnHeader: !editingThisCell && row === 0 && selection.focus.column === column
  };
}

export function cellBackground(row, selected, frozen, firstColumnLabel, colors = GRID_COLORS) {
  if (selected) return frozen ? colors.selectionFrozen : colors.selection;
  if (frozen) return row === 0 ? colors.frozenHeader : firstColumnLabel ? colors.firstColumnFrozen : colors.frozen;
  if (row === 0) return colors.header;
  if (firstColumnLabel) return colors.firstColumn;
  return row % 2 ? colors.rowOdd : colors.rowEven;
}

export function cellTextColor(row, column, value, selected, colorizeColumns, firstColumnLabel = false, colors = GRID_COLORS) {
  if (selected) return colors.textSelected;
  if (row === 0) return colors.textHeader;
  const text = String(value).trim();
  if (text === "") return colors.textEmpty;
  if (firstColumnLabel) return colors.firstColumnText;
  if (colorizeColumns) {
    return [
      colors.columnTextA,
      colors.columnTextB,
      colors.columnTextC,
      colors.columnTextD,
      colors.columnTextE
    ][columnColorIndex(column, 5)];
  }
  return colors.text;
}

export function centeredTextY(y, height) {
  return y + height / 2;
}

export function initialColumnFitWidth({
  measuredHeaderWidth,
  zoom = 1,
  min = 56,
  max = 420,
  padding = 24
}) {
  const scaledWidth = measuredHeaderWidth + padding * zoom;
  return Math.max(min, Math.min(max, Math.ceil(scaledWidth / zoom)));
}

export function frozenVerticalEdgeRects(x, height) {
  if (height <= 0) return [];
  return [
    { color: "frozenEdgeHighlight", x: x - 2, y: 0, width: 1, height },
    { color: "frozenEdgeShadow", x: x - 1, y: 0, width: 1, height },
    { color: "frozenEdgeAmbient", x, y: 0, width: 3, height }
  ];
}

export function frozenHorizontalEdgeRects(y, width) {
  if (width <= 0) return [];
  return [
    { color: "frozenEdgeHighlight", x: 0, y: y - 2, width, height: 1 },
    { color: "frozenEdgeShadow", x: 0, y: y - 1, width, height: 1 },
    { color: "frozenEdgeAmbient", x: 0, y, width, height: 3 }
  ];
}

export function activeRowHeaderChromeSteps({ rowHeaderWidth, y, height }) {
  if (height <= 2 || rowHeaderWidth <= 2) return [];
  const right = rowHeaderWidth - 1.5;
  const bottom = y + height - 1.5;
  return [
    {
      kind: "fillRect",
      color: "activeRowHeaderSheen",
      x: 2,
      y: y + 2,
      width: Math.max(0, rowHeaderWidth - 4),
      height: Math.max(1, Math.floor(height * .35))
    },
    {
      kind: "strokePath",
      color: "activeRowHeaderHighlight",
      points: [
        [1.5, bottom - 1],
        [1.5, y + 1.5],
        [right - 1, y + 1.5]
      ]
    },
    {
      kind: "strokePath",
      color: "activeRowHeaderShadow",
      points: [
        [1.5, bottom],
        [right, bottom],
        [right, y + 1.5]
      ]
    }
  ];
}

export function diagnosticMarkerState(diagnostics = [], { x = 0, y = 0, width = 0, height = 0 } = {}) {
  if (!diagnostics?.length) return null;
  const severity = diagnostics.some((item) => item.severity === "error") ? "error"
    : diagnostics.some((item) => item.severity === "warning") ? "warning"
      : "info";
  const colors = { error: "#f14c4c", warning: "#cca700", info: "#3794ff" };
  const size = Math.min(10, Math.max(6, Math.round(Math.min(width, height) * 0.34)));
  return {
    severity,
    color: colors[severity] ?? colors.warning,
    points: [
      [x + width - size - 1, y + height - 1],
      [x + width - 1, y + height - 1],
      [x + width - 1, y + height - size - 1]
    ]
  };
}

export function createGridRenderStats() {
  return {
    frames: 0,
    totalMs: 0,
    lastMs: 0,
    droppedFrames: 0,
    visibleRows: [0, 0],
    visibleColumns: [0, 0],
    reason: "init"
  };
}

export function updateGridRenderStats(stats, { elapsed = 0, rows = [], columns = [], reason = "direct" } = {}) {
  stats.frames += 1;
  stats.totalMs += elapsed;
  stats.lastMs = Math.round(elapsed * 100) / 100;
  stats.reason = reason;
  stats.visibleRows = rows.length ? [rows[0].row, rows[rows.length - 1].row] : [0, 0];
  stats.visibleColumns = columns.length ? [columns[0].column, columns[columns.length - 1].column] : [0, 0];
  if (elapsed > 16.7) stats.droppedFrames += 1;
  return stats;
}
