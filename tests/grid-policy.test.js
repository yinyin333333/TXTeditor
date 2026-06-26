import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TableDocument } from "../src/core/table-model.js";
import { SelectionModel } from "../src/core/selection.js";
import { incrementFillSelectedCellsCommand } from "../src/core/operations.js";
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
import {
  activeRowHeaderChromeSteps,
  cellBackground,
  cellTextColor,
  centeredTextY,
  columnHeaderRenderState,
  createGridRenderStats,
  frozenHorizontalEdgeRects,
  frozenVerticalEdgeRects,
  initialColumnFitWidth,
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
  resizedTrackValue
} from "../src/ui/grid-viewport-policy.js";
import { shouldClearHoverForInteraction } from "../src/ui/hover-policy.js";
import {
  createDefaultLintSettings,
  lintRuleGroupsForProfile,
  runLint
} from "../src/core/lint-engine.js";

function lintDocs(docs, profile = "RotW") {
  const settings = createDefaultLintSettings();
  settings.profile = profile;
  return runLint(docs, settings);
}

function ruleIdsForProfile(profile) {
  return lintRuleGroupsForProfile(profile).flatMap((group) => group.rules.map((rule) => rule.id));
}

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

test("frozen pane edge uses a subtle raised effect instead of hard divider strokes", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.deepEqual(frozenVerticalEdgeRects(80, 240), [
    { color: "frozenEdgeHighlight", x: 78, y: 0, width: 1, height: 240 },
    { color: "frozenEdgeShadow", x: 79, y: 0, width: 1, height: 240 },
    { color: "frozenEdgeAmbient", x: 80, y: 0, width: 3, height: 240 }
  ]);
  assert.deepEqual(frozenHorizontalEdgeRects(52, 320), [
    { color: "frozenEdgeHighlight", x: 0, y: 50, width: 320, height: 1 },
    { color: "frozenEdgeShadow", x: 0, y: 51, width: 320, height: 1 },
    { color: "frozenEdgeAmbient", x: 0, y: 52, width: 320, height: 3 }
  ]);
  assert.deepEqual(frozenVerticalEdgeRects(80, 0), []);
  assert.deepEqual(frozenHorizontalEdgeRects(52, 0), []);
  assert.match(css, /--grid-frozen-edge-highlight:/);
  assert.match(css, /--grid-frozen-edge-shadow:/);
  assert.match(css, /--grid-frozen-edge-ambient:/);
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

test("active cell highlights both the first-row header and left row header", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const selection = { focus: { row: 2, column: 3 } };
  assert.equal(rowHeaderRenderState(selection, 2).activeHeader, true);
  assert.equal(rowHeaderRenderState(selection, 1).activeHeader, false);
  assert.equal(columnHeaderRenderState({ selection, row: 0, column: 3, editingThisCell: false }).activeColumnHeader, true);
  assert.equal(columnHeaderRenderState({ selection, row: 0, column: 3, editingThisCell: true }).activeColumnHeader, false);
  assert.equal(columnHeaderRenderState({ selection, row: 1, column: 3, editingThisCell: false }).activeColumnHeader, false);
  assert.equal(columnHeaderRenderState({ selection, row: 0, column: 2, editingThisCell: false }).activeColumnHeader, false);
  const fillRects = [];
  let fillStyle = "";
  const ctx = {
    set fillStyle(value) {
      fillStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    fillRect: (x, y, width, height) => fillRects.push({ fillStyle, x, y, width, height }),
    strokeRect() {},
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
  assert.equal(fillRects[0].fillStyle, gridColor("activeHeader"));
  assert.equal(fillRects[1].fillStyle, gridColor("activeHeader"));
  assert.match(css, /--grid-active-header-bg: var\(--activeHeaderBg\);/);
  assert.match(css, /--grid-active-header-text: var\(--activeHeaderText\);/);
});

test("active row header draws raised chrome over the row index only", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.deepEqual(activeRowHeaderChromeSteps({ rowHeaderWidth: 38, y: 20, height: 26 }), [
    { kind: "fillRect", color: "activeRowHeaderSheen", x: 2, y: 22, width: 34, height: 9 },
    { kind: "strokePath", color: "activeRowHeaderHighlight", points: [[1.5, 43.5], [1.5, 21.5], [35.5, 21.5]] },
    { kind: "strokePath", color: "activeRowHeaderShadow", points: [[1.5, 44.5], [36.5, 44.5], [36.5, 21.5]] }
  ]);
  assert.deepEqual(activeRowHeaderChromeSteps({ rowHeaderWidth: 38, y: 20, height: 2 }), []);
  assert.deepEqual(activeRowHeaderChromeSteps({ rowHeaderWidth: 2, y: 20, height: 26 }), []);
  assert.match(css, /--grid-active-row-header-highlight:/);
  assert.match(css, /--grid-active-row-header-shadow:/);
  assert.match(css, /--grid-active-row-header-sheen:/);
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
      getCell: (row, column) => {
        assert.equal(row, 0);
        return column === 0 ? "id" : "long header";
      }
    }
  };
  CanvasGrid.prototype.autoFitInitialColumns.call(grid);
  assert.deepEqual(measured, ["id", "long header"]);
  assert.deepEqual(grid.doc.columnWidths, [56, 134]);
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
