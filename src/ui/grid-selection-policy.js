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

export function keyboardSelectionTarget({ key, shiftKey = false, ctrlKey = false, focus, rowCount, columnCount, jumpRow, jumpColumn }) {
  let { row, column } = focus;
  if (key === "Tab") column += shiftKey ? -1 : 1;
  else if (key === "ArrowDown") row = ctrlKey ? jumpRow(row, 1) : row + 1;
  else if (key === "ArrowUp") row = ctrlKey ? jumpRow(row, -1) : row - 1;
  else if (key === "ArrowRight") column = ctrlKey ? jumpColumn(column, 1) : column + 1;
  else if (key === "ArrowLeft") column = ctrlKey ? jumpColumn(column, -1) : column - 1;
  else return null;
  return {
    row: clamp(row, 0, rowCount - 1),
    column: clamp(column, 0, columnCount - 1),
    extend: Boolean(shiftKey && key !== "Tab")
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
