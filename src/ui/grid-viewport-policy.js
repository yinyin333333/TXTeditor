import { clamp } from "../core/table-model.js";
export function snappedGridScrollOffset({ metrics, offset, maxScroll, direction = 0 }) {
  const max = Math.max(0, Number(maxScroll) || 0), value = clamp(Number(offset) || 0, 0, max);
  if (value === max || !metrics?.total) return value;
  const boundaries = metrics.simpleSize != null ? null : metrics.prefix;
  if (metrics.simpleSize != null) {
    const size = Math.max(1, metrics.simpleSize), quotient = value / size;
    const step = direction > 0 ? Math.ceil(quotient) : direction < 0 ? Math.floor(quotient) : Math.round(quotient);
    return clamp(step * size, 0, max);
  }
  const upper = lowerBound(boundaries, value), exact = boundaries[upper] === value;
  const index = direction > 0 ? upper : direction < 0 ? (exact ? upper : upper - 1) : nearestBoundary(boundaries, value, upper);
  return clamp(boundaries[clamp(index, 0, boundaries.length - 1)] ?? 0, 0, max);
}

export function normalizeCellGridScrollOffsets(grid) {
  const current = { scrollLeft: grid.host.scrollLeft, scrollTop: grid.host.scrollTop };
  const hasObserved = Boolean(grid._lastObservedCellScrollOffset), observedBefore = grid._lastObservedCellScrollOffset ?? current, rawBefore = grid._lastRawCellScrollOffset ?? {}, snappedBefore = grid._lastCellScrollOffset ?? current, metrics = grid.gridMetrics();
  const maxLeft = Math.max(0, grid.rowHeaderWidth + grid.frozenColumnWidth() + grid.scrollableColumnWidth() - grid.host.clientWidth);
  const maxTop = Math.max(0, grid.headerHeight + grid.frozenRowHeight() + grid.scrollableRowsHeight() - grid.host.clientHeight);
  const changed = {
    scrollLeft: !hasObserved || current.scrollLeft !== observedBefore.scrollLeft,
    scrollTop: !hasObserved || current.scrollTop !== observedBefore.scrollTop
  };
  const next = {
    scrollLeft: changed.scrollLeft ? snappedGridScrollOffset({ metrics: metrics.columns, offset: current.scrollLeft, maxScroll: maxLeft, direction: cellScrollDirection(current.scrollLeft, rawBefore.scrollLeft, snappedBefore.scrollLeft) }) : snappedBefore.scrollLeft,
    scrollTop: changed.scrollTop ? snappedGridScrollOffset({ metrics: metrics.rows, offset: current.scrollTop, maxScroll: maxTop, direction: cellScrollDirection(current.scrollTop, rawBefore.scrollTop, snappedBefore.scrollTop) }) : snappedBefore.scrollTop
  };
  // An event for one axis leaves the other axis sitting at its snapped output.
  // Keep that axis's last *raw* position so a later thumb movement cannot be
  // mistaken for a reversal from the snapped boundary.
  grid._lastRawCellScrollOffset = {
    scrollLeft: changed.scrollLeft ? current.scrollLeft : rawBefore.scrollLeft,
    scrollTop: changed.scrollTop ? current.scrollTop : rawBefore.scrollTop
  };
  grid._lastCellScrollOffset = next;
  const dragging = grid._cellScrollThumbDrag ?? {};
  grid._lastObservedCellScrollOffset = {
    scrollLeft: changed.scrollLeft && !dragging.horizontal ? next.scrollLeft : current.scrollLeft,
    scrollTop: changed.scrollTop && !dragging.vertical ? next.scrollTop : current.scrollTop
  };
  grid._cellScrollChangedAxes = changed;
  return next;
}

export function setCellGridScrollBaseline(grid, offsets, { notify = false } = {}) {
  const next = { scrollLeft: offsets.scrollLeft, scrollTop: offsets.scrollTop };
  grid._lastRawCellScrollOffset = { ...next };
  grid._lastObservedCellScrollOffset = { ...next };
  grid._lastCellScrollOffset = next;
  grid._cellScrollChangedAxes = { scrollLeft: false, scrollTop: false };
  grid._cellScrollEcho = null;
  if (grid.doc) Object.assign(grid.doc, next);
  if (notify) { grid.clearHoverState?.(); grid.requestRender?.("scroll"); grid.onViewportChanged?.("scroll"); }
}

export function consumeCellGridScrollEcho(grid) {
  const expected = grid._cellScrollEcho;
  if (!expected || grid.host.scrollLeft !== expected.scrollLeft || grid.host.scrollTop !== expected.scrollTop) return false;
  grid._cellScrollEcho = null;
  return true;
}

function cellScrollDirection(current, rawBefore, snappedBefore) {
  if (current === snappedBefore) return 0;
  return Math.sign(current - (rawBefore ?? snappedBefore ?? current));
}

function nextRawCellScrollOffset(current, rawBefore, snappedBefore) {
  return current === snappedBefore ? rawBefore : current;
}

function lowerBound(values, target) {
  let low = 0, high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function nearestBoundary(values, value, upper) {
  if (upper <= 0) return 0;
  if (upper >= values.length) return values.length - 1;
  return value - values[upper - 1] <= values[upper] - value ? upper - 1 : upper;
}

export function centeredScrollOffset({ itemStart, itemSize, viewportSize, maxScroll }) {
  const viewport = Math.max(0, Number(viewportSize) || 0);
  const max = Math.max(0, Number(maxScroll) || 0);
  return clamp(Math.round(itemStart + itemSize / 2 - viewport / 2), 0, max);
}

export function centeredCellScrollState({
  row,
  column,
  freezeFirstRow,
  freezeFirstColumn,
  columnContentLeft,
  rowContentTop,
  columnWidth,
  rowHeight,
  viewportWidth,
  viewportHeight,
  scrollableWidth,
  scrollableHeight
}) {
  const state = {};
  if (!(freezeFirstColumn && column === 0)) {
    const viewport = Math.max(0, Number(viewportWidth) || 0);
    state.scrollLeft = centeredScrollOffset({
      itemStart: columnContentLeft,
      itemSize: columnWidth,
      viewportSize: viewport,
      maxScroll: scrollableWidth - viewport
    });
  }
  if (!(freezeFirstRow && row === 0)) {
    const viewport = Math.max(0, Number(viewportHeight) || 0);
    state.scrollTop = centeredScrollOffset({
      itemStart: rowContentTop,
      itemSize: rowHeight,
      viewportSize: viewport,
      maxScroll: scrollableHeight - viewport
    });
  }
  return state;
}

export function edgeScrollOffset({ itemStart, itemSize, viewportStart, viewportSize, overshoot = 16 }) {
  const start = Number(viewportStart) || 0;
  const size = Math.max(0, Number(viewportSize) || 0);
  const end = start + size;
  if (itemStart < start) return itemStart;
  if (itemStart + itemSize > end) return itemStart + itemSize - size + overshoot;
  return start;
}

export function edgeCellScrollState({
  row,
  column,
  freezeFirstRow,
  freezeFirstColumn,
  columnContentLeft,
  rowContentTop,
  columnWidth,
  rowHeight,
  viewportLeft,
  viewportTop,
  viewportWidth,
  viewportHeight
}) {
  const state = {};
  if (!(freezeFirstColumn && column === 0)) {
    state.scrollLeft = edgeScrollOffset({
      itemStart: columnContentLeft,
      itemSize: columnWidth,
      viewportStart: viewportLeft,
      viewportSize: viewportWidth
    });
  }
  if (!(freezeFirstRow && row === 0)) {
    state.scrollTop = edgeScrollOffset({
      itemStart: rowContentTop,
      itemSize: rowHeight,
      viewportStart: viewportTop,
      viewportSize: viewportHeight
    });
  }
  return state;
}

export function clampedGridScrollOffsets({
  scrollLeft,
  scrollTop,
  rowHeaderWidth,
  headerHeight,
  frozenColumnWidth,
  frozenRowHeight,
  scrollableColumnWidth,
  scrollableRowsHeight,
  viewportWidth,
  viewportHeight
}) {
  return {
    scrollLeft: clamp(scrollLeft, 0, Math.max(0, rowHeaderWidth + frozenColumnWidth + scrollableColumnWidth - viewportWidth)),
    scrollTop: clamp(scrollTop, 0, Math.max(0, headerHeight + frozenRowHeight + scrollableRowsHeight - viewportHeight))
  };
}

export function wheelScrollOffsets(
  { deltaX = 0, deltaY = 0, deltaMode = 0, shiftKey = false } = {},
  { scrollLeft = 0, scrollTop = 0, lineSize = 1, pageWidth = 1, pageHeight = 1 } = {}
) {
  const horizontalScale = deltaMode === 1 ? lineSize : deltaMode === 2 ? pageWidth : 1;
  const verticalScale = deltaMode === 1 ? lineSize : deltaMode === 2 ? pageHeight : 1;
  let left = (Number(deltaX) || 0) * horizontalScale;
  let top = (Number(deltaY) || 0) * verticalScale;
  if (shiftKey && left === 0) {
    left = top;
    top = 0;
  }
  return {
    scrollLeft: scrollLeft + left,
    scrollTop: scrollTop + top
  };
}

export function applyGridScrollBounds({ host, doc, rowHeaderWidth, headerHeight, frozenColumnWidth, frozenRowHeight, scrollableColumnWidth, scrollableRowsHeight }) {
  const next = clampedGridScrollOffsets({
    scrollLeft: host.scrollLeft,
    scrollTop: host.scrollTop,
    rowHeaderWidth,
    headerHeight,
    frozenColumnWidth,
    frozenRowHeight,
    scrollableColumnWidth,
    scrollableRowsHeight,
    viewportWidth: host.clientWidth,
    viewportHeight: host.clientHeight
  });
  if (host.scrollLeft !== next.scrollLeft) host.scrollLeft = next.scrollLeft;
  if (host.scrollTop !== next.scrollTop) host.scrollTop = next.scrollTop;
  if (doc) {
    doc.scrollLeft = next.scrollLeft;
    doc.scrollTop = next.scrollTop;
  }
}

export function resizedTrackValue({ before, pointer, start, zoom, min }) {
  return Math.max(min, before + (pointer - start) / zoom);
}

export function applyResizeDragState({ doc, resizing, hit }) {
  if (resizing.kind === "column") {
    const next = resizedTrackValue({
      before: resizing.before,
      pointer: hit.x,
      start: resizing.startX,
      zoom: resizing.zoom,
      min: 36
    });
    doc.columnWidths[resizing.index] = next;
    doc.markViewChanged?.();
    return { value: next, guide: { kind: "column", x: hit.x }, hasCustomRowHeights: doc.hasCustomRowHeights };
  }

  const next = resizedTrackValue({
    before: resizing.before,
    pointer: hit.y,
    start: resizing.startY,
    zoom: resizing.zoom,
    min: 18
  });
  doc.rowHeights[resizing.index] = next;
  doc.hasCustomRowHeights = true;
  doc.markViewChanged?.();
  return { value: next, guide: { kind: "row", y: hit.y }, hasCustomRowHeights: true };
}
