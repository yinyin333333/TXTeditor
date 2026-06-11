export function classifyPanePoint({ x, y, rowHeaderWidth, headerHeight, frozenColumnWidth, frozenRowHeight }) {
  if (x < rowHeaderWidth && y < headerHeight) return "corner";
  if (y < headerHeight) return "column-header";
  if (x < rowHeaderWidth) return "row-header";
  if (frozenRowHeight > 0 && y >= headerHeight && y < headerHeight + frozenRowHeight) return "frozen-row";
  if (frozenColumnWidth > 0 && x >= rowHeaderWidth && x < rowHeaderWidth + frozenColumnWidth) return "frozen-column";
  return "cell";
}

export function classifyGridHit({ pane, row, column, x, y }) {
  if (pane === "corner") return { kind: "corner", row: 0, column: 0, x, y };
  if (pane === "column-header") return { kind: "column-header", row: 0, column, x, y };
  if (pane === "row-header") return { kind: "row-header", row, column: 0, x, y };
  if (pane === "frozen-row" || pane === "frozen-column") return { kind: "cell", row, column, x, y, frozen: true };
  return { kind: "cell", row, column, x, y };
}

export function classifyResizeHandle({ hit, columnRight, rowBottom, zoom = 1 }) {
  if (!hit || hit.kind === "empty") return null;
  const tolerance = Math.max(4, Math.round(5 * zoom));
  if (hit.kind === "column-header" && Math.abs(hit.x - columnRight) <= tolerance) return { kind: "column", index: hit.column };
  if (hit.kind === "row-header" && Math.abs(hit.y - rowBottom) <= tolerance) return { kind: "row", index: hit.row };
  if (hit.kind === "cell" && Math.abs(hit.x - columnRight) <= tolerance) return { kind: "column", index: hit.column };
  if (hit.kind === "cell" && Math.abs(hit.y - rowBottom) <= tolerance) return { kind: "row", index: hit.row };
  return null;
}

export function boundedTableExtent({ fixedExtent = 0, scrollableExtent = 0, scrollOffset = 0, viewportExtent = 0 }) {
  const extent = Math.ceil(fixedExtent + scrollableExtent - scrollOffset);
  return Math.max(0, Math.min(extent, viewportExtent));
}

export function columnColorIndex(column, colorCount = 5) {
  if (colorCount <= 0) return 0;
  return ((column % colorCount) + colorCount) % colorCount;
}
