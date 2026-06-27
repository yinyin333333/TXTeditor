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
  indexHeader: "#252526",
  indexHeaderFrozen: "#30343b",
  indexHeaderActive: "#30343b",
  indexHeaderPressed: "#35383d",
  indexHeaderActiveText: "#ffffff",
  indexHeaderHighlight: "rgba(255, 255, 255, .20)",
  indexHeaderShadow: "rgba(0, 0, 0, .48)",
  indexHeaderSheen: "rgba(255, 255, 255, .06)",
  frozen: "#252a31",
  frozenHeader: "#30343b",
  grid: "#46515b",
  gridFrozen: "#6a7887",
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
  frozenEdgeAmbient: "rgba(18, 31, 45, .10)",
  diagnosticRangeError: "#ff5f6d",
  diagnosticRangeWarning: "#d9a400",
  diagnosticRangeInfo: "#3794ff",
  diagnosticInsertionCaretError: "#ff5f6d",
  diagnosticInsertionCaretWarning: "#d9a400",
  diagnosticInsertionCaretInfo: "#3794ff"
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
  indexHeader: "--grid-index-header-bg",
  indexHeaderFrozen: "--grid-index-header-frozen-bg",
  indexHeaderActive: "--grid-index-header-active-bg",
  indexHeaderPressed: "--grid-index-header-pressed-bg",
  indexHeaderActiveText: "--grid-index-header-active-text",
  indexHeaderHighlight: "--grid-index-header-highlight",
  indexHeaderShadow: "--grid-index-header-shadow",
  indexHeaderSheen: "--grid-index-header-sheen",
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
  frozenEdgeAmbient: "--grid-frozen-edge-ambient",
  diagnosticRangeError: "--grid-diagnostic-range-error",
  diagnosticRangeWarning: "--grid-diagnostic-range-warning",
  diagnosticRangeInfo: "--grid-diagnostic-range-info",
  diagnosticInsertionCaretError: "--grid-diagnostic-insertion-caret-error",
  diagnosticInsertionCaretWarning: "--grid-diagnostic-insertion-caret-warning",
  diagnosticInsertionCaretInfo: "--grid-diagnostic-insertion-caret-info"
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
    activeColumnHeader: !editingThisCell && row === 0 && selection.focus.row === row && selection.focus.column === column
  };
}

export function columnIndexLabel(column) {
  const index = Math.floor(Number(column));
  if (!Number.isFinite(index) || index < 0) return "";
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function columnIndexRenderState({ selection, column, rowCount }) {
  return {
    selected: selection.hasFullColumn(column, rowCount),
    activeHeader: selection.focus.column === column
  };
}

export function cellBackground(row, selected, frozen, firstColumnLabel, colors = GRID_COLORS) {
  if (selected) return frozen ? colors.selectionFrozen : colors.selection;
  if (frozen) return row === 0 ? colors.frozenHeader : firstColumnLabel ? colors.firstColumnFrozen : colors.frozen;
  if (row === 0) return colors.header;
  if (firstColumnLabel) return colors.firstColumn;
  return row % 2 ? colors.rowOdd : colors.rowEven;
}

export function cellGridLineColor(_state = {}, colors = GRID_COLORS) {
  return colors.grid;
}

export function indexHandleRenderState({ selected = false, active = false, frozen = false } = {}) {
  const pressed = selected || active;
  return {
    fill: pressed ? "indexHeaderPressed" : frozen ? "indexHeaderFrozen" : "indexHeader",
    text: pressed ? "indexHeaderActiveText" : "rowText",
    stroke: "grid",
    pressed
  };
}

export function indexHandleChromeSteps({ x = 0, y = 0, width = 0, height = 0, pressed = false } = {}) {
  if (!pressed || width <= 2 || height <= 2) return [];
  const right = x + width - 1.5;
  const bottom = y + height - 1.5;
  return [
    {
      kind: "fillRect",
      color: "indexHeaderSheen",
      x: x + 2,
      y: y + 2,
      width: Math.max(0, width - 4),
      height: Math.max(1, Math.floor(height * .32))
    },
    {
      kind: "strokePath",
      color: "indexHeaderShadow",
      points: [
        [x + 1.5, bottom],
        [x + 1.5, y + 1.5],
        [right - 1, y + 1.5]
      ]
    },
    {
      kind: "strokePath",
      color: "indexHeaderHighlight",
      points: [
        [x + 1.5, bottom],
        [right, bottom],
        [right, y + 1.5]
      ]
    }
  ];
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

export function cellTextRenderPlan({ text = "", maxWidth = 0, measureText } = {}) {
  const value = String(text ?? "");
  const measure = typeof measureText === "function" ? measureText : (candidate) => String(candidate ?? "").length;
  if (maxWidth <= 0) {
    return { text: "", sourceLength: 0, clipped: value.length > 0 };
  }
  if (measure(value) <= maxWidth) {
    return { text: value, sourceLength: value.length, clipped: false };
  }
  let clipped = value;
  while (clipped.length > 1 && measure(`${clipped}...`) > maxWidth) clipped = clipped.slice(0, -1);
  return {
    text: `${clipped}...`,
    sourceLength: clipped.length,
    clipped: true
  };
}

export function diagnosticTextOverlayPlan({
  diagnostics = [],
  value = "",
  active = false,
  hovered = false,
  currentProblem = false,
  textX = 0,
  cellY = 0,
  cellHeight = 0,
  maxWidth = 0,
  measureText
} = {}) {
  if (!active && !hovered && !currentProblem) return null;
  const diagnostic = bestPreciseDiagnostic(diagnostics);
  if (!diagnostic) return null;
  const text = String(value ?? "");
  const renderPlan = cellTextRenderPlan({ text, maxWidth, measureText });
  const visibleSourceLength = renderPlan.sourceLength;
  const measure = typeof measureText === "function" ? measureText : (candidate) => String(candidate ?? "").length;
  const severity = diagnostic.severity === "error" || diagnostic.severity === "warning" ? diagnostic.severity : "info";
  const color = severity[0].toUpperCase() + severity.slice(1);

  if (diagnostic.isInsertionPoint) {
    const position = numberOr(diagnostic.localInsertionPoint, diagnostic.localStart);
    if (position == null || position < 0 || position > text.length) return null;
    if (renderPlan.clipped && position >= visibleSourceLength) return null;
    const x = textX + measure(text.slice(0, position));
    return {
      kind: "insertion",
      severity,
      color: `diagnosticInsertionCaret${color}`,
      x,
      top: cellY + 5,
      bottom: cellY + Math.max(6, cellHeight - 5),
      lineWidth: 2
    };
  }

  const start = numberOr(diagnostic.localStart, null);
  const end = numberOr(diagnostic.localEnd, null);
  if (start == null || end == null || end <= start || start < 0 || end > text.length) return null;
  if (renderPlan.clipped && end > visibleSourceLength) return null;
  const startX = textX + measure(text.slice(0, start));
  const endX = textX + measure(text.slice(0, end));
  if (endX <= startX) return null;
  return {
    kind: "range",
    severity,
    color: `diagnosticRange${color}`,
    x: startX,
    y: cellY + Math.max(8, cellHeight - 6),
    width: Math.max(3, endX - startX),
    lineWidth: 2
  };
}

function bestPreciseDiagnostic(diagnostics = []) {
  return [...(diagnostics ?? [])]
    .filter((diagnostic) => diagnostic?.hasPreciseRange)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0] ?? null;
}

function severityRank(severity) {
  if (severity === "error") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
