import assert from "node:assert/strict";
import test from "node:test";
import { SelectionModel } from "../src/core/selection.js";
import { rowOperationTargets } from "../src/ui/row-operation-policy.js";

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

