export function classifyPanePoint({ x, y, rowHeaderWidth, headerHeight, frozenColumnWidth, frozenRowHeight }) {
  if (x < rowHeaderWidth && y < headerHeight) return "corner";
  if (y < headerHeight) return "column-header";
  if (x < rowHeaderWidth) return "row-header";
  if (frozenRowHeight > 0 && y >= headerHeight && y < headerHeight + frozenRowHeight) return "frozen-row";
  if (frozenColumnWidth > 0 && x >= rowHeaderWidth && x < rowHeaderWidth + frozenColumnWidth) return "frozen-column";
  return "cell";
}

export function boundedTableExtent({ fixedExtent = 0, scrollableExtent = 0, scrollOffset = 0, viewportExtent = 0 }) {
  const extent = Math.ceil(fixedExtent + scrollableExtent - scrollOffset);
  return Math.max(0, Math.min(extent, viewportExtent));
}

export function columnColorIndex(column, colorCount = 5) {
  if (colorCount <= 0) return 0;
  return ((column % colorCount) + colorCount) % colorCount;
}
