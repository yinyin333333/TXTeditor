import assert from "node:assert/strict";
import test from "node:test";
import { TableDocument } from "../src/core/table-model.js";
import { tableFileState } from "../src/core/table-file-state.js";
import { tableViewState } from "../src/core/table-view-state.js";
import { RangeSet } from "../src/core/range-set.js";
import { lspChangedRowsToIncrementalChanges } from "../src/core/lsp-session-policy.js";
import { UndoManager, makeCellCommand } from "../src/core/undo.js";
import {
  addColumnsCommand,
  addRowsCommand,
  cloneColumnsCommand,
  cloneRowsCommand,
  deleteColumnsCommand,
  deleteRowsCommand,
  insertColumnCommand,
  insertRowCommand,
  pasteTextCommand
} from "../src/core/operations.js";

const fixtures = {
  denseLfFinal: ["h0\th1\th2\th3\nr0c0\tr0c1\tr0c2\tr0c3\nr1c0\tr1c1\tr1c2\tr1c3\nr2c0\tr2c1\tr2c2\tr2c3\n", null, false],
  denseCrlfNoFinal: ["h0\th1\th2\th3\r\nr0c0\tr0c1\tr0c2\tr0c3\r\nr1c0\tr1c1\tr1c2\tr1c3\r\nr2c0\tr2c1\tr2c2\tr2c3", null, false],
  denseCrFinal: ["h0\th1\th2\th3\rr0c0\tr0c1\tr0c2\tr0c3\rr1c0\tr1c1\tr1c2\tr1c3\rr2c0\tr2c1\tr2c2\tr2c3\r", null, false],
  shortHeaderLongBody: ["h0\th1\nb0\tb1\tb2\tb3\tb4\nc0\tc1\tc2\tc3", 2, true],
  longHeaderShortBody: ["h0\th1\th2\th3\th4\nb0\tb1\nc0", 5, true],
  emptyHeaderBody: ["\t\t\n\nx\t\tz", 4, true],
  ragged: ["h0\th1\th2\th3\nr0\nr1\tr1c1\nr2\tr2c1\tr2c2\nr3\tr3c1\tr3c2\tr3c3\tr3c4", null, true],
  serializedLessThanMax: ["h0\th1\th2\th3\th4\nr0\tr1\tr2\tr3\tr4", 2, true],
  serializedGreaterThanMax: ["h0\th1\nr0\tr1", 7, true]
};

function rowSnapshot(row) {
  const present = [];
  const values = [];
  for (let index = 0; index < row.length; index++) {
    const exists = index in row;
    present.push(exists);
    values.push(exists ? row[index] : null);
  }
  return { length: row.length, present, values };
}

function snapshot(doc) {
  const file = tableFileState(doc);
  const view = tableViewState(doc);
  const text = doc.toText();
  return {
    rows: doc.rows.map(rowSnapshot),
    rowCount: doc.rowCount,
    columnCount: doc.columnCount,
    serializedColumnCount: doc.serializedColumnCount,
    text,
    bytes: Buffer.from(text, "utf8").toString("hex"),
    file: {
      name: file.name,
      path: file.path,
      lineEnding: file.lineEnding,
      finalNewline: file.finalNewline,
      encoding: file.encoding,
      dirty: file.dirty,
      revision: file.revision,
      fileSizeBytes: file.fileSizeBytes,
      estimatedCellCount: file.estimatedCellCount,
      largeFileMode: file.largeFileMode,
      largeFileReasons: [...file.largeFileReasons]
    },
    view: {
      hiddenRows: view.hiddenRows.ranges.map((range) => [...range]),
      hiddenColumns: view.hiddenColumns.ranges.map((range) => [...range]),
      columnWidths: [...view.columnWidths],
      rowHeights: [...view.rowHeights],
      defaultColumnWidth: view.defaultColumnWidth,
      defaultRowHeight: view.defaultRowHeight,
      hasCustomRowHeights: view.hasCustomRowHeights,
      zoom: view.zoom,
      freezeFirstRow: view.freezeFirstRow,
      freezeFirstColumn: view.freezeFirstColumn,
      scrollLeft: view.scrollLeft,
      scrollTop: view.scrollTop,
      selection: structuredClone(view.selection),
      initialColumnFitApplied: view.initialColumnFitApplied,
      revision: view.revision
    }
  };
}

function restorable(state) {
  const copy = structuredClone(state);
  delete copy.file.dirty;
  delete copy.file.revision;
  delete copy.view.revision;
  return copy;
}

function assertRestored(before, after, label, revisionDelta = 2) {
  assert.deepEqual(restorable(after), restorable(before), label);
  assert.equal(after.file.dirty, true, `${label}: content undo remains dirty`);
  assert.equal(after.file.revision, before.file.revision + revisionDelta, `${label}: revision`);
  assert.ok(after.view.revision >= before.view.revision, `${label}: view revision monotonic`);
}

function decorate(doc) {
  doc.hiddenRows = RangeSet.from(doc.rowCount > 2 ? [[1, Math.min(doc.rowCount - 1, 2)]] : []);
  doc.hiddenColumns = RangeSet.from(doc.columnCount > 2 ? [[1, Math.min(doc.columnCount - 1, 2)]] : []);
  doc.columnWidths = Array.from({ length: doc.columnCount }, (_, column) => 71 + column * 13);
  doc.rowHeights = Array.from({ length: doc.rowCount }, (_, row) => 23 + (row % 4) * 7);
  doc.defaultColumnWidth = 133;
  doc.defaultRowHeight = 31;
  doc.hasCustomRowHeights = true;
  doc.zoom = 1.15;
  doc.freezeFirstRow = true;
  doc.freezeFirstColumn = true;
  doc.scrollLeft = 17;
  doc.scrollTop = 29;
  doc.initialColumnFitApplied = true;
  doc.selectionState = {
    focus: { row: Math.min(1, doc.rowCount - 1), column: Math.min(1, doc.columnCount - 1) },
    anchor: { row: 0, column: 0 },
    ranges: [{ top: 0, left: 0, bottom: Math.min(1, doc.rowCount - 1), right: Math.min(1, doc.columnCount - 1) }]
  };
  doc.markViewChanged();
  return doc;
}

function makeFixture(name) {
  const [text, serializedColumnCount, sparse] = fixtures[name];
  const doc = TableDocument.fromText(`${name}.txt`, text, {
    serializedColumnCount,
    dirty: false,
    revision: 11,
    path: `Data\\${name}.txt`,
    encoding: "utf-8",
    autoFitInitialColumns: false
  });
  if (sparse) {
    for (const [row, column] of [[1, 1], [1, 3], [2, 0], [2, 2], [3, 1], [3, 4]]) {
      if (doc.rows[row] && column < doc.rows[row].length) delete doc.rows[row][column];
    }
    doc.refreshShape();
  }
  return decorate(doc);
}

const commandFactories = [
  ["cell-edit", (doc) => makeCellCommand("edit", doc, [
    { row: Math.min(1, doc.rowCount - 1), column: Math.min(1, doc.columnCount - 1), value: "edited-cell" },
    { row: doc.rowCount, column: Math.min(2, doc.columnCount + 1), value: "new-row-cell" }
  ])],
  ["paste", (doc) => pasteTextCommand(doc, { row: 1, column: 1 }, "pasted-a\tpasted-b\npasted-c\tpasted-d")],
  ["insert-row", (doc) => insertRowCommand(doc, Math.min(2, doc.rowCount), 2)],
  ["add-row", (doc) => addRowsCommand(doc, 2)],
  ["clone-row", (doc) => cloneRowsCommand(doc, doc.rowCount > 1 ? [1] : [], Math.min(2, doc.rowCount))],
  ["delete-row", (doc) => deleteRowsCommand(doc, Math.min(1, doc.rowCount - 1), 1)],
  ["insert-column", (doc) => insertColumnCommand(doc, Math.min(3, doc.columnCount), 2)],
  ["add-column", (doc) => addColumnsCommand(doc, 2)],
  ["clone-column", (doc) => cloneColumnsCommand(doc, [Math.min(1, doc.columnCount - 1)], Math.min(2, doc.columnCount))],
  ["delete-column", (doc) => deleteColumnsCommand(doc, Math.min(1, doc.columnCount - 1), 1)]
];

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomInt(next, max) {
  return Math.floor(next() * max);
}

function randomCommand(doc, next) {
  switch (randomInt(next, 10)) {
    case 0:
      return makeCellCommand("random-cell", doc, [{
        row: next() < 0.3 ? doc.rowCount : randomInt(next, doc.rowCount),
        column: next() < 0.3 ? doc.columnCount + randomInt(next, 2) : randomInt(next, doc.columnCount),
        value: `v-${Math.floor(next() * 100000)}`
      }]);
    case 1:
      return pasteTextCommand(doc, { row: randomInt(next, doc.rowCount), column: randomInt(next, doc.columnCount) }, "p\tq\nr\ts");
    case 2:
      return insertRowCommand(doc, randomInt(next, doc.rowCount + 1), 1 + randomInt(next, 2));
    case 3:
      return addRowsCommand(doc, 1 + randomInt(next, 2));
    case 4:
      return cloneRowsCommand(doc, doc.rowCount > 1 ? [1 + randomInt(next, doc.rowCount - 1)] : [], randomInt(next, doc.rowCount + 1));
    case 5:
      return deleteRowsCommand(doc, randomInt(next, doc.rowCount), 1);
    case 6:
      return insertColumnCommand(doc, randomInt(next, doc.columnCount + 1), 1 + randomInt(next, 2));
    case 7:
      return addColumnsCommand(doc, 1 + randomInt(next, 2));
    case 8:
      return cloneColumnsCommand(doc, [randomInt(next, doc.columnCount)], randomInt(next, doc.columnCount + 1));
    default:
      return deleteColumnsCommand(doc, randomInt(next, doc.columnCount), 1);
  }
}

test("table commands restore full observable state for dense and sparse fixtures", () => {
  let checks = 0;
  for (const fixtureName of Object.keys(fixtures)) {
    for (const [commandName, factory] of commandFactories) {
      const doc = makeFixture(fixtureName);
      const command = factory(doc);
      if (command.isEmpty) continue;
      const before = snapshot(doc);
      const undo = new UndoManager();
      command.redo(doc);
      undo.push(command);
      undo.undo(doc);
      assertRestored(before, snapshot(doc), `${fixtureName}/${commandName}`);
      assert.equal(undo.undoStack.length, 0);
      assert.equal(undo.redoStack.length, 1);
      for (let cycle = 0; cycle < 3; cycle++) {
        undo.redo(doc);
        undo.undo(doc);
        assertRestored(before, snapshot(doc), `${fixtureName}/${commandName}/cycle-${cycle}`, 2 + (cycle + 1) * 2);
      }
      checks++;
    }
  }
  assert.equal(checks, Object.keys(fixtures).length * commandFactories.length);
});

test("table commands restore full observable state through fixed-seed mixed sequences", () => {
  const seeds = [0x5eed, 0x12345678, 0xc0ffee, 0x9e3779b9, 0xdeadbeef, 0x42424242, 0x01020304, 0xa5a5a5a5];
  const cases = [
    "denseLfFinal",
    "shortHeaderLongBody",
    "longHeaderShortBody",
    "emptyHeaderBody",
    "ragged",
    "serializedLessThanMax",
    "serializedGreaterThanMax"
  ];
  let checks = 0;
  for (const seed of seeds) {
    for (const fixtureName of cases) {
      const doc = makeFixture(fixtureName);
      const initial = snapshot(doc);
      const undo = new UndoManager();
      const commands = [];
      const states = [initial];
      const next = random(seed ^ fixtureName.length);
      for (let step = 0; step < 60; step++) {
        const command = randomCommand(doc, next);
        if (command.isEmpty) continue;
        command.redo(doc);
        undo.push(command);
        commands.push(command);
        states.push(snapshot(doc));
      }
      assert.ok(commands.length >= 20, `${fixtureName}/${seed.toString(16)} command count`);
      for (let index = commands.length - 1; index >= 0; index--) {
        undo.undo(doc);
        assert.deepEqual(
          restorable(snapshot(doc)),
          restorable(states[index]),
          `${fixtureName}/${seed.toString(16)}/undo-${index}/${commands[index].label}`
        );
      }
      assertRestored(initial, snapshot(doc), `${fixtureName}/${seed.toString(16)}/undo-all`, commands.length * 2);
      while (undo.canRedo) undo.redo(doc);
      while (undo.canUndo) undo.undo(doc);
      assertRestored(initial, snapshot(doc), `${fixtureName}/${seed.toString(16)}/redo-all-undo-all`, commands.length * 4);
      checks++;
    }
  }
  assert.equal(checks, seeds.length * cases.length);
});

test("table command LSP changes are exact inverses for redo and undo", () => {
  const columnDoc = () => TableDocument.fromText("items.txt", "h0\th1\th2\nh0\th1\th2", { dirty: false });
  const contracts = [
    [
      "insert-column",
      insertColumnCommand(columnDoc(), 1, 2),
      { kind: "insertColumns", index: 1, count: 2 },
      { kind: "deleteColumns", index: 1, count: 2 }
    ],
    [
      "add-column",
      addColumnsCommand(columnDoc(), 2),
      { kind: "insertColumns", index: 3, count: 2 },
      { kind: "deleteColumns", index: 3, count: 2 }
    ],
    [
      "clone-column",
      cloneColumnsCommand(columnDoc(), [1], 2),
      { kind: "insertColumns", index: 2, count: 1 },
      { kind: "deleteColumns", index: 2, count: 1 }
    ],
    [
      "delete-column",
      deleteColumnsCommand(columnDoc(), 1, 1),
      { kind: "deleteColumns", index: 1, count: 1 },
      { kind: "insertColumns", index: 1, count: 1 }
    ],
    [
      "delete-row",
      deleteRowsCommand(columnDoc(), 1, 1),
      { kind: "deleteRows", index: 1, count: 1 },
      { kind: "insertRows", index: 1, count: 1 }
    ]
  ];

  for (const [label, command, redoChange, undoChange] of contracts) {
    assert.deepEqual(command.lspChange, redoChange, `${label} redo LSP change`);
    assert.deepEqual(command.undoLspChange, undoChange, `${label} undo LSP change`);
  }

  const cellDoc = columnDoc();
  const cell = makeCellCommand("edit", cellDoc, [{ row: 1, column: 1, value: "changed" }]);
  assert.deepEqual(cell.lspChange, { kind: "replaceRows", rows: [1] });
  assert.deepEqual(cell.undoLspChange, { kind: "replaceRows", rows: [1] });
  cell.redo(cellDoc);
  assert.deepEqual(lspChangedRowsToIncrementalChanges(cellDoc, cell.lspChange), [{
    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0xFFFFFF } },
    text: "h0\tchanged\th2"
  }]);
  cell.undo(cellDoc);
  assert.equal(cellDoc.toText(), "h0\th1\th2\nh0\th1\th2");
});
