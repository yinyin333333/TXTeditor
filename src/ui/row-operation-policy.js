export function rowOperationTargets({ selection, contextHit = null, rowCount, columnCount }) {
  return valuesFromIndexRanges(rowOperationTargetRanges({ selection, contextHit, rowCount, columnCount }));
}

export function rowOperationTargetRanges({ selection, contextHit = null, rowCount, columnCount }) {
  const validFocusRow = clampRow(selection?.focus?.row, rowCount);
  if (contextHit?.kind === "row-header") {
    if (!selection?.hasFullRow?.(contextHit.row, columnCount)) return singleIndexRange(clampRow(contextHit.row, rowCount));
    return preventAllRowRanges(fullRowTargetRanges(selection.ranges, rowCount, columnCount), rowCount, contextHit.row);
  }
  const fullRows = fullRowTargetRanges(selection?.ranges, rowCount, columnCount);
  if (fullRows.length) return preventAllRowRanges(fullRows, rowCount, validFocusRow);
  return preventAllRowRanges(rowRangesFromRanges(selection?.ranges, rowCount), rowCount, validFocusRow);
}

export function columnsFromRanges(ranges = []) {
  return valuesFromIndexRanges(columnRangesFromRanges(ranges));
}

export function rowsFromRanges(ranges = []) {
  return valuesFromIndexRanges(rowRangesFromRanges(ranges));
}

export function columnRangesFromRanges(ranges = [], columnCount = null) {
  return compactIndexRanges(ranges, "left", "right", columnCount);
}

export function rowRangesFromRanges(ranges = [], rowCount = null) {
  return compactIndexRanges(ranges, "top", "bottom", rowCount);
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

function fullRowTargetRanges(ranges = [], rowCount, columnCount) {
  return rowRangesFromRanges(ranges.filter((range) => range.left === 0 && range.right >= columnCount - 1), rowCount);
}

function preventAllRowRanges(ranges, rowCount, fallbackRow) {
  const valid = compactIndexRangeList(ranges, rowCount);
  if (rowCount > 1 && rangeSize(valid) >= rowCount) return singleIndexRange(clampRow(fallbackRow, rowCount));
  return valid;
}

function clampRow(row, rowCount) {
  return clampIndex(row, rowCount);
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

function compactIndexRanges(ranges = [], startKey, endKey, count = null) {
  const indexRanges = [];
  for (const range of ranges ?? []) {
    const start = normalizeIndex(range?.[startKey]);
    const end = normalizeIndex(range?.[endKey]);
    if (start == null || end == null) continue;
    indexRanges.push([Math.min(start, end), Math.max(start, end)]);
  }
  return compactIndexRangeList(indexRanges, count);
}

function compactIndexRangeList(ranges = [], count = null) {
  const max = count == null || !Number.isFinite(Number(count)) ? null : Math.max(0, Math.floor(Number(count)) - 1);
  const normalized = [];
  for (const range of ranges ?? []) {
    const start = normalizeIndex(range?.[0]);
    const end = normalizeIndex(range?.[1]);
    if (start == null || end == null) continue;
    const next = [Math.min(start, end), Math.max(start, end)];
    if (max != null) {
      if (next[1] < 0 || next[0] > max) continue;
      next[0] = Math.max(0, next[0]);
      next[1] = Math.min(max, next[1]);
    }
    normalized.push(next);
  }
  normalized.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const compact = [];
  for (const [start, end] of normalized) {
    const last = compact.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else compact.push([start, end]);
  }
  return compact;
}

function normalizeIndex(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.floor(number));
}

function clampIndex(index, count) {
  return Math.max(0, Math.min(Math.max(0, count - 1), Math.floor(Number(index) || 0)));
}

function singleIndexRange(index) {
  return [[index, index]];
}

function rangeSize(ranges) {
  return ranges.reduce((total, [start, end]) => total + end - start + 1, 0);
}

function valuesFromIndexRanges(ranges) {
  return ranges.flatMap(([start, end]) => indexRange(start, end));
}
