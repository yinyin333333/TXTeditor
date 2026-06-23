import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TableDocument } from "../src/core/table-model.js";
import { SelectionModel } from "../src/core/selection.js";
import { findInTable } from "../src/core/search.js";
import { UndoManager, makeCellCommand } from "../src/core/undo.js";
import {
  addColumnsCommand,
  addRowsCommand,
  clearRangesCommand,
  cloneRowsCommand,
  copyRange,
  copyRanges,
  deleteColumnsCommand,
  deleteRowsCommand,
  fillSelectedCellsCommand,
  fillSelectionCommand,
  incrementFillSelectedCellsCommand,
  incrementFillCommand,
  insertColumnCommand,
  insertRowCommand,
  pasteTextToRangesCommand,
  pasteTextCommand,
  resizeColumnCommand,
  resizeRowCommand
} from "../src/core/operations.js";
import { movedCell, normalizeVectorLspTooltip, shouldDrawCellText, shouldShowFirstColumnHover, VECTOR_LSP_HOVER_DELAY_MS } from "../src/ui/canvas-grid.js";
import { boundedTableExtent, classifyGridHit, classifyPanePoint, classifyResizeHandle, columnColorIndex } from "../src/ui/grid-geometry.js";
import {
  openNativePathsBulk
} from "../src/core/io.js";
import {
  LINT_RULES,
  buildWorkspaceFileStates,
  buildWorkspaceIndex,
  createDefaultLintSettings,
  diagnosticsForDocument,
  groupDiagnosticsByCell,
  lintRuleGroupsForProfile,
  normalizeLintSettings,
  runLint
} from "../src/core/lint-engine.js";
import { formatD2rlintCompatibleExport, formatTxteditorLintExport } from "../src/core/lint-export.js";
import {
  cancelVectorHoverSample,
  finishVectorHoverSample,
  makeVectorHoverTarget,
  markVectorHoverRequested,
  shouldAcceptVectorHoverResult,
  startVectorHoverSample
} from "../src/core/vector-hover.js";

function lintDocs(docs, profile = "RotW") {
  const settings = createDefaultLintSettings();
  settings.profile = profile;
  return runLint(docs, settings);
}

function ruleIdsForProfile(profile) {
  return lintRuleGroupsForProfile(profile).flatMap((group) => group.rules.map((rule) => rule.id));
}

test("parses and serializes TSV while preserving CRLF and final newline", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\r\n1\t2\r\n");
  assert.equal(doc.rowCount, 2);
  assert.equal(doc.columnCount, 2);
  assert.equal(doc.lineEnding, "\r\n");
  assert.equal(doc.finalNewline, true);
  assert.equal(doc.toText(), "a\tb\r\n1\t2\r\n");
});

test("initial column sizing is compact and header-first", () => {
  const doc = TableDocument.fromText("x.txt", "very_long_header_name\tb\nshort\tmedium_content\nshort\t" + "x".repeat(200));
  assert.ok(doc.columnWidths[0] > 160);
  assert.ok(doc.columnWidths[1] <= 64);
});

test("initial column sizing prioritizes the real first row header", () => {
  const doc = TableDocument.fromText("x.txt", "really_long_header_name_that_should_not_clip\tid\nx\t1\ny\t2");
  assert.ok(doc.columnWidths[0] > doc.columnWidths[1] * 2);
  assert.ok(doc.columnWidths[0] >= 280);
});

test("short headers get compact independent initial widths per document", () => {
  const stats = TableDocument.fromText("stats.txt", "class\tstr\tdex\tint\tvit\nama\t20\t25\t15\t20");
  const skills = TableDocument.fromText("skills.txt", "really_long_skill_header\tid\nvalue\t1");
  assert.ok(stats.columnWidths.every((width) => width <= 64));
  assert.ok(skills.columnWidths[0] > stats.columnWidths[0] * 3);
  assert.ok(skills.columnWidths[1] <= 64);
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

test("selection supports ctrl-style multi-range toggles", () => {
  const selection = new SelectionModel();
  selection.set(1, 1);
  selection.toggleCell(4, 3);
  assert.equal(selection.contains(1, 1), true);
  assert.equal(selection.contains(4, 3), true);
  assert.equal(selection.ranges.length, 2);
  selection.toggleCell(1, 1);
  assert.equal(selection.contains(1, 1), false);
  assert.equal(selection.contains(4, 3), true);
});

test("shift-style extension preserves the original anchor", () => {
  const selection = new SelectionModel();
  selection.set(1, 1);
  selection.toggleCell(4, 4);
  selection.extend(8, 3);
  assert.deepEqual(selection.rect, { top: 1, left: 1, bottom: 8, right: 3 });
});

test("row index highlight is reserved for full-row selection", () => {
  const selection = new SelectionModel();
  selection.set(167, 2);
  assert.equal(selection.hasFullRow(167, 8), false);
  selection.setRow(167, 8);
  assert.equal(selection.hasFullRow(167, 8), true);
});

test("search wraps through the document", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\tneedle\nlast\trow");
  assert.deepEqual(findInTable(doc, "needle", { row: 2, column: 1 }), { row: 1, column: 1 });
});

test("search finds first-row header names as normal cells", () => {
  const doc = TableDocument.fromText("skills.txt", "pSrvDoFunc\tpSrvHitFunc\n1\t2");
  assert.deepEqual(findInTable(doc, "pSrvDoFunc", { row: 1, column: 0 }), { row: 0, column: 0 });
});

test("search includes the first real data column", () => {
  const doc = TableDocument.fromText("skills.txt", "skill\tid\tdesc\nbash\t1\tmelee\nwarcry\t2\tbuff");
  assert.deepEqual(findInTable(doc, "warcry", { row: 0, column: 0 }), { row: 2, column: 0 });
});

test("search can land on the current first-column cell for a changed query", () => {
  const doc = TableDocument.fromText("skills.txt", "skill\tref\nWar Cry\twarcry\nLeap\twarcry");
  assert.deepEqual(findInTable(doc, "war cry", { row: 1, column: 0 }, { includeStart: true }), { row: 1, column: 0 });
  assert.deepEqual(findInTable(doc, "warcry", { row: 0, column: 0 }), { row: 1, column: 1 });
  assert.equal(findInTable(doc, "3", { row: 0, column: 0 }, { includeStart: true }), null);
});

test("search matching is case-insensitive only, without whitespace normalization", () => {
  const doc = TableDocument.fromText("skills.txt", "skill\nWarcry\nWARCRY\nWar Cry\nwar cry");
  assert.deepEqual(findInTable(doc, "warcry", { row: 0, column: 0 }), { row: 1, column: 0 });
  assert.deepEqual(findInTable(doc, "warcry", { row: 1, column: 0 }), { row: 2, column: 0 });
  assert.deepEqual(findInTable(doc, "warcry", { row: 2, column: 0 }), { row: 1, column: 0 });
  assert.deepEqual(findInTable(doc, "War Cry", { row: 0, column: 0 }), { row: 3, column: 0 });
  assert.deepEqual(findInTable(doc, "war cry", { row: 0, column: 0 }), { row: 3, column: 0 });
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

test("clone rows inserts body-row copies below the selected range and skips the header row", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2\n3\t4\n5\t6");
  const undo = new UndoManager();
  const command = cloneRowsCommand(doc, [0, 1, 2], 3);
  command.redo(doc);
  undo.push(command);
  assert.equal(doc.dirty, true);
  assert.equal(doc.rowCount, 6);
  assert.equal(doc.getCell(3, 0), "1");
  assert.equal(doc.getCell(4, 0), "3");
  assert.equal(doc.getCell(5, 0), "5");
  undo.undo(doc);
  assert.equal(doc.rowCount, 4);
  assert.equal(doc.getCell(3, 0), "5");
  undo.redo(doc);
  assert.equal(doc.getCell(3, 1), "2");
  assert.equal(doc.getCell(4, 1), "4");
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

test("copy and paste support first-row header cells", () => {
  const doc = TableDocument.fromText("skills.txt", "pSrvDoFunc\tpSrvHitFunc\n1\t2");
  assert.equal(copyRanges(doc, [{ top: 0, left: 0, bottom: 0, right: 0 }]), "pSrvDoFunc");
  const command = pasteTextToRangesCommand(doc, [{ top: 0, left: 1, bottom: 0, right: 1 }], { row: 0, column: 1 }, "renamed");
  command.redo(doc);
  assert.equal(doc.getCell(0, 1), "renamed");
});

test("multi-range clear applies only to selected cells", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\tc\n1\t2\t3\n4\t5\t6");
  clearRangesCommand(doc, [
    { top: 0, left: 0, bottom: 0, right: 0 },
    { top: 2, left: 2, bottom: 2, right: 2 }
  ]).redo(doc);
  assert.equal(doc.getCell(0, 0), "");
  assert.equal(doc.getCell(2, 2), "");
  assert.equal(doc.getCell(1, 1), "2");
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

test("fill uses the vertical selection anchor instead of the last focused cell", () => {
  const doc = TableDocument.fromText("x.txt", "v\n20\n10");
  const selection = new SelectionModel();
  selection.set(1, 0);
  selection.extend(2, 0);
  fillSelectedCellsCommand(doc, selection.ranges, selection.anchor).redo(doc);
  assert.equal(doc.getCell(1, 0), "20");
  assert.equal(doc.getCell(2, 0), "20");
});

test("fill uses the horizontal selection anchor instead of the last focused cell", () => {
  const doc = TableDocument.fromText("x.txt", "left\tright\n20\t115");
  const selection = new SelectionModel();
  selection.set(1, 0);
  selection.extend(1, 1);
  fillSelectedCellsCommand(doc, selection.ranges, selection.anchor).redo(doc);
  assert.equal(doc.getCell(1, 0), "20");
  assert.equal(doc.getCell(1, 1), "20");
});

test("fill uses the anchor cell over a non-contiguous selected cell set only", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\tc\n1\tseed\t3\n4\t5\t6");
  const selection = new SelectionModel();
  selection.set(1, 1);
  selection.toggleCell(2, 0);
  selection.toggleCell(0, 2);
  const command = fillSelectedCellsCommand(doc, selection.ranges, selection.anchor);
  command.redo(doc);
  assert.equal(doc.getCell(0, 2), "seed");
  assert.equal(doc.getCell(1, 1), "seed");
  assert.equal(doc.getCell(2, 0), "seed");
  assert.equal(doc.getCell(0, 0), "a");
  assert.equal(doc.getCell(1, 0), "1");
  assert.equal(doc.getCell(2, 1), "5");
  command.undo(doc);
  assert.equal(doc.getCell(0, 2), "c");
  assert.equal(doc.getCell(2, 0), "4");
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

test("context menu source stays anchored when right-clicking inside a multi-cell selection", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\tc\n20\t25\t30");
  const selection = new SelectionModel();
  selection.set(1, 0);
  selection.extend(1, 2);
  const contextHit = { kind: "cell", row: 1, column: 2 };
  if (contextHit.kind === "cell" && !selection.contains(contextHit.row, contextHit.column)) selection.set(contextHit.row, contextHit.column);
  assert.deepEqual(selection.anchor, { row: 1, column: 0 });
  fillSelectedCellsCommand(doc, selection.ranges, selection.anchor).redo(doc);
  assert.deepEqual(doc.rows[1], ["20", "20", "20"]);
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

test("explicit auto-fit can still expand for long body content", () => {
  const doc = TableDocument.fromText("x.txt", "Id\nForsaken 01 (Act1 Pit Cave)");
  const initial = doc.columnWidths[0];
  doc.autoFitColumn(0, 300);
  assert.ok(doc.columnWidths[0] > initial);
});

test("manual column width survives table shape refresh", () => {
  const doc = TableDocument.fromText("x.txt", "class\tstr\nama\t20");
  doc.columnWidths[0] = 240;
  doc.refreshShape();
  assert.equal(doc.columnWidths[0], 240);
});

test("keyboard commit movement targets expected cells", () => {
  assert.deepEqual(movedCell({ row: 2, column: 2 }, 0, 1, 10, 10), { row: 2, column: 3 });
  assert.deepEqual(movedCell({ row: 2, column: 2 }, 1, 0, 10, 10), { row: 3, column: 2 });
  assert.deepEqual(movedCell({ row: 0, column: 0 }, -1, -1, 10, 10), { row: 0, column: 0 });
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

test("editing cell drawing suppresses selected chrome only for the editing cell", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  const drawCell = source.match(/drawCell\(row, column, x, y, width, height, options = \{\}\) \{[\s\S]*?\n  drawDiagnosticMarker/)?.[0] ?? "";
  const styleEditor = source.match(/styleEditorForCell\(row, column\) \{[\s\S]*?\n  async measureColumnFitWidth/)?.[0] ?? "";
  assert.match(drawCell, /const editing = this\.editingCell\(\);/);
  assert.match(drawCell, /const editingThisCell = editing\?\.row === row && editing\?\.column === column;/);
  assert.match(drawCell, /const selected = !editingThisCell && this\.selection\.contains\(row, column\);/);
  assert.match(drawCell, /const active = !editingThisCell && this\.selection\.focus\.row === row && this\.selection\.focus\.column === column;/);
  assert.match(drawCell, /this\.drawDiagnosticMarker\(row, column, x, y, width, height\);/);
  assert.match(drawCell, /if \(active\) \{/);
  assert.match(styleEditor, /const unselectedBackground = cellBackground\(row, false, frozen, firstColumnLabel\);/);
  assert.match(styleEditor, /this\.editor\.style\.backgroundColor = unselectedBackground;/);
  assert.match(styleEditor, /cellTextColor\(row, column, this\.doc\.getCell\(row, column\), false, this\.colorizeColumns, firstColumnLabel\)/);
  assert.doesNotMatch(styleEditor, /const selectedBackground|opaqueColor|cellBackground\(row, true/);
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

test("Vector-LSP tooltip removes duplicate value titles only", () => {
  assert.deepEqual(
    normalizeVectorLspTooltip("StrClassOnly", "StrClassOnly\r\n\r\nLookup column used by string class filters."),
    { title: "StrClassOnly", detail: "Lookup column used by string class filters." }
  );
  assert.deepEqual(
    normalizeVectorLspTooltip("StrClassOnly", "Different title\n\nStrClassOnly is referenced in another note."),
    { title: "StrClassOnly", detail: "Different title\n\nStrClassOnly is referenced in another note." }
  );
  assert.deepEqual(
    normalizeVectorLspTooltip("", "StrClassOnly\n\nLookup column used by string class filters."),
    { title: "StrClassOnly", detail: "Lookup column used by string class filters." }
  );
});

test("delayed Vector-LSP header and cell hovers are accepted while the target is stable", () => {
  const header = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 0, column: 0, columnName: "description" });
  const cell = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 1, column: 18, columnName: "output" });
  assert.equal(header.targetKind, "header");
  assert.equal(cell.targetKind, "cell");
  assert.deepEqual(
    shouldAcceptVectorHoverResult({
      target: header,
      generation: 2,
      currentTargetKey: header.key,
      currentGeneration: 2,
      vectorHoverEnabled: true,
      contextMenuOpen: false
    }),
    { accepted: true, reason: "" }
  );
  assert.deepEqual(
    shouldAcceptVectorHoverResult({
      target: cell,
      generation: 3,
      currentTargetKey: cell.key,
      currentGeneration: 3,
      vectorHoverEnabled: true,
      contextMenuOpen: false
    }),
    { accepted: true, reason: "" }
  );
});

test("late Vector-LSP result can be accepted by stable target key after version churn", () => {
  const beforeReady = makeVectorHoverTarget({
    uri: "file:///cubemain.txt",
    fileName: "cubemain.txt",
    row: 1,
    column: 6,
    columnName: "op",
    cellValue: "18",
    documentVersion: 1
  });
  const afterReady = makeVectorHoverTarget({
    uri: "file:///cubemain.txt",
    fileName: "cubemain.txt",
    row: 1,
    column: 6,
    columnName: "op",
    cellValue: "18",
    documentVersion: 2
  });
  assert.notEqual(beforeReady.key, afterReady.key);
  assert.equal(beforeReady.matchKey, afterReady.matchKey);
  assert.deepEqual(
    shouldAcceptVectorHoverResult({
      target: beforeReady,
      generation: 1,
      currentTargetKey: afterReady.matchKey,
      currentGeneration: 1,
      vectorHoverEnabled: true,
      contextMenuOpen: false
    }),
    { accepted: true, reason: "" }
  );
});

test("Vector-LSP hover target identity includes version value and diagnostics state", () => {
  const base = makeVectorHoverTarget({
    uri: "file:///cubemain.txt",
    fileName: "cubemain.txt",
    row: 8,
    column: 4,
    columnName: "op",
    cellValue: "useitem",
    documentVersion: 3
  });
  const edited = makeVectorHoverTarget({
    uri: "file:///cubemain.txt",
    fileName: "cubemain.txt",
    row: 8,
    column: 4,
    columnName: "op",
    cellValue: "usetype",
    documentVersion: 4
  });
  const diagnostic = makeVectorHoverTarget({
    uri: "file:///cubemain.txt",
    fileName: "cubemain.txt",
    row: 8,
    column: 4,
    columnName: "op",
    cellValue: "useitem",
    documentVersion: 3,
    hasDiagnostics: true
  });
  assert.equal(base.targetKind, "cell");
  assert.equal(diagnostic.targetKind, "diagnostic-cell");
  assert.notEqual(base.key, edited.key);
  assert.notEqual(base.key, diagnostic.key);
});

test("pending Vector-LSP hover results are discarded for leave, target change, disabled hover, and context menu", () => {
  const first = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 0, column: 0, columnName: "description" });
  const second = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 0, column: 1, columnName: "enabled" });
  assert.equal(
    shouldAcceptVectorHoverResult({
      target: first,
      generation: 1,
      currentTargetKey: first.key,
      currentGeneration: 2,
      vectorHoverEnabled: true,
      contextMenuOpen: false
    }).reason,
    "generation-changed"
  );
  assert.equal(
    shouldAcceptVectorHoverResult({
      target: first,
      generation: 1,
      currentTargetKey: second.key,
      currentGeneration: 1,
      vectorHoverEnabled: true,
      contextMenuOpen: false
    }).reason,
    "target-changed"
  );
  assert.equal(
    shouldAcceptVectorHoverResult({
      target: first,
      generation: 1,
      currentTargetKey: first.key,
      currentGeneration: 1,
      vectorHoverEnabled: false,
      contextMenuOpen: false
    }).reason,
    "hover-disabled"
  );
  assert.equal(
    shouldAcceptVectorHoverResult({
      target: first,
      generation: 1,
      currentTargetKey: first.key,
      currentGeneration: 1,
      vectorHoverEnabled: true,
      contextMenuOpen: true
    }).reason,
    "context-menu-open"
  );
});

test("Vector-LSP hover samples record queued, requested, rendered, and canceled timings", () => {
  let tick = 100;
  const now = () => tick;
  const target = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 4, column: 0, columnName: "description" });
  const sample = startVectorHoverSample(target, { now, vectorHoverEnabled: true, cached: false, lspReady: false });
  assert.equal(sample.targetKind, "leftmost");
  assert.equal(sample.requestedAt, null);
  assert.equal(sample.lspReady, false);
  tick = 130;
  markVectorHoverRequested(sample, now);
  assert.equal(sample.requestedAt, 130);
  assert.equal(sample.lspReady, true);
  tick = 165;
  sample.responseAt = now();
  tick = 170;
  finishVectorHoverSample(sample, { now, contentReturned: true, rendered: true });
  assert.equal(sample.contentReturned, true);
  assert.equal(sample.noContent, false);
  assert.equal(sample.accepted, true);
  assert.equal(sample.renderedAt, 170);
  assert.equal(sample.tooltipRenderedAt, 170);
  assert.equal(sample.requestSentAt, 130);
  assert.equal(sample.lspResponseAt, 165);
  assert.equal(sample.totalMs, 70);
  assert.equal(sample.lspMs, 35);
  assert.equal(sample.renderMs, 5);

  const canceled = startVectorHoverSample(target, { now, vectorHoverEnabled: true, cached: false, lspReady: true });
  tick = 180;
  cancelVectorHoverSample(canceled, "grid-hover-cleared", now);
  assert.equal(canceled.canceled, true);
  assert.equal(canceled.cancelReason, "grid-hover-cleared");
  assert.equal(canceled.discarded, true);
  assert.equal(canceled.discardReason, "grid-hover-cleared");
});

test("accepted Vector-LSP no-content samples are recorded without rendering", () => {
  let tick = 300;
  const now = () => tick;
  const target = makeVectorHoverTarget({ uri: "file:///armor.txt", fileName: "armor.txt", row: 1, column: 4, columnName: "code", cellValue: "cap" });
  const sample = startVectorHoverSample(target, { now, vectorHoverEnabled: true, cached: false, lspReady: true });
  tick = 310;
  markVectorHoverRequested(sample, now);
  tick = 340;
  finishVectorHoverSample(sample, { now, contentReturned: false, rendered: false, pointerStillOnTarget: true });
  assert.equal(sample.accepted, true);
  assert.equal(sample.noContent, true);
  assert.equal(sample.contentReturned, false);
  assert.equal(sample.tooltipRenderedAt, null);
  assert.equal(sample.totalMs, 40);
});

test("canceled Vector-LSP hover samples cannot be finished by late responses", () => {
  let tick = 200;
  const now = () => tick;
  const target = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 1, column: 0, columnName: "description", cellValue: "test" });
  const sample = startVectorHoverSample(target, { now, vectorHoverEnabled: true, cached: false, lspReady: true });
  tick = 220;
  cancelVectorHoverSample(sample, "target-changed", now);
  tick = 260;
  finishVectorHoverSample(sample, { now, contentReturned: true, rendered: true, pointerStillOnTarget: true });
  assert.equal(sample.canceled, true);
  assert.equal(sample.accepted, false);
  assert.equal(sample.cancelReason, "target-changed");
  assert.equal(sample.renderedAt, null);
  assert.equal(sample.totalMs, 20);
});

test("Vector-LSP hover dispatch has no artificial delay", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.equal(VECTOR_LSP_HOVER_DELAY_MS, 0);
  assert.match(source, /export const VECTOR_LSP_HOVER_DELAY_MS = 0;/);
  const scheduler = source.match(/_scheduleHoverRequest\(row, col\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.doesNotMatch(scheduler, /setTimeout\(/);
  assert.match(scheduler, /this\.onHoverRequest\?\.\(this\._pendingHoverRow, this\._pendingHoverCol/);
});

test("hover delay is not restarted by repeated movement inside the same target", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(source, /const samePendingTarget = this\._pendingHoverRow === row && this\._pendingHoverCol === col;/);
  assert.match(source, /const sameRequestedTarget = this\._lastHoverRequestRow === row && this\._lastHoverRequestCol === col;/);
  assert.match(source, /if \(sameRequestedTarget\) return;/);
});

test("prewarm is disabled so background hover cannot block user hover", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /const HOVER_PREWARM_ENABLED = false;/);
  assert.match(source, /function scheduleHoverPrewarm\(reason = "schedule"\) \{\s*if \(!effectiveVectorLspHoverEnabled\(\)\) \{/);
  assert.match(source, /if \(!HOVER_PREWARM_ENABLED\) \{/);
  assert.match(source, /cancelHoverPrewarm\(reason\);\s*recordLspTraffic\(docToUri\(activeDoc\(\)\), "hover_prewarm_canceled", \{ reason, disabled: true, activeFile: activeDoc\(\)\?\.name \?\? "" \}\);\s*recordHoverPrewarmEvent\(\{ reason, skipped: true, disabled: true, queued: 0 \}\);\s*return;/);
  assert.match(source, /async function requestLspHover\(row, col, options = \{\}\) \{\s*if \(!effectiveVectorLspHoverEnabled\(\)\)/);
  assert.match(source, /cancelHoverPrewarm\("user-hover"\);/);
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

test("frozen pane edge uses a subtle raised effect instead of hard divider strokes", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(source, /drawFrozenVerticalEdge\(x, tableHeight\);/);
  assert.match(source, /drawFrozenHorizontalEdge\(y, tableWidth\);/);
  assert.match(source, /ctx\.fillStyle = GRID_COLORS\.frozenEdgeHighlight;[\s\S]*ctx\.fillRect\(x - 2, 0, 1, height\);/);
  assert.match(source, /ctx\.fillStyle = GRID_COLORS\.frozenEdgeShadow;[\s\S]*ctx\.fillRect\(x - 1, 0, 1, height\);/);
  assert.match(source, /ctx\.fillStyle = GRID_COLORS\.frozenEdgeAmbient;[\s\S]*ctx\.fillRect\(x, 0, 3, height\);/);
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
});

test("lint rule list excludes JSON rules and has no pending TXT rule placeholders", () => {
  assert.equal(LINT_RULES.some((rule) => rule.id.toLowerCase().startsWith("json/")), false);
  assert.equal(LINT_RULES.every((rule) => rule.implemented), true);
  assert.equal(LINT_RULES.every((rule) => !/not implemented|pending/i.test(rule.note ?? "")), true);
});

test("profile-specific rule groups exactly match RotW and 2.4 TXT rule lists", () => {
  assert.deepEqual(ruleIdsForProfile("RotW"), [
    "Basic/NoDuplicateExcel",
    "Basic/ExcelColumns",
    "Basic/LinkedExcel",
    "Basic/StringCheck",
    "Basic/NumericBounds",
    "Basic/BooleanFields",
    "Cube/ValidInputs",
    "Cube/ValidOutputs",
    "Cube/ValidOp",
    "Items/ValidSockets",
    "Items/NoIllegalGambling",
    "Items/ValidStatParameters",
    "Level/ValidWarp",
    "Level/ValidWPs",
    "Monsters/ValidChains",
    "Skills/EqualSkills",
    "String/NoUntranslated",
    "TC/ValidTreasure",
    "TC/ValidNegativePicks",
    "TC/ValidProbs"
  ]);
  assert.deepEqual(ruleIdsForProfile("2.4"), [
    "Basic/NoDuplicateExcel",
    "Basic/ExcelColumns",
    "Basic/LinkedExcel",
    "Basic/MissileRangeFieldSemantics",
    "Basic/MonstatsDesecratedTreasureClassSemantics",
    "Basic/MonEquipLevelOrder",
    "Basic/StringCheck",
    "Basic/NumericBounds",
    "Basic/BooleanFields",
    "Cube/ValidInputs",
    "Cube/ValidOutputs",
    "Cube/ValidOp",
    "Items/ValidSockets",
    "Items/NoIllegalGambling",
    "Items/ValidStatParameters",
    "Level/ValidWarp",
    "Level/ValidWPs",
    "Monsters/ValidChains",
    "Skills/EqualSkills",
    "String/NoUntranslated",
    "TC/ValidTreasure",
    "TC/ValidNegativePicks",
    "TC/ValidProbs"
  ]);
});

test("profile-specific rule groups hide 2.4-only rules from RotW", () => {
  const rotwIds = lintRuleGroupsForProfile("RotW").flatMap((group) => group.rules.map((rule) => rule.id));
  const d2r24Ids = lintRuleGroupsForProfile("2.4").flatMap((group) => group.rules.map((rule) => rule.id));
  assert.equal(rotwIds.includes("Basic/MissileRangeFieldSemantics"), false);
  assert.equal(rotwIds.includes("Basic/MonstatsDesecratedTreasureClassSemantics"), false);
  assert.equal(rotwIds.includes("Basic/MonEquipLevelOrder"), false);
  assert.equal(d2r24Ids.includes("Basic/MissileRangeFieldSemantics"), true);
  assert.equal(d2r24Ids.includes("Basic/MonstatsDesecratedTreasureClassSemantics"), true);
  assert.equal(d2r24Ids.includes("Basic/MonEquipLevelOrder"), true);
});

test("lint settings default to RotW with implemented rules enabled only", () => {
  const settings = normalizeLintSettings({});
  assert.equal(settings.profile, "RotW");
  assert.equal(settings.profiles.RotW.rules["Basic/LinkedExcel"].enabled, true);
  assert.equal(settings.profiles.RotW.rules["Cube/ValidInputs"].enabled, true);
  assert.equal(settings.profiles.RotW.rules["Items/ValidSockets"].enabled, true);
  assert.equal(settings.profiles.RotW.rules["Basic/MissileRangeFieldSemantics"], undefined);
  assert.equal(settings.profiles["2.4"].rules["Basic/MissileRangeFieldSemantics"].enabled, true);
});

test("lint catches duplicate excel identifiers and maps diagnostics to cells", () => {
  const doc = TableDocument.fromText("armor.txt", "code\tname\nabc\tOne\nabc\tTwo");
  const diagnostics = runLint([doc], createDefaultLintSettings());
  const duplicate = diagnostics.find((item) => item.ruleId === "Basic/NoDuplicateExcel");
  assert.equal(duplicate.fileName, "armor.txt");
  assert.equal(duplicate.rowIndex, 2);
  assert.equal(duplicate.columnIndex, 0);
  assert.equal(groupDiagnosticsByCell(diagnostics).has("2:0"), true);
  assert.equal(diagnosticsForDocument(diagnostics, doc).length > 0, true);
});

test("duplicate Excel lint preserves duplicate pairs without quadratic unique-row scans", () => {
  const doc = TableDocument.fromText("armor.txt", "code\tname\nabc\tOne\nabc\tTwo\nabc\tThree\nExpansion\tSkip\nExpansion\tSkip");
  const diagnostics = runLint([doc], createDefaultLintSettings()).filter((item) => item.ruleId === "Basic/NoDuplicateExcel");
  assert.equal(diagnostics.length, 3);
  assert.deepEqual(diagnostics.map((item) => item.rowIndex), [2, 3, 3]);
  const source = readFileSync(new URL("../src/core/lint-engine.js", import.meta.url), "utf8");
  const body = source.match(/function lintNoDuplicateExcel\(index, ctx\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(body, /const seen = new Map\(\);/);
  assert.doesNotMatch(body, /for \(let j = i \+ 1;/);
});

test("Basic/LinkedExcel reports bad references from workspace docs with exact cells", () => {
  const docs = [
    TableDocument.fromText("properties.txt", "code\nknown-prop", { path: "excel/properties.txt" }),
    TableDocument.fromText("itemstatcost.txt", "stat\nknown-stat", { path: "excel/itemstatcost.txt" }),
    TableDocument.fromText("missiles.txt", "missile\tskill\nknownmissile\tMissingSkill", { path: "excel/missiles.txt" }),
    TableDocument.fromText("skills.txt", "skill\tsrvmissilea\nKnownSkill\tmissingmissile", { path: "excel/skills.txt" }),
    TableDocument.fromText("uniqueitems.txt", "index\tprop3\nBad Unique\tmissing-prop", { path: "excel/uniqueitems.txt" }),
    TableDocument.fromText("misc.txt", "code\tname\tstat1\tnamestr\nbadmisc\tBad Misc\tmissing-stat\t", { path: "excel/misc.txt" })
  ];
  const diagnostics = lintDocs(docs).filter((item) => item.ruleId === "Basic/LinkedExcel");
  assert.ok(diagnostics.some((item) => item.fileName === "uniqueitems.txt" && item.rowIndex === 1 && item.columnName === "prop3" && item.rowLabel === "Bad Unique"));
  assert.ok(diagnostics.some((item) => item.fileName === "missiles.txt" && item.rowIndex === 1 && item.columnName === "skill" && item.rowLabel === "knownmissile"));
  assert.ok(diagnostics.some((item) => item.fileName === "skills.txt" && item.rowIndex === 1 && item.columnName === "srvmissilea" && item.rowLabel === "KnownSkill"));
  assert.ok(diagnostics.some((item) => item.fileName === "misc.txt" && item.rowIndex === 1 && item.columnName === "stat1" && item.rowLabel === "badmisc"));
  assert.ok(diagnostics.some((item) => item.fileName === "misc.txt" && item.rowIndex === 1 && item.columnName === "namestr" && item.d2rMessage === "misc.txt, line 2: namestr for 'Bad Misc' is blank but required"));
});

test("Basic/LinkedExcel resolves RotW propertygroups without hiding 2.4 or casing mismatches", () => {
  const docs = [
    TableDocument.fromText("properties.txt", "code\ngethit-skill"),
    TableDocument.fromText("propertygroups.txt", "code\tprop1\nGelid-Affix5\tgethit-skill\nBreaching-Affix4\tGelid-Affix5"),
    TableDocument.fromText("uniqueitems.txt", "index\tprop1\tprop2\tprop3\nRotW Item\tGelid-Affix5\tBreaching-Affix4\tGethit-skill"),
    TableDocument.fromText("magicprefix.txt", "name\tmod3code\nGelid\tGelid-Affix5")
  ];
  const rotw = lintDocs(docs, "RotW").filter((item) => item.ruleId === "Basic/LinkedExcel");
  assert.equal(rotw.some((item) => item.columnName === "prop1" && item.offendingValue === "Gelid-Affix5"), false);
  assert.equal(rotw.some((item) => item.columnName === "prop2" && item.offendingValue === "Breaching-Affix4"), false);
  assert.equal(rotw.some((item) => item.columnName === "mod3code" && item.offendingValue === "Gelid-Affix5"), false);
  assert.ok(rotw.some((item) => item.columnName === "prop3" && item.offendingValue === "Gethit-skill"));

  const d24 = lintDocs(docs, "2.4").filter((item) => item.ruleId === "Basic/LinkedExcel");
  assert.ok(d24.some((item) => item.columnName === "prop1" && item.offendingValue === "Gelid-Affix5"));
});

test("Basic/LinkedExcel covers d2rlint item type, sound, skilldesc, and summode links", () => {
  const docs = [
    TableDocument.fromText("properties.txt", "code\nknown-prop"),
    TableDocument.fromText("itemtypes.txt", "code\nwand"),
    TableDocument.fromText("magicprefix.txt", "name\titype1\nBurning\tstaff"),
    TableDocument.fromText("monsounds.txt", "id\nzombie"),
    TableDocument.fromText("monstats.txt", "id\tmonsound\tumonsound\nhorse\thorse\thorse"),
    TableDocument.fromText("skilldesc.txt", "skilldesc\nknown desc"),
    TableDocument.fromText("monmode.txt", "code\nNU"),
    TableDocument.fromText("skills.txt", "skill\tskilldesc\tsummon\tsummode\nUberAncientsHeal\tself heal\tzombie\t")
  ];
  const diagnostics = lintDocs(docs, "RotW").filter((item) => item.ruleId === "Basic/LinkedExcel");
  assert.ok(diagnostics.some((item) => item.fileName === "magicprefix.txt" && item.columnName === "itype1" && item.d2rMessage === "magicprefix.txt, line 2: itype1 'staff' not found for 'Burning'"));
  assert.ok(diagnostics.some((item) => item.fileName === "monstats.txt" && item.columnName === "monsound" && item.d2rMessage === "monstats.txt, line 2: monsound 'horse' not found for 'horse'"));
  assert.ok(diagnostics.some((item) => item.fileName === "monstats.txt" && item.columnName === "umonsound" && item.d2rMessage === "monstats.txt, line 2: umonsound 'horse' not found for 'horse'"));
  assert.ok(diagnostics.some((item) => item.fileName === "skills.txt" && item.columnName === "skilldesc" && item.d2rMessage === "skills.txt, line 2: skilldesc 'self heal' not found for 'UberAncientsHeal'"));
  assert.ok(diagnostics.some((item) => item.fileName === "skills.txt" && item.columnName === "summode" && item.d2rMessage === "skills.txt, line 2: invalid summode '' for 'UberAncientsHeal'"));
});

test("lint checks numeric bounds, boolean fields, cube rules, and treasure class rules", () => {
  const docs = [
    TableDocument.fromText("misc.txt", "code\tautobelt\nabc\t2"),
    TableDocument.fromText("armor.txt", "code\ncap"),
    TableDocument.fromText("weapons.txt", "code\naxe"),
    TableDocument.fromText("itemtypes.txt", "code\narmo"),
    TableDocument.fromText("itemstatcost.txt", "stat\nstrength"),
    TableDocument.fromText("setitems.txt", "index\nSet Cap"),
    TableDocument.fromText("uniqueitems.txt", "index\nUnique Cap"),
    TableDocument.fromText("cubemod.txt", "code\n"),
    TableDocument.fromText("cubemain.txt", "description\tenabled\tnuminputs\tinput 1\toutput\top\tparam\tvalue\nbad\t1\t2\tcap\tmissing\t5\tbadstat\t"),
    TableDocument.fromText("treasureclassex.txt", "Treasure Class\tPicks\tItem1\tProb1\tItem2\tProb2\nBadTC\t-2\tcap\t1\tmissing\t")
  ];
  const diagnostics = runLint(docs, createDefaultLintSettings());
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/BooleanFields" && item.columnName === "autobelt"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Cube/ValidInputs" && item.columnName === "numinputs"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Cube/ValidOutputs" && item.columnName === "output"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Cube/ValidOp" && item.columnName === "value"));
  assert.ok(diagnostics.some((item) => item.ruleId === "TC/ValidTreasure" && item.columnName === "Item2"));
  assert.ok(diagnostics.some((item) => item.ruleId === "TC/ValidNegativePicks" && item.columnName === "Picks"));
  assert.ok(diagnostics.some((item) => item.ruleId === "TC/ValidProbs" && item.columnName === "Prob2"));
});

test("Items/ValidSockets carries d2rlint-compatible socket messages", () => {
  const docs = [
    TableDocument.fromText("itemtypes.txt", "code\tmaxsocketslevelthreshold1\tmaxsocketslevelthreshold2\tmaxsockets1\tmaxsockets2\tmaxsockets3\namul\t0\t0\t0\t0\t0\norb\t0\t0\t3\t3\t3"),
    TableDocument.fromText("armor.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\n"),
    TableDocument.fromText("misc.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\nAmulet\tamu\tamul\t\t1\t1\t0\t1\t1"),
    TableDocument.fromText("weapons.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\nEagle Orb\tob1\torb\t\t1\t4\t0\t1\t2")
  ];
  const diagnostics = lintDocs(docs).filter((item) => item.ruleId === "Items/ValidSockets");
  assert.ok(diagnostics.some((item) => item.fileName === "misc.txt" && item.d2rMessage === "misc.txt, line 4: gemsockets (1) won't spawn on 'Amulet' because its type(s) won't allow more than 0 sockets."));
  assert.ok(diagnostics.some((item) => item.fileName === "weapons.txt" && item.d2rMessage === "weapons.txt, line 4: gemsockets (4) won't spawn on 'Eagle Orb' because its type(s) won't allow more than 3 sockets."));
  assert.ok(diagnostics.some((item) => item.fileName === "weapons.txt" && item.d2rMessage === "weapons.txt, line 4: 'Eagle Orb' has more gemsockets (4) than inventory spaces used (1 x 2 = 2)"));
});

test("remaining D2R TXT lint rules produce concrete diagnostics", () => {
  assert.ok(lintDocs([TableDocument.fromText("cubemain.txt", "description\tenabled\nbad\t1")]).some((item) => item.ruleId === "Basic/ExcelColumns"));
  assert.ok(lintDocs([TableDocument.fromText("localstrings.txt", "id\tKey\tenUS\tdeDE\n1\tHello\tHello\tHallo\n1\tOther\tOther\t")]).some((item) => item.ruleId === "Basic/StringCheck" && item.columnName === "id"));
  assert.ok(lintDocs([TableDocument.fromText("localstrings.txt", "id\tKey\tenUS\tdeDE\n1\tHello\tHello\t")]).some((item) => item.ruleId === "String/NoUntranslated" && item.columnName === "deDE"));

  const socketDocs = [
    TableDocument.fromText("itemtypes.txt", "code\tmaxsocketslevelthreshold1\tmaxsocketslevelthreshold2\tmaxsockets1\tmaxsockets2\tmaxsockets3\narmo\t30\t20\t2\t1\t7"),
    TableDocument.fromText("armor.txt", "code\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\ncap\tarmo\t\t1\t4\t5\t1\t2"),
    TableDocument.fromText("misc.txt", "code\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\n"),
    TableDocument.fromText("weapons.txt", "code\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\n")
  ];
  const socketDiagnostics = lintDocs(socketDocs);
  assert.ok(socketDiagnostics.some((item) => item.ruleId === "Items/ValidSockets" && item.columnName === "maxsocketslevelthreshold1"));
  assert.ok(socketDiagnostics.some((item) => item.ruleId === "Items/ValidSockets" && item.columnName === "gemapplytype"));

  const gambleDocs = [
    TableDocument.fromText("itemtypes.txt", "code\tequiv1\tequiv2\nchar\t\t\ncharm\tchar\t"),
    TableDocument.fromText("misc.txt", "code\ttype\ttype2\ncm1\tcharm\t"),
    TableDocument.fromText("gamble.txt", "code\ncm1")
  ];
  assert.ok(lintDocs(gambleDocs).some((item) => item.ruleId === "Items/NoIllegalGambling" && item.columnName === "code"));

  const statDocs = [
    TableDocument.fromText("properties.txt", "code\tfunc1\tstat1\nbadprop\t1\titem_strength"),
    TableDocument.fromText("itemstatcost.txt", "stat\tsave bits\tsave add\tsigned\tencode\nitem_strength\t2\t0\t0\t0"),
    TableDocument.fromText("skills.txt", "skill\nAttack"),
    TableDocument.fromText("uniqueitems.txt", "index\tprop1\tpar1\tmin1\tmax1\nBad Unique\tbadprop\t\t0\t5")
  ];
  assert.ok(lintDocs(statDocs).some((item) => item.ruleId === "Items/ValidStatParameters" && item.columnName === "max1"));

  const narrowStatDocs = [
    TableDocument.fromText("properties.txt", "code\tfunc1\tstat1\nreal-prop\t1\treal_stat\nbroad-prop\t20\t"),
    TableDocument.fromText("itemstatcost.txt", "stat\tsave bits\tsave add\tsigned\tencode\nreal_stat\t1\t0\t1\t0"),
    TableDocument.fromText("skills.txt", "skill\nAttack"),
    TableDocument.fromText("monprop.txt", "id\tprop1\tmin1\tmax1\ndruidhawk\treal-prop\t-1\t-1"),
    TableDocument.fromText("magicprefix.txt", "name\tmod1code\tmod1min\tmod1max\nMassive\tbroad-prop\t65\t65")
  ];
  const statWarnings = lintDocs(narrowStatDocs).filter((item) => item.ruleId === "Items/ValidStatParameters");
  assert.equal(statWarnings.length, 2);
  assert.ok(statWarnings.every((item) => item.fileName === "monprop.txt"));

  const levelDocs = [
    TableDocument.fromText("levels.txt", "id\tname\tvis0\twarp0\twaypoint\n1\tOne\t2\t5\t1\n2\tTwo\t0\t0\t1"),
    TableDocument.fromText("lvlwarp.txt", "name\nWarp Zero")
  ];
  const levelDiagnostics = lintDocs(levelDocs);
  assert.ok(levelDiagnostics.some((item) => item.ruleId === "Level/ValidWarp" && item.columnName === "vis0"));
  assert.ok(levelDiagnostics.some((item) => item.ruleId === "Level/ValidWPs" && item.columnName === "waypoint"));

  assert.ok(lintDocs([TableDocument.fromText("monstats.txt", "id\tbaseid\tnextinclass\tboss\tprimeevil\nzombie\tzombie\tmissing\t0\t0")]).some((item) => item.ruleId === "Monsters/ValidChains" && item.columnName === "nextinclass"));
  assert.ok(lintDocs([
    TableDocument.fromText("skills.txt", "skill\tcharclass\nA Skill\tama\nS Skill 1\tsor\nS Skill 2\tsor"),
    TableDocument.fromText("playerclass.txt", "code\nama\nsor")
  ]).some((item) => item.ruleId === "Skills/EqualSkills" && item.columnName === "code"));
});

test("d2rlint parity avoids socket checks when a required item table is absent", () => {
  const docs = [
    TableDocument.fromText("armor.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\nCap\tcap\tarmo\t\t1\t6\t9\t1\t1"),
    TableDocument.fromText("misc.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\n"),
    TableDocument.fromText("weapons.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\n")
  ];
  assert.equal(lintDocs(docs).some((item) => item.ruleId === "Items/ValidSockets"), false);
});

test("cube output lint resolves quoted items and property group output mods", () => {
  const docs = [
    TableDocument.fromText("armor.txt", "code\ncap"),
    TableDocument.fromText("misc.txt", "code\n"),
    TableDocument.fromText("weapons.txt", "code\n"),
    TableDocument.fromText("setitems.txt", "index\n"),
    TableDocument.fromText("uniqueitems.txt", "index\n"),
    TableDocument.fromText("itemtypes.txt", "code\narmo"),
    TableDocument.fromText("cubemod.txt", "code\n"),
    TableDocument.fromText("properties.txt", "code\nknown-property"),
    TableDocument.fromText("propertygroups.txt", "code\nknown-group"),
    TableDocument.fromText("cubemain.txt", "description\tenabled\tnuminputs\tinput 1\toutput\tb mod 1\nok\t1\t1\tcap\t\"cap,mag\"\tknown-group")
  ];
  const diagnostics = lintDocs(docs).filter((item) => item.ruleId === "Cube/ValidOutputs");
  assert.equal(diagnostics.length, 0);
});

test("valid stat parameter lint follows d2rlint file scope and ignores cubemain mods", () => {
  const docs = [
    TableDocument.fromText("properties.txt", "code\tfunc1\tstat1\nbadprop\t1\titem_strength"),
    TableDocument.fromText("itemstatcost.txt", "stat\tsave bits\tsave add\tsigned\tencode\nitem_strength\t2\t0\t0\t0"),
    TableDocument.fromText("skills.txt", "skill\nAttack"),
    TableDocument.fromText("cubemain.txt", "description\tenabled\tmod 1\tmod 1 min\tmod 1 max\ncube\t1\tbadprop\t0\t5")
  ];
  assert.equal(lintDocs(docs).some((item) => item.ruleId === "Items/ValidStatParameters"), false);
});

test("2.4-only TXT lint rules are implemented and hidden from RotW", () => {
  const docs = [
    TableDocument.fromText("missiles.txt", "missile\trange\nbolt\tpar3"),
    TableDocument.fromText("monstats.txt", "id\ttreasureclassdesecrated\ttreasureclassdesecratedchamp\ttreasureclassdesecratedunique\nzombie\t\tAct 1 Champ\t"),
    TableDocument.fromText("monequip.txt", "monster\tlevel\nzombie\t5\nzombie\t10")
  ];
  assert.equal(lintDocs(docs, "RotW").some((item) =>
    item.ruleId === "Basic/MissileRangeFieldSemantics" ||
    item.ruleId === "Basic/MonstatsDesecratedTreasureClassSemantics" ||
    item.ruleId === "Basic/MonEquipLevelOrder"
  ), false);
  const diagnostics = lintDocs(docs, "2.4");
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/MissileRangeFieldSemantics" && item.columnName === "range"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/MonstatsDesecratedTreasureClassSemantics" && item.columnName === "treasureclassdesecrated"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/MonEquipLevelOrder" && item.columnName === "level"));
});

test("RotW 3.2 schema accepts new Excel columns without Basic/ExcelColumns warnings", () => {
  const docs = [
    TableDocument.fromText("charstats.txt", "class\ttwohandedoffhandrestrictitemtype\ttwohandeddamageasonehanded\nama\taxe\t1"),
    TableDocument.fromText("levels.txt", "id\tcompletiontotalroomsoverride\n1\t0"),
    TableDocument.fromText("monpet.txt", "monster\tcalc1\tcalc2\tcalc3\tcalc4\tcalc5\tboundstat1\tboundcalc1\tboundstat2\tboundcalc2\tboundstat3\tboundcalc3\tboundstat4\tboundcalc4\tboundstat5\tboundcalc5\nwolf\t1\t2\t3\t4\t5\thp\t1\tmana\t2\tstr\t3\tdex\t4\tvit\t5"),
    TableDocument.fromText("soundenviron.txt", "index\tinheritenvironment\tinheritenvrionment\ncave\t1\t0")
  ];
  const warnings = lintDocs(docs, "RotW").filter((item) => item.ruleId === "Basic/ExcelColumns");
  assert.deepEqual(warnings.map((item) => `${item.fileName}:${item.columnName}`), []);
});

test("RotW 3.2 missile pcltdofunc allows 77 but still rejects larger values", () => {
  const doc = TableDocument.fromText("missiles.txt", "missile\tpcltdofunc\nok\t77\nbad\t78");
  const diagnostics = lintDocs([doc], "RotW").filter((item) => item.ruleId === "Basic/NumericBounds" && item.columnName === "pcltdofunc");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].rowIndex, 2);
  assert.equal(diagnostics[0].offendingValue, "78");
});

test("RotW 3.2 schema and bounds do not leak into the 2.4 profile", () => {
  const docs = [
    TableDocument.fromText("charstats.txt", "class\ttwohandedoffhandrestrictitemtype\ttwohandeddamageasonehanded\nama\taxe\t1"),
    TableDocument.fromText("levels.txt", "id\tcompletiontotalroomsoverride\n1\t0"),
    TableDocument.fromText("missiles.txt", "missile\tpcltdofunc\nbolt\t77")
  ];
  const diagnostics = lintDocs(docs, "2.4");
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/ExcelColumns" && item.fileName === "charstats.txt" && item.columnName === "twohandedoffhandrestrictitemtype"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/ExcelColumns" && item.fileName === "charstats.txt" && item.columnName === "twohandeddamageasonehanded"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/ExcelColumns" && item.fileName === "levels.txt" && item.columnName === "completiontotalroomsoverride"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/NumericBounds" && item.fileName === "missiles.txt" && item.columnName === "pcltdofunc" && item.offendingValue === "77"));
});

test("single-file lint avoids cross-file cube reference false positives", () => {
  const doc = TableDocument.fromText("cubemain.txt", "description\tenabled\tnuminputs\tinput 1\toutput\top\tparam\tvalue\nok\t1\t1\tunknown\talso_unknown\t0\t\t");
  const diagnostics = runLint([doc], createDefaultLintSettings());
  assert.equal(diagnostics.some((item) => item.ruleId === "Cube/ValidInputs" || item.ruleId === "Cube/ValidOutputs"), false);
});

test("lint profile affects D2R 2.4 missile range semantics", () => {
  const doc = TableDocument.fromText("missiles.txt", "missile\trange\nbolt\tpar3");
  assert.equal(runLint([doc], createDefaultLintSettings()).some((item) => item.ruleId === "Basic/MissileRangeFieldSemantics"), false);
  const settings = createDefaultLintSettings();
  settings.profile = "2.4";
  settings.profiles["2.4"].rules["Basic/MissileRangeFieldSemantics"].enabled = true;
  assert.equal(runLint([doc], settings).some((item) => item.ruleId === "Basic/MissileRangeFieldSemantics"), true);
});

test("fixed lint diagnostics disappear after re-running on edited data", () => {
  const doc = TableDocument.fromText("misc.txt", "code\tautobelt\nabc\t2");
  assert.equal(runLint([doc], createDefaultLintSettings()).some((item) => item.ruleId === "Basic/BooleanFields"), true);
  doc.setCell(1, 1, "1");
  assert.equal(runLint([doc], createDefaultLintSettings()).some((item) => item.ruleId === "Basic/BooleanFields"), false);
});

test("blank version is ignored only on dummy section rows", () => {
  const doc = TableDocument.fromText("uniqueitems.txt", "index\tversion\tcode\tprop1\nWarlock Class Pack\t\t\t\nReal Missing\t\tcap\t\nReal Bad\t2\tcap\t");
  const diagnostics = lintDocs([doc], "RotW").filter((item) => item.ruleId === "Basic/NumericBounds" && item.fileName === "uniqueitems.txt");
  assert.equal(diagnostics.some((item) => item.rowIndex === 1 && item.columnName === "version"), false);
  assert.ok(diagnostics.some((item) => item.rowIndex === 2 && item.columnName === "version"));
  assert.ok(diagnostics.some((item) => item.rowIndex === 3 && item.columnName === "version"));
});

test("lint diagnostics expose semantic labels and active profile", () => {
  const doc = TableDocument.fromText("treasureclassex.txt", "Treasure Class\tPicks\tItem1\tProb1\nAct 1 (N) Unique B\t-2\tcap\t1");
  const diagnostic = runLint([doc], createDefaultLintSettings()).find((item) => item.ruleId === "TC/ValidNegativePicks");
  assert.equal(diagnostic.profile, "RotW");
  assert.equal(diagnostic.rowLabel, "Act 1 (N) Unique B");
  assert.equal(diagnostic.columnName, "Picks");
  assert.equal(diagnostic.locationLabel, "Act 1 (N) Unique B > Picks");
  assert.equal(diagnostic.primaryLocationLabel, "Act 1 (N) Unique B > Picks");
  assert.equal(diagnostic.technicalLocationLabel, "R2:C2");
  assert.equal(diagnostic.offendingValue, "-2");
});

test("d2rlint-compatible export uses WARN tab-separated diagnostics", () => {
  const doc = TableDocument.fromText("treasureclassex.txt", "Treasure Class\tPicks\tItem1\tProb1\nAct 1 (N) Unique B\t-2\tcap\t1");
  const diagnostics = runLint([doc], createDefaultLintSettings());
  const text = formatD2rlintCompatibleExport({ diagnostics });
  assert.match(text, /^WARN\tTC\/ValidNegativePicks\ttreasureclassex\.txt, line 2: 'picks' \(-2\) doesn't match negative sum of probs \(-1\) for 'Act 1 \(N\) Unique B'$/m);
  assert.equal(text.split("\n").filter(Boolean).length, diagnostics.length);
  assert.equal(/Log started|20\d\d-\d\d-\d\d|T\d\d:\d\d/.test(text), false);
  assert.equal(formatD2rlintCompatibleExport({ diagnostics }), text);
});

test("d2rlint-compatible export preserves severity labels and selected profile diagnostics", () => {
  const diagnostics = [
    { severity: "info", ruleId: "Info/Rule", fileName: "z.txt", rowIndex: 4, columnIndex: 0, message: "info message", profile: "2.4" },
    { severity: "error", ruleId: "Error/Rule", fileName: "a.txt", rowIndex: 0, columnIndex: 1, message: "error message", profile: "2.4" }
  ];
  const text = formatD2rlintCompatibleExport({ diagnostics });
  assert.match(text, /^ERROR\tError\/Rule\ta\.txt, line 1: error message$/m);
  assert.match(text, /^INFO\tInfo\/Rule\tz\.txt, line 5: info message$/m);
  assert.equal(text.split("\n").filter(Boolean).length, 2);
});

test("lint exports use the canonical diagnostics count and deterministic ordering", () => {
  const diagnostics = [
    { severity: "warning", ruleId: "B/Rule", profile: "RotW", filePath: "z/misc.txt", fileName: "misc.txt", rowIndex: 5, columnIndex: 3, rowLabel: "Zed", columnName: "code", offendingValue: "bad", message: "z message" },
    { severity: "warning", ruleId: "A/Rule", profile: "RotW", filePath: "a/armor.txt", fileName: "armor.txt", rowIndex: 1, columnIndex: 2, rowLabel: "Cap", columnName: "prop1", offendingValue: "Gelid-Affix5", message: "a message" }
  ];
  const readable = formatTxteditorLintExport({ diagnostics });
  const compatible = formatD2rlintCompatibleExport({ diagnostics });
  assert.equal(readable.trimEnd().split("\n").length - 1, diagnostics.length);
  assert.equal(compatible.trimEnd().split("\n").filter(Boolean).length, diagnostics.length);
  assert.match(readable, /^severity\truleId\tprofile\tfilePath\tfileName\trowIndex\tline\trowLabel\tcolumnName\tcellValue\tmessage\nWARN\tA\/Rule\tRotW\ta\/armor\.txt/m);
  assert.match(compatible, /^WARN\tA\/Rule\tarmor\.txt, line 2: a message\nWARN\tB\/Rule\tmisc\.txt, line 6: z message\n$/);
});

test("disabling a lint rule removes that rule's diagnostics", () => {
  const doc = TableDocument.fromText("armor.txt", "code\tname\nabc\tOne\nabc\tTwo");
  const settings = createDefaultLintSettings();
  assert.equal(runLint([doc], settings).some((item) => item.ruleId === "Basic/NoDuplicateExcel"), true);
  settings.profiles.RotW.rules["Basic/NoDuplicateExcel"].enabled = false;
  assert.equal(runLint([doc], settings).some((item) => item.ruleId === "Basic/NoDuplicateExcel"), false);
});

test("disabling Basic/LinkedExcel removes linked-reference diagnostics", () => {
  const docs = [
    TableDocument.fromText("properties.txt", "code\nknown-prop"),
    TableDocument.fromText("uniqueitems.txt", "index\tprop1\nBad Unique\tmissing-prop")
  ];
  const settings = createDefaultLintSettings();
  assert.equal(runLint(docs, settings).some((item) => item.ruleId === "Basic/LinkedExcel"), true);
  settings.profiles.RotW.rules["Basic/LinkedExcel"].enabled = false;
  assert.equal(runLint(docs, settings).some((item) => item.ruleId === "Basic/LinkedExcel"), false);
});

test("profile switching replaces previous profile diagnostics", () => {
  const doc = TableDocument.fromText("missiles.txt", "missile\trange\nbolt\tpar3");
  const settings = createDefaultLintSettings();
  assert.equal(runLint([doc], settings).some((item) => item.profile === "RotW" && item.ruleId === "Basic/MissileRangeFieldSemantics"), false);
  settings.profile = "2.4";
  settings.profiles["2.4"].rules["Basic/MissileRangeFieldSemantics"].enabled = true;
  const diagnostics = runLint([doc], settings);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].profile, "2.4");
  assert.equal(diagnostics[0].locationLabel, "bolt > range");
});

test("workspace lint can report diagnostics for files that are not the active document", () => {
  const activeDoc = TableDocument.fromText("misc.txt", "code\tautobelt\nok\t1");
  const workspaceOnlyDoc = TableDocument.fromText("armor.txt", "code\tname\nabc\tOne\nabc\tTwo");
  const diagnostics = runLint([activeDoc, workspaceOnlyDoc], createDefaultLintSettings());
  assert.equal(diagnosticsForDocument(diagnostics, activeDoc).length, 0);
  assert.equal(diagnosticsForDocument(diagnostics, workspaceOnlyDoc).some((item) => item.ruleId === "Basic/NoDuplicateExcel"), true);
});

test("workspace index represents every Explorer txt as loaded and parsed", () => {
  const explorerFiles = [
    { path: "fixtures/excel/armor.txt", name: "armor.txt" },
    { path: "fixtures/excel/misc.txt", name: "misc.txt" },
    { path: "fixtures/excel/cubemain.txt", name: "cubemain.txt" }
  ];
  const docs = [
    TableDocument.fromText("armor.txt", "code\ncap", { path: "fixtures/excel/armor.txt" }),
    TableDocument.fromText("misc.txt", "code\nhpot", { path: "fixtures/excel/misc.txt" }),
    TableDocument.fromText("cubemain.txt", "description\tenabled\tnuminputs\tinput 1\toutput\top\tparam\tvalue\nrecipe\t1\t1\thpot\tcap\t0\t\t", { path: "fixtures/excel/cubemain.txt" })
  ];
  const fileStates = buildWorkspaceFileStates(explorerFiles, docs);
  assert.equal(fileStates.size, explorerFiles.length);
  for (const file of explorerFiles) {
    const state = fileStates.get(file.path.toLowerCase());
    assert.equal(state.loadedForIndex, true);
    assert.equal(state.parsedForLint, true);
  }
  const index = buildWorkspaceIndex(docs, "RotW");
  assert.equal(index.files.size, docs.length);
  assert.equal(index.tablesByName.has("cubemain.txt"), true);
  assert.equal(index.itemCodes.has("hpot"), true);
  assert.equal(index.itemCodes.has("cap"), true);
  assert.equal(index.rowLabelsByFile.get("fixtures/excel/cubemain.txt").get(1), "recipe");
  assert.equal(runLint(docs, createDefaultLintSettings()).some((item) => item.ruleId === "Cube/ValidInputs"), false);
});

test("workspace file states keep parse errors visible instead of silently ignoring files", () => {
  const explorerFiles = [{ path: "fixtures/excel/bad.txt", name: "bad.txt" }];
  const errors = new Map([["fixtures/excel/bad.txt", "Unable to parse"]]);
  const fileStates = buildWorkspaceFileStates(explorerFiles, [], errors);
  const state = fileStates.get("fixtures/excel/bad.txt");
  assert.equal(state.loadedForIndex, true);
  assert.equal(state.parsedForLint, false);
  assert.equal(state.parseError, "Unable to parse");
});

test("settings UI lives in Settings while lint controls stay in the bottom Problems panel", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const toolbar = html.match(/<section class="toolbar">([\s\S]*?)<\/section>/)?.[1] ?? "";
  const problems = html.match(/<section id="problemsPanel"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.equal(toolbar.includes("toggle-lint"), false);
  assert.equal(toolbar.includes("open-settings"), false);
  assert.equal(problems.includes("lintControls"), true);
  assert.equal(problems.includes("lintRulesPanel"), true);
  assert.equal(toolbar.includes("open-app-settings"), true);
  assert.equal(toolbar.includes("toggle-colorize"), false);
  assert.equal(toolbar.includes("fontSelect"), false);
  assert.equal(toolbar.includes("toggle-theme"), false);
  for (const removed of ["run-lint", "toggle-auto-lint", "Run Lint", "Auto Lint", "export-lint-txt", "export-d2rlint-txt", "export-lint-txt-d2rlint", "Export Lint TXT", "Export d2rlint TXT"]) {
    assert.equal(html.includes(removed), false);
  }
  assert.equal(problems.includes("problemsResizer"), true);
  assert.equal(html.includes("sidebarResizer"), true);
});

test("temporary lint TXT export commands are not exposed in the app UI", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.equal(source.includes("export-lint-txt"), false);
  assert.equal(source.includes("export-d2rlint-txt"), false);
  assert.equal(source.includes("Export Lint TXT"), false);
  assert.equal(source.includes("Export d2rlint TXT"), false);
  assert.equal(source.includes("function exportLintTxt"), false);
  assert.equal(source.includes("formatTxteditorLintExport"), false);
  assert.equal(source.includes("formatD2rlintCompatibleExport"), false);
});

test("Open File and Open Folder sidebar buttons are constrained to one line", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(html, /<button data-command="open-file">Open File<\/button>/);
  assert.match(html, /<button data-command="open-folder">Open Folder<\/button>/);
  assert.match(css, /--sidebar-width:\s*260px/);
  assert.match(css, /\.layout-root\s*\{[\s\S]*grid-template-columns:\s*var\(--dock-left-width\) minmax\(var\(--editor-min-width\), 1fr\) var\(--dock-right-width\)/);
  assert.match(css, /\.sidebar\s*\{[\s\S]*min-width:\s*0/);
  assert.match(css, /\.sidebar-actions button\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(app, /const MIN_SIDEBAR_WIDTH = 260/);
  assert.match(app, /clamp\(Math\.round\(width\), MIN_SIDEBAR_WIDTH, 520\)/);
});

test("app source has real Explorer and Problems toggles with persisted resize state", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /async function toggleExplorerPane\(\)/);
  assert.match(source, /async function toggleProblemsPanel\(\)/);
  assert.match(source, /txteditor\.sidebarWidth/);
  assert.match(source, /txteditor\.problemsHeight/);
  assert.match(source, /problemsVisible: localStorage\.getItem\("txteditor\.problems"\) === "visible"/);
  assert.match(source, /localStorage\.setItem\("txteditor\.problems", state\.problemsVisible \? "visible" : "hidden"\)/);
});

test("dock layout defaults to Explorer left and Problems bottom without replacing visibility keys", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const resetDockLayout = source.match(/function resetDockLayout\(\)[\s\S]*?\nfunction setDockSplitRatio/)?.[0] ?? "";
  assert.match(source, /const DOCK_EDGES = \["left", "right", "top", "bottom"\];/);
  assert.match(source, /const DEFAULT_DOCK_LAYOUT = Object\.freeze\(\{\s*explorer: "left",\s*problems: "bottom"/);
  assert.match(source, /const savedDockLayout = normalizeDockLayout\(readJsonStorage\("txteditor\.layout\.docks", DEFAULT_DOCK_LAYOUT\)\);/);
  assert.match(source, /dockLayout: savedDockLayout/);
  assert.match(source, /sidebarVisible: localStorage\.getItem\("txteditor\.sidebar"\) !== "hidden"/);
  assert.match(source, /problemsVisible: localStorage\.getItem\("txteditor\.problems"\) === "visible"/);
  assert.match(source, /localStorage\.setItem\("txteditor\.layout\.docks", JSON\.stringify\(state\.dockLayout\)\)/);
  assert.match(resetDockLayout, /explorer: DEFAULT_DOCK_LAYOUT\.explorer/);
  assert.match(resetDockLayout, /problems: DEFAULT_DOCK_LAYOUT\.problems/);
  assert.doesNotMatch(resetDockLayout, /sidebarVisible|problemsVisible|txteditor\.sidebar|txteditor\.problems|state\.lint/);
});

test("dock shell renders every edge and same-edge split orientations", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  for (const id of ["layoutRoot", "dockTop", "dockLeft", "dockRight", "dockBottom"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-dock-panel="explorer"/);
  assert.match(html, /data-dock-panel="problems"/);
  assert.match(css, /\.dock-left\s*\{[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.dock-right\s*\{[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.dock-top\s*\{[\s\S]*flex-direction:\s*row/);
  assert.match(css, /\.dock-bottom\s*\{[\s\S]*flex-direction:\s*row/);
  assert.match(css, /\.dock-left \.dock-splitter,\s*\.dock-right \.dock-splitter\s*\{[\s\S]*cursor:\s*ns-resize/);
  assert.match(css, /\.dock-top \.dock-splitter,\s*\.dock-bottom \.dock-splitter\s*\{[\s\S]*cursor:\s*ew-resize/);
  assert.match(source, /function syncDockLayout\(\)/);
  assert.match(source, /function dockSplitter\(edge\)/);
  assert.match(source, /function startDockSplitResize\(edge, event\)/);
  assert.match(source, /function setDockEdgeSize\(edge, size\)/);
  assert.match(source, /grid\.layout\(\);/);
});

test("dock settings expose Explorer, Problems, and reset layout without drag controls", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const appSettings = source.match(/function showAppSettings\(\)[\s\S]*?\nasync function showSettings\(\)/)?.[0] ?? "";
  assert.match(appSettings, /Explorer Dock/);
  assert.match(appSettings, /Problems Dock/);
  assert.match(appSettings, /data-settings-dock-panel="\$\{panel\}"/);
  assert.match(appSettings, /data-settings-reset-layout/);
  assert.match(appSettings, /setPanelDock\(button\.dataset\.settingsDockPanel, button\.dataset\.settingsDockEdge\)/);
  assert.match(appSettings, /resetDockLayout\(\); refresh\(\);/);
  assert.doesNotMatch(source, /DOCK_DRAG_THRESHOLD/);
  assert.doesNotMatch(source, /function wireDocking\(\)/);
  assert.doesNotMatch(source, /function startDockPointerDrag/);
  assert.doesNotMatch(source, /dockDragState/);
  assert.doesNotMatch(source, /dockDragHandle/);
});

test("dock drop UI is removed and docked controls keep a single-row Problems header", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /dockDropZones|dock-drop-zone|data-dock-target/);
  assert.doesNotMatch(html, /activity-button[^>]*data-dock-panel|sidebar-header[^>]*data-dock-panel|problems-header[^>]*data-dock-panel/);
  assert.doesNotMatch(css, /dock-drop-zone|dock-dragging|dock-drag-handle/);
  assert.doesNotMatch(source, /dockDropZones|data-dock-target|dockSuppressClick/);
  assert.match(css, /\.main\s*\{[\s\S]*grid-template-rows:\s*34px auto minmax\(0, 1fr\);/);
  assert.match(css, /\.toolbar\s*\{[\s\S]*overflow-x:\s*auto;/);
  assert.match(css, /\.problems-panel\s*\{[\s\S]*grid-template-rows:\s*38px auto minmax\(0, 1fr\);/);
  assert.match(css, /\.problems-panel\.problems-panel-narrow\s*\{[\s\S]*grid-template-rows:\s*76px auto minmax\(0, 1fr\);/);
  assert.match(css, /\.problems-header\s*\{[\s\S]*height:\s*38px;[\s\S]*overflow-x:\s*auto;[\s\S]*scrollbar-width:\s*none;/);
  assert.match(css, /\.problems-panel\.problems-panel-narrow \.problems-header\s*\{[\s\S]*grid-template-rows:\s*38px 38px;[\s\S]*height:\s*76px;/);
  assert.match(css, /\.problems-panel\.problems-panel-narrow \.lint-controls\s*\{[\s\S]*height:\s*38px;[\s\S]*overflow-x:\s*auto;[\s\S]*scrollbar-width:\s*none;/);
  assert.match(css, /\.lint-controls\s*\{[\s\S]*flex:\s*0 0 auto;/);
  assert.match(css, /\.problem-item\s*\{[\s\S]*white-space:\s*nowrap !important;/);
  assert.match(css, /\.problems-panel\[data-dock-edge="left"\] \.problem-item,\s*\.problems-panel\[data-dock-edge="right"\] \.problem-item\s*\{[\s\S]*white-space:\s*normal !important;/);
  assert.match(css, /\.problems-panel\[data-dock-edge="left"\] \.problem-message,\s*\.problems-panel\[data-dock-edge="right"\] \.problem-message\s*\{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*white-space:\s*normal;/);
  assert.match(source, /function syncProblemsHeaderLayout\(\)/);
  assert.match(source, /header\.scrollWidth > header\.clientWidth \+ 2/);
  assert.doesNotMatch(css, /\.problems-panel\[data-dock-edge="left"\] \.problems-header/);
  assert.doesNotMatch(css, /\.problems-panel\[data-dock-edge="left"\] \.lint-controls/);
});

test("Problems lint panel is gated by the active P panel and lint enabled state", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /function lintActive\(\)\s*\{\s*return state\.problemsVisible && state\.lint\.enabled;/);
  assert.match(source, /if \(!state\.lint\.enabled \|\| !isVectorLintEngine\(\)\) \{/);
  assert.match(source, /const diagnosticsByCell = lintActive\(\)\s*\?\s*groupDiagnosticsByCell/);
  assert.match(source, /const diags = lintActive\(\) \? diagnosticsForDocument/);
});

test("Legacy Lint and Vector-LSP activation stay independent of dock placement", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const lintActivation = source.match(/function lintActive\(\)[\s\S]*?\nfunction effectiveVectorLspHoverEnabled/)?.[0] ?? "";
  const legacyScheduling = source.match(/function scheduleLegacyLintForOpen[\s\S]*?\nasync function runLegacyLint/)?.[0] ?? "";
  const vectorDiagnostics = source.match(/function handleLspDiagnosticsChanged[\s\S]*?\nfunction updateGridDiagnostics/)?.[0] ?? "";
  assert.match(lintActivation, /return state\.problemsVisible && state\.lint\.enabled;/);
  assert.match(lintActivation, /return lintActive\(\) && isLegacyLintEngine\(\);/);
  assert.match(lintActivation, /return lintActive\(\) && isVectorLintEngine\(\);/);
  assert.doesNotMatch(lintActivation, /dockLayout|dockForPanel|txteditor\.layout\.docks/);
  assert.doesNotMatch(legacyScheduling, /dockLayout|dockForPanel|txteditor\.layout\.docks/);
  assert.doesNotMatch(vectorDiagnostics, /dockLayout|dockForPanel|txteditor\.layout\.docks/);
});

test("context menu uses one explicit active submenu and exposes Clone Row only", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(source, /function openContextSubmenu\(group\)/);
  assert.match(source, /candidate\.classList\.toggle\("active", candidate === group\)/);
  assert.match(source, /state\.contextMenuActiveGroup = ""/);
  assert.match(source, /if \(event\.key === "Escape" && !els\.contextMenu\.classList\.contains\("hidden"\)\)[\s\S]*hideContextMenu\(\)/);
  assert.match(source, /\{ id: "clone-row", label: "Clone Row"/);
  assert.equal(source.includes("Swap Rows"), false);
  assert.match(css, /\.menu-group\.active > \.submenu\s*\{\s*display: block;/);
  assert.doesNotMatch(css, /\.menu-group:hover \.submenu/);
});

test("row context menu orders Clone Row after hide and delete without changing commands", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const rowItems = source.match(/function rowItems\(\)\s*\{[\s\S]*?return \[([\s\S]*?)\];\s*\}/)?.[1] ?? "";
  const ids = [...rowItems.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["add-row", "insert-row", "hide-row", "delete-row", "clone-row"]);
  assert.match(rowItems, /\{ id: "clone-row", label: "Clone Row", disabled: rowsForContextOperation\(\)/);
});

test("context menu suspends default and Vector-LSP hover until it closes", () => {
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const grid = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(app, /contextMenuOpen: false/);
  assert.match(app, /function showContextMenu\(\{ x, y, hit \}\)[\s\S]*setContextMenuOpen\(true\)/);
  assert.match(app, /function hideContextMenu\(\)[\s\S]*setContextMenuOpen\(false\)/);
  assert.match(app, /function setContextMenuOpen\(open\)\s*\{\s*state\.contextMenuOpen = Boolean\(open\);\s*if \(state\.contextMenuOpen\) clearVisibleLspHover\("context-menu-open"\);\s*grid\.setHoverSuspended\(state\.contextMenuOpen\);/);
  assert.match(app, /async function requestLspHover\(row, col, options = \{\}\)/);
  assert.match(app, /onHoverInvalidated: \(\) => clearVisibleLspHover\("grid-hover-cleared"\)/);
  assert.match(app, /function clearVisibleLspHover\(reason = "hover-cleared"\)[\s\S]*recordHoverQueueEvent\(\{ reason, visibleClear: true, inFlight: lspHoverPending\.size \}\);/);
  assert.doesNotMatch(app.match(/function clearVisibleLspHover[\s\S]*?function recordHoverSample/)?.[0] ?? "", /lspHoverPending\.clear\(\)/);
  assert.match(app, /let lspHoverGeneration = 0;/);
  assert.match(app, /shouldAcceptVectorHoverResult\(\{[\s\S]*currentTargetKey: lspHoverCurrentTarget\?\.matchKey \?\? lspHoverCurrentTarget\?\.key,[\s\S]*contextMenuOpen: state\.contextMenuOpen/);
  assert.match(grid, /setHoverSuspended\(suspended\)/);
  assert.match(grid, /clearHoverState\(\)/);
  assert.match(grid, /return !this\.hoverSuspended && !this\.resizing && !this\.dragging;/);
  assert.match(grid, /if \(!this\.isHoverAllowed\(\) \|\| hit\.kind !== "cell" \|\| this\.dragging\)/);
  assert.match(grid, /if \(!this\.isHoverAllowed\(\)\) return;\s*if \(!this\.vectorLspHoverEnabled\) return;/);
  assert.match(grid, /setLspHover\(row, col, text\) \{\s*if \(!this\.isHoverAllowed\(\)\) return;\s*if \(this\._hoveredCell\?\.row !== row \|\| this\._hoveredCell\?\.col !== col\) return;\s*const key = `\$\{row\}:\$\{col\}`;/);
  assert.match(grid, /if \(!this\.isHoverAllowed\(\)\) \{\s*this\.hideFirstColumnHoverPreview\(\);/);
});

test("Explorer problem badges are visible only while Problems lint notifications are active", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(source, /function lintNotificationsVisible\(\)\s*\{\s*return state\.problemsVisible && state\.lint\.enabled && state\.lint\.diagnostics\.length > 0;/);
  assert.match(source, /function lintNotificationCount\(\)\s*\{\s*return lintNotificationsVisible\(\) \? state\.lint\.diagnostics\.length : 0;/);
  assert.match(source, /function problemBadgeForPath\(path\)\s*\{\s*if \(!lintNotificationsVisible\(\)\) return "";/);
  assert.match(source, /button\.dataset\.badge = String\(count\)/);
  assert.match(source, /delete button\.dataset\.badge/);
  assert.match(css, /\.activity-button\[data-badge\]::after/);
});

test("Settings modal exposes immediate visual settings without save cancel apply", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const appSettings = source.match(/function showAppSettings\(\)[\s\S]*?\nasync function showSettings\(\)/)?.[0] ?? "";
  assert.match(source, /function showAppSettings\(\)/);
  assert.match(appSettings, /Colorize columns/);
  assert.match(appSettings, /Vector-LSP Hover/);
  assert.match(appSettings, /data-settings-theme="dark">Dark/);
  assert.match(appSettings, /data-settings-theme="light">Light/);
  assert.match(appSettings, /colorizeInput\.addEventListener\("change", \(\) => \{ setColorizeColumns/);
  assert.match(appSettings, /hoverInput\.addEventListener\("change", \(\) => \{ setVectorLspHover/);
  assert.match(appSettings, /fontInput\.addEventListener\("change", \(\) => \{ changeGridFont/);
  assert.match(appSettings, /button\.addEventListener\("click", \(\) => \{ setTheme/);
  assert.equal(appSettings.includes("data-settings-close"), true);
  assert.equal(appSettings.includes('data-settings-choice="save"'), false);
  assert.equal(appSettings.includes('data-settings-choice="cancel"'), false);
  assert.equal(appSettings.includes('data-settings-choice="apply"'), false);
  assert.match(css, /\.settings-segmented/);
});

test("Vector-LSP hover can be disabled without clearing baseline hover behavior", () => {
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const grid = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(app, /const savedVectorLspHover = localStorage\.getItem\("txteditor\.vectorLspHover"\) !== "off";/);
  assert.match(app, /function effectiveVectorLspHoverEnabled\(\)\s*\{\s*return isVectorLintEngine\(\) && state\.vectorLspHover;/);
  assert.match(app, /vectorHoverEnabled: effectiveVectorLspHoverEnabled\(\)/);
  assert.match(app, /cancelVectorHoverSample\(sample, acceptance\.reason, perfNow\)/);
  assert.match(grid, /setVectorLspHoverEnabled\(enabled\)/);
  assert.match(grid, /if \(!this\.vectorLspHoverEnabled\) return;/);
  assert.match(grid, /if \(!this\.vectorLspHoverEnabled\) \{\s*this\._hoveredCell = null;\s*this\.clearLspHovers\(\);\s*this\.showLegacyHoverPreview\(hit, event, value\);\s*return;/);
  assert.match(grid, /showLegacyHoverPreview\(hit, event, value\)/);
  assert.match(grid, /if \(shouldShowFirstColumnHover\(hit, value\)\) \{\s*this\.updateFirstColumnHoverPreview\(hit, event\);/);
  assert.match(grid, /export function shouldShowFirstColumnHover/);
});

test("lint engine selector defaults to Vector-LSP and persists separately from lint settings", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /const LINT_ENGINE_VECTOR = "vector-lsp";/);
  assert.match(source, /const LINT_ENGINE_LEGACY = "legacy";/);
  assert.match(source, /const savedLintEngine = localStorage\.getItem\("txteditor\.lint\.engine"\) === LINT_ENGINE_LEGACY \? LINT_ENGINE_LEGACY : LINT_ENGINE_VECTOR;/);
  assert.match(source, /lint:\s*\{[\s\S]*engine: savedLintEngine/);
  assert.match(source, /localStorage\.setItem\("txteditor\.lint\.engine", state\.lint\.engine\)/);
  assert.match(source, /localStorage\.setItem\("txteditor\.legacyLint\.settings", JSON\.stringify\(state\.lint\.legacy\.settings\)\)/);
  assert.match(source, /localStorage\.setItem\("txteditor\.lint\.settings", JSON\.stringify\(\{ enabled: state\.lint\.enabled \}\)\)/);
});

test("Settings and Problems controls switch between Vector-LSP and Legacy Lint", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const appSettings = source.match(/function showAppSettings\(\)[\s\S]*?\nasync function showSettings\(\)/)?.[0] ?? "";
  assert.match(html, /id="lintControls" class="lint-controls"/);
  assert.match(html, /id="lintRulesPanel" class="lint-rules-panel hidden"/);
  assert.match(appSettings, /Lint Engine/);
  assert.match(appSettings, /data-settings-lint-engine="vector-lsp">Vector-LSP/);
  assert.match(appSettings, /data-settings-lint-engine="legacy">Legacy Lint/);
  assert.match(appSettings, /settingsVectorLspHover"\$\{state\.vectorLspHover \? " checked" : ""\}\$\{isLegacyLintEngine\(\) \? " disabled" : ""\}/);
  assert.match(source, /function renderLintControls\(\)/);
  assert.match(source, /if \(isLegacyLintEngine\(\)\) \{[\s\S]*lintProfileSelect[\s\S]*toggle-lint-rules[\s\S]*return;/);
  assert.match(source, /data-command="open-settings" title="Lint options">Lint Options/);
});

test("Legacy Lint is isolated from Vector-LSP traffic and writes the shared diagnostic pipeline", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /function scheduleLegacyLintForOpen\(reason = "file-opened"\)\s*\{\s*scheduleLegacyLintFull\(reason, 0\);/);
  assert.match(source, /function scheduleLegacyLintForEdit\(doc\)[\s\S]*const delay = hasDiagnostics \? 120 : 180;[\s\S]*scheduleLegacyLintFull\(hasDiagnostics \? "diagnostic-file-edited" : "file-edited", delay\);/);
  assert.match(source, /function scheduleLegacyLintFull\(reason = "change", delay = 0\)/);
  assert.match(source, /const diagnostics = runLintWithWorkspaceIndex\(indexResult\.index, state\.lint\.legacy\.settings\);/);
  assert.match(source, /setLintDiagnostics\(diagnostics\);/);
  assert.match(source, /if \(!state\.lint\.enabled \|\| !isVectorLintEngine\(\)\) \{[\s\S]*vector-diagnostics-ignored/);
  assert.match(source, /async function requestLspHover\(row, col, options = \{\}\) \{\s*if \(!effectiveVectorLspHoverEnabled\(\)\)/);
  assert.match(source, /if \(isVectorLintEngine\(\)\) lspUpdateDoc\(doc, changedRows\)\.catch/);
  assert.match(source, /else scheduleLegacyLintForEdit\(doc\);/);
  assert.match(source, /if \(isVectorLintEngine\(\)\) \{\s*lspOpenDoc\(doc\)\.catch/);
  assert.match(source, /else \{\s*scheduleLegacyLintForOpen\("file-opened"\);/);
  assert.match(source, /if \(!isVectorLintEngine\(\) \|\| !state\.lsp\.started\) return false;/);
  assert.match(source, /if \(!isVectorLintEngine\(\) \|\| !state\.lsp\.started\) return;/);
  assert.match(source, /state\.lint\.legacy\.workspaceDocs = mergeOpenLegacyWorkspaceDocs\(docs\);/);
  assert.match(source, /state\.lint\.legacy\.workspaceDocs\.find/);
});

test("Legacy Lint activation paths schedule immediate runs without changing the P tab model", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const addDocument = source.match(/async function addDocument\(doc\)[\s\S]*?\nasync function openFile\(\)/)?.[0] ?? "";
  assert.match(source, /function legacyLintDisplayActive\(\)\s*\{\s*return lintActive\(\) && isLegacyLintEngine\(\);/);
  assert.match(source, /else scheduleLegacyLintFull\("workspace-opened", 0\);/);
  assert.match(source, /scheduleLegacyLintFull\("engine-switched-legacy", 0\);/);
  assert.match(source, /scheduleLegacyLintFull\("lint-enabled", 0\);/);
  assert.match(source, /scheduleLegacyLintFull\("profile-changed", 0\);/);
  assert.match(source, /scheduleLegacyLintFull\("problems-opened", 0\);/);
  assert.match(addDocument, /scheduleLegacyLintForOpen\("file-opened"\);/);
  assert.doesNotMatch(addDocument, /scheduleLegacyLintForEdit\(doc\)/);
});

test("Legacy Lint workspace loading uses bulk native reads and cache signatures", async () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(source, /openNativePathsBulk\(explorerFiles\.map\(\(file\) => file\.path\), TableDocument\)/);
  assert.match(source, /function legacyWorkspaceFileSignature\(files\)/);
  assert.match(source, /workspaceLoad\.status === "ready" && state\.lint\.legacy\.workspaceLoad\.signature === signature/);
  assert.match(source, /workspaceIndexCache/);
  assert.match(rust, /fn read_text_files\(paths: Vec<String>\) -> Vec<Result<TextFilePayload, String>>/);
  assert.match(rust, /read_text_files,/);
  assert.match(rust, /modified_ms: Option<u64>/);
  const results = await openNativePathsBulk(["a.txt", "bad.txt"], TableDocument, async (command, args) => {
    assert.equal(command, "read_text_files");
    assert.deepEqual(args.paths, ["a.txt", "bad.txt"]);
    return [
      { Ok: { path: "a.txt", name: "a.txt", text: "col\n1\n", encoding: "utf-8" } },
      { Err: "failed to read" }
    ];
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].doc.name, "a.txt");
  assert.equal(results[0].bulkRead, true);
  assert.equal(results[1].error, "failed to read");
});

test("resize interactions clear hover state and block stale hover results", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(source, /if \(resize\) \{\s*this\.clearHoverState\(\);/);
  assert.match(source, /if \(this\.resizing\) \{\s*this\.clearHoverState\(\);/);
  assert.match(source, /return !this\.hoverSuspended && !this\.resizing && !this\.dragging;/);
  assert.match(source, /setLspHover\(row, col, text\) \{\s*if \(!this\.isHoverAllowed\(\)\) return;/);
});

test("header and Vector-LSP hover clear immediately on pointer leave", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(source, /this\.host\.addEventListener\("mouseleave", \(event\) => this\.onMouseLeave\(event\)\);/);
  assert.match(source, /this\.host\.addEventListener\("pointerleave", \(event\) => this\.onMouseLeave\(event\)\);/);
  assert.match(source, /onMouseLeave\(event\) \{\s*this\.clearHoverState\(\);/);
  assert.match(source, /clearHoverState\(\) \{[\s\S]*clearTimeout\(this\._hoverDebounceTimer\);[\s\S]*this\.onHoverInvalidated\?\.\(\);/);
  assert.match(source, /this\.host\.addEventListener\("scroll", \(\) => \{[\s\S]*this\.clearHoverState\(\);[\s\S]*this\.requestRender\("scroll"\);/);
});

test("Vector-LSP tooltip owns leftmost hover and legacy preview is fallback only", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(source, /const diags = this\.diagnosticsByCell\.get\(key\) \?\? \[\];\s*const hoverText = this\._lspHoverByCell\.get\(key\) \?\? null;\s*const hasLocalValue = String\(value \?\? ""\)\.trim\(\)\.length > 0;\s*if \(hoverText \|\| diags\.length \|\| hasLocalValue\) \{\s*this\.hideFirstColumnHoverPreview\(\);\s*this\._renderTooltip/);
  assert.match(source, /else \{\s*this\.hideVectorTooltip\(\);\s*this\.showLegacyHoverPreview\(hit, event, value\);/);
  assert.match(source, /const diags = this\.diagnosticsByCell\.get\(key\) \?\? \[\];\s*const hasLocalValue = String\(this\.doc\.getCell\(row, col\) \?\? ""\)\.trim\(\)\.length > 0;\s*if \(text \|\| diags\.length \|\| hasLocalValue\) \{\s*this\.hideFirstColumnHoverPreview\(\);\s*this\._renderTooltip/);
  assert.match(source, /else \{\s*this\.hideVectorTooltip\(\);\s*this\.showLegacyHoverPreview/);
  assert.match(source, /if \(this\._hoveredCell\?\.row !== row \|\| this\._hoveredCell\?\.col !== col\) return;/);
});

test("Vector-LSP hover app cache stores ready no-content results with version and TTL", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /const HOVER_NO_CONTENT_TTL_MS = 60_000;/);
  assert.match(source, /function makeHoverSemanticCacheKey\(target\)/);
  assert.match(source, /function makeHoverCacheEntry\(target, text\)[\s\S]*hasContent,[\s\S]*noContent: !hasContent,[\s\S]*documentVersion: target\.documentVersion,[\s\S]*semanticKey: makeHoverSemanticCacheKey\(target\),[\s\S]*cachedAt: perfNow\(\)/);
  assert.match(source, /function isHoverCacheEntryUsable\(entry, target\)[\s\S]*entry\.uri !== target\.uri \|\| entry\.documentVersion !== target\.documentVersion/);
  assert.match(source, /entry\.noContent && perfNow\(\) - entry\.cachedAt > HOVER_NO_CONTENT_TTL_MS/);
  assert.match(source, /const cacheEntry = setHoverCacheEntry\(target, text\);/);
  assert.match(source, /cacheEntry\.noContent \? "no-content-stored" : "stored"/);
  assert.match(source, /cacheEntry\.noContent \? `\$\{cacheEntry\.cacheSource\}-no-content-hit` : `\$\{cacheEntry\.cacheSource\}-hit`/);
  assert.match(source, /lspHoverSemanticCache\.set\(entry\.semanticKey, entry\)/);
});

test("Vector-LSP hover queue keeps one active request and one latest replacement", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /let lspHoverActiveUserRequest = null;/);
  assert.match(source, /let lspHoverLatestQueuedRequest = null;/);
  assert.match(source, /function enqueueUserHoverTarget\(target, generation, sample\)/);
  assert.match(source, /if \(!lspHoverActiveUserRequest\) \{\s*dispatchUserHoverRequest\(request\);\s*return;\s*\}/);
  assert.match(source, /cancelVectorHoverSample\(lspHoverLatestQueuedRequest\.sample, "replaced-by-latest-hover", perfNow\)/);
  assert.match(source, /const next = lspHoverLatestQueuedRequest;\s*lspHoverLatestQueuedRequest = null;\s*if \(next\) dispatchUserHoverRequest\(next\);/);
  assert.match(source, /recordHoverQueueEvent\(\{[\s\S]*reason: "dispatch-hover"/);
});

test("Vector-LSP traffic counters and idempotent didOpen state are exposed for runtime proof", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const grid = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(source, /window\.__txteditorPerf\.hoverQueueSamples = hoverQueueSamples;/);
  assert.match(source, /window\.__txteditorPerf\.lspTraffic = lspTraffic;/);
  assert.match(source, /window\.__txteditorPerf\.lspReadiness = lspReadiness;/);
  assert.match(source, /function recordLspTraffic\(uri, kind, details = \{\}\)/);
  for (const label of ["lsp_open_file", "lsp_update_file", "lsp_update_file_incremental", "lsp_get_diagnostics", "lsp_hover", "diagnostics_changed", "hover_cache_hit", "hover_cache_miss", "hover_semantic_cache_hit", "hover_header_cache_hit"]) {
    assert.match(source, new RegExp(`${label}: 0`));
  }
  assert.match(source, /if \(doc\._lspOpened && doc\._lspOpenedUri === uri && doc\._lspOpenedVersion === version\) return;/);
  assert.match(source, /if \(doc\._lspOpenPromise\) return doc\._lspOpenPromise;/);
  assert.match(source, /doc\._lspOpenPromise = \(async \(\) => \{[\s\S]*recordLspTraffic\(uri, "lsp_open_file"/);
  assert.match(source, /recordLspTraffic\(target\.uri, "lsp_hover"/);
  assert.match(source, /function markDocHoverReady\(doc, uri, reason\)/);
  assert.match(source, /recordLspReadiness\(uri, "didOpenSent"/);
  assert.match(source, /recordLspReadiness\(uri, "firstDiagnosticsReceived"/);
  assert.match(source, /recordLspReadiness\(target\.uri, "firstHoverRequested"/);
  assert.match(source, /recordLspReadiness\(target\.uri, "firstHoverResponse"/);
  const scrollHandler = grid.match(/this\.host\.addEventListener\("scroll"[\s\S]*?this\.onViewportChanged\?\.\("scroll"\);/)?.[0] ?? "";
  assert.notEqual(scrollHandler, "");
  assert.doesNotMatch(scrollHandler, /lspOpenDoc|lspUpdateDoc|lspGetDiagnostics|lsp_open_file|lsp_update_file|lsp_get_diagnostics/);
});

test("Problems panel rendering is skipped while hidden and cached while unchanged", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /version: 0/);
  assert.match(source, /function setLintDiagnostics\(diagnostics\)\s*\{\s*state\.lint\.diagnostics = diagnostics;\s*state\.lint\.version \+= 1;/);
  assert.match(source, /function renderProblemsPanelIfNeeded\(\)\s*\{\s*const started = perfNow\(\);\s*if \(!els\.problemsList \|\| !state\.problemsVisible \|\| state\.bottomTab !== "problems"\) \{\s*recordUiPerf\("render-problems-panel", started, \{ skipped: true \}\);\s*return;/);
  assert.match(source, /if \(els\.problemsList\.dataset\.renderKey === key\) \{\s*updateActiveProblemHighlight\(\);\s*recordUiPerf\("render-problems-panel", started, \{ cached: true \}\);\s*return;/);
  assert.match(source, /function problemsPanelRenderKey\(\)/);
});

test("Problems list highlights diagnostics for the active or edited marker cell", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const grid = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(source, /onSelectionChanged: \(\) => updateActiveProblemHighlight\(\)/);
  assert.match(source, /function activeProblemDiagnosticIds\(\)/);
  assert.match(source, /const activeCell = grid\.editingCell\?\.\(\) \?\? state\.selection\.focus;/);
  assert.match(source, /diagnostic\.rowIndex !== activeCell\.row \|\| diagnostic\.columnIndex !== activeCell\.column/);
  assert.match(source, /button\.classList\.toggle\("problem-item-active-cell", active\);/);
  assert.match(source, /button\.setAttribute\("aria-current", "location"\)/);
  assert.match(source, /updateActiveProblemHighlight\(\);\s*recordUiPerf\("render-problems-panel", started, \{ cached: true \}\);/);
  assert.match(grid, /onSelectionChanged/);
  assert.match(grid, /notifySelectionChanged\("pointer-selection"\)/);
  assert.match(grid, /notifySelectionChanged\("keyboard-selection"\)/);
  assert.match(grid, /notifySelectionChanged\("edit-start"\)/);
  assert.match(css, /\.problem-item\.problem-item-active-cell\s*\{[\s\S]*background:\s*color-mix/);
});

test("UI performance instrumentation records row and lint display work", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /window\.__txteditorPerf = uiPerfSamples;/);
  assert.match(source, /recordUiPerf\("row-command"/);
  assert.match(source, /recordUiPerf\("update-grid-diagnostics"/);
  assert.match(source, /recordUiPerf\("update-overview-ruler"/);
  assert.match(source, /recordUiPerf\("render-problems-panel"/);
  assert.match(source, /recordUiPerf\("render-chrome"/);
});

test("active cell highlights both the first-row header and left row header", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(source, /const activeHeader = this\.selection\.focus\.row === row;/);
  assert.match(source, /const activeColumnHeader = !editingThisCell && row === 0 && this\.selection\.focus\.column === column;/);
  assert.match(source, /GRID_COLORS\.activeHeader/);
  assert.match(css, /--grid-active-header-bg: var\(--activeHeaderBg\);/);
  assert.match(css, /--grid-active-header-text: var\(--activeHeaderText\);/);
});

test("active row header draws raised chrome over the row index only", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(source, /if \(activeHeader\) this\.drawActiveRowHeaderChrome\(y, height\);/);
  assert.match(source, /drawActiveRowHeaderChrome\(y, height\) \{/);
  assert.match(source, /GRID_COLORS\.activeRowHeaderHighlight/);
  assert.match(source, /GRID_COLORS\.activeRowHeaderShadow/);
  assert.match(source, /GRID_COLORS\.activeRowHeaderSheen/);
  assert.match(css, /--grid-active-row-header-highlight:/);
  assert.match(css, /--grid-active-row-header-shadow:/);
  assert.match(css, /--grid-active-row-header-sheen:/);
});

test("Find UI is a centered modal and text inputs keep native shortcuts", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(html, /id="searchPanel" class="modal-backdrop search-backdrop hidden"/);
  assert.match(html, /class="modal search-modal"/);
  assert.match(html, /id="searchInput" class="modal-input"/);
  assert.match(html, /data-search-close/);
  assert.doesNotMatch(html, /id="searchPanel" class="quick-panel/);
  assert.match(source, /function closeSearch\(\)/);
  assert.match(source, /if \(!editingCell && isTextInputTarget\(event\.target\)\) return;/);
  assert.match(source, /function isTextInputTarget\(target\)/);
  assert.match(source, /target\.closest\("input, textarea, select, \[contenteditable=''\], \[contenteditable='true'\]"\)/);
  assert.match(source, /if \(event\.key === "Enter"\) \{\s*event\.preventDefault\(\);\s*findNext\(\);/);
  assert.match(css, /\.modal-backdrop\s*\{[\s\S]*align-items: center;[\s\S]*justify-content: center;/);
  assert.match(css, /\.search-modal\s*\{/);
});

test("initial canvas column fit is header-only and compact", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(source, /autoFitInitialColumns\(\{ min = 56, max = 420, padding = 24 \} = \{\}\)/);
  assert.match(source, /this\.ctx\.measureText\(this\.doc\.getCell\(0, column\)\)\.width \+ padding \* this\.zoom/);
  assert.doesNotMatch(source, /for \(let row = 1; row < rows; row\+\+\)/);
});

test("canvas drag row resizing opts into custom row-height layout", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(source, /classifyResizeHandle\(\{ hit, columnRight, rowBottom, zoom: this\.zoom \}\)/);
  assert.match(source, /this\.doc\.rowHeights\[this\.resizing\.index\] = next;\s*this\.doc\.hasCustomRowHeights = true;/);
});

test("first-column hover preview is single and clears on grid context changes", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(source, /this\.hoverPreview = createFirstColumnHoverPreview\(\);/);
  assert.match(source, /this\.host\.addEventListener\("mouseleave", \(event\) => this\.onMouseLeave\(event\)\);/);
  assert.match(source, /setDocument\(doc\) \{\s*if \(this\._tooltip\) this\.clearHoverState\(\);\s*else this\.hideFirstColumnHoverPreview\(\);/);
  assert.match(source, /this\.clearHoverState\(\);\s*this\.requestRender\("scroll"\);/);
  assert.match(source, /onContext\(event\) \{\s*event\.preventDefault\(\);\s*this\.clearHoverState\(\);/);
  assert.match(source, /function createFirstColumnHoverPreview\(\) \{\s*const preview = document\.createElement\("div"\);/);
});

test("cell and row-header text use row-height-centered baselines", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(source, /this\.ctx\.textBaseline = "middle";\s*this\.ctx\.fillText\(label, x, y \+ height \/ 2\)/);
  assert.match(source, /ctx\.textBaseline = "middle";\s*this\.fillText\(value, x \+ 8, y \+ height \/ 2, width - 12\)/);
  assert.equal(source.includes("y + Math.round(17 * this.zoom)"), false);
});

test("Find Next includes the current cell once when the query changes", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /search:\s*\{\s*lastQuery: ""\s*\}/);
  assert.match(source, /els\.searchInput\.addEventListener\("input", \(\) => \{\s*state\.search\.lastQuery = "";/);
  assert.match(source, /const includeStart = query !== state\.search\.lastQuery;/);
  assert.match(source, /findInTable\(activeDoc\(\), query, state\.selection\.focus, \{ includeStart \}\)/);
  assert.match(source, /state\.search\.lastQuery = query;/);
});

test("Ctrl+B, Ctrl+L, and Ctrl+H use the shared panel and row-height reset paths", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(source, /if \(event\.ctrlKey && key === "b"\) return prevent\(event, toggleSidebar\);/);
  assert.match(source, /if \(event\.ctrlKey && key === "l"\) return prevent\(event, toggleProblemsPanel\);/);
  assert.match(source, /if \(event\.ctrlKey && key === "h"\) return prevent\(event, resetRowHeights\);/);
  assert.match(source, /function resetRowHeights\(\)\s*\{\s*if \(!hasOpenDocument\(\)\) return;\s*activeDoc\(\)\.resetRowHeights\(\);\s*grid\.layout\(\);\s*renderChrome\(\);/);
  assert.match(source, /\["reset-row-heights", "Reset Row Heights"\]/);
  assert.match(readme, /`Ctrl\+B`: toggle Explorer panel/);
  assert.match(readme, /`Ctrl\+L`: toggle Problems panel/);
  assert.match(readme, /`Ctrl\+H`: reset all row heights to default/);
});

test("quick and explicit edit modes commit on arrow-key cell navigation", () => {
  const source = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(source, /this\.startEdit\(event\.key, true, "quick"\)/);
  assert.match(source, /this\.startEdit\(null, false, "explicit"\)/);
  assert.match(source, /if \(isArrowNavigationKey\(event\.key\)\) \{/);
  assert.doesNotMatch(source.match(/onEditorKeyDown\(event\) \{[\s\S]*?\n  startEdit/)?.[0] ?? "", /editMode === "quick"/);
  assert.match(source, /this\.commitEdit\(\);\s*this\.moveSelectionBy\(rowDelta, columnDelta\);/);
  assert.match(source, /this\.host\.addEventListener\("dblclick", \(event\) => this\.onDblClick\(event\)\)/);
  assert.match(source, /this\.editor\.selectionStart = this\.editor\.value\.length;\s*this\.editor\.selectionEnd = this\.editor\.value\.length;/);
  assert.equal(source.includes("this.editor.select();"), false);
});

test("version metadata is bumped to TXTeditor 0.4.2", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const cargoToml = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
  const cargoLock = readFileSync(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
  const tauri = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.equal(pkg.version, "0.4.2");
  assert.equal(lock.version, "0.4.2");
  assert.equal(lock.packages[""].version, "0.4.2");
  assert.match(pkg.description, /TXTeditor 0\.4\.2/);
  assert.match(cargoToml, /version = "0\.4\.2"/);
  assert.match(cargoToml, /description = "TXTeditor 0\.4\.2/);
  assert.match(cargoLock, /name = "txteditor"\r?\nversion = "0\.4\.2"/);
  assert.equal(tauri.version, "0.4.2");
  assert.match(readme, /TXTeditor 0\.4\.2 is/);
});
