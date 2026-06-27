export class SelectionModel {
  constructor() {
    this.anchor = { row: 0, column: 0 };
    this.focus = { row: 0, column: 0 };
    this.ranges = [makeRect(0, 0, 0, 0)];
    this.selectionKind = "cell";
  }

  set(row, column) {
    this.anchor = { row, column };
    this.focus = { row, column };
    this.ranges = [makeRect(row, column, row, column)];
    this.selectionKind = "cell";
  }

  extend(row, column) {
    this.focus = { row, column };
    this.ranges = [makeRect(this.anchor.row, this.anchor.column, row, column)];
    this.selectionKind = "cell";
  }

  setRange(top, left, bottom, right, focus = { row: bottom, column: right }) {
    const rect = makeRect(top, left, bottom, right);
    this.anchor = { row: rect.top, column: rect.left };
    this.focus = { row: focus.row, column: focus.column };
    this.ranges = [rect];
    this.selectionKind = "cell";
  }

  extendRange(top, left, bottom, right, focus = { row: bottom, column: right }) {
    const anchor = this.anchor ?? { row: top, column: left };
    this.focus = { row: focus.row, column: focus.column };
    this.ranges = [makeRect(anchor.row, left, focus.row, right)];
    this.selectionKind = "cell";
  }

  toggleCell(row, column) {
    this.toggleRange(makeRect(row, column, row, column), { row, column });
    this.selectionKind = "cell";
  }

  setRow(row, columnCount) {
    this.setRange(row, 0, row, Math.max(0, columnCount - 1), { row, column: Math.max(0, columnCount - 1) });
    this.selectionKind = "row";
  }

  extendRows(row, columnCount) {
    this.focus = { row, column: Math.max(0, columnCount - 1) };
    this.ranges = [makeRect(this.anchor.row, 0, row, Math.max(0, columnCount - 1))];
    this.selectionKind = "row";
  }

  toggleRow(row, columnCount) {
    this.toggleRange(makeRect(row, 0, row, Math.max(0, columnCount - 1)), { row, column: Math.max(0, columnCount - 1) });
    this.selectionKind = "row";
  }

  setColumn(column, rowCount) {
    this.setRange(0, column, Math.max(0, rowCount - 1), column, { row: Math.max(0, rowCount - 1), column });
    this.selectionKind = "column";
  }

  extendColumns(column, rowCount) {
    this.focus = { row: Math.max(0, rowCount - 1), column };
    this.ranges = [makeRect(0, this.anchor.column, Math.max(0, rowCount - 1), column)];
    this.selectionKind = "column";
  }

  toggleColumn(column, rowCount) {
    this.toggleRange(makeRect(0, column, Math.max(0, rowCount - 1), column), { row: Math.max(0, rowCount - 1), column });
    this.selectionKind = "column";
  }

  toggleRange(rect, focus = { row: rect.bottom, column: rect.right }) {
    const target = normalizeRect(rect);
    if (rangeContains(this.ranges, target)) {
      this.ranges = subtractFromRanges(this.ranges, target);
    } else {
      this.ranges = [...this.ranges, target];
    }
    if (!this.ranges.length) this.ranges = [makeRect(focus.row, focus.column, focus.row, focus.column)];
    this.focus = pointInRanges(this.ranges, focus) ? { row: focus.row, column: focus.column } : firstCellInLastRange(this.ranges);
    this.anchor = pointInRanges(this.ranges, this.anchor) ? this.anchor : this.focus;
  }

  get rect() {
    return unionRect(this.ranges);
  }

  get primaryRect() {
    return this.ranges[this.ranges.length - 1] ?? this.rect;
  }

  get isMultiRange() {
    return this.ranges.length > 1;
  }

  contains(row, column) {
    return this.ranges.some((r) => row >= r.top && row <= r.bottom && column >= r.left && column <= r.right);
  }

  hasFullRow(row, columnCount) {
    return this.ranges.some((r) => r.left === 0 && r.right >= columnCount - 1 && row >= r.top && row <= r.bottom);
  }

  hasFullColumn(column, rowCount) {
    return this.ranges.some((r) => r.top === 0 && r.bottom >= rowCount - 1 && column >= r.left && column <= r.right);
  }

  selectAll(rowCount, columnCount) {
    this.anchor = { row: 0, column: 0 };
    this.focus = { row: Math.max(0, rowCount - 1), column: Math.max(0, columnCount - 1) };
    this.ranges = [makeRect(0, 0, Math.max(0, rowCount - 1), Math.max(0, columnCount - 1))];
    this.selectionKind = "all";
  }
}

export function repairSelectionForDocument(selection, doc, { preferVisible = true } = {}) {
  if (!selection || !doc) return;
  const rowMax = Math.max(0, (doc.rowCount ?? 1) - 1);
  const columnMax = Math.max(0, (doc.columnCount ?? 1) - 1);
  const clampedRanges = (selection.ranges ?? []).map((range) => makeRect(
    clampIndex(range.top, rowMax),
    clampIndex(range.left, columnMax),
    clampIndex(range.bottom, rowMax),
    clampIndex(range.right, columnMax)
  ));
  const focus = normalizePoint(selection.focus, rowMax, columnMax);
  const visibleRanges = preferVisible ? clampedRanges.filter((range) => rangeHasVisibleCell(range, doc)) : clampedRanges;
  if (!visibleRanges.length) {
    const fallback = nearestVisiblePoint(focus, doc, rowMax, columnMax) ?? firstCellInLastRange(clampedRanges) ?? { row: 0, column: 0 };
    selection.ranges = [makeRect(fallback.row, fallback.column, fallback.row, fallback.column)];
    selection.focus = fallback;
    selection.anchor = fallback;
    return;
  }
  selection.ranges = visibleRanges;
  const fallback = firstVisibleCellInRanges(selection.ranges, doc, preferVisible) ?? nearestVisiblePoint(focus, doc, rowMax, columnMax) ?? firstCellInLastRange(selection.ranges);
  if (!pointInRanges(selection.ranges, fallback)) selection.ranges = [makeRect(fallback.row, fallback.column, fallback.row, fallback.column)];
  selection.focus = pointInRanges(selection.ranges, focus) && isVisiblePoint(focus, doc, preferVisible) ? focus : fallback;
  const anchor = normalizePoint(selection.anchor, rowMax, columnMax);
  selection.anchor = pointInRanges(selection.ranges, anchor) && isVisiblePoint(anchor, doc, preferVisible) ? anchor : selection.focus;
}

function makeRect(rowA, columnA, rowB, columnB) {
  return {
    top: Math.min(rowA, rowB),
    left: Math.min(columnA, columnB),
    bottom: Math.max(rowA, rowB),
    right: Math.max(columnA, columnB)
  };
}

function normalizeRect(rect) {
  return makeRect(rect.top, rect.left, rect.bottom, rect.right);
}

function unionRect(ranges) {
  if (!ranges.length) {
    return {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0
    };
  }
  return ranges.reduce((acc, r) => ({
    top: Math.min(acc.top, r.top),
    left: Math.min(acc.left, r.left),
    bottom: Math.max(acc.bottom, r.bottom),
    right: Math.max(acc.right, r.right)
  }), ranges[0]);
}

function rangeContains(ranges, target) {
  return ranges.some((r) => r.top <= target.top && r.left <= target.left && r.bottom >= target.bottom && r.right >= target.right);
}

function pointInRanges(ranges, point) {
  return ranges.some((r) => point.row >= r.top && point.row <= r.bottom && point.column >= r.left && point.column <= r.right);
}

function firstCellInLastRange(ranges) {
  const range = ranges.at(-1) ?? makeRect(0, 0, 0, 0);
  return { row: range.top, column: range.left };
}

function firstVisibleCellInRanges(ranges, doc, preferVisible) {
  if (!preferVisible) return null;
  for (const range of ranges) {
    const row = firstVisibleIndexInRange(range.top, range.bottom, doc.hiddenRows);
    const column = firstVisibleIndexInRange(range.left, range.right, doc.hiddenColumns);
    if (row !== null && column !== null) return { row, column };
  }
  return null;
}

function rangeHasVisibleCell(range, doc) {
  return firstVisibleIndexInRange(range.top, range.bottom, doc.hiddenRows) !== null
    && firstVisibleIndexInRange(range.left, range.right, doc.hiddenColumns) !== null;
}

function firstVisibleIndexInRange(start, end, hidden) {
  for (let index = start; index <= end; index++) {
    if (!hidden?.has(index)) return index;
  }
  return null;
}

function isVisiblePoint(point, doc, preferVisible) {
  return !preferVisible || (!doc.hiddenRows?.has(point.row) && !doc.hiddenColumns?.has(point.column));
}

function normalizePoint(point = {}, rowMax, columnMax) {
  return { row: clampIndex(point.row, rowMax), column: clampIndex(point.column, columnMax) };
}

function clampIndex(value, max) {
  return Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
}

function nearestVisiblePoint(point, doc, rowMax, columnMax) {
  const row = nearestVisibleIndex(point.row, rowMax, doc.hiddenRows);
  const column = nearestVisibleIndex(point.column, columnMax, doc.hiddenColumns);
  return row === null || column === null ? null : { row, column };
}

function nearestVisibleIndex(value, max, hidden) {
  if (!hidden?.has(value)) return value;
  for (let offset = 1; offset <= max; offset++) {
    if (value - offset >= 0 && !hidden.has(value - offset)) return value - offset;
    if (value + offset <= max && !hidden.has(value + offset)) return value + offset;
  }
  return null;
}

function subtractFromRanges(ranges, target) {
  return ranges.flatMap((range) => subtractRect(range, target));
}

function subtractRect(range, target) {
  const top = Math.max(range.top, target.top);
  const left = Math.max(range.left, target.left);
  const bottom = Math.min(range.bottom, target.bottom);
  const right = Math.min(range.right, target.right);
  if (top > bottom || left > right) return [range];
  const pieces = [];
  if (range.top < top) pieces.push(makeRect(range.top, range.left, top - 1, range.right));
  if (bottom < range.bottom) pieces.push(makeRect(bottom + 1, range.left, range.bottom, range.right));
  if (range.left < left) pieces.push(makeRect(top, range.left, bottom, left - 1));
  if (right < range.right) pieces.push(makeRect(top, right + 1, bottom, range.right));
  return pieces;
}
