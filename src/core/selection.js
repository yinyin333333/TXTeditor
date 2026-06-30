export class SelectionModel {
  constructor() {
    this.anchor = { row: 0, column: 0 };
    this.focus = { row: 0, column: 0 };
    this.ranges = [makeRect(0, 0, 0, 0)];
  }

  set(row, column) {
    this.anchor = { row, column };
    this.focus = { row, column };
    this.ranges = [makeRect(row, column, row, column)];
  }

  snapshot() {
    return {
      anchor: { ...this.anchor },
      focus: { ...this.focus },
      ranges: this.ranges.map((range) => ({ ...range }))
    };
  }

  restore(snapshot, rowCount, columnCount) {
    const safe = normalizeSelectionSnapshot(snapshot, rowCount, columnCount);
    this.anchor = safe.anchor;
    this.focus = safe.focus;
    this.ranges = safe.ranges;
  }

  extend(row, column) {
    this.focus = { row, column };
    this.ranges = [makeRect(this.anchor.row, this.anchor.column, row, column)];
  }

  setRange(top, left, bottom, right, focus = { row: bottom, column: right }) {
    const rect = makeRect(top, left, bottom, right);
    this.anchor = { row: rect.top, column: rect.left };
    this.focus = { row: focus.row, column: focus.column };
    this.ranges = [rect];
  }

  extendRange(top, left, bottom, right, focus = { row: bottom, column: right }) {
    const anchor = this.anchor ?? { row: top, column: left };
    this.focus = { row: focus.row, column: focus.column };
    this.ranges = [makeRect(anchor.row, left, focus.row, right)];
  }

  toggleCell(row, column) {
    this.toggleRange(makeRect(row, column, row, column), { row, column });
  }

  setRow(row, columnCount) {
    this.setRange(row, 0, row, Math.max(0, columnCount - 1), { row, column: Math.max(0, columnCount - 1) });
  }

  extendRows(row, columnCount) {
    this.focus = { row, column: Math.max(0, columnCount - 1) };
    this.ranges = [makeRect(this.anchor.row, 0, row, Math.max(0, columnCount - 1))];
  }

  toggleRow(row, columnCount) {
    this.toggleRange(makeRect(row, 0, row, Math.max(0, columnCount - 1)), { row, column: Math.max(0, columnCount - 1) });
  }

  setColumn(column, rowCount) {
    this.setRange(0, column, Math.max(0, rowCount - 1), column, { row: Math.max(0, rowCount - 1), column });
  }

  extendColumns(column, rowCount) {
    this.focus = { row: Math.max(0, rowCount - 1), column };
    this.ranges = [makeRect(0, this.anchor.column, Math.max(0, rowCount - 1), column)];
  }

  toggleColumn(column, rowCount) {
    this.toggleRange(makeRect(0, column, Math.max(0, rowCount - 1), column), { row: Math.max(0, rowCount - 1), column });
  }

  toggleRange(rect, focus = { row: rect.bottom, column: rect.right }) {
    const target = normalizeRect(rect);
    this.focus = { row: focus.row, column: focus.column };
    if (rangeContains(this.ranges, target)) {
      this.ranges = subtractFromRanges(this.ranges, target);
    } else {
      this.ranges = [...this.ranges, target];
    }
    if (!this.ranges.length) this.ranges = [makeRect(focus.row, focus.column, focus.row, focus.column)];
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
  }
}

export function normalizeSelectionSnapshot(snapshot, rowCount = 1, columnCount = 1) {
  const maxRow = Math.max(0, Math.floor(Number(rowCount) || 0) - 1);
  const maxColumn = Math.max(0, Math.floor(Number(columnCount) || 0) - 1);
  const fallbackCell = { row: 0, column: 0 };
  const focus = normalizeCell(snapshot?.focus, maxRow, maxColumn) ?? fallbackCell;
  const anchor = normalizeCell(snapshot?.anchor, maxRow, maxColumn) ?? focus;
  const ranges = Array.isArray(snapshot?.ranges)
    ? snapshot.ranges.map((range) => normalizeSnapshotRect(range, maxRow, maxColumn)).filter(Boolean)
    : [];
  return {
    anchor,
    focus,
    ranges: ranges.length ? ranges : [makeRect(focus.row, focus.column, focus.row, focus.column)]
  };
}

function makeRect(rowA, columnA, rowB, columnB) {
  return {
    top: Math.min(rowA, rowB),
    left: Math.min(columnA, columnB),
    bottom: Math.max(rowA, rowB),
    right: Math.max(columnA, columnB)
  };
}

function normalizeCell(cell, maxRow, maxColumn) {
  if (!cell || !Number.isFinite(Number(cell.row)) || !Number.isFinite(Number(cell.column))) return null;
  return {
    row: clampIndex(cell.row, maxRow),
    column: clampIndex(cell.column, maxColumn)
  };
}

function normalizeSnapshotRect(range, maxRow, maxColumn) {
  if (!range) return null;
  const top = Number(range.top);
  const left = Number(range.left);
  const bottom = Number(range.bottom);
  const right = Number(range.right);
  if (![top, left, bottom, right].every(Number.isFinite)) return null;
  return makeRect(
    clampIndex(top, maxRow),
    clampIndex(left, maxColumn),
    clampIndex(bottom, maxRow),
    clampIndex(right, maxColumn)
  );
}

function clampIndex(value, max) {
  return Math.max(0, Math.min(max, Math.floor(Number(value))));
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
