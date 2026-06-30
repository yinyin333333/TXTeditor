import assert from "node:assert/strict";
import test from "node:test";
import { SelectionModel } from "../src/core/selection.js";
import {
  columnRangesFromRanges,
  rowOperationTargetRanges,
  rowOperationTargets
} from "../src/ui/row-operation-policy.js";

test("row operation targets preserve explicit full-row ranges", () => {
  const selection = new SelectionModel();
  selection.setRow(10, 5);
  selection.extendRows(20, 5);

  assert.deepEqual(rowOperationTargets({
    selection,
    contextHit: { kind: "row-header", row: 15 },
    rowCount: 100,
    columnCount: 5
  }), Array.from({ length: 11 }, (_, index) => index + 10));
  assert.deepEqual(rowOperationTargetRanges({
    selection,
    contextHit: { kind: "row-header", row: 15 },
    rowCount: 100,
    columnCount: 5
  }), [[10, 20]]);
});

test("row operation targets do not turn select-all into hide-all", () => {
  const selection = new SelectionModel();
  selection.selectAll(100, 5);

  assert.deepEqual(rowOperationTargets({
    selection,
    contextHit: { kind: "row-header", row: 12 },
    rowCount: 100,
    columnCount: 5
  }), [12]);
});

test("row operation targets fall back from full-column selection to the focused row", () => {
  const selection = new SelectionModel();
  selection.setColumn(3, 100);
  selection.focus = { row: 42, column: 3 };

  assert.deepEqual(rowOperationTargets({
    selection,
    rowCount: 100,
    columnCount: 5
  }), [42]);
});

test("row operation targets support multiple disjoint full-row ranges", () => {
  const selection = new SelectionModel();
  selection.setRow(3, 5);
  selection.toggleRow(8, 5);
  selection.toggleRow(9, 5);

  assert.deepEqual(rowOperationTargets({
    selection,
    rowCount: 20,
    columnCount: 5
  }), [3, 8, 9]);
  assert.deepEqual(rowOperationTargetRanges({
    selection,
    rowCount: 20,
    columnCount: 5
  }), [[3, 3], [8, 9]]);
});

test("row operation targets do not treat partial all-row table selection as hide-all", () => {
  const selection = new SelectionModel();
  selection.setRange(0, 1, 99, 3, { row: 12, column: 2 });

  assert.deepEqual(rowOperationTargets({
    selection,
    rowCount: 100,
    columnCount: 5
  }), [12]);
});

test("column range targets preserve consecutive selections compactly", () => {
  assert.deepEqual(columnRangesFromRanges([
    { top: 0, bottom: 9, left: 3, right: 8 },
    { top: 0, bottom: 9, left: 12, right: 13 }
  ], 20), [[3, 8], [12, 13]]);
});
