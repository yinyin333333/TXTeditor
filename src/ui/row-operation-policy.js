export function rowOperationTargets({ selection, contextHit = null, rowCount, columnCount }) {
  const validFocusRow = clampRow(selection?.focus?.row, rowCount);
  if (contextHit?.kind === "row-header") {
    if (!selection?.hasFullRow?.(contextHit.row, columnCount)) return [clampRow(contextHit.row, rowCount)];
    return preventAllRows(fullRowTargets(selection.ranges, rowCount, columnCount), rowCount, contextHit.row);
  }
  const fullRows = fullRowTargets(selection?.ranges, rowCount, columnCount);
  if (fullRows.length) return preventAllRows(fullRows, rowCount, validFocusRow);
  return preventAllRows(rowsFromRanges(selection?.ranges), rowCount, validFocusRow);
}

export function columnsFromRanges(ranges = []) {
  return sortedUnique(ranges.flatMap((range) => indexRange(range.left, range.right)));
}

export function rowsFromRanges(ranges = []) {
  return sortedUnique(ranges.flatMap((range) => indexRange(range.top, range.bottom)));
}

export function indexRange(start, end) {
  const values = [];
  for (let value = start; value <= end; value++) values.push(value);
  return values;
}

export function keepSelectionVisible({ doc, selection, clamp }) {
  const focus = selection.focus;
  if (!doc.hiddenRows.has(focus.row)) return;
  const row = nearestVisibleRow(doc, focus.row, clamp);
  const column = clamp(focus.column, 0, Math.max(0, doc.columnCount - 1));
  selection.set(row, column);
}

function fullRowTargets(ranges = [], rowCount, columnCount) {
  return rowsFromRanges(ranges.filter((range) => range.left === 0 && range.right >= columnCount - 1))
    .filter((row) => row >= 0 && row < rowCount);
}

function preventAllRows(rows, rowCount, fallbackRow) {
  const valid = sortedUnique(rows).filter((row) => row >= 0 && row < rowCount);
  if (rowCount > 1 && valid.length >= rowCount) return [clampRow(fallbackRow, rowCount)];
  return valid;
}

function clampRow(row, rowCount) {
  return Math.max(0, Math.min(Math.max(0, rowCount - 1), Math.floor(Number(row) || 0)));
}

function nearestVisibleRow(doc, row, clamp) {
  for (let next = row + 1; next < doc.rowCount; next++) {
    if (!doc.hiddenRows.has(next)) return next;
  }
  for (let prev = row - 1; prev >= 0; prev--) {
    if (!doc.hiddenRows.has(prev)) return prev;
  }
  return clamp(row, 0, Math.max(0, doc.rowCount - 1));
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}
