import assert from "node:assert/strict";
import test from "node:test";
import {
  resetUndoManagerForDocument,
  undoManagerForDocument
} from "../src/core/document-undo-state.js";
import { TableDocument } from "../src/core/table-model.js";
import {
  autoFitColumnWidth,
  estimateTextWidth,
  initialHeaderColumnWidth as initialTableHeaderColumnWidth
} from "../src/core/table-sizing.js";
import { tableFileState } from "../src/core/table-file-state.js";
import { LARGE_FILE_THRESHOLDS } from "../src/core/large-file-policy.js";
import { RangeSet } from "../src/core/range-set.js";
import { tableViewState } from "../src/core/table-view-state.js";
import { SelectionModel } from "../src/core/selection.js";
import {
  UndoManager,
  makeCellCommand
} from "../src/core/undo.js";
import {
  addColumnsCommand,
  addRowsCommand,
  cloneRowsCommand,
  copyRange,
  copyRanges,
  deleteColumnsCommand,
  deleteRowsCommand,
  fillSelectedCellsCommand,
  fillSelectionCommand,
  hiddenColumnsCommand,
  hiddenRowsCommand,
  incrementFillCommand,
  insertColumnCommand,
  insertRowCommand,
  pasteTextToRangesCommand,
  pasteTextCommand,
  resizeColumnCommand,
  resizeRowCommand
} from "../src/core/operations.js";
import { movedCell } from "../src/ui/canvas-grid.js";
import {
  arrowNavigationDelta,
  editorKeyAction,
  shouldCommitEditOnArrow
} from "../src/ui/edit-policy.js";
import { classifyGridHit } from "../src/ui/grid-geometry.js";
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

test("table sizing helpers preserve compact header and explicit auto-fit widths", () => {
  assert.equal(estimateTextWidth("A z._\t한"), 8 + 4 + 7 + 4 + 8 + 16 + 12);
  assert.equal(initialTableHeaderColumnWidth("class"), 59);
  assert.equal(initialTableHeaderColumnWidth(""), 56);
  assert.equal(initialTableHeaderColumnWidth("x".repeat(200)), 420);
  assert.equal(autoFitColumnWidth([["Id"], ["Forsaken 01 (Act1 Pit Cave)"]], 0, 300), 244);
  assert.equal(autoFitColumnWidth([["Id"], ["Forsaken 01 (Act1 Pit Cave)"]], 0, 1), 72);
  assert.equal(autoFitColumnWidth([["x".repeat(100)]], 0, 300), 420);
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

test("selection snapshots are copied and restored within document bounds", () => {
  const selection = new SelectionModel();
  selection.set(3, 4);
  selection.extend(1, 2);
  const snapshot = selection.snapshot();
  selection.set(0, 0);

  assert.deepEqual(snapshot.focus, { row: 1, column: 2 });
  assert.deepEqual(snapshot.ranges, [{ top: 1, left: 2, bottom: 3, right: 4 }]);
  selection.restore({
    anchor: { row: 99, column: 99 },
    focus: { row: 40, column: 30 },
    ranges: [{ top: 5, left: 6, bottom: 50, right: 40 }]
  }, 10, 8);
  assert.deepEqual(selection.anchor, { row: 9, column: 7 });
  assert.deepEqual(selection.focus, { row: 9, column: 7 });
  assert.deepEqual(selection.ranges, [{ top: 5, left: 6, bottom: 9, right: 7 }]);
});

test("selection restore falls back to the first cell for invalid snapshots", () => {
  const selection = new SelectionModel();
  selection.set(3, 4);

  selection.restore({ focus: { row: "bad", column: null }, ranges: [{ top: "x" }] }, 10, 8);

  assert.deepEqual(selection.focus, { row: 0, column: 0 });
  assert.deepEqual(selection.anchor, { row: 0, column: 0 });
  assert.deepEqual(selection.ranges, [{ top: 0, left: 0, bottom: 0, right: 0 }]);
});

test("documents preserve independent selection snapshots", () => {
  const skills = TableDocument.fromText("skills.txt", "a\tb\n1\t2\n3\t4");
  const skilldesc = TableDocument.fromText("skilldesc.txt", "x\ty\nm\tn");
  const selection = new SelectionModel();

  selection.set(2, 1);
  skills.selectionState = selection.snapshot();
  selection.set(1, 0);
  skilldesc.selectionState = selection.snapshot();

  selection.restore(skills.selectionState, skills.rowCount, skills.columnCount);
  assert.deepEqual(selection.focus, { row: 2, column: 1 });
  selection.restore(skilldesc.selectionState, skilldesc.rowCount, skilldesc.columnCount);
  assert.deepEqual(selection.focus, { row: 1, column: 0 });
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

test("row index highlight is reserved for full-row selection", () => {
  const selection = new SelectionModel();
  selection.set(167, 2);
  assert.equal(selection.hasFullRow(167, 8), false);
  selection.setRow(167, 8);
  assert.equal(selection.hasFullRow(167, 8), true);
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

test("bulk row insertion refreshes shape once and shifts hidden rows once", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2\n3\t4", { dirty: false });
  doc.setRowHeight(2, 44);
  doc.hiddenRows = new Set([2]);
  let refreshCalls = 0;
  const refreshShape = doc.refreshShape.bind(doc);
  doc.refreshShape = () => {
    refreshCalls += 1;
    return refreshShape();
  };

  doc.insertRows(1, 3);

  assert.equal(refreshCalls, 1);
  assert.equal(doc.rowCount, 6);
  assert.deepEqual([...doc.hiddenRows], [5]);
  assert.equal(doc.rowHeights[1], doc.defaultRowHeight);
  assert.equal(doc.rowHeights[5], 44);
  assert.equal(doc.getCell(1, 0), "");
  assert.equal(doc.toText(), "a\tb\n\t\n\t\n\t\n1\t2\n3\t4");
});

test("add rows command uses one batched insert and undo removes the block", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2");
  let insertRowsCalls = 0;
  let refreshCalls = 0;
  const insertRows = doc.insertRows.bind(doc);
  const refreshShape = doc.refreshShape.bind(doc);
  doc.insertRows = (...args) => {
    insertRowsCalls += 1;
    return insertRows(...args);
  };
  doc.refreshShape = () => {
    refreshCalls += 1;
    return refreshShape();
  };

  const command = addRowsCommand(doc, 10000);
  command.redo(doc);

  assert.equal(insertRowsCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.equal(doc.rowCount, 10002);
  command.undo(doc);
  assert.equal(doc.rowCount, 2);
});

test("bulk column insertion appends sparse body cells and refreshes shape once", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2", { dirty: false });
  let refreshCalls = 0;
  const refreshShape = doc.refreshShape.bind(doc);
  doc.refreshShape = () => {
    refreshCalls += 1;
    return refreshShape();
  };

  doc.insertColumns(doc.columnCount, 2);

  assert.equal(refreshCalls, 1);
  assert.equal(doc.columnCount, 4);
  assert.equal(doc.getCell(0, 2), "Column3");
  assert.equal(doc.getCell(0, 3), "Column4");
  assert.equal(doc.getCell(1, 2), "");
  assert.equal(doc.rows[1].length, 2);
  assert.equal(Object.hasOwn(doc.rows[1], 2), false);
  assert.equal(doc.toText(), "a\tb\tColumn3\tColumn4\n1\t2\t\t");
});

test("chunked serialization matches full table text", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2\n3\t4\n", { dirty: false });
  doc.insertColumns(doc.columnCount, 2);

  assert.equal([...doc.toTextChunks({ chunkRows: 2 })].join(""), doc.toText());
});

test("add columns command uses one batched insert and undo restores shape", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2");
  let insertColumnsCalls = 0;
  let insertColumnCalls = 0;
  const insertColumns = doc.insertColumns.bind(doc);
  doc.insertColumns = (...args) => {
    insertColumnsCalls += 1;
    return insertColumns(...args);
  };
  doc.insertColumn = () => {
    insertColumnCalls += 1;
    throw new Error("single-column insert should not be used for addColumnsCommand");
  };

  const command = addColumnsCommand(doc, 10000);
  command.redo(doc);

  assert.equal(insertColumnsCalls, 1);
  assert.equal(insertColumnCalls, 0);
  assert.equal(doc.columnCount, 10002);
  assert.equal(doc.getCell(0, 10001), "Column10002");
  command.undo(doc);
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

test("view-only commands and table methods do not mark file content dirty", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2", { dirty: false });
  const initialRevision = tableFileState(doc).revision;

  doc.setRowsHidden([1], true);
  doc.setColumnsHidden([1], true);
  doc.setColumnWidth(1, 240);
  doc.setRowHeight(1, 44);

  assert.equal(doc.dirty, false);
  assert.equal(tableFileState(doc).revision, initialRevision);

  const hide = hiddenRowsCommand([1], false);
  assert.equal(hide.contentChanged, false);
  assert.deepEqual(hide.lspChange, { kind: "none" });
  hide.redo(doc);
  hiddenColumnsCommand([1], false).redo(doc);
  resizeColumnCommand(1, 240, 260).redo(doc);
  resizeRowCommand(1, 44, 50).redo(doc);

  assert.equal(doc.dirty, false);
  assert.equal(tableFileState(doc).revision, initialRevision);

  doc.setCell(1, 1, "changed");
  assert.equal(doc.dirty, true);
  assert.equal(tableFileState(doc).revision, initialRevision + 1);
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

test("first row data cells are hit as cells, not column headers", () => {
  assert.deepEqual(
    classifyGridHit({ pane: "cell", row: 0, column: 2, x: 250, y: 8 }),
    { kind: "cell", row: 0, column: 2, x: 250, y: 8 }
  );
});

test("blank version is ignored only on dummy section rows", () => {
  const doc = TableDocument.fromText("uniqueitems.txt", "index\tversion\tcode\tprop1\nWarlock Class Pack\t\t\t\nReal Missing\t\tcap\t\nReal Bad\t2\tcap\t");
  const diagnostics = lintDocs([doc], "RotW").filter((item) => item.ruleId === "Basic/NumericBounds" && item.fileName === "uniqueitems.txt");
  assert.equal(diagnostics.some((item) => item.rowIndex === 1 && item.columnName === "version"), false);
  assert.ok(diagnostics.some((item) => item.rowIndex === 2 && item.columnName === "version"));
  assert.ok(diagnostics.some((item) => item.rowIndex === 3 && item.columnName === "version"));
});

test("TableDocument file state uses compatible accessors outside content rows", () => {
  const doc = TableDocument.fromText("items.txt", "id\tname\r\n1\tcap\r\n", {
    path: "Data\\Items.txt",
    encoding: "windows-1252",
    dirty: false
  });
  const dirtyDescriptor = Object.getOwnPropertyDescriptor(doc, "dirty");
  assert.equal(typeof dirtyDescriptor.get, "function");
  assert.equal(typeof dirtyDescriptor.set, "function");
  assert.equal(dirtyDescriptor.enumerable, true);
  assert.equal("value" in dirtyDescriptor, false);
  assert.equal(doc.name, "items.txt");
  assert.equal(doc.path, "Data\\Items.txt");
  assert.equal(doc.encoding, "windows-1252");
  assert.equal(doc.finalNewline, true);
  assert.equal(doc.lineEnding, "\r\n");
  assert.equal(doc.dirty, false);
  assert.equal(doc.toText(), "id\tname\r\n1\tcap\r\n");

  doc.name = "renamed.txt";
  doc.path = "Data\\Renamed.txt";
  doc.dirty = true;
  assert.equal(tableFileState(doc).name, "renamed.txt");
  assert.equal(tableFileState(doc).path, "Data\\Renamed.txt");
  assert.equal(tableFileState(doc).dirty, true);
  doc.dirty = false;
  doc.setCell(1, 1, "helm");
  assert.equal(tableFileState(doc).dirty, true);
  assert.equal(doc.toText(), "id\tname\r\n1\thelm\r\n");
});

test("TableDocument records large-file metadata from file size and shape", () => {
  const largeBySize = TableDocument.fromText("huge.txt", "a\tb\n1\t2", {
    dirty: false,
    fileSizeBytes: LARGE_FILE_THRESHOLDS.fileSizeBytes
  });
  assert.equal(largeBySize.fileSizeBytes, LARGE_FILE_THRESHOLDS.fileSizeBytes);
  assert.equal(largeBySize.estimatedCellCount, 4);
  assert.equal(largeBySize.largeFileMode, true);
  assert.deepEqual(largeBySize.largeFileReasons, ["file-size"]);

  const largeByColumns = TableDocument.fromText("wide.txt", "a\tb\n1\t2", { dirty: false });
  assert.equal(largeByColumns.largeFileMode, false);
  largeByColumns.insertColumns(largeByColumns.columnCount, LARGE_FILE_THRESHOLDS.columns - largeByColumns.columnCount);
  assert.equal(largeByColumns.largeFileMode, true);
  assert.ok(largeByColumns.largeFileReasons.includes("column-count"));
});

test("RangeSet stores consecutive hidden indexes as compact ranges", () => {
  const set = RangeSet.from([[10, 200]]);
  set.add(500);
  set.addRange(700, 702);

  assert.equal(set.size, 195);
  assert.equal(set.rangeCount, 3);
  assert.equal(set.has(99), true);
  assert.equal(set.has(201), false);
  assert.deepEqual([...set].slice(0, 3), [10, 11, 12]);

  assert.equal(set.deleteRange(12, 198), true);
  assert.deepEqual(set.ranges, [[10, 11], [199, 200], [500, 500], [700, 702]]);
});

test("hidden commands preserve compact row and column ranges", () => {
  const tallText = Array.from({ length: 250 }, (_, row) => `row-${row}`).join("\n");
  const tall = TableDocument.fromText("tall.txt", tallText, { dirty: false, autoFitInitialColumns: false });
  const hideRows = hiddenRowsCommand([[10, 200]], true);

  hideRows.redo(tall);
  assert.deepEqual(tall.hiddenRows.ranges, [[10, 200]]);
  assert.equal(tall.hiddenRows.size, 191);
  assert.equal(tall.dirty, false);
  hideRows.undo(tall);
  assert.equal(tall.hiddenRows.size, 0);

  const header = Array.from({ length: 250 }, (_, column) => `Column${column + 1}`).join("\t");
  const wide = TableDocument.fromText("wide.txt", `${header}\n${header}`, { dirty: false, autoFitInitialColumns: false });
  const hideColumns = hiddenColumnsCommand([[5, 205]], true);

  hideColumns.redo(wide);
  assert.deepEqual(wide.hiddenColumns.ranges, [[5, 205]]);
  assert.equal(wide.hiddenColumns.size, 201);
  assert.equal(wide.dirty, false);
  hideColumns.undo(wide);
  assert.equal(wide.hiddenColumns.size, 0);
});

test("RangeSet shifts hidden ranges for structural row and column changes", () => {
  const set = new RangeSet();
  set.addRange(10, 20);
  set.addRange(50, 60);

  assert.deepEqual(set.shiftForInsert(30, 5).ranges, [[10, 20], [55, 65]]);
  assert.deepEqual(set.shiftForInsert(15, 3).ranges, [[10, 14], [18, 23], [53, 63]]);
  assert.deepEqual(set.shiftForDelete(15, 40).ranges, [[10, 20]]);
});

test("TableDocument view and undo state stay outside serialized content fields", () => {
  const doc = TableDocument.fromText("items.txt", "id\tname\n1\tcap", { dirty: false });
  doc.columnWidths[1] = 240;
  doc.rowHeights[1] = 44;
  doc.hasCustomRowHeights = true;
  doc.hiddenColumns.add(1);
  doc.scrollLeft = 12;
  doc.scrollTop = 34;
  doc.zoom = 1.25;
  doc.freezeFirstRow = true;
  doc.initialColumnFitApplied = true;

  assert.equal(doc.toText(), "id\tname\n1\tcap");
  assert.equal(doc.dirty, false);
  assert.equal(tableViewState(doc).columnWidths[1], 240);
  assert.equal(tableViewState(doc).rowHeights[1], 44);
  assert.equal(tableViewState(doc).hiddenColumns.has(1), true);
  doc.selectionState = { focus: { row: 1, column: 0 }, anchor: { row: 1, column: 0 }, ranges: [{ top: 1, left: 0, bottom: 1, right: 0 }] };
  assert.deepEqual(tableViewState(doc).selection.focus, { row: 1, column: 0 });
  for (const field of ["columnWidths", "rowHeights", "hiddenColumns", "hiddenRows", "scrollLeft", "scrollTop", "zoom", "freezeFirstRow", "initialColumnFitApplied", "selectionState"]) {
    assert.equal(Object.hasOwn(doc, field), false);
  }

  const undo = undoManagerForDocument(doc);
  assert.equal(undoManagerForDocument(doc), undo);
  assert.notEqual(resetUndoManagerForDocument(doc), undo);
  assert.equal(Object.hasOwn(doc, "undo"), false);
});

test("only quick edit mode commits on arrow-key cell navigation", () => {
  assert.equal(shouldCommitEditOnArrow("quick", "ArrowDown"), true);
  assert.equal(shouldCommitEditOnArrow("quick", "ArrowLeft"), true);
  assert.equal(shouldCommitEditOnArrow("explicit", "ArrowDown"), false);
  assert.equal(shouldCommitEditOnArrow("quick", "Enter"), false);
  assert.deepEqual(arrowNavigationDelta("ArrowDown"), { rowDelta: 1, columnDelta: 0 });
  assert.deepEqual(arrowNavigationDelta("ArrowLeft"), { rowDelta: 0, columnDelta: -1 });
  assert.deepEqual(editorKeyAction({ key: "ArrowDown", editMode: "quick" }), { action: "commit-move", rowDelta: 1, columnDelta: 0 });
  assert.deepEqual(editorKeyAction({ key: "ArrowDown", editMode: "explicit" }), { action: "none" });
  assert.deepEqual(editorKeyAction({ key: "Enter", shiftKey: true, editMode: "explicit" }), { action: "commit-move", rowDelta: -1, columnDelta: 0 });
  assert.deepEqual(editorKeyAction({ key: "Tab", shiftKey: false, editMode: "explicit" }), { action: "commit-move", rowDelta: 0, columnDelta: 1 });
  assert.deepEqual(editorKeyAction({ key: "Escape", editMode: "quick" }), { action: "cancel" });
  assert.deepEqual(editorKeyAction({ key: "a", editMode: "quick" }), { action: "none" });
});
