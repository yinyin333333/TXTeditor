import assert from "node:assert/strict";
import test from "node:test";
import { TableDocument } from "../src/core/table-model.js";
import { SelectionModel } from "../src/core/selection.js";
import {
  SEARCH_SCOPE_COLUMN_TITLES,
  SEARCH_SCOPE_ROW_TITLES,
  replaceAllInTable,
  replaceNextInTable
} from "../src/core/search.js";
import { makeCellCommand } from "../src/core/undo.js";
import { columnCommandItems, commandActionForId } from "../src/ui/command-registry.js";
import { createGridCommandController } from "../src/ui/controllers/grid-command-controller.js";
import { cyclicDocumentIndex } from "../src/ui/document-lifecycle-policy.js";
import { globalShortcutAction } from "../src/ui/global-shortcut-policy.js";
import { promptNumber } from "../src/ui/prompt-dialog.js";
import { validateShortcutChord } from "../src/ui/shortcut-policy.js";

test("table replace-next and replace-all are case-insensitive and scope-aware", () => {
  const doc = TableDocument.fromText("skills.txt", "Name\tDescription\nBash\tbash bash\nZeal\tbash");

  const next = replaceNextInTable(doc, "BASH", "hit", { row: 1, column: 0 });
  assert.deepEqual(next.found, { row: 1, column: 0 });
  assert.deepEqual(next.edits, [{ row: 1, column: 0, value: "hit" }]);
  assert.equal(next.replacementCount, 1);

  const all = replaceAllInTable(doc, "bash", "hit");
  assert.equal(all.replacementCount, 4);
  assert.deepEqual(all.edits, [
    { row: 1, column: 0, value: "hit" },
    { row: 1, column: 1, value: "hit hit" },
    { row: 2, column: 1, value: "hit" }
  ]);

  assert.equal(replaceAllInTable(doc, "name", "id", { scope: SEARCH_SCOPE_COLUMN_TITLES }).replacementCount, 1);
  assert.equal(replaceAllInTable(doc, "zeal", "frenzy", { scope: SEARCH_SCOPE_ROW_TITLES }).replacementCount, 1);
});

test("Replace All is recorded as one reversible cell command", () => {
  const doc = TableDocument.fromText("skills.txt", "name\tdesc\nbash\tbash bash");
  const result = replaceAllInTable(doc, "bash", "hit");
  const command = makeCellCommand("Replace All", doc, result.edits);

  command.redo(doc);
  assert.equal(doc.getCell(1, 0), "hit");
  assert.equal(doc.getCell(1, 1), "hit hit");
  command.undo(doc);
  assert.equal(doc.getCell(1, 0), "bash");
  assert.equal(doc.getCell(1, 1), "bash bash");
});

test("new navigation shortcuts map to commands and modified Tab remains configurable", () => {
  assert.equal(globalShortcutAction({ key: "F3" }), "find-next");
  assert.equal(globalShortcutAction({ key: "F3", shiftKey: true }), "find-previous");
  assert.equal(globalShortcutAction({ key: "h", ctrlKey: true, shiftKey: true }), "replace");
  assert.equal(globalShortcutAction({ key: "g", ctrlKey: true }), "go-to-row");
  assert.equal(globalShortcutAction({ key: "Tab", ctrlKey: true }), "next-tab");
  assert.equal(globalShortcutAction({ key: "Tab", ctrlKey: true, shiftKey: true }), "previous-tab");
  assert.equal(globalShortcutAction({ key: "F3" }, { editingCell: true }), "find-next");
  assert.equal(globalShortcutAction({ key: "F3", shiftKey: true }, { editingCell: true }), "find-previous");
  assert.equal(globalShortcutAction({ key: "h", ctrlKey: true }), "reset-row-heights");
  assert.equal(validateShortcutChord("Ctrl+Tab").valid, true);
  assert.equal(validateShortcutChord("Ctrl+Shift+Tab").valid, true);
  assert.equal(validateShortcutChord("Tab").valid, false);
  assert.equal(validateShortcutChord("Shift+Tab").valid, false);
});

test("new commands are registered with their intended handlers", () => {
  assert.deepEqual(commandActionForId("find-previous"), { type: "handler", name: "findPrevious" });
  assert.deepEqual(commandActionForId("replace"), { type: "handler", name: "showReplace" });
  assert.deepEqual(commandActionForId("go-to-row"), { type: "handler", name: "goToRow" });
  assert.deepEqual(commandActionForId("next-tab"), { type: "handler", name: "nextTab" });
  assert.deepEqual(commandActionForId("previous-tab"), { type: "handler", name: "previousTab" });
  assert.deepEqual(commandActionForId("clone-column"), { type: "handler", name: "cloneColumns" });
  assert.deepEqual(columnCommandItems().at(-1), { id: "clone-column", label: "Clone Column(s)", disabled: false });
});

test("tab navigation wraps in both directions", () => {
  assert.equal(cyclicDocumentIndex({ activeIndex: 0, documentCount: 3, delta: 1 }), 1);
  assert.equal(cyclicDocumentIndex({ activeIndex: 2, documentCount: 3, delta: 1 }), 0);
  assert.equal(cyclicDocumentIndex({ activeIndex: 0, documentCount: 3, delta: -1 }), 2);
  assert.equal(cyclicDocumentIndex({ activeIndex: 0, documentCount: 0, delta: 1 }), -1);
});

test("Go to Row uses the displayed one-based row number", async () => {
  const doc = TableDocument.fromText("skills.txt", "name\nrow1\nrow2\nrow3");
  const calls = [];
  const state = {
    selection: {
      focus: { row: 0, column: 0 },
      set(row, column) { this.focus = { row, column }; }
    }
  };
  const controller = createGridCommandController({
    state,
    grid: {
      scrollCellToCenter: (row, column) => calls.push(["scroll", row, column]),
      draw: () => calls.push(["draw"])
    },
    activeDoc: () => doc,
    hasOpenDocument: () => true,
    execute: () => {},
    saveSelectionState: () => calls.push(["save"]),
    renderChrome: () => calls.push(["render"]),
    showError: (error) => { throw error; },
    promptNumber: async (options) => {
      assert.equal(options.min, 1);
      assert.equal(options.max, 4);
      return 3;
    },
    applyFreezeToDoc: () => {},
    rowsForContextOperation: () => [],
    columnsFromSelection: () => []
  });

  await controller.goToRow();
  assert.deepEqual(state.selection.focus, { row: 2, column: 0 });
  assert.deepEqual(calls, [["save"], ["scroll", 2, 0], ["draw"], ["render"]]);
});

test("Clone Row and Clone Column preserve the existing focus and viewport", () => {
  const doc = TableDocument.fromText("skills.txt", "name\tid\tdesc\nbash\t1\tmelee\nzeal\t2\taura");
  const selection = new SelectionModel();
  selection.set(1, 1);
  const executed = [];
  const controller = createGridCommandController({
    state: { selection },
    grid: {
      scrollCellIntoView: () => { throw new Error("Clone must not move the viewport."); },
      draw: () => {}
    },
    activeDoc: () => doc,
    hasOpenDocument: () => true,
    execute: (command) => {
      command.redo(doc);
      executed.push(command.label);
    },
    saveSelectionState: () => {},
    renderChrome: () => {},
    showError: (error) => { throw new Error(String(error)); },
    applyFreezeToDoc: () => {},
    rowsForContextOperation: () => [1],
    columnsFromSelection: () => [1]
  });

  controller.cloneRows();
  assert.deepEqual(selection.focus, { row: 1, column: 1 });
  assert.equal(doc.getCell(3, 0), "bash");
  controller.cloneColumns();
  assert.deepEqual(selection.focus, { row: 1, column: 1 });
  assert.equal(doc.getCell(1, 3), "1");
  assert.deepEqual(executed, ["Clone 1 Row(s)", "Clone 1 Column(s)"]);
});

test("numeric prompts can enforce an upper bound", async () => {
  const result = await promptNumber({
    title: "Go to Row",
    message: "Row",
    min: 1,
    max: 3,
    askText: async ({ validate }) => validate("4")
  });
  assert.deepEqual(result, { error: "Enter a number 3 or lower." });
});
