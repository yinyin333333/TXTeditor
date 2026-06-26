import { clamp } from "../core/table-model.js";

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
  return { value: next, guide: { kind: "row", y: hit.y }, hasCustomRowHeights: true };
}
