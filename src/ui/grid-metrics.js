export class GridMetrics {
  constructor() {
    this.rows = emptyMetrics(0);
    this.columns = emptyMetrics(0);
    this.rowKey = "";
    this.columnKey = "";
  }

  updateRows({ doc, zoom, scrollStartRow }) {
    const key = [
      doc.viewRevision ?? 0,
      doc.rowCount,
      doc.defaultRowHeight,
      doc.hasCustomRowHeights,
      doc.hiddenRows?.size ?? 0,
      scrollStartRow,
      zoom
    ].join("|");
    if (key === this.rowKey) return this.rows;
    this.rowKey = key;
    this.rows = buildMetrics({
      count: doc.rowCount,
      start: scrollStartRow,
      hidden: doc.hiddenRows,
      sizeAt: (row) => Math.round((doc.rowHeights[row] ?? doc.defaultRowHeight) * zoom),
      simpleSize: !doc.hiddenRows?.size && !doc.hasCustomRowHeights ? Math.round((doc.defaultRowHeight ?? 26) * zoom) : null
    });
    return this.rows;
  }

  updateColumns({ doc, zoom, scrollStartColumn }) {
    const key = [
      doc.viewRevision ?? 0,
      doc.columnCount,
      doc.defaultColumnWidth,
      doc.hiddenColumns?.size ?? 0,
      doc.columnWidths?.length ?? 0,
      scrollStartColumn,
      zoom
    ].join("|");
    if (key === this.columnKey) return this.columns;
    this.columnKey = key;
    this.columns = buildMetrics({
      count: doc.columnCount,
      start: scrollStartColumn,
      hidden: doc.hiddenColumns,
      sizeAt: (column) => Math.round((doc.columnWidths?.[column] ?? doc.defaultColumnWidth ?? 120) * zoom)
    });
    return this.columns;
  }

  scrollableRowsHeight() {
    return this.rows.total;
  }

  scrollableColumnWidth() {
    return this.columns.total;
  }

  rowContentTop(row) {
    return offsetForIndex(this.rows, row);
  }

  columnContentLeft(column) {
    return offsetForIndex(this.columns, column);
  }

  rowAtContent(y) {
    return indexAtOffset(this.rows, y);
  }

  columnAtContent(x) {
    return indexAtOffset(this.columns, x);
  }

  visibleRows({ scrollTop, viewportHeight, fixedTop, overscanPx }) {
    return visibleItems(this.rows, {
      scrollOffset: scrollTop,
      viewportExtent: viewportHeight,
      fixedExtent: fixedTop,
      overscan: overscanPx,
      indexKey: "row",
      positionKey: "top"
    });
  }

  visibleColumns({ scrollLeft, viewportWidth, fixedLeft, overscanPx }) {
    return visibleItems(this.columns, {
      scrollOffset: scrollLeft,
      viewportExtent: viewportWidth,
      fixedExtent: fixedLeft,
      overscan: overscanPx,
      indexKey: "column",
      positionKey: "left"
    });
  }
}

function buildMetrics({ count, start, hidden, sizeAt, simpleSize = null }) {
  const safeStart = Math.max(0, Math.floor(Number(start) || 0));
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  if (simpleSize != null) {
    return {
      count: safeCount,
      start: safeStart,
      simpleSize,
      total: Math.max(0, safeCount - safeStart) * simpleSize,
      indexes: null,
      prefix: null
    };
  }
  const indexes = [];
  const prefix = [0];
  let total = 0;
  for (let index = safeStart; index < safeCount; index++) {
    if (hidden?.has(index)) continue;
    indexes.push(index);
    total += sizeAt(index);
    prefix.push(total);
  }
  return { count: safeCount, start: safeStart, simpleSize: null, total, indexes, prefix };
}

function emptyMetrics(start) {
  return { count: 0, start, simpleSize: 0, total: 0, indexes: null, prefix: null };
}

function offsetForIndex(metrics, index) {
  if (metrics.simpleSize != null) return Math.max(0, index - metrics.start) * metrics.simpleSize;
  const position = lowerBound(metrics.indexes, index);
  return metrics.prefix[position] ?? metrics.total;
}

function indexAtOffset(metrics, offset) {
  if (metrics.count <= 0) return 0;
  const value = Math.max(0, Number(offset) || 0);
  if (metrics.simpleSize != null) {
    return clamp(metrics.start + Math.floor(value / Math.max(1, metrics.simpleSize)), 0, metrics.count - 1);
  }
  if (!metrics.indexes.length) return Math.max(0, metrics.count - 1);
  const position = clamp(upperBound(metrics.prefix, value) - 1, 0, metrics.indexes.length - 1);
  return metrics.indexes[position];
}

function visibleItems(metrics, { scrollOffset, viewportExtent, fixedExtent, overscan, indexKey, positionKey }) {
  if (metrics.count <= 0) return [];
  const viewport = Math.max(0, Number(viewportExtent) || 0);
  const fixed = Math.max(0, Number(fixedExtent) || 0);
  const scanBefore = Math.max(0, Number(overscan) || 0);
  const scroll = Math.max(0, Number(scrollOffset) || 0);
  const lower = Math.max(0, scroll - scanBefore);
  const upper = scroll + Math.max(0, viewport - fixed) + scanBefore;
  if (metrics.simpleSize != null) return visibleSimpleItems(metrics, { lower, upper, scroll, fixed, indexKey, positionKey });
  const items = [];
  let position = Math.max(0, upperBound(metrics.prefix, lower) - 1);
  for (; position < metrics.indexes.length; position++) {
    const offset = metrics.prefix[position];
    if (offset > upper) break;
    const size = metrics.prefix[position + 1] - offset;
    if (offset + size >= lower) {
      items.push({ [indexKey]: metrics.indexes[position], [positionKey]: fixed + offset - scroll, [indexKey === "row" ? "height" : "width"]: size });
    }
  }
  return items;
}

function visibleSimpleItems(metrics, { lower, upper, scroll, fixed, indexKey, positionKey }) {
  const items = [];
  const size = Math.max(1, metrics.simpleSize);
  const first = Math.max(metrics.start, metrics.start + Math.floor(lower / size));
  const last = Math.min(metrics.count - 1, metrics.start + Math.ceil(upper / size));
  for (let index = first; index <= last; index++) {
    const offset = (index - metrics.start) * size;
    items.push({ [indexKey]: index, [positionKey]: fixed + offset - scroll, [indexKey === "row" ? "height" : "width"]: size });
  }
  return items;
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
