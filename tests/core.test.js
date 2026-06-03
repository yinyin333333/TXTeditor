import assert from "node:assert/strict";
import test from "node:test";
import { TableDocument } from "../src/core/table-model.js";
import { SelectionModel } from "../src/core/selection.js";
import { findInTable } from "../src/core/search.js";
import { UndoManager, makeCellCommand } from "../src/core/undo.js";
import {
  addColumnsCommand,
  addRowsCommand,
  copyRange,
  deleteColumnsCommand,
  deleteRowsCommand,
  fillSelectionCommand,
  incrementFillCommand,
  insertColumnCommand,
  insertRowCommand,
  pasteTextCommand,
  resizeColumnCommand,
  resizeRowCommand
} from "../src/core/operations.js";
import { shouldDrawCellText } from "../src/ui/canvas-grid.js";
import { boundedTableExtent, classifyGridHit, classifyPanePoint, columnColorIndex } from "../src/ui/grid-geometry.js";

test("parses and serializes TSV while preserving CRLF and final newline", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\r\n1\t2\r\n");
  assert.equal(doc.rowCount, 2);
  assert.equal(doc.columnCount, 2);
  assert.equal(doc.lineEnding, "\r\n");
  assert.equal(doc.finalNewline, true);
  assert.equal(doc.toText(), "a\tb\r\n1\t2\r\n");
});

test("initial column sizing samples headers and early content with sane clamps", () => {
  const doc = TableDocument.fromText("x.txt", "very_long_header_name\tb\nshort\tmedium_content\nshort\t" + "x".repeat(200));
  assert.ok(doc.columnWidths[0] > 120);
  assert.ok(doc.columnWidths[1] > 120);
  assert.ok(doc.columnWidths[1] <= 560);
});

test("initial column sizing prioritizes the real first row header", () => {
  const doc = TableDocument.fromText("x.txt", "really_long_header_name_that_should_not_clip\tid\nx\t1\ny\t2");
  assert.ok(doc.columnWidths[0] > doc.columnWidths[1] * 2);
  assert.ok(doc.columnWidths[0] >= 300);
});

test("cell commands undo and redo without full table snapshots", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2");
  const undo = new UndoManager();
  const command = makeCellCommand("Edit", doc, [{ row: 1, column: 1, value: "42" }]);
  doc.applyCellChanges(command.changes, "after");
  undo.push(command);
  assert.equal(doc.getCell(1, 1), "42");
  undo.undo(doc);
  assert.equal(doc.getCell(1, 1), "2");
  undo.redo(doc);
  assert.equal(doc.getCell(1, 1), "42");
});

test("first row cell edits are undoable and saved as file data", () => {
  const doc = TableDocument.fromText("skills.txt", "pSrvDoFunc\tpSrvHitFunc\n1\t2\n");
  const undo = new UndoManager();
  const command = makeCellCommand("Edit Header Cell", doc, [{ row: 0, column: 0, value: "renamedFunc" }]);
  command.redo(doc);
  undo.push(command);
  assert.equal(doc.getCell(0, 0), "renamedFunc");
  assert.equal(doc.toText(), "renamedFunc\tpSrvHitFunc\n1\t2\n");
  undo.undo(doc);
  assert.equal(doc.getCell(0, 0), "pSrvDoFunc");
});

test("committed multi-character cell edit is one undoable command", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2");
  const undo = new UndoManager();
  const command = makeCellCommand("Edit Cell", doc, [{ row: 1, column: 1, value: "apple" }]);
  command.redo(doc);
  undo.push(command);
  assert.equal(doc.getCell(1, 1), "apple");
  undo.undo(doc);
  assert.equal(doc.getCell(1, 1), "2");
});

test("selection supports ranges and select all", () => {
  const selection = new SelectionModel();
  selection.set(3, 4);
  selection.extend(1, 2);
  assert.deepEqual(selection.rect, { top: 1, left: 2, bottom: 3, right: 4 });
  selection.selectAll(10, 6);
  assert.deepEqual(selection.rect, { top: 0, left: 0, bottom: 9, right: 5 });
});

test("search wraps through the document", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\tneedle\nlast\trow");
  assert.deepEqual(findInTable(doc, "needle", { row: 2, column: 1 }), { row: 1, column: 1 });
});

test("search finds first-row header names as normal cells", () => {
  const doc = TableDocument.fromText("skills.txt", "pSrvDoFunc\tpSrvHitFunc\n1\t2");
  assert.deepEqual(findInTable(doc, "pSrvDoFunc", { row: 1, column: 0 }), { row: 0, column: 0 });
});

test("insert and delete row are grouped undoable commands", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2");
  const undo = new UndoManager();
  const insert = insertRowCommand(doc, 1, ["x", "y"]);
  insert.redo(doc);
  undo.push(insert);
  assert.equal(doc.getCell(1, 0), "x");
  undo.undo(doc);
  assert.equal(doc.getCell(1, 0), "1");

  const del = deleteRowsCommand(doc, 1, 1);
  del.redo(doc);
  undo.push(del);
  assert.equal(doc.rowCount, 1);
  undo.undo(doc);
  assert.equal(doc.getCell(1, 1), "2");
});

test("add row and add column append grouped undoable changes", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2");
  const undo = new UndoManager();
  const rows = addRowsCommand(doc, 2);
  rows.redo(doc);
  undo.push(rows);
  assert.equal(doc.rowCount, 4);
  undo.undo(doc);
  assert.equal(doc.rowCount, 2);

  const columns = addColumnsCommand(doc, 2);
  columns.redo(doc);
  undo.push(columns);
  assert.equal(doc.columnCount, 4);
  assert.equal(doc.getCell(0, 2), "Column3");
  undo.undo(doc);
  assert.equal(doc.columnCount, 2);
});

test("insert and delete column are grouped undoable commands", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2");
  const undo = new UndoManager();
  const insert = insertColumnCommand(doc, 1, "new");
  insert.redo(doc);
  undo.push(insert);
  assert.equal(doc.getCell(0, 1), "new");
  undo.undo(doc);
  assert.equal(doc.getCell(0, 1), "b");

  const del = deleteColumnsCommand(doc, 0, 1);
  del.redo(doc);
  undo.push(del);
  assert.equal(doc.getCell(0, 0), "b");
  undo.undo(doc);
  assert.equal(doc.getCell(0, 0), "a");
});

test("copy and paste range preserve tabular shape", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\tc\n1\t2\t3\n4\t5\t6");
  const copied = copyRange(doc, { top: 1, left: 1, bottom: 2, right: 2 });
  assert.equal(copied, "2\t3\n5\t6");
  const command = pasteTextCommand(doc, { row: 0, column: 0 }, copied);
  command.redo(doc);
  assert.equal(doc.getCell(0, 0), "2");
  assert.equal(doc.getCell(1, 1), "6");
  command.undo(doc);
  assert.equal(doc.getCell(0, 0), "a");
});

test("fill copies the top-left selected value over the selection", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\tc\n1\t2\t3\n4\t5\t6");
  const command = fillSelectionCommand(doc, { top: 1, left: 0, bottom: 2, right: 2 });
  command.redo(doc);
  assert.equal(doc.getCell(1, 0), "1");
  assert.equal(doc.getCell(1, 2), "1");
  assert.equal(doc.getCell(2, 1), "1");
  command.undo(doc);
  assert.equal(doc.getCell(2, 1), "5");
});

test("increment fill handles numbers and trailing numeric text", () => {
  const numeric = TableDocument.fromText("x.txt", "v\n1\n\n");
  incrementFillCommand(numeric, { top: 1, left: 0, bottom: 3, right: 0 }).redo(numeric);
  assert.equal(numeric.getCell(1, 0), "1");
  assert.equal(numeric.getCell(2, 0), "2");
  assert.equal(numeric.getCell(3, 0), "3");

  const prefixedNumber = TableDocument.fromText("x.txt", "v\nco1\n\n");
  incrementFillCommand(prefixedNumber, { top: 1, left: 0, bottom: 3, right: 0 }).redo(prefixedNumber);
  assert.equal(prefixedNumber.getCell(1, 0), "co1");
  assert.equal(prefixedNumber.getCell(2, 0), "co2");
  assert.equal(prefixedNumber.getCell(3, 0), "co3");

  const padded = TableDocument.fromText("x.txt", "v\nabc099\n\n");
  incrementFillCommand(padded, { top: 1, left: 0, bottom: 2, right: 0 }).redo(padded);
  assert.equal(padded.getCell(1, 0), "abc099");
  assert.equal(padded.getCell(2, 0), "abc100");
});

test("resize commands are undoable without table snapshots", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2");
  const undo = new UndoManager();
  const col = resizeColumnCommand(1, doc.columnWidths[1], 240);
  col.redo(doc);
  undo.push(col);
  assert.equal(doc.columnWidths[1], 240);
  undo.undo(doc);
  assert.notEqual(doc.columnWidths[1], 240);

  const beforeHeight = doc.rowHeights[1];
  const row = resizeRowCommand(1, beforeHeight, 44);
  row.redo(doc);
  undo.push(row);
  assert.equal(doc.rowHeights[1], 44);
  undo.undo(doc);
  assert.equal(doc.rowHeights[1], beforeHeight);
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

test("first row data cells are hit as cells, not column headers", () => {
  assert.deepEqual(
    classifyGridHit({ pane: "cell", row: 0, column: 2, x: 250, y: 8 }),
    { kind: "cell", row: 0, column: 2, x: 250, y: 8 }
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

test("renderer skips stale text for the active editing cell only", () => {
  const editingCell = { row: 0, column: 1 };
  assert.equal(shouldDrawCellText(0, 1, editingCell), false);
  assert.equal(shouldDrawCellText(0, 0, editingCell), true);
  assert.equal(shouldDrawCellText(1, 1, editingCell), true);
  assert.equal(shouldDrawCellText(0, 1, null), true);
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

test("column text color cycle is predictable and bounded", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((column) => columnColorIndex(column, 5)), [0, 1, 2, 3, 4, 0, 1, 2, 3, 4]);
});
