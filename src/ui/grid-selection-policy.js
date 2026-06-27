export function applySelectionForHit(selection, hit, { rowCount, columnCount, extend = false, toggle = false } = {}) {
  if (hit.kind === "empty") return "none";
  if (hit.kind === "row-header") return applyRowSelection(selection, hit.row, columnCount, { extend, toggle });
  if (hit.kind === "column-header") return applyColumnSelection(selection, hit.column, rowCount, { extend, toggle });
  if (hit.kind === "corner") {
    selection.selectAll(rowCount, columnCount);
    return "select-all";
  }
  if (toggle) {
    selection.toggleCell(hit.row, hit.column);
    return "toggle-cell";
  }
  if (extend) {
    selection.extend(hit.row, hit.column);
    return "extend-cell";
  }
  selection.set(hit.row, hit.column);
  return "set-cell";
}

export function applyRowSelection(selection, row, columnCount, { extend = false, toggle = false } = {}) {
  if (toggle) {
    selection.toggleRow(row, columnCount);
    return "toggle-row";
  }
  if (extend) {
    selection.extendRows(row, columnCount);
    return "extend-row";
  }
  selection.setRow(row, columnCount);
  return "set-row";
}

export function applyColumnSelection(selection, column, rowCount, { extend = false, toggle = false } = {}) {
  if (toggle) {
    selection.toggleColumn(column, rowCount);
    return "toggle-column";
  }
  if (extend) {
    selection.extendColumns(column, rowCount);
    return "extend-column";
  }
  selection.setColumn(column, rowCount);
  return "set-column";
}

export function hasFullRowRange(ranges, columnCount) {
  return ranges.some((rect) => rect.left === 0 && rect.right >= columnCount - 1);
}

export function hasFullColumnRange(ranges, rowCount) {
  return ranges.some((rect) => rect.top === 0 && rect.bottom >= rowCount - 1);
}

export function keyboardSelectionTarget({ key, shiftKey = false, ctrlKey = false, focus, rowCount, columnCount, jumpRow, jumpColumn, hiddenRows = new Set(), hiddenColumns = new Set() }) {
  let { row, column } = focus;
  let rowDirection = 0;
  let columnDirection = 0;
  if (key === "Tab") column += (columnDirection = shiftKey ? -1 : 1);
  else if (key === "ArrowDown") row = ctrlKey ? jumpRow(row, rowDirection = 1) : row + (rowDirection = 1);
  else if (key === "ArrowUp") row = ctrlKey ? jumpRow(row, rowDirection = -1) : row + (rowDirection = -1);
  else if (key === "ArrowRight") column = ctrlKey ? jumpColumn(column, columnDirection = 1) : column + (columnDirection = 1);
  else if (key === "ArrowLeft") column = ctrlKey ? jumpColumn(column, columnDirection = -1) : column + (columnDirection = -1);
  else return null;
  const target = visibleSelectionTarget({
    row,
    column,
    rowDirection,
    columnDirection,
    focus,
    rowCount,
    columnCount,
    hiddenRows,
    hiddenColumns
  });
  return {
    row: target.row,
    column: target.column,
    extend: Boolean(shiftKey && key !== "Tab")
  };
}

export function movementSelectionTarget({ focus, rowDelta = 0, columnDelta = 0, rowCount, columnCount, hiddenRows = new Set(), hiddenColumns = new Set() }) {
  return visibleSelectionTarget({
    row: focus.row + rowDelta,
    column: focus.column + columnDelta,
    rowDirection: Math.sign(rowDelta),
    columnDirection: Math.sign(columnDelta),
    focus,
    rowCount,
    columnCount,
    hiddenRows,
    hiddenColumns
  });
}

function visibleSelectionTarget({ row, column, rowDirection = 0, columnDirection = 0, focus, rowCount, columnCount, hiddenRows = new Set(), hiddenColumns = new Set() }) {
  return {
    row: clamp(visibleIndex(row, rowCount, hiddenRows, rowDirection, focus.row), 0, rowCount - 1),
    column: clamp(visibleIndex(column, columnCount, hiddenColumns, columnDirection, focus.column), 0, columnCount - 1)
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function visibleIndex(value, count, hidden, direction, fallback) {
  const clamped = clamp(value, 0, Math.max(0, count - 1));
  if (!hidden?.has(clamped)) return clamped;
  const step = direction || 1;
  for (let index = clamped; index >= 0 && index < count; index += step) {
    if (!hidden.has(index)) return index;
  }
  for (let index = clamped; index >= 0 && index < count; index -= step) {
    if (!hidden.has(index)) return index;
  }
  return clamp(fallback, 0, Math.max(0, count - 1));
}
