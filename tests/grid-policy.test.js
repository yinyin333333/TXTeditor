import assert from "node:assert/strict";
import test from "node:test";
import { TableDocument } from "../src/core/table-model.js";
import { SelectionModel } from "../src/core/selection.js";
import { clearRangesCommand, incrementFillSelectedCellsCommand } from "../src/core/operations.js";
import {
  CanvasGrid,
  createFirstColumnHoverPreview,
  gridColor,
  shouldDrawCellText,
  shouldShowFirstColumnHover
} from "../src/ui/canvas-grid.js";
import {
  editorBoxStyle,
  editorCellState,
  isPrintableEditKey,
  keyboardEditStartAction
} from "../src/ui/edit-policy.js";
import {
  boundedTableExtent,
  classifyGridHit,
  classifyPanePoint,
  classifyResizeHandle,
  columnColorIndex
} from "../src/ui/grid-geometry.js";
import { GridMetrics } from "../src/ui/grid-metrics.js";
import {
  activeRowHeaderChromeSteps,
  cellBackground,
  cellGridLineColor,
  cellTextColor,
  centeredTextY,
  columnHeaderRenderState,
  columnIndexLabel,
  columnIndexRenderState,
  createGridRenderStats,
  cellTextRenderPlan,
  diagnosticMarkerState,
  diagnosticTextOverlayPlan,
  initialColumnFitWidth,
  indexHandleChromeSteps,
  indexHandleRenderState,
  rowHeaderRenderState,
  syncGridThemeFromStyle,
  updateGridRenderStats
} from "../src/ui/grid-render-policy.js";
import {
  applySelectionForHit,
  hasFullColumnRange,
  hasFullRowRange,
  keyboardSelectionTarget
} from "../src/ui/grid-selection-policy.js";
import {
  applyResizeDragState,
  centeredCellScrollState,
  centeredScrollOffset,
  edgeCellScrollState,
  edgeScrollOffset,
  resizedTrackValue,
  snappedGridScrollOffset,
  consumeCellGridScrollEcho,
  normalizeCellGridScrollOffsets,
  setCellGridScrollBaseline
} from "../src/ui/grid-viewport-policy.js";
import { GRID_SCROLL_MODE_CELL, normalizeGridScrollMode } from "../src/ui/grid-scroll-mode-policy.js";
import { shouldClearHoverForInteraction } from "../src/ui/hover-policy.js";
import { drawGridCellLayer, drawGridColumnHeader, drawGridCornerHeader } from "../src/ui/grid/grid-renderer.js";

test("grid selection policy applies cell, row, column, and corner hits", () => {
  const selection = new SelectionModel();
  const bounds = { rowCount: 6, columnCount: 4 };

  assert.equal(applySelectionForHit(selection, { kind: "cell", row: 2, column: 1 }, bounds), "set-cell");
  assert.deepEqual(selection.rect, { top: 2, left: 1, bottom: 2, right: 1 });

  assert.equal(applySelectionForHit(selection, { kind: "cell", row: 3, column: 2 }, { ...bounds, extend: true }), "extend-cell");
  assert.deepEqual(selection.rect, { top: 2, left: 1, bottom: 3, right: 2 });

  assert.equal(applySelectionForHit(selection, { kind: "row-header", row: 4 }, bounds), "set-row");
  assert.equal(selection.hasFullRow(4, bounds.columnCount), true);

  assert.equal(applySelectionForHit(selection, { kind: "column-header", column: 2 }, { ...bounds, toggle: true }), "toggle-column");
  assert.equal(selection.hasFullColumn(2, bounds.rowCount), true);

  assert.equal(applySelectionForHit(selection, { kind: "corner" }, bounds), "select-all");
  assert.deepEqual(selection.rect, { top: 0, left: 0, bottom: 5, right: 3 });

  assert.equal(applySelectionForHit(selection, { kind: "empty" }, bounds), "none");
  assert.deepEqual(selection.rect, { top: 0, left: 0, bottom: 5, right: 3 });
});

test("column index labels use spreadsheet-style letters", () => {
  assert.deepEqual([0, 1, 2, 25, 26, 27, 51, 52].map(columnIndexLabel), ["A", "B", "C", "Z", "AA", "AB", "AZ", "BA"]);
  assert.equal(columnIndexLabel(-1), "");
  assert.equal(columnIndexLabel(Number.NaN), "");
});

test("grid selection policy detects full row and column ranges", () => {
  const ranges = [
    { top: 2, left: 0, bottom: 2, right: 4 },
    { top: 0, left: 3, bottom: 9, right: 3 }
  ];
  assert.equal(hasFullRowRange(ranges, 5), true);
  assert.equal(hasFullRowRange(ranges, 6), false);
  assert.equal(hasFullColumnRange(ranges, 10), true);
  assert.equal(hasFullColumnRange(ranges, 11), false);
});

test("grid keyboard selection target preserves tab and arrow navigation semantics", () => {
  const base = {
    focus: { row: 2, column: 2 },
    rowCount: 5,
    columnCount: 4,
    jumpRow: (row, direction) => row + direction * 3,
    jumpColumn: (column, direction) => column + direction * 3
  };

  assert.deepEqual(keyboardSelectionTarget({ ...base, key: "Tab" }), { row: 2, column: 3, extend: false });
  assert.deepEqual(keyboardSelectionTarget({ ...base, key: "Tab", shiftKey: true }), { row: 2, column: 1, extend: false });
  assert.equal(keyboardSelectionTarget({ ...base, key: "Tab", ctrlKey: true }), null);
  assert.equal(keyboardSelectionTarget({ ...base, key: "Tab", ctrlKey: true, shiftKey: true }), null);
  assert.deepEqual(keyboardSelectionTarget({ ...base, key: "ArrowDown", shiftKey: true }), { row: 3, column: 2, extend: true });
  assert.deepEqual(keyboardSelectionTarget({ ...base, key: "ArrowRight", ctrlKey: true }), { row: 2, column: 3, extend: false });
  assert.deepEqual(keyboardSelectionTarget({ ...base, key: "ArrowUp", ctrlKey: true }), { row: 0, column: 2, extend: false });
  assert.equal(keyboardSelectionTarget({ ...base, key: "Escape" }), null);
});

test("increment fill starts from the anchor and walks selected cells in deterministic grid order", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\tc\n1\tco7\t3\n4\t5\t6");
  const selection = new SelectionModel();
  selection.set(1, 1);
  selection.toggleCell(2, 0);
  selection.toggleCell(0, 2);
  incrementFillSelectedCellsCommand(doc, selection.ranges, selection.anchor).redo(doc);
  assert.equal(doc.getCell(0, 2), "co7");
  assert.equal(doc.getCell(1, 1), "co8");
  assert.equal(doc.getCell(2, 0), "co9");
  assert.equal(doc.getCell(0, 0), "a");
  assert.equal(doc.getCell(2, 1), "5");
});

test("row height reset clears custom row heights without marking TXT data dirty", () => {
  const doc = TableDocument.fromText("x.txt", "a\n1\n2", { dirty: false });
  doc.rowHeights[1] = 88;
  doc.hasCustomRowHeights = true;
  const changed = doc.resetRowHeights();
  assert.equal(changed, true);
  assert.equal(doc.hasCustomRowHeights, false);
  assert.deepEqual(doc.rowHeights, [doc.defaultRowHeight, doc.defaultRowHeight, doc.defaultRowHeight]);
  assert.equal(doc.dirty, false);
});

test("frozen pane geometry classifies header and frozen regions", () => {
  const base = { rowHeaderWidth: 58, headerHeight: 28, frozenColumnWidth: 120, frozenRowHeight: 26 };
  assert.equal(classifyPanePoint({ ...base, x: 10, y: 10 }), "corner");
  assert.equal(classifyPanePoint({ ...base, x: 100, y: 10 }), "column-header");
  assert.equal(classifyPanePoint({ ...base, x: 10, y: 40 }), "row-header");
  assert.equal(classifyPanePoint({ ...base, x: 220, y: 40 }), "frozen-row");
  assert.equal(classifyPanePoint({ ...base, x: 100, y: 90 }), "frozen-column");
  assert.equal(classifyPanePoint({ ...base, x: 220, y: 90 }), "cell");
});

test("grid hit testing separates the column index band from field-name cells", () => {
  assert.deepEqual(
    classifyGridHit({ pane: "column-header", row: 0, column: 2, x: 250, y: 10 }),
    { kind: "column-header", row: 0, column: 2, x: 250, y: 10 }
  );
  assert.deepEqual(
    classifyGridHit({ pane: "cell", row: 0, column: 2, x: 250, y: 34 }),
    { kind: "cell", row: 0, column: 2, x: 250, y: 34 }
  );
  assert.deepEqual(
    classifyGridHit({ pane: "corner", row: 0, column: 0, x: 12, y: 10 }),
    { kind: "corner", row: 0, column: 0, x: 12, y: 10 }
  );
  assert.deepEqual(
    classifyGridHit({ pane: "row-header", row: 1, column: 0, x: 12, y: 34 }),
    { kind: "row-header", row: 1, column: 0, x: 12, y: 34 }
  );
});

test("frozen first row and first column data cells stay cell targets", () => {
  assert.deepEqual(
    classifyGridHit({ pane: "frozen-row", row: 0, column: 2, x: 250, y: 8 }),
    { kind: "cell", row: 0, column: 2, x: 250, y: 8, frozen: true }
  );
  assert.deepEqual(
    classifyGridHit({ pane: "frozen-column", row: 4, column: 0, x: 72, y: 140 }),
    { kind: "cell", row: 4, column: 0, x: 72, y: 140, frozen: true }
  );
});

test("column index selection targets whole logical columns while field-name cells stay normal cells", () => {
  const doc = TableDocument.fromText("x.txt", "description\tenabled\tversion\nname\t1\t0.4.4\nname2\t0\t0.4.5");
  const bounds = { rowCount: doc.rowCount, columnCount: doc.columnCount };
  const selection = new SelectionModel();
  const versionColumn = 2;

  assert.equal(applySelectionForHit(selection, { kind: "cell", row: 0, column: versionColumn }, bounds), "set-cell");
  assert.deepEqual(selection.rect, { top: 0, left: versionColumn, bottom: 0, right: versionColumn });
  assert.equal(selection.hasFullColumn(versionColumn, doc.rowCount), false);

  assert.equal(applySelectionForHit(selection, { kind: "column-header", column: versionColumn }, bounds), "set-column");
  assert.deepEqual(selection.rect, { top: 0, left: versionColumn, bottom: 2, right: versionColumn });
  assert.equal(selection.hasFullColumn(versionColumn, doc.rowCount), true);
});

test("column index range selection extends contiguous whole-column ranges", () => {
  const selection = new SelectionModel();
  const bounds = { rowCount: 4, columnCount: 6 };

  assert.equal(applySelectionForHit(selection, { kind: "column-header", column: 1 }, bounds), "set-column");
  assert.equal(applySelectionForHit(selection, { kind: "column-header", column: 4 }, { ...bounds, extend: true }), "extend-column");
  assert.deepEqual(selection.rect, { top: 0, left: 1, bottom: 3, right: 4 });
  assert.equal(selection.hasFullColumn(1, bounds.rowCount), true);
  assert.equal(selection.hasFullColumn(4, bounds.rowCount), true);
  assert.equal(selection.hasFullColumn(5, bounds.rowCount), false);
});

test("#83 row index dragging extends whole-row selection in both directions", () => {
  for (const targetRow of [1, 6]) {
    const selection = new SelectionModel();
    const hits = [
      { kind: "row-header", row: 4, column: 0, x: 12, y: 130 },
      { kind: "row-header", row: targetRow, column: 0, x: 12, y: targetRow * 26 + 30 }
    ];
    let draws = 0;
    const notifications = [];
    const grid = {
      host: { focus() {}, style: {} },
      doc: { rowCount: 8, columnCount: 4 },
      selection,
      dragging: false,
      resizing: null,
      hideFirstColumnHoverPreview() {},
      isScrollbarEvent: () => false,
      hitTest: () => hits.shift(),
      resizeHit: () => null,
      applyHitSelection(hit, extend, toggle) {
        return applySelectionForHit(selection, hit, {
          rowCount: this.doc.rowCount,
          columnCount: this.doc.columnCount,
          extend,
          toggle
        });
      },
      clearHoverState() {},
      draw() { draws += 1; },
      notifySelectionChanged(reason) { notifications.push(reason); },
      _updateTooltip() {}
    };

    CanvasGrid.prototype.onMouseDown.call(grid, {
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false
    });
    assert.equal(grid.dragging, "row-header");

    CanvasGrid.prototype.onMouseMove.call(grid, {});
    assert.deepEqual(selection.rect, {
      top: Math.min(4, targetRow),
      left: 0,
      bottom: Math.max(4, targetRow),
      right: 3
    });
    assert.equal(selection.hasFullRow(4, grid.doc.columnCount), true);
    assert.equal(selection.hasFullRow(targetRow, grid.doc.columnCount), true);
    assert.equal(draws, 2);
    assert.deepEqual(notifications, ["pointer-selection", "drag-selection"]);
  }
});

test("clear after column-index selection edits table cells but not generated labels", () => {
  const doc = TableDocument.fromText("x.txt", "description\tenabled\tversion\nname\t1\t0.4.4\nname2\t0\t0.4.5");
  const selection = new SelectionModel();
  const versionColumn = 2;
  const beforeLabel = columnIndexLabel(versionColumn);

  applySelectionForHit(selection, { kind: "column-header", column: versionColumn }, {
    rowCount: doc.rowCount,
    columnCount: doc.columnCount
  });
  const command = clearRangesCommand(doc, selection.ranges);
  command.redo(doc);

  assert.equal(columnIndexLabel(versionColumn), beforeLabel);
  assert.equal(doc.getCell(0, versionColumn), "");
  assert.equal(doc.getCell(1, versionColumn), "");
  assert.equal(doc.getCell(2, versionColumn), "");
  assert.equal(doc.getCell(1, 0), "name");
  assert.equal(command.isEmpty, false);

  command.undo(doc);
  assert.equal(doc.getCell(0, versionColumn), "version");
  assert.equal(doc.getCell(1, versionColumn), "0.4.4");
  assert.equal(doc.getCell(2, versionColumn), "0.4.5");

  command.redo(doc);
  assert.equal(doc.getCell(0, versionColumn), "");
  assert.equal(doc.getCell(1, versionColumn), "");
  assert.equal(doc.getCell(2, versionColumn), "");
});

test("renderer skips stale text for the active editing cell only", () => {
  const editingCell = { row: 0, column: 1 };
  assert.equal(shouldDrawCellText(0, 1, editingCell), false);
  assert.equal(shouldDrawCellText(0, 0, editingCell), true);
  assert.equal(shouldDrawCellText(1, 1, editingCell), true);
  assert.equal(shouldDrawCellText(0, 1, null), true);
});

test("first-column hover is gated to real first-column cells with text", () => {
  assert.equal(shouldShowFirstColumnHover({ kind: "cell", row: 2, column: 0 }, "full-code-value"), true);
  assert.equal(shouldShowFirstColumnHover({ kind: "cell", row: 0, column: 0 }, "full-code-value"), false);
  assert.equal(shouldShowFirstColumnHover({ kind: "cell", row: 2, column: 1 }, "full-code-value"), false);
  assert.equal(shouldShowFirstColumnHover({ kind: "row-header", row: 2, column: 0 }, "full-code-value"), false);
  assert.equal(shouldShowFirstColumnHover({ kind: "column-header", row: 0, column: 0 }, "full-code-value"), false);
  assert.equal(shouldShowFirstColumnHover({ kind: "empty" }, "full-code-value"), false);
  assert.equal(shouldShowFirstColumnHover({ kind: "cell", row: 2, column: 0 }, ""), false);
});

test("frozen pane dividers are bounded to visible table content", () => {
  assert.equal(boundedTableExtent({
    fixedExtent: 0,
    scrollableExtent: 260,
    scrollOffset: 0,
    viewportExtent: 900
  }), 260);
  assert.equal(boundedTableExtent({
    fixedExtent: 26,
    scrollableExtent: 5200,
    scrollOffset: 1200,
    viewportExtent: 900
  }), 900);
  assert.equal(boundedTableExtent({
    fixedExtent: 26,
    scrollableExtent: 520,
    scrollOffset: 700,
    viewportExtent: 900
  }), 0);
});

test("centered scroll offsets clamp for short and bounded content", () => {
  assert.equal(centeredScrollOffset({ itemStart: 240, itemSize: 26, viewportSize: 500, maxScroll: -120 }), 0);
  assert.equal(centeredScrollOffset({ itemStart: 240, itemSize: 26, viewportSize: 100, maxScroll: 1000 }), 203);
  assert.equal(centeredScrollOffset({ itemStart: 980, itemSize: 40, viewportSize: 200, maxScroll: 720 }), 720);
  assert.equal(edgeScrollOffset({ itemStart: 40, itemSize: 20, viewportStart: 100, viewportSize: 200 }), 40);
  assert.equal(edgeScrollOffset({ itemStart: 320, itemSize: 40, viewportStart: 100, viewportSize: 200 }), 176);
  assert.equal(edgeScrollOffset({ itemStart: 140, itemSize: 40, viewportStart: 100, viewportSize: 200 }), 100);
  assert.equal(resizedTrackValue({ before: 80, pointer: 150, start: 100, zoom: 2, min: 18 }), 105);
  assert.equal(resizedTrackValue({ before: 20, pointer: 0, start: 100, zoom: 1, min: 18 }), 18);
  assert.deepEqual(centeredCellScrollState({
    row: 4,
    column: 3,
    freezeFirstRow: true,
    freezeFirstColumn: true,
    columnContentLeft: 240,
    rowContentTop: 180,
    columnWidth: 80,
    rowHeight: 26,
    viewportWidth: 100,
    viewportHeight: 80,
    scrollableWidth: 1000,
    scrollableHeight: 500
  }), { scrollLeft: 230, scrollTop: 153 });
  assert.deepEqual(centeredCellScrollState({
    row: 0,
    column: 0,
    freezeFirstRow: true,
    freezeFirstColumn: true,
    columnContentLeft: 240,
    rowContentTop: 180,
    columnWidth: 80,
    rowHeight: 26,
    viewportWidth: 100,
    viewportHeight: 80,
    scrollableWidth: 1000,
    scrollableHeight: 500
  }), {});
  assert.deepEqual(edgeCellScrollState({
    row: 4,
    column: 3,
    freezeFirstRow: true,
    freezeFirstColumn: true,
    columnContentLeft: 320,
    rowContentTop: 260,
    columnWidth: 40,
    rowHeight: 26,
    viewportLeft: 100,
    viewportTop: 220,
    viewportWidth: 200,
    viewportHeight: 80
  }), { scrollLeft: 176, scrollTop: 220 });
  assert.deepEqual(edgeCellScrollState({
    row: 0,
    column: 0,
    freezeFirstRow: true,
    freezeFirstColumn: true,
    columnContentLeft: 320,
    rowContentTop: 260,
    columnWidth: 40,
    rowHeight: 26,
    viewportLeft: 100,
    viewportTop: 220,
    viewportWidth: 200,
    viewportHeight: 80
  }), {});
});

test("cell scrolling snaps variable hidden boundaries without skipping exact forward boundaries", () => {
  const metrics = new GridMetrics();
  const doc = new TableDocument("snap", [["a", "b", "c", "d"]]);
  doc.defaultColumnWidth = 50;
  doc.columnWidths = [50, 70, 30, 90];
  doc.hiddenColumns.add(1);
  metrics.updateColumns({ doc, zoom: 2, scrollStartColumn: 0 });
  assert.equal(snappedGridScrollOffset({ metrics: metrics.columns, offset: 83, maxScroll: 250, direction: 1 }), 100);
  assert.equal(snappedGridScrollOffset({ metrics: metrics.columns, offset: 100, maxScroll: 250, direction: 1 }), 100);
  assert.equal(snappedGridScrollOffset({ metrics: metrics.columns, offset: 100, maxScroll: 250, direction: -1 }), 100);
  assert.equal(snappedGridScrollOffset({ metrics: metrics.columns, offset: 250, maxScroll: 250, direction: 1 }), 250);
  assert.equal(normalizeGridScrollMode("invalid"), "pixel");
  assert.equal(normalizeGridScrollMode(GRID_SCROLL_MODE_CELL), GRID_SCROLL_MODE_CELL);
});

test("cell scrolling normalizes partial offsets in both axes", () => {
  const grid = {
    host: { scrollLeft: 30, scrollTop: 13, clientWidth: 200, clientHeight: 150 },
    rowHeaderWidth: 40,
    headerHeight: 24,
    frozenColumnWidth: () => 0,
    frozenRowHeight: () => 0,
    scrollableColumnWidth: () => 400,
    scrollableRowsHeight: () => 400,
    gridMetrics: () => ({
      columns: { total: 400, simpleSize: 80, prefix: null },
      rows: { total: 400, simpleSize: 25, prefix: null }
    })
  };
  assert.deepEqual(normalizeCellGridScrollOffsets(grid), { scrollLeft: 0, scrollTop: 25 });
  CanvasGrid.prototype.scrollToOffsets.call(grid, { scrollLeft: 113, scrollTop: 63 });
  assert.deepEqual([grid.host.scrollLeft, grid.host.scrollTop], [113, 63]);
});

test("cell scrolling preserves non-boundary maxima and returns to prior column and row boundaries", () => {
  const grid = {
    host: { scrollLeft: 0, scrollTop: 0, clientWidth: 200, clientHeight: 150 },
    rowHeaderWidth: 40,
    headerHeight: 24,
    frozenColumnWidth: () => 0,
    frozenRowHeight: () => 0,
    scrollableColumnWidth: () => 500,
    scrollableRowsHeight: () => 400,
    gridMetrics: () => ({
      columns: { total: 500, simpleSize: null, prefix: [0, 75, 175, 300, 500] },
      rows: { total: 400, simpleSize: 25, prefix: null }
    })
  };
  // Native maxima: 40 + 500 - 200 = 340, and 24 + 400 - 150 = 274.
  grid.host.scrollLeft = 340;
  grid.host.scrollTop = 274;
  assert.deepEqual(normalizeCellGridScrollOffsets(grid), { scrollLeft: 340, scrollTop: 274 });
  grid.host.scrollLeft = 339;
  grid.host.scrollTop = 273;
  assert.deepEqual(normalizeCellGridScrollOffsets(grid), { scrollLeft: 300, scrollTop: 250 });
});

test("cell normalization keeps monotonic variable-width and variable-height thumb drags monotonic", () => {
  const grid = {
    host: { scrollLeft: 0, scrollTop: 0, clientWidth: 100, clientHeight: 100 },
    rowHeaderWidth: 0, headerHeight: 0,
    frozenColumnWidth: () => 0, frozenRowHeight: () => 0,
    scrollableColumnWidth: () => 400, scrollableRowsHeight: () => 400,
    gridMetrics: () => ({
      columns: { total: 400, simpleSize: null, prefix: [0, 50, 130, 240, 400] },
      rows: { total: 400, simpleSize: null, prefix: [0, 30, 100, 190, 400] }
    })
  };
  const normalizeAndApply = () => {
    const next = normalizeCellGridScrollOffsets(grid);
    Object.assign(grid.host, next);
    return next;
  };
  const horizontal = [], vertical = [];
  for (const raw of [20, 60, 70, 90, 110]) {
    grid.host.scrollLeft = raw;
    horizontal.push(normalizeAndApply().scrollLeft);
  }
  for (const raw of [12, 40, 55, 75, 95]) {
    grid.host.scrollTop = raw;
    vertical.push(normalizeAndApply().scrollTop);
  }
  assert.deepEqual(horizontal, [0, 130, 130, 130, 130]);
  assert.deepEqual(vertical, [30, 100, 100, 100, 100]);
  grid.host.scrollLeft = 90;
  grid.host.scrollTop = 75;
  assert.deepEqual(normalizeAndApply(), { scrollLeft: 50, scrollTop: 30 });
});

test("cell normalization keeps raw direction history independent for each axis", () => {
  const grid = {
    host: { scrollLeft: 0, scrollTop: 0, clientWidth: 100, clientHeight: 100 },
    rowHeaderWidth: 0, headerHeight: 0,
    frozenColumnWidth: () => 0, frozenRowHeight: () => 0,
    scrollableColumnWidth: () => 400, scrollableRowsHeight: () => 400,
    gridMetrics: () => ({
      columns: { total: 400, simpleSize: null, prefix: [0, 50, 130, 240, 400] },
      rows: { total: 400, simpleSize: null, prefix: [0, 30, 100, 190, 400] }
    })
  };
  const normalizeAndApply = () => {
    const next = normalizeCellGridScrollOffsets(grid);
    Object.assign(grid.host, next);
    return next;
  };

  normalizeAndApply();
  grid.host.scrollTop = 40;
  assert.equal(normalizeAndApply().scrollTop, 100);
  assert.equal(grid._lastRawCellScrollOffset.scrollTop, 40);
  grid.host.scrollLeft = 60;
  assert.equal(normalizeAndApply().scrollLeft, 130);
  assert.equal(grid._lastRawCellScrollOffset.scrollTop, 40);
  grid.host.scrollTop = 55;
  assert.equal(normalizeAndApply().scrollTop, 100);

  const horizontalGrid = { ...grid, host: { scrollLeft: 0, scrollTop: 0, clientWidth: 100, clientHeight: 100 } };
  const normalizeHorizontal = () => {
    const next = normalizeCellGridScrollOffsets(horizontalGrid);
    Object.assign(horizontalGrid.host, next);
    return next;
  };
  normalizeHorizontal();
  horizontalGrid.host.scrollLeft = 40;
  assert.equal(normalizeHorizontal().scrollLeft, 50);
  horizontalGrid.host.scrollTop = 40;
  assert.equal(normalizeHorizontal().scrollTop, 100);
  horizontalGrid.host.scrollLeft = 55;
  assert.equal(normalizeHorizontal().scrollLeft, 130);

  const diagonalGrid = {
    ...grid,
    host: { scrollLeft: 0, scrollTop: 0, clientWidth: 100, clientHeight: 100 },
    _lastRawCellScrollOffset: null,
    _lastCellScrollOffset: null
  };
  const normalizeDiagonal = () => {
    const next = normalizeCellGridScrollOffsets(diagonalGrid);
    Object.assign(diagonalGrid.host, next);
    return next;
  };
  normalizeDiagonal();
  const diagonal = [];
  for (const [left, top] of [[20, 12], [60, 40], [90, 75]]) {
    diagonalGrid.host.scrollLeft = left;
    diagonalGrid.host.scrollTop = top;
    diagonal.push(normalizeDiagonal());
  }
  assert.deepEqual(diagonal, [
    { scrollLeft: 50, scrollTop: 30 },
    { scrollLeft: 130, scrollTop: 100 },
    { scrollLeft: 130, scrollTop: 100 }
  ]);
  diagonalGrid.host.scrollLeft = 70;
  assert.deepEqual(normalizeDiagonal(), { scrollLeft: 50, scrollTop: 100 });

  const rawBeforeEcho = { ...diagonalGrid._lastRawCellScrollOffset };
  diagonalGrid._cellScrollEcho = { scrollLeft: diagonalGrid.host.scrollLeft, scrollTop: diagonalGrid.host.scrollTop };
  assert.equal(consumeCellGridScrollEcho(diagonalGrid), true);
  assert.deepEqual(diagonalGrid._lastRawCellScrollOffset, rawBeforeEcho);
});

test("active scrollbar thumb drags retain physical offsets while the grid uses snapped logical offsets", () => {
  const makeGrid = () => {
    const writes = [], notifications = [];
    const host = {
      _left: 0, _top: 0, clientWidth: 100, clientHeight: 100, scrollWidth: 400, scrollHeight: 400,
      get scrollLeft() { return this._left; },
      set scrollLeft(value) { writes.push(["left", value]); this._left = value; },
      get scrollTop() { return this._top; },
      set scrollTop(value) { writes.push(["top", value]); this._top = value; },
      getBoundingClientRect: () => ({ left: 0, top: 0 })
    };
    const grid = {
      host, doc: {}, scrollMode: GRID_SCROLL_MODE_CELL,
      rowHeaderWidth: 0, headerHeight: 0,
      frozenColumnWidth: () => 0, frozenRowHeight: () => 0,
      scrollableColumnWidth: () => 400, scrollableRowsHeight: () => 400,
      gridMetrics: () => ({
        columns: { total: 400, simpleSize: null, prefix: [0, 50, 130, 240, 400] },
        rows: { total: 400, simpleSize: null, prefix: [0, 30, 100, 190, 400] }
      }),
      clearHoverState() {},
      requestRender: () => { notifications.push("render"); },
      onViewportChanged: () => { notifications.push("viewport"); },
      draw: () => { notifications.push("draw"); },
      scrollbarAxesForEvent: CanvasGrid.prototype.scrollbarAxesForEvent,
      isScrollbarEvent: CanvasGrid.prototype.isScrollbarEvent
    };
    Object.defineProperties(grid, {
      scrollLeft: { get: () => CanvasGrid.prototype.__lookupGetter__("scrollLeft").call(grid) },
      scrollTop: { get: () => CanvasGrid.prototype.__lookupGetter__("scrollTop").call(grid) }
    });
    return { grid, host, writes, notifications };
  };

  const { grid, host, writes, notifications } = makeGrid();
  CanvasGrid.prototype.onMouseDown.call(grid, { button: 0, clientX: 50, clientY: 100 });
  assert.deepEqual(grid._cellScrollThumbDrag, { horizontal: true, vertical: false });
  const logical = [];
  for (const raw of [20, 60, 90, 300, 299, 70]) {
    host._left = raw;
    CanvasGrid.prototype.onHostScroll.call(grid);
    logical.push(grid.scrollLeft);
  }
  assert.deepEqual(logical, [0, 130, 130, 300, 240, 50]);
  assert.equal(host.scrollLeft, 70);
  assert.deepEqual(writes, []);
  assert.equal(grid.doc.scrollLeft, 50);
  assert.equal(grid.doc.scrollTop, 0);
  assert.equal(grid._lastRawCellScrollOffset.scrollTop, 0);
  assert.equal(notifications.filter((value) => value === "viewport").length, 5);

  const physicalBeforeRelease = host.scrollLeft;
  CanvasGrid.prototype.onMouseUp.call(grid);
  assert.equal(physicalBeforeRelease, host.scrollLeft);
  assert.equal(grid._cellScrollThumbDrag, null);
  assert.equal(notifications.filter((value) => value === "draw").length, 1);
});

test("changing thumb axes after release preserves the retained physical/logical divergence", () => {
  const makeGrid = () => {
    const writes = [];
    const host = {
      _left: 0, _top: 0, clientWidth: 100, clientHeight: 100,
      get scrollLeft() { return this._left; }, set scrollLeft(value) { writes.push(["left", value]); this._left = value; },
      get scrollTop() { return this._top; }, set scrollTop(value) { writes.push(["top", value]); this._top = value; }
    };
    const grid = {
      host, doc: {}, scrollMode: GRID_SCROLL_MODE_CELL, resizing: null,
      rowHeaderWidth: 0, headerHeight: 0, frozenColumnWidth: () => 0, frozenRowHeight: () => 0,
      scrollableColumnWidth: () => 400, scrollableRowsHeight: () => 400,
      gridMetrics: () => ({
        columns: { total: 400, simpleSize: null, prefix: [0, 50, 130, 240, 400] },
        rows: { total: 400, simpleSize: null, prefix: [0, 30, 100, 190, 400] }
      }),
      clearHoverState() {}, requestRender() {}, onViewportChanged() {}, draw() {}
    };
    Object.defineProperties(grid, {
      scrollLeft: { get: () => CanvasGrid.prototype.__lookupGetter__("scrollLeft").call(grid) },
      scrollTop: { get: () => CanvasGrid.prototype.__lookupGetter__("scrollTop").call(grid) }
    });
    setCellGridScrollBaseline(grid, host);
    return { grid, host, writes };
  };

  const { grid, host, writes } = makeGrid();
  grid._cellScrollThumbDrag = { horizontal: true, vertical: false };
  host._left = 60;
  CanvasGrid.prototype.onHostScroll.call(grid);
  assert.deepEqual([host.scrollLeft, grid.scrollLeft, grid.doc.scrollLeft], [60, 130, 130]);
  CanvasGrid.prototype.onMouseUp.call(grid);
  writes.length = 0;
  grid._cellScrollThumbDrag = { horizontal: false, vertical: true };
  host._top = 40;
  CanvasGrid.prototype.onHostScroll.call(grid);
  assert.deepEqual([host.scrollLeft, grid.scrollLeft, grid.doc.scrollLeft], [60, 130, 130]);
  assert.deepEqual(grid._cellScrollChangedAxes, { scrollLeft: false, scrollTop: true });
  assert.equal(writes.some(([axis]) => axis === "left"), false);
  host._top = 55;
  CanvasGrid.prototype.onHostScroll.call(grid);
  assert.equal(grid.scrollTop, 100);

  const reverse = makeGrid();
  reverse.grid._cellScrollThumbDrag = { horizontal: false, vertical: true };
  reverse.host._top = 40;
  CanvasGrid.prototype.onHostScroll.call(reverse.grid);
  CanvasGrid.prototype.onMouseUp.call(reverse.grid);
  reverse.writes.length = 0;
  reverse.grid._cellScrollThumbDrag = { horizontal: true, vertical: false };
  reverse.host._left = 60;
  CanvasGrid.prototype.onHostScroll.call(reverse.grid);
  assert.deepEqual([reverse.host.scrollTop, reverse.grid.scrollTop, reverse.grid.doc.scrollTop], [40, 100, 100]);
  assert.deepEqual(reverse.grid._cellScrollChangedAxes, { scrollLeft: true, scrollTop: false });
  assert.equal(reverse.writes.some(([axis]) => axis === "top"), false);

  const diagonal = makeGrid();
  diagonal.host._left = 60;
  diagonal.host._top = 40;
  CanvasGrid.prototype.onHostScroll.call(diagonal.grid);
  assert.deepEqual(diagonal.grid._cellScrollChangedAxes, { scrollLeft: true, scrollTop: true });
});

test("vertical thumb drags are independent and non-thumb cell scrolling still writes snapped positions", () => {
  const host = {
    _left: 0, _top: 0, clientWidth: 100, clientHeight: 100,
    get scrollLeft() { return this._left; }, set scrollLeft(value) { this._left = value; },
    get scrollTop() { return this._top; }, set scrollTop(value) { this._top = value; }
  };
  const grid = {
    host, doc: {}, scrollMode: GRID_SCROLL_MODE_CELL,
    rowHeaderWidth: 0, headerHeight: 0,
    frozenColumnWidth: () => 0, frozenRowHeight: () => 0,
    scrollableColumnWidth: () => 400, scrollableRowsHeight: () => 400,
    gridMetrics: () => ({
      columns: { total: 400, simpleSize: null, prefix: [0, 50, 130, 240, 400] },
      rows: { total: 400, simpleSize: null, prefix: [0, 30, 100, 190, 400] }
    }),
    clearHoverState() {}, requestRender() {}, onViewportChanged() {}
  };
  Object.defineProperties(grid, {
    scrollLeft: { get: () => CanvasGrid.prototype.__lookupGetter__("scrollLeft").call(grid) },
    scrollTop: { get: () => CanvasGrid.prototype.__lookupGetter__("scrollTop").call(grid) }
  });
  grid._cellScrollThumbDrag = { horizontal: false, vertical: true };
  const vertical = [];
  for (const raw of [12, 40, 75, 300, 299, 55]) {
    host._top = raw;
    CanvasGrid.prototype.onHostScroll.call(grid);
    vertical.push(grid.scrollTop);
  }
  assert.deepEqual(vertical, [0, 100, 100, 300, 190, 30]);
  assert.equal(host.scrollTop, 55);
  assert.equal(host.scrollLeft, 0);
  assert.equal(grid._lastRawCellScrollOffset.scrollLeft, 0);

  grid._cellScrollThumbDrag = null;
  host._left = 40;
  CanvasGrid.prototype.onHostScroll.call(grid);
  assert.equal(host.scrollLeft, 50);
  assert.equal(grid.scrollLeft, 50);
});

test("manual single-axis scrolling preserves the other logical viewport after programmatic navigation", () => {
  const writes = [];
  const host = {
    _left: 217, _top: 145, clientWidth: 100, clientHeight: 100,
    get scrollLeft() { return this._left; }, set scrollLeft(value) { writes.push(["left", value]); this._left = value; },
    get scrollTop() { return this._top; }, set scrollTop(value) { writes.push(["top", value]); this._top = value; }
  };
  const grid = {
    host, doc: { scrollLeft: 217, scrollTop: 145 }, scrollMode: GRID_SCROLL_MODE_CELL,
    rowHeaderWidth: 0, headerHeight: 0, selection: { focus: { row: 686, column: 107 } },
    frozenColumnWidth: () => 0, frozenRowHeight: () => 0,
    scrollableColumnWidth: () => 400, scrollableRowsHeight: () => 400,
    gridMetrics: () => ({
      columns: { total: 400, simpleSize: null, prefix: [0, 80, 180, 280, 400] },
      rows: { total: 400, simpleSize: null, prefix: [0, 50, 140, 250, 400] }
    }),
    clearHoverState() {}, requestRender() {}, onViewportChanged() {}
  };
  Object.defineProperties(grid, {
    scrollLeft: { get: () => CanvasGrid.prototype.__lookupGetter__("scrollLeft").call(grid) },
    scrollTop: { get: () => CanvasGrid.prototype.__lookupGetter__("scrollTop").call(grid) }
  });
  setCellGridScrollBaseline(grid, host);
  for (const raw of [230, 260]) {
    host._left = raw;
    CanvasGrid.prototype.onHostScroll.call(grid);
    assert.equal(host.scrollTop, 145);
    assert.equal(grid.scrollTop, 145);
    assert.equal(grid.doc.scrollTop, 145);
    assert.deepEqual(grid.selection.focus, { row: 686, column: 107 });
  }
  assert.equal(writes.some(([axis]) => axis === "top"), false);

  writes.length = 0;
  setCellGridScrollBaseline(grid, host);
  for (const raw of [160, 190]) {
    host._top = raw;
    CanvasGrid.prototype.onHostScroll.call(grid);
    assert.equal(host.scrollLeft, grid._lastCellScrollOffset.scrollLeft);
    assert.equal(grid.doc.scrollLeft, grid.scrollLeft);
  }
  assert.equal(writes.some(([axis]) => axis === "left"), false);
});

test("grid explicit scroll shortcuts clamp to table bounds", () => {
  const grid = {
    host: {
      scrollLeft: 40,
      scrollTop: 300,
      clientWidth: 300,
      clientHeight: 200
    },
    rowHeaderWidth: 40,
    headerHeight: 24,
    frozenColumnWidth: () => 10,
    frozenRowHeight: () => 20,
    scrollableColumnWidth: () => 900,
    scrollableRowsHeight: () => 800,
    scrollToOffsets: CanvasGrid.prototype.scrollToOffsets,
    gridPageHeight: CanvasGrid.prototype.gridPageHeight,
    scrollToTop: CanvasGrid.prototype.scrollToTop,
    scrollToBottom: CanvasGrid.prototype.scrollToBottom,
    scrollToLeft: CanvasGrid.prototype.scrollToLeft,
    scrollToRight: CanvasGrid.prototype.scrollToRight,
    scrollPageUp: CanvasGrid.prototype.scrollPageUp,
    scrollPageDown: CanvasGrid.prototype.scrollPageDown
  };

  grid.scrollToTop();
  assert.equal(grid.host.scrollTop, 0);
  assert.equal(grid.host.scrollLeft, 40);

  grid.scrollToBottom();
  assert.equal(grid.host.scrollTop, 644);

  grid.scrollToLeft();
  assert.equal(grid.host.scrollLeft, 0);
  assert.equal(grid.host.scrollTop, 644);

  grid.scrollToRight();
  assert.equal(grid.host.scrollLeft, 650);

  grid.host.scrollTop = 300;
  grid.scrollPageUp();
  assert.equal(grid.host.scrollTop, 144);

  grid.scrollPageDown();
  assert.equal(grid.host.scrollTop, 300);

  grid.scrollPageDown();
  grid.scrollPageDown();
  grid.scrollPageDown();
  assert.equal(grid.host.scrollTop, 644);
});

test("wheel zoom reports a user action without changing another document", () => {
  const active = { zoom: 1 };
  const other = { zoom: 1.7 };
  const remembered = [];
  let layouts = 0;

  CanvasGrid.prototype.setZoom.call({
    doc: active,
    layout: () => { layouts += 1; },
    onZoomChanged: (zoom) => remembered.push(zoom)
  }, 1.3, { userAction: true });

  assert.equal(active.zoom, 1.3);
  assert.equal(other.zoom, 1.7);
  assert.equal(layouts, 1);
  assert.deepEqual(remembered, [1.3]);
});

test("grid wheel scrolling supports pixel, line, and shifted horizontal input", () => {
  const grid = {
    host: {
      scrollLeft: 40,
      scrollTop: 300,
      clientWidth: 300,
      clientHeight: 200
    },
    rowHeight: 26,
    rowHeaderWidth: 40,
    headerHeight: 24,
    frozenColumnWidth: () => 10,
    frozenRowHeight: () => 20,
    scrollableColumnWidth: () => 900,
    scrollableRowsHeight: () => 800,
    scrollToOffsets: CanvasGrid.prototype.scrollToOffsets,
    gridPageHeight: CanvasGrid.prototype.gridPageHeight,
    scrollByWheel: CanvasGrid.prototype.scrollByWheel
  };

  grid.scrollByWheel({ deltaX: 5, deltaY: 20 });
  assert.equal(grid.host.scrollLeft, 45);
  assert.equal(grid.host.scrollTop, 320);

  grid.scrollByWheel({ deltaY: 2, deltaMode: 1 });
  assert.equal(grid.host.scrollTop, 372);

  grid.scrollByWheel({ deltaY: 10, shiftKey: true });
  assert.equal(grid.host.scrollLeft, 55);
  assert.equal(grid.host.scrollTop, 372);
});

test("cell-mode programmatic wheel helper keeps raw offsets until the scroll event normalizes them", () => {
  const grid = {
    scrollMode: GRID_SCROLL_MODE_CELL,
    host: { scrollLeft: 30, scrollTop: 10, clientWidth: 300, clientHeight: 200 },
    rowHeight: 26,
    rowHeaderWidth: 40,
    headerHeight: 24,
    frozenColumnWidth: () => 10,
    frozenRowHeight: () => 20,
    scrollableColumnWidth: () => 900,
    scrollableRowsHeight: () => 800,
    gridMetrics: () => ({
      columns: { total: 900, simpleSize: 80, prefix: null },
      rows: { total: 800, simpleSize: 25, prefix: null }
    }),
    scrollToOffsets: CanvasGrid.prototype.scrollToOffsets,
    gridPageHeight: CanvasGrid.prototype.gridPageHeight,
    scrollByWheel: CanvasGrid.prototype.scrollByWheel
  };
  grid.scrollByWheel({ deltaY: 2, deltaMode: 1 });
  assert.equal(grid.host.scrollTop, 62);
  grid.scrollByWheel({ deltaY: -1, deltaMode: 1, shiftKey: true });
  assert.equal(grid.host.scrollLeft, 4);
  grid.scrollByWheel({ deltaY: 7 });
  assert.equal(grid.host.scrollTop, 69);
});

test("centered cell scrolling can preserve the unrelated search axis", () => {
  const grid = {
    host: { scrollLeft: 40, scrollTop: 300, clientWidth: 300, clientHeight: 200 },
    doc: { freezeFirstRow: false, freezeFirstColumn: false },
    rowHeaderWidth: 40,
    headerHeight: 24,
    frozenColumnWidth: () => 0,
    frozenRowHeight: () => 0,
    columnContentLeft: () => 600,
    rowContentTop: () => 900,
    scaledColumnWidth: () => 80,
    scaledRowHeight: () => 26,
    scrollableColumnWidth: () => 1200,
    scrollableRowsHeight: () => 1600
  };

  CanvasGrid.prototype.scrollCellToCenter.call(grid, 20, 8, { preserveScrollTop: true });
  assert.equal(grid.host.scrollLeft, 510);
  assert.equal(grid.host.scrollTop, 300);

  grid.host.scrollLeft = 40;
  CanvasGrid.prototype.scrollCellToCenter.call(grid, 20, 8, { preserveScrollLeft: true });
  assert.equal(grid.host.scrollLeft, 40);
  assert.equal(grid.host.scrollTop, 825);
});

test("selected row and column index handles use neutral pressed styling", () => {
  const selectedRowHandle = indexHandleRenderState({ selected: true, active: true });
  const selectedColumnHandle = indexHandleRenderState({ selected: true, active: true });
  const activeRowHandle = indexHandleRenderState({ selected: false, active: true });
  const activeColumnHandle = indexHandleRenderState({ selected: false, active: true });
  assert.equal(selectedRowHandle.fill, "indexHeaderPressed");
  assert.equal(selectedColumnHandle.fill, "indexHeaderPressed");
  assert.equal(activeRowHandle.fill, "indexHeaderPressed");
  assert.equal(activeColumnHandle.fill, "indexHeaderPressed");
  assert.notEqual(selectedRowHandle.fill, "selection");
  assert.notEqual(selectedColumnHandle.fill, "selectionFrozen");
  assert.notEqual(activeRowHandle.fill, "selection");
  assert.notEqual(activeColumnHandle.fill, "selectionFrozen");
  assert.equal(selectedRowHandle.pressed, true);
  assert.equal(selectedColumnHandle.pressed, true);
  assert.equal(activeRowHandle.text, "indexHeaderActiveText");
  assert.equal(activeColumnHandle.text, "indexHeaderActiveText");
  assert.equal(activeRowHandle.pressed, true);
  assert.equal(activeColumnHandle.pressed, true);
  assert.deepEqual(indexHandleChromeSteps({ x: 10, y: 20, width: 40, height: 24, pressed: false }), []);
  assert.deepEqual(indexHandleChromeSteps({ x: 10, y: 20, width: 40, height: 24, pressed: true }), [
    { kind: "fillRect", color: "indexHeaderSheen", x: 12, y: 22, width: 36, height: 7 },
    { kind: "strokePath", color: "indexHeaderShadow", points: [[11.5, 42.5], [11.5, 21.5], [47.5, 21.5]] },
    { kind: "strokePath", color: "indexHeaderHighlight", points: [[11.5, 42.5], [48.5, 42.5], [48.5, 21.5]] }
  ]);
});

test("single-cell focus presses row and column index handles without selection fill", () => {
  const selection = {
    focus: { row: 1, column: 2 },
    hasFullColumn: () => false
  };
  const rowHandle = indexHandleRenderState({
    selected: false,
    active: rowHeaderRenderState(selection, 1).activeHeader
  });
  const columnState = columnIndexRenderState({
    selection,
    column: 2,
    rowCount: 5
  });
  const columnHandle = indexHandleRenderState({
    selected: columnState.selected,
    active: columnState.activeHeader
  });

  assert.deepEqual(rowHandle, {
    fill: "indexHeaderPressed",
    text: "indexHeaderActiveText",
    stroke: "grid",
    pressed: true
  });
  assert.deepEqual(columnHandle, {
    fill: "indexHeaderPressed",
    text: "indexHeaderActiveText",
    stroke: "grid",
    pressed: true
  });
});

test("active-cell and direct index selections share the same neutral handle visual state", () => {
  const activeRowHandle = indexHandleRenderState({ selected: false, active: true });
  const selectedRowHandle = indexHandleRenderState({ selected: true, active: true });
  const activeColumnHandle = indexHandleRenderState({ selected: false, active: true });
  const selectedColumnHandle = indexHandleRenderState({ selected: true, active: true });

  assert.deepEqual(activeRowHandle, selectedRowHandle);
  assert.deepEqual(activeColumnHandle, selectedColumnHandle);
  assert.equal(activeRowHandle.fill, "indexHeaderPressed");
  assert.equal(activeColumnHandle.fill, "indexHeaderPressed");
  assert.equal(activeRowHandle.pressed, true);
  assert.equal(activeColumnHandle.pressed, true);
});

test("corner index handle uses the normal neutral surface unless selected", () => {
  const fillRects = [];
  let fillStyle = "";
  let strokeStyle = "";
  const ctx = {
    set fillStyle(value) {
      fillStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set strokeStyle(value) {
      strokeStyle = value;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    fillRect: (x, y, width, height) => fillRects.push({ fillStyle, x, y, width, height }),
    strokeRect() {}
  };
  const grid = {
    ctx,
    rowHeaderWidth: 48,
    headerHeight: 24,
    selection: {
      hasFullRow: () => false,
      hasFullColumn: () => false
    },
    doc: {
      columnCount: 4,
      rowCount: 6
    }
  };

  drawGridCornerHeader(grid);
  assert.equal(fillRects[0].fillStyle, gridColor("indexHeader"));
  assert.notEqual(fillRects[0].fillStyle, gridColor("indexHeaderFrozen"));
});

test("column index labels use normal text weight", () => {
  const fonts = [];
  const texts = [];
  let font = "";
  const ctx = {
    set fillStyle(_value) {},
    get fillStyle() {
      return "";
    },
    set strokeStyle(_value) {},
    get strokeStyle() {
      return "";
    },
    set font(value) {
      font = value;
      fonts.push(value);
    },
    get font() {
      return font;
    },
    fillRect() {},
    strokeRect() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    measureText: (value) => ({ width: String(value).length * 7 }),
    fillText: (text) => texts.push(text)
  };
  const grid = {
    ctx,
    headerHeight: 24,
    font: (weight) => `${weight} 12px sans-serif`,
    selection: {
      focus: { row: 2, column: 1 },
      hasFullColumn: () => false
    },
    doc: {
      rowCount: 6
    }
  };

  drawGridColumnHeader(grid, 1, 48, 80);
  assert.equal(fonts.at(-1), "400 12px sans-serif");
  assert.deepEqual(texts, ["B"]);
});

test("selected cells use dedicated grid separator colors", () => {
  const colors = {
    grid: "ordinary-grid-line",
    selectionGridLine: "selected-grid-line",
    selectionGridLineFrozen: "selected-frozen-grid-line"
  };

  assert.equal(cellGridLineColor({}, colors), "ordinary-grid-line");
  assert.equal(cellGridLineColor({ frozen: true }, colors), "ordinary-grid-line");
  assert.equal(cellGridLineColor({ selected: true }, colors), "selected-grid-line");
  assert.equal(
    cellGridLineColor({ selected: true, frozen: true }, colors),
    "selected-frozen-grid-line"
  );
});

test("diagnostic text overlay policy plans active hovered and current-problem precise markers only", () => {
  const measureText = (value) => String(value).length * 7;
  const rangeDiagnostic = {
    severity: "error",
    hasPreciseRange: true,
    localStart: 2,
    localEnd: 4
  };
  const activePlan = diagnosticTextOverlayPlan({
    diagnostics: [rangeDiagnostic],
    value: "abcdefg",
    active: true,
    textX: 100,
    cellY: 20,
    cellHeight: 26,
    maxWidth: 80,
    measureText
  });
  assert.deepEqual(activePlan, {
    kind: "range",
    severity: "error",
    color: "diagnosticRangeError",
    x: 114,
    y: 40,
    width: 14,
    lineWidth: 2
  });
  assert.equal(diagnosticTextOverlayPlan({
    diagnostics: [rangeDiagnostic],
    value: "abcdef",
    textX: 100,
    cellY: 20,
    cellHeight: 26,
    maxWidth: 80,
    measureText
  }), null);
  assert.equal(diagnosticTextOverlayPlan({
    diagnostics: [{ ...rangeDiagnostic, hasPreciseRange: false }],
    value: "abcdef",
    active: true,
    textX: 100,
    cellY: 20,
    cellHeight: 26,
    maxWidth: 80,
    measureText
  }), null);
  assert.equal(diagnosticTextOverlayPlan({
    diagnostics: [rangeDiagnostic],
    value: "abcdef",
    hovered: true,
    textX: 100,
    cellY: 20,
    cellHeight: 26,
    maxWidth: 80,
    measureText
  })?.kind, "range");
  assert.equal(diagnosticTextOverlayPlan({
    diagnostics: [rangeDiagnostic],
    value: "abcdef",
    currentProblem: true,
    textX: 100,
    cellY: 20,
    cellHeight: 26,
    maxWidth: 80,
    measureText
  })?.kind, "range");
});

test("diagnostic text overlay policy handles insertion points and clipped text", () => {
  const measureText = (value) => String(value).length * 7;
  assert.deepEqual(cellTextRenderPlan({
    text: "abcdefg",
    maxWidth: 42,
    measureText
  }), {
    text: "abc...",
    sourceLength: 3,
    clipped: true
  });
  assert.deepEqual(diagnosticTextOverlayPlan({
    diagnostics: [{
      severity: "warning",
      hasPreciseRange: true,
      isInsertionPoint: true,
      localStart: 3,
      localEnd: 3,
      localInsertionPoint: 3
    }],
    value: "abcdefg",
    active: true,
    textX: 10,
    cellY: 30,
    cellHeight: 24,
    maxWidth: 100,
    measureText
  }), {
    kind: "insertion",
    severity: "warning",
    color: "diagnosticInsertionCaretWarning",
    x: 31,
    top: 35,
    bottom: 49,
    lineWidth: 2
  });
  assert.equal(diagnosticTextOverlayPlan({
    diagnostics: [{
      severity: "error",
      hasPreciseRange: true,
      localStart: 4,
      localEnd: 5
    }],
    value: "abcdefg",
    active: true,
    textX: 10,
    cellY: 30,
    cellHeight: 24,
    maxWidth: 42,
    measureText
  }), null);
  assert.equal(diagnosticTextOverlayPlan({
    diagnostics: [{
      severity: "error",
      hasPreciseRange: true,
      isInsertionPoint: true,
      localStart: 3,
      localEnd: 3,
      localInsertionPoint: 3
    }],
    value: "abcdefg",
    active: true,
    textX: 10,
    cellY: 30,
    cellHeight: 24,
    maxWidth: 42,
    measureText
  }), null);
  assert.deepEqual(diagnosticTextOverlayPlan({
    diagnostics: [{
      severity: "error",
      hasPreciseRange: true,
      isInsertionPoint: true,
      localStart: 3,
      localEnd: 3,
      localInsertionPoint: 3
    }],
    value: "abcdefg",
    active: true,
    textX: 10,
    cellY: 30,
    cellHeight: 24,
    maxWidth: 49,
    measureText
  }), {
    kind: "insertion",
    severity: "error",
    color: "diagnosticInsertionCaretError",
    x: 31,
    top: 35,
    bottom: 49,
    lineWidth: 2
  });
});

test("diagnostic corner marker remains separate from precise text overlay", () => {
  assert.equal(diagnosticMarkerState([], { x: 10, y: 20, width: 40, height: 26 }), null);
  assert.deepEqual(diagnosticMarkerState([{ severity: "warning", hasPreciseRange: true }], { x: 10, y: 20, width: 40, height: 26 }), {
    severity: "warning",
    color: "#cca700",
    points: [[40, 45], [49, 45], [49, 36]]
  });
});

test("active cell renderer draws precise diagnostic overlay before active border", () => {
  const operations = [];
  let fillStyle = "";
  let strokeStyle = "";
  let lineWidth = 1;
  let path = [];
  const ctx = {
    set fillStyle(value) {
      fillStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set strokeStyle(value) {
      strokeStyle = value;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set lineWidth(value) {
      lineWidth = value;
    },
    get lineWidth() {
      return lineWidth;
    },
    fillRect: (x, y, width, height) => operations.push({ kind: "fillRect", fillStyle, x, y, width, height }),
    strokeRect: (x, y, width, height) => operations.push({ kind: "strokeRect", strokeStyle, lineWidth, x, y, width, height }),
    save: () => operations.push({ kind: "save" }),
    restore: () => operations.push({ kind: "restore" }),
    rect: (x, y, width, height) => operations.push({ kind: "rect", x, y, width, height }),
    clip: () => operations.push({ kind: "clip" }),
    beginPath: () => {
      path = [];
      operations.push({ kind: "beginPath" });
    },
    moveTo: (x, y) => path.push(["M", x, y]),
    lineTo: (x, y) => path.push(["L", x, y]),
    stroke: () => operations.push({ kind: "stroke", strokeStyle, lineWidth, path }),
    measureText: (value) => ({ width: String(value).length * 7 }),
    fillText: (text, x, y) => operations.push({ kind: "text", text, x, y })
  };
  const grid = {
    ctx,
    rowHeaderWidth: 48,
    colorizeColumns: false,
    selection: {
      focus: { row: 2, column: 1 },
      contains: () => false
    },
    doc: {
      columnCount: 3,
      getCell: () => "abcdef"
    },
    diagnosticsByCell: new Map([["2:1", [{
      severity: "error",
      hasPreciseRange: true,
      localStart: 1,
      localEnd: 3
    }]]]),
    font: () => "12px sans-serif",
    editingCell: () => null,
    fillText: (...args) => operations.push({ kind: "gridText", args }),
    drawDiagnosticMarker: () => operations.push({ kind: "cornerMarker" })
  };

  CanvasGrid.prototype.drawCell.call(grid, 2, 1, 100, 200, 80, 30);

  const overlayStroke = operations.find((operation) => operation.kind === "stroke" && operation.strokeStyle === gridColor("diagnosticRangeError"));
  assert.deepEqual(overlayStroke.path, [["M", 115, 224], ["L", 129, 224]]);
  assert.ok(operations.findIndex((operation) => operation === overlayStroke) < operations.findIndex((operation) => operation.kind === "cornerMarker"));
  assert.ok(operations.findIndex((operation) => operation.kind === "cornerMarker") < operations.findIndex((operation) => operation.kind === "strokeRect" && operation.lineWidth === 2));
});

test("resize handles are detected on cell boundaries, not only headers", () => {
  assert.deepEqual(
    classifyResizeHandle({
      hit: { kind: "cell", row: 4, column: 2, x: 198, y: 122 },
      columnRight: 200,
      rowBottom: 148,
      zoom: 1
    }),
    { kind: "column", index: 2 }
  );
  assert.deepEqual(
    classifyResizeHandle({
      hit: { kind: "cell", row: 4, column: 2, x: 162, y: 147 },
      columnRight: 200,
      rowBottom: 148,
      zoom: 1
    }),
    { kind: "row", index: 4 }
  );
  assert.deepEqual(
    classifyResizeHandle({
      hit: { kind: "row-header", row: 6, column: 0, x: 20, y: 310 },
      columnRight: 72,
      rowBottom: 312,
      zoom: 1
    }),
    { kind: "row", index: 6 }
  );
  assert.equal(
    classifyResizeHandle({
      hit: { kind: "cell", row: 4, column: 2, x: 160, y: 122 },
      columnRight: 200,
      rowBottom: 148,
      zoom: 1
    }),
    null
  );
});

test("column text color cycle is predictable and bounded", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((column) => columnColorIndex(column, 5)), [0, 1, 2, 3, 4, 0, 1, 2, 3, 4]);
  const colors = {
    selectionFrozen: "selectionFrozen",
    selection: "selection",
    frozenHeader: "frozenHeader",
    firstColumnFrozen: "firstColumnFrozen",
    frozen: "frozen",
    header: "header",
    firstColumn: "firstColumn",
    rowOdd: "rowOdd",
    rowEven: "rowEven",
    textSelected: "textSelected",
    textHeader: "textHeader",
    textEmpty: "textEmpty",
    firstColumnText: "firstColumnText",
    columnTextA: "columnTextA",
    columnTextB: "columnTextB",
    columnTextC: "columnTextC",
    columnTextD: "columnTextD",
    columnTextE: "columnTextE",
    text: "text"
  };
  assert.equal(cellBackground(3, true, true, false, colors), "selectionFrozen");
  assert.equal(cellBackground(3, true, false, false, colors), "selection");
  assert.equal(cellBackground(0, false, true, false, colors), "frozenHeader");
  assert.equal(cellBackground(2, false, true, true, colors), "firstColumnFrozen");
  assert.equal(cellBackground(2, false, true, false, colors), "frozen");
  assert.equal(cellBackground(0, false, false, false, colors), "header");
  assert.equal(cellBackground(3, false, false, true, colors), "firstColumn");
  assert.equal(cellBackground(3, false, false, false, colors), "rowOdd");
  assert.equal(cellBackground(4, false, false, false, colors), "rowEven");
  assert.equal(cellTextColor(4, 2, "value", true, true, false, colors), "textSelected");
  assert.equal(cellTextColor(0, 2, "value", false, true, false, colors), "textHeader");
  assert.equal(cellTextColor(4, 2, "  ", false, true, false, colors), "textEmpty");
  assert.equal(cellTextColor(4, 0, "value", false, true, true, colors), "firstColumnText");
  assert.equal(cellTextColor(4, 7, "value", false, true, false, colors), "columnTextC");
  assert.equal(cellTextColor(4, 7, "value", false, false, false, colors), "text");
});

test("selection separator redraw wins after later adjacent cells", () => {
  const colors = {
    grid: "grid"
  };
  assert.equal(cellGridLineColor({ selected: false, frozen: false }, colors), "grid");
  assert.equal(cellGridLineColor({ selected: false, frozen: true }, colors), "grid");
  assert.equal(cellGridLineColor({ selected: true, frozen: false }, colors), "grid");
  assert.equal(cellGridLineColor({ selected: true, frozen: true }, colors), "grid");

  const fillRects = [];
  const strokeRects = [];
  const paths = [];
  let strokeStyle = "";
  let fillStyle = "";
  let currentPath = [];
  const ctx = {
    lineWidth: 1,
    set fillStyle(value) {
      fillStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set strokeStyle(value) {
      strokeStyle = value;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    fillRect: (x, y, width, height) => fillRects.push({ fillStyle, x, y, width, height }),
    strokeRect: (x, y, width, height) => strokeRects.push({ strokeStyle, x, y, width, height }),
    beginPath: () => {
      currentPath = [];
    },
    moveTo: (x, y) => currentPath.push(["M", x, y]),
    lineTo: (x, y) => currentPath.push(["L", x, y]),
    stroke: () => paths.push({ strokeStyle, lineWidth: ctx.lineWidth, path: currentPath }),
    measureText: (value) => ({ width: String(value).length * 7 })
  };
  const grid = {
    ctx,
    rowHeaderWidth: 48,
    colorizeColumns: false,
    selection: {
      focus: { row: 0, column: 0 },
      contains: (row, column) => row === 2 && column === 1
    },
    doc: {
      columnCount: 3,
      getCell: () => "selected"
    },
    font: () => "12px sans-serif",
    editingCell: () => null,
    fillText() {},
    drawDiagnosticMarker() {}
  };
  drawGridCellLayer(grid, [
    { row: 2, top: 200, height: 30 },
    { row: 3, top: 230, height: 30 }
  ], [
    { column: 1, left: 100, width: 80 }
  ]);
  assert.equal(fillRects[0].fillStyle, gridColor("selection"));
  assert.equal(strokeRects[0].strokeStyle, gridColor("selectionGridLine"));
  assert.equal(strokeRects[1].strokeStyle, gridColor("grid"));
  assert.equal(strokeRects[2].strokeStyle, gridColor("selectionGridLine"));
  assert.equal(strokeRects.length, 3);
  assert.equal(paths.length, 0);
});

test("selection separator redraw keeps the active border above diagnostic markers", () => {
  const operations = [];
  let strokeStyle = "";
  let fillStyle = "";
  let lineWidth = 1;
  const ctx = {
    set fillStyle(value) {
      fillStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set strokeStyle(value) {
      strokeStyle = value;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set lineWidth(value) {
      lineWidth = value;
    },
    get lineWidth() {
      return lineWidth;
    },
    fillRect() {},
    strokeRect: (x, y, width, height) => operations.push({
      kind: "strokeRect",
      strokeStyle,
      lineWidth,
      x,
      y,
      width,
      height
    }),
    measureText: (value) => ({ width: String(value).length * 7 })
  };
  const grid = {
    ctx,
    rowHeaderWidth: 48,
    colorizeColumns: false,
    selection: {
      focus: { row: 2, column: 1 },
      contains: (row, column) => row === 2 && (column === 1 || column === 2)
    },
    doc: {
      columnCount: 3,
      getCell: () => "selected"
    },
    font: () => "12px sans-serif",
    editingCell: () => null,
    fillText() {},
    drawDiagnosticMarker: (row, column) => operations.push({ kind: "cornerMarker", row, column })
  };

  drawGridCellLayer(grid, [
    { row: 2, top: 200, height: 30 }
  ], [
    { column: 1, left: 100, width: 80 },
    { column: 2, left: 180, width: 80 }
  ]);

  const activeBorders = operations.filter((operation) => (
    operation.kind === "strokeRect"
    && operation.strokeStyle === gridColor("active")
    && operation.lineWidth === 2
  ));
  assert.equal(activeBorders.length, 2);
  assert.deepEqual(operations.at(-2), { kind: "cornerMarker", row: 2, column: 2 });
  assert.deepEqual(operations.at(-1), {
    kind: "strokeRect",
    strokeStyle: gridColor("active"),
    lineWidth: 2,
    x: 101,
    y: 201,
    width: 78,
    height: 28
  });
});

test("active cell presses row and column indexes without highlighting field-name header cells", () => {
  const selection = { focus: { row: 2, column: 3 } };
  assert.equal(rowHeaderRenderState(selection, 2).activeHeader, true);
  assert.equal(rowHeaderRenderState(selection, 1).activeHeader, false);
  assert.deepEqual(columnIndexRenderState({
    selection: {
      focus: { row: 2, column: 3 },
      hasFullColumn: (column, rowCount) => column === 3 && rowCount === 6
    },
    column: 3,
    rowCount: 6
  }), { selected: true, activeHeader: true });
  assert.deepEqual(indexHandleRenderState({
    selected: false,
    active: rowHeaderRenderState(selection, 2).activeHeader
  }), {
    fill: "indexHeaderPressed",
    text: "indexHeaderActiveText",
    stroke: "grid",
    pressed: true
  });
  assert.deepEqual(indexHandleRenderState({
    selected: false,
    active: columnIndexRenderState({
      selection: {
        ...selection,
        hasFullColumn: () => false
      },
      column: 3,
      rowCount: 6
    }).activeHeader
  }), {
    fill: "indexHeaderPressed",
    text: "indexHeaderActiveText",
    stroke: "grid",
    pressed: true
  });
  assert.equal(columnHeaderRenderState({ selection, row: 0, column: 3, editingThisCell: false }).activeColumnHeader, false);
  assert.equal(columnHeaderRenderState({ selection, row: 0, column: 3, editingThisCell: true }).activeColumnHeader, false);
  assert.equal(columnHeaderRenderState({ selection, row: 1, column: 3, editingThisCell: false }).activeColumnHeader, false);
  assert.equal(columnHeaderRenderState({ selection, row: 0, column: 2, editingThisCell: false }).activeColumnHeader, false);
  assert.equal(columnHeaderRenderState({ selection: { focus: { row: 0, column: 3 } }, row: 0, column: 3, editingThisCell: false }).activeColumnHeader, true);
  const fillRects = [];
  let fillStyle = "";
  let strokeStyle = "";
  let currentPath = [];
  const ctx = {
    set fillStyle(value) {
      fillStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set strokeStyle(value) {
      strokeStyle = value;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    save() {},
    restore() {},
    fillRect: (x, y, width, height) => fillRects.push({ fillStyle, x, y, width, height }),
    strokeRect() {},
    beginPath: () => {
      currentPath = [];
    },
    moveTo: (x, y) => currentPath.push(["M", x, y]),
    lineTo: (x, y) => currentPath.push(["L", x, y]),
    stroke() {},
    measureText: (value) => ({ width: String(value).length * 7 }),
    fillText() {}
  };
  const grid = {
    ctx,
    rowHeaderWidth: 48,
    colorizeColumns: false,
    selection: {
      ...selection,
      hasFullRow: () => false,
      contains: () => false
    },
    doc: {
      columnCount: 5,
      getCell: () => "header"
    },
    font: () => "12px sans-serif",
    editingCell: () => null,
    drawActiveRowHeaderChrome() {},
    drawDiagnosticMarker() {},
    fillText() {}
  };
  CanvasGrid.prototype.drawRowHeader.call(grid, 2, 20, 26);
  CanvasGrid.prototype.drawCell.call(grid, 0, 3, 100, 0, 80, 26);
  assert.equal(fillRects[0].fillStyle, gridColor("indexHeaderPressed"));
  assert.equal(fillRects.at(-1).fillStyle, gridColor("header"));
  assert.notEqual(fillRects.at(-1).fillStyle, gridColor("activeHeader"));
});

test("frozen row and column drawing uses frozen cell tints and restores normal backgrounds", () => {
  const fillRects = [];
  let fillStyle = "";
  const ctx = {
    lineWidth: 1,
    set fillStyle(value) {
      fillStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set strokeStyle(_value) {},
    get strokeStyle() {
      return "";
    },
    fillRect: (x, y, width, height) => fillRects.push({ fillStyle, x, y, width, height }),
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    measureText: (value) => ({ width: String(value).length * 7 })
  };
  const grid = {
    ctx,
    rowHeaderWidth: 48,
    colorizeColumns: false,
    selection: {
      focus: { row: 9, column: 9 },
      contains: () => false
    },
    doc: {
      columnCount: 4,
      getCell: (row, column) => `${row}:${column}`
    },
    font: () => "12px sans-serif",
    editingCell: () => null,
    fillText() {},
    drawDiagnosticMarker() {}
  };

  CanvasGrid.prototype.drawCell.call(grid, 0, 2, 100, 24, 80, 26, { frozenRow: true });
  CanvasGrid.prototype.drawCell.call(grid, 3, 0, 48, 76, 80, 26, { frozenColumn: true });
  CanvasGrid.prototype.drawCell.call(grid, 3, 2, 180, 76, 80, 26, { frozenColumn: true });
  CanvasGrid.prototype.drawCell.call(grid, 0, 2, 100, 24, 80, 26);
  CanvasGrid.prototype.drawCell.call(grid, 3, 0, 48, 76, 80, 26);

  assert.deepEqual(fillRects.map((rect) => rect.fillStyle), [
    gridColor("frozenHeader"),
    gridColor("firstColumnFrozen"),
    gridColor("frozen"),
    gridColor("header"),
    gridColor("firstColumn")
  ]);
});

test("active row header draws raised chrome over the row index only", () => {
  assert.deepEqual(activeRowHeaderChromeSteps({ rowHeaderWidth: 38, y: 20, height: 26 }), [
    { kind: "fillRect", color: "activeRowHeaderSheen", x: 2, y: 22, width: 34, height: 9 },
    { kind: "strokePath", color: "activeRowHeaderHighlight", points: [[1.5, 43.5], [1.5, 21.5], [35.5, 21.5]] },
    { kind: "strokePath", color: "activeRowHeaderShadow", points: [[1.5, 44.5], [36.5, 44.5], [36.5, 21.5]] }
  ]);
  assert.deepEqual(activeRowHeaderChromeSteps({ rowHeaderWidth: 38, y: 20, height: 2 }), []);
  assert.deepEqual(activeRowHeaderChromeSteps({ rowHeaderWidth: 2, y: 20, height: 26 }), []);
});

test("grid render policy syncs theme CSS variables without CanvasGrid owning the palette", () => {
  const requested = [];
  const colors = {
    background: "#000000",
    text: "#111111"
  };
  const style = {
    getPropertyValue(variable) {
      requested.push(variable);
      if (variable === "--grid-bg") return "  #123456  ";
      if (variable === "--grid-text") return "#abcdef";
      return "";
    }
  };

  assert.equal(syncGridThemeFromStyle(style, colors), colors);
  assert.equal(colors.background, "#123456");
  assert.equal(colors.text, "#abcdef");
  assert.equal(requested.includes("--grid-bg"), true);
  assert.equal(requested.includes("--grid-text"), true);
});

test("grid render policy records frame statistics without CanvasGrid owning the math", () => {
  const stats = createGridRenderStats();
  assert.deepEqual(stats, {
    frames: 0,
    totalMs: 0,
    lastMs: 0,
    droppedFrames: 0,
    visibleRows: [0, 0],
    visibleColumns: [0, 0],
    reason: "init"
  });

  assert.equal(updateGridRenderStats(stats, {
    elapsed: 16.345,
    rows: [{ row: 4 }, { row: 5 }, { row: 8 }],
    columns: [{ column: 2 }, { column: 6 }],
    reason: "scroll"
  }), stats);
  assert.deepEqual(stats, {
    frames: 1,
    totalMs: 16.345,
    lastMs: 16.35,
    droppedFrames: 0,
    visibleRows: [4, 8],
    visibleColumns: [2, 6],
    reason: "scroll"
  });

  updateGridRenderStats(stats, { elapsed: 18, rows: [], columns: [], reason: "resize" });
  assert.equal(stats.frames, 2);
  assert.equal(stats.totalMs, 34.345);
  assert.equal(stats.lastMs, 18);
  assert.equal(stats.droppedFrames, 1);
  assert.deepEqual(stats.visibleRows, [0, 0]);
  assert.deepEqual(stats.visibleColumns, [0, 0]);
  assert.equal(stats.reason, "resize");
});

test("column-index band and row-index gutter stay aligned with scroll geometry", () => {
  const headerHeightGetter = Object.getOwnPropertyDescriptor(CanvasGrid.prototype, "headerHeight").get;
  assert.equal(headerHeightGetter.call({ zoom: 1 }), 24);
  assert.equal(headerHeightGetter.call({ zoom: 1.5 }), 36);

  const columnGrid = {
    rowHeaderWidth: 48,
    zoom: 1,
    scrollLeft: 35,
    host: { clientWidth: 360 },
    doc: {
      columnCount: 4,
      columnWidths: [100, 80, 90, 70],
      defaultColumnWidth: 80,
      freezeFirstColumn: false,
      hiddenColumns: new Set()
    },
    frozenColumnWidth: () => 0,
    scrollStartColumn: () => 0,
    scaledColumnWidth: CanvasGrid.prototype.scaledColumnWidth,
    columnContentLeft: CanvasGrid.prototype.columnContentLeft
  };
  const columns = CanvasGrid.prototype.visibleColumns.call(columnGrid);
  assert.equal(columns[0].left, CanvasGrid.prototype.screenXForColumn.call(columnGrid, columns[0].column));
  assert.equal(columns[1].left, CanvasGrid.prototype.screenXForColumn.call(columnGrid, columns[1].column));

  const rowGrid = {
    rowHeight: 26,
    headerHeight: 24,
    scrollTop: 13,
    host: { clientHeight: 160 },
    doc: {
      rowCount: 5,
      rowHeights: [],
      defaultRowHeight: 26,
      freezeFirstRow: false,
      hiddenRows: new Set(),
      hasCustomRowHeights: false
    },
    frozenRowHeight: () => 0,
    scrollStartRow: () => 0,
    scaledRowHeight: CanvasGrid.prototype.scaledRowHeight,
    rowContentTop: CanvasGrid.prototype.rowContentTop
  };
  const rows = CanvasGrid.prototype.visibleRows.call(rowGrid);
  assert.equal(rows[0].top, CanvasGrid.prototype.screenYForRow.call(rowGrid, rows[0].row));
  assert.equal(rows[1].top, CanvasGrid.prototype.screenYForRow.call(rowGrid, rows[1].row));
});

test("grid metrics reuse hidden-row prefix data for repeated hit tests", () => {
  let hiddenChecks = 0;
  const hiddenRows = new Set([1, 2, 6]);
  hiddenRows.has = (value) => {
    hiddenChecks += 1;
    return Set.prototype.has.call(hiddenRows, value);
  };
  const doc = {
    viewRevision: 1,
    rowCount: 10,
    defaultRowHeight: 26,
    rowHeights: [26, 26, 26, 26, 52, 26, 26, 26, 26, 26],
    hiddenRows,
    hasCustomRowHeights: true
  };
  const metrics = new GridMetrics();

  metrics.updateRows({ doc, zoom: 1, scrollStartRow: 0 });
  const checksAfterBuild = hiddenChecks;

  assert.equal(metrics.scrollableRowsHeight(), 208);
  assert.equal(metrics.rowContentTop(7), 130);
  assert.equal(metrics.rowAtContent(0), 0);
  assert.equal(metrics.rowAtContent(80), 4);
  assert.deepEqual(metrics.visibleRows({
    scrollTop: 70,
    viewportHeight: 120,
    fixedTop: 24,
    overscanPx: 26
  }).map((row) => row.row), [3, 4, 5, 7, 8, 9]);
  assert.equal(hiddenChecks, checksAfterBuild);
});

test("grid metrics invalidate when document view revision changes", () => {
  const doc = TableDocument.fromText("x.txt", "a\n1\n2\n3", { dirty: false });
  const metrics = new GridMetrics();
  metrics.updateRows({ doc, zoom: 1, scrollStartRow: 0 });

  assert.equal(metrics.scrollableRowsHeight(), 104);
  doc.setRowsHidden([1, 2], true);
  metrics.updateRows({ doc, zoom: 1, scrollStartRow: 0 });

  assert.equal(metrics.scrollableRowsHeight(), 52);
  assert.equal(metrics.rowAtContent(30), 3);
});

test("freeze state layout changes redraw the grid immediately", () => {
  const draws = [];
  const grid = {
    doc: {
      freezeFirstRow: false,
      freezeFirstColumn: false
    },
    host: {
      getBoundingClientRect: () => ({ width: 320, height: 180 })
    },
    canvas: { style: {} },
    frozenCanvas: { style: {} },
    ctx: {},
    frozenCtx: {},
    scrollSurface: { style: {} },
    rowHeaderWidth: 48,
    headerHeight: 24,
    hideFirstColumnHoverPreview() {},
    resetCellScrollNormalizationState: CanvasGrid.prototype.resetCellScrollNormalizationState,
    syncTheme() {},
    layoutCanvas() {},
    positionCanvases() {},
    frozenColumnWidth() {
      return this.doc.freezeFirstColumn ? 80 : 0;
    },
    frozenRowHeight() {
      return this.doc.freezeFirstRow ? 26 : 0;
    },
    scrollableColumnWidth() {
      return 160;
    },
    scrollableRowsHeight() {
      return 260;
    },
    draw() {
      draws.push({
        freezeFirstRow: this.doc.freezeFirstRow,
        freezeFirstColumn: this.doc.freezeFirstColumn,
        scrollWidth: this.scrollSurface.style.width,
        scrollHeight: this.scrollSurface.style.height
      });
    }
  };

  CanvasGrid.prototype.layout.call(grid);
  grid.doc.freezeFirstRow = true;
  grid.doc.freezeFirstColumn = true;
  CanvasGrid.prototype.layout.call(grid);

  assert.deepEqual(draws, [
    { freezeFirstRow: false, freezeFirstColumn: false, scrollWidth: "208px", scrollHeight: "284px" },
    { freezeFirstRow: true, freezeFirstColumn: true, scrollWidth: "288px", scrollHeight: "310px" }
  ]);
});

test("document switch restores scroll after rebuilding the target scroll surface", () => {
  const restores = [];
  const targetDoc = TableDocument.fromText("large.txt", "a\n1\n2\n3");
  targetDoc.scrollLeft = 40;
  targetDoc.scrollTop = 500;
  targetDoc.selectionState = { focus: { row: 2, column: 0 }, anchor: { row: 2, column: 0 }, ranges: [{ top: 2, left: 0, bottom: 2, right: 0 }] };
  const host = {
    _scrollLeft: 0,
    _scrollTop: 0,
    _maxScrollLeft: 0,
    _maxScrollTop: 0,
    get scrollLeft() {
      return this._scrollLeft;
    },
    set scrollLeft(value) {
      this._scrollLeft = Math.max(0, Math.min(Number(value) || 0, this._maxScrollLeft));
    },
    get scrollTop() {
      return this._scrollTop;
    },
    set scrollTop(value) {
      this._scrollTop = Math.max(0, Math.min(Number(value) || 0, this._maxScrollTop));
    }
  };
  const grid = {
    _tooltip: null,
    _lspHoverByCell: new Map(),
    host,
    selection: {
      restore(snapshot) {
        restores.push(snapshot.focus);
      }
    },
    get scrollLeft() {
      return Math.round(this.host.scrollLeft);
    },
    get scrollTop() {
      return Math.round(this.host.scrollTop);
    },
    hideFirstColumnHoverPreview() {},
    resetCellScrollNormalizationState: CanvasGrid.prototype.resetCellScrollNormalizationState,
    layout() {
      this.host._maxScrollLeft = 100;
      this.host._maxScrollTop = 1000;
    },
    draw() {}
  };

  CanvasGrid.prototype.setDocument.call(grid, targetDoc);

  assert.equal(host.scrollLeft, 40);
  assert.equal(host.scrollTop, 500);
  assert.equal(targetDoc.scrollLeft, 40);
  assert.equal(targetDoc.scrollTop, 500);
  assert.deepEqual(restores, [{ row: 2, column: 0 }]);
});

test("document switching clears cell scroll history before restoring target offsets", () => {
  const targetDoc = TableDocument.fromText("target.txt", "a\n1");
  targetDoc.scrollLeft = 40;
  targetDoc.scrollTop = 55;
  targetDoc.selectionState = { focus: { row: 0, column: 0 }, anchor: { row: 0, column: 0 }, ranges: [] };
  const grid = {
    _tooltip: null,
    _lspHoverByCell: new Map(),
    _lastRawCellScrollOffset: { scrollLeft: 220, scrollTop: 180 },
    _lastObservedCellScrollOffset: { scrollLeft: 240, scrollTop: 190 },
    _lastCellScrollOffset: { scrollLeft: 240, scrollTop: 190 },
    _cellScrollEcho: { scrollLeft: 240, scrollTop: 190 },
    _cellScrollThumbDrag: { horizontal: true, vertical: false },
    host: { scrollLeft: 0, scrollTop: 0, clientWidth: 100, clientHeight: 100 },
    selection: { restore() {} },
    get scrollLeft() { return this.host.scrollLeft; },
    get scrollTop() { return this.host.scrollTop; },
    hideFirstColumnHoverPreview() {},
    resetCellScrollNormalizationState: CanvasGrid.prototype.resetCellScrollNormalizationState,
    layout() {},
    draw() {}
  };

  CanvasGrid.prototype.setDocument.call(grid, targetDoc);

  assert.equal(grid._lastRawCellScrollOffset, null);
  assert.equal(grid._lastObservedCellScrollOffset, null);
  assert.equal(grid._lastCellScrollOffset, null);
  assert.equal(grid._cellScrollEcho, null);
  assert.equal(grid._cellScrollThumbDrag, null);
  assert.deepEqual([grid.host.scrollLeft, grid.host.scrollTop], [40, 55]);
  Object.assign(grid, {
    rowHeaderWidth: 0,
    headerHeight: 0,
    frozenColumnWidth: () => 0,
    frozenRowHeight: () => 0,
    scrollableColumnWidth: () => 400,
    scrollableRowsHeight: () => 400,
    gridMetrics: () => ({
      columns: { total: 400, simpleSize: null, prefix: [0, 50, 130, 400] },
      rows: { total: 400, simpleSize: null, prefix: [0, 30, 100, 400] }
    })
  });
  assert.deepEqual(normalizeCellGridScrollOffsets(grid), { scrollLeft: 50, scrollTop: 30 });
});

test("scroll mode changes clear active physical and logical cell-scroll state", () => {
  const grid = {
    scrollMode: GRID_SCROLL_MODE_CELL,
    _lastRawCellScrollOffset: { scrollLeft: 40, scrollTop: 55 },
    _lastObservedCellScrollOffset: { scrollLeft: 50, scrollTop: 100 },
    _lastCellScrollOffset: { scrollLeft: 50, scrollTop: 100 },
    _cellScrollEcho: { scrollLeft: 50, scrollTop: 100 },
    _cellScrollThumbDrag: { horizontal: true, vertical: false },
    resetCellScrollNormalizationState: CanvasGrid.prototype.resetCellScrollNormalizationState,
    draw() {}
  };
  CanvasGrid.prototype.setScrollMode.call(grid, "pixel");
  assert.equal(grid.scrollMode, "pixel");
  assert.equal(grid._lastRawCellScrollOffset, null);
  assert.equal(grid._lastObservedCellScrollOffset, null);
  assert.equal(grid._lastCellScrollOffset, null);
  assert.equal(grid._cellScrollEcho, null);
  assert.equal(grid._cellScrollThumbDrag, null);
});

test("initial canvas column fit is header-only and compact", () => {
  assert.equal(initialColumnFitWidth({ measuredHeaderWidth: 4, zoom: 1 }), 56);
  assert.equal(initialColumnFitWidth({ measuredHeaderWidth: 156, zoom: 2, padding: 24 }), 102);
  assert.equal(initialColumnFitWidth({ measuredHeaderWidth: 2000, zoom: 1 }), 420);
  assert.equal(initialColumnFitWidth({ measuredHeaderWidth: 87.2, zoom: 1, min: 36, max: 2000, padding: 24 }), 112);
  const measured = [];
  const grid = {
    zoom: 1,
    font: () => "bold",
    ctx: {
      font: "",
      measureText: (value) => {
        measured.push(value);
        return { width: value.length * 10 };
      }
    },
    doc: {
      columnCount: 2,
      columnWidths: [],
      viewRevision: 0,
      markViewChanged() {
        this.viewRevision += 1;
      },
      getCell: (row, column) => {
        assert.equal(row, 0);
        return column === 0 ? "id" : "long header";
      }
    }
  };
  CanvasGrid.prototype.autoFitInitialColumns.call(grid);
  assert.deepEqual(measured, ["id", "long header"]);
  assert.deepEqual(grid.doc.columnWidths, [56, 134]);
  assert.equal(grid.doc.viewRevision, 1);
});

test("canvas drag row resizing opts into custom row-height layout", () => {
  const doc = TableDocument.fromText("rows.txt", "a\n1\n2", { dirty: false });
  const rowResult = applyResizeDragState({
    doc,
    resizing: { kind: "row", index: 1, before: 26, startY: 100, zoom: 2 },
    hit: { y: 140 }
  });
  assert.equal(doc.rowHeights[1], 46);
  assert.equal(doc.hasCustomRowHeights, true);
  assert.deepEqual(rowResult, { value: 46, guide: { kind: "row", y: 140 }, hasCustomRowHeights: true });

  const columnResult = applyResizeDragState({
    doc,
    resizing: { kind: "column", index: 0, before: 80, startX: 100, zoom: 2 },
    hit: { x: 160 }
  });
  assert.equal(doc.columnWidths[0], 110);
  assert.deepEqual(columnResult, { value: 110, guide: { kind: "column", x: 160 }, hasCustomRowHeights: true });
});

test("first-column hover preview is single and clears on grid context changes", () => {
  const appended = [];
  const ownerDocument = {
    body: {
      append: (element) => appended.push(element)
    },
    createElement: (tagName) => ({
      tagName,
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      }
    })
  };
  const preview = createFirstColumnHoverPreview(ownerDocument);
  assert.equal(preview.tagName, "div");
  assert.equal(preview.className, "first-column-hover-preview hidden");
  assert.equal(preview.attributes.role, "tooltip");
  assert.deepEqual(appended, [preview]);
  assert.equal(shouldClearHoverForInteraction({ documentChanged: true }), true);
  assert.equal(shouldClearHoverForInteraction({ pointerLeave: true }), true);
  assert.equal(shouldClearHoverForInteraction({ scroll: true }), true);
  assert.equal(shouldClearHoverForInteraction({ contextMenu: true }), true);
});

test("cell and row-header text use row-height-centered baselines", () => {
  const textBaselines = [];
  const rowHeaderText = [];
  const cellText = [];
  const ctx = {
    fillRect() {},
    strokeRect() {},
    measureText: (value) => ({ width: String(value).length * 7 }),
    fillText: (...args) => rowHeaderText.push(args),
    set textBaseline(value) {
      textBaselines.push(value);
    }
  };
  const grid = {
    ctx,
    rowHeaderWidth: 48,
    colorizeColumns: false,
    selection: {
      focus: { row: 0, column: 0 },
      hasFullRow: () => false,
      contains: () => false
    },
    doc: {
      columnCount: 3,
      getCell: () => "cell text"
    },
    font: () => "12px sans-serif",
    editingCell: () => null,
    fillText: (...args) => cellText.push(args),
    drawDiagnosticMarker() {}
  };

  assert.equal(centeredTextY(20, 26), 33);
  CanvasGrid.prototype.drawRowHeader.call(grid, 4, 20, 26);
  CanvasGrid.prototype.drawCell.call(grid, 2, 1, 100, 200, 80, 30);

  assert.deepEqual(textBaselines, ["middle", "middle"]);
  assert.equal(rowHeaderText[0][0], "5");
  assert.equal(rowHeaderText[0][2], centeredTextY(20, 26));
  assert.deepEqual(cellText[0], ["cell text", 108, centeredTextY(200, 30), 68]);
});

test("keyboard edit start policy preserves explicit and quick edit triggers", () => {
  assert.deepEqual(keyboardEditStartAction({ key: "Enter" }), { action: "start-edit", initialText: null, replace: false, mode: "explicit" });
  assert.deepEqual(keyboardEditStartAction({ key: "F2" }), { action: "start-edit", initialText: null, replace: false, mode: "explicit" });
  assert.deepEqual(keyboardEditStartAction({ key: "x" }), { action: "start-edit", initialText: "x", replace: true, mode: "quick" });
  assert.deepEqual(keyboardEditStartAction({ key: "x", ctrlKey: true }), { action: "none" });
  assert.deepEqual(keyboardEditStartAction({ key: "ArrowDown" }), { action: "none" });
  assert.equal(isPrintableEditKey({ key: "x", ctrlKey: false, metaKey: false, altKey: false }), true);
  assert.equal(isPrintableEditKey({ key: "x", ctrlKey: true, metaKey: false, altKey: false }), false);
});

test("editor presentation policy preserves overlay geometry and cell state", () => {
  assert.deepEqual(
    editorBoxStyle({
      hostBox: { left: 100, top: 50 },
      cellBox: { left: 10, top: 20, width: 80, height: 26 },
      zoom: 1
    }),
    { left: "111px", top: "71px", width: "78px", height: "24px", fontSize: "12px" }
  );
  assert.deepEqual(
    editorBoxStyle({
      hostBox: { left: 0, top: 0 },
      cellBox: { left: 0, top: 0, width: 40, height: 18 },
      zoom: 0.5
    }),
    { left: "1px", top: "1px", width: "38px", height: "16px", fontSize: "10px" }
  );
  assert.deepEqual(editorCellState({ row: 0, column: 2, freezeFirstRow: true }), {
    frozen: true,
    firstColumnLabel: false,
    fontWeight: "600"
  });
  assert.deepEqual(editorCellState({ row: 3, column: 0, freezeFirstColumn: true }), {
    frozen: true,
    firstColumnLabel: true,
    fontWeight: "600"
  });
  assert.deepEqual(editorCellState({ row: 3, column: 2 }), {
    frozen: false,
    firstColumnLabel: false,
    fontWeight: "400"
  });
});

test("mouse resize lock disables resize handles and clears an active mouse resize", () => {
  const geometry = {
    mouseResizeLocked: false,
    zoom: 1,
    screenXForColumn: () => 100,
    scaledColumnWidth: () => 80,
    screenYForRow: () => 50,
    scaledRowHeight: () => 26
  };
  const columnBoundary = { kind: "column-header", row: 0, column: 1, x: 180, y: 10 };
  const rowBoundary = { kind: "row-header", row: 2, column: 0, x: 10, y: 76 };

  assert.deepEqual(CanvasGrid.prototype.resizeHit.call(geometry, columnBoundary), { kind: "column", index: 1 });
  assert.deepEqual(CanvasGrid.prototype.resizeHit.call(geometry, rowBoundary), { kind: "row", index: 2 });

  geometry.mouseResizeLocked = true;
  assert.equal(CanvasGrid.prototype.resizeHit.call(geometry, columnBoundary), null);
  assert.equal(CanvasGrid.prototype.resizeHit.call(geometry, rowBoundary), null);

  let draws = 0;
  const activeResize = {
    mouseResizeLocked: false,
    resizing: { kind: "column", index: 1 },
    resizeGuide: { kind: "column", x: 180 },
    host: { style: { cursor: "col-resize" } },
    draw: () => { draws += 1; }
  };
  CanvasGrid.prototype.setMouseResizeLocked.call(activeResize, true);
  assert.equal(activeResize.mouseResizeLocked, true);
  assert.equal(activeResize.resizing, null);
  assert.equal(activeResize.resizeGuide, null);
  assert.equal(activeResize.host.style.cursor, "default");
  assert.equal(draws, 1);
});

test("locked resize boundaries fall through to normal selection and skip double-click auto-fit", () => {
  const cellBoundary = { kind: "cell", row: 2, column: 1, x: 180, y: 76 };
  const selections = [];
  const grid = {
    host: { focus: () => {}, style: {} },
    hideFirstColumnHoverPreview: () => {},
    isScrollbarEvent: () => false,
    hitTest: () => cellBoundary,
    resizeHit: () => null,
    applyHitSelection: (...args) => selections.push(args),
    clearHoverState: () => {},
    draw: () => {},
    notifySelectionChanged: () => {},
    dragging: false,
    resizing: null
  };

  CanvasGrid.prototype.onMouseDown.call(grid, {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false
  });
  assert.equal(selections.length, 1);
  assert.deepEqual(selections[0][0], cellBoundary);
  assert.equal(grid.resizing, null);

  let autoFits = 0;
  grid.hitTest = () => ({ kind: "column-header", row: 0, column: 1, x: 180, y: 10 });
  grid.onAutoFitColumn = () => { autoFits += 1; };
  grid.startEdit = () => { throw new Error("column header must not start cell editing"); };
  CanvasGrid.prototype.onDblClick.call(grid, {});
  assert.equal(autoFits, 0);
});
