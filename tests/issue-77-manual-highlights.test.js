import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deleteColumnsCommand, deleteRowsCommand, insertRowCommand } from "../src/core/operations.js";
import { SelectionModel } from "../src/core/selection.js";
import { TableDocument } from "../src/core/table-model.js";
import { CanvasGrid } from "../src/ui/canvas-grid.js";
import {
  MANUAL_HIGHLIGHT_PALETTE,
  MANUAL_HIGHLIGHT_STORAGE_KEY,
  createManualHighlightController,
  manualHighlightDocumentKey
} from "../src/ui/manual-highlight.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key) ?? null; }
  };
}

function harness(doc, { storage = memoryStorage() } = {}) {
  const selection = new SelectionModel();
  selection.set(0, 0);
  let draws = 0;
  const controller = createManualHighlightController({
    state: { selection },
    activeDoc: () => doc,
    grid: { draw: () => { draws += 1; } },
    storage
  });
  controller.openDocument(doc);
  return { controller, selection, storage, get draws() { return draws; } };
}

function persistedDocuments(storage) {
  return JSON.parse(storage.value(MANUAL_HIGHLIGHT_STORAGE_KEY) || "{}").documents ?? {};
}

test("#77 applies the 11-color palette to cells, ranges, and full rows without modifying TXT data", () => {
  assert.deepEqual(MANUAL_HIGHLIGHT_PALETTE.map(({ id }) => id), [
    "red", "orange", "yellow", "lime", "green", "sky", "blue", "purple", "pink", "brown", "gray"
  ]);
  const doc = TableDocument.fromText("records.txt", "id\tname\tvalue\na\tAlpha\t1\nb\tBeta\t2", { dirty: false });
  const beforeText = doc.toText();
  const { controller, selection } = harness(doc);

  selection.setRange(1, 1, 2, 2);
  assert.equal(controller.applyColor("red"), true);
  assert.equal(controller.colorForCell(doc, 1, 1), "red");
  assert.equal(controller.colorForCell(doc, 2, 2), "red");
  assert.equal(controller.colorForCell(doc, 1, 0), null);

  selection.setRow(2, doc.columnCount);
  assert.equal(controller.applyColor("blue"), true);
  for (let column = 0; column < doc.columnCount; column += 1) {
    assert.equal(controller.colorForCell(doc, 2, column), "blue");
  }

  selection.set(2, 1);
  assert.equal(controller.removeSelection(), true);
  assert.equal(controller.colorForCell(doc, 2, 1), null, "a cell removal masks an inherited row highlight");
  assert.equal(controller.colorForCell(doc, 2, 0), "blue");
  assert.equal(doc.toText(), beforeText);
  assert.equal(doc.dirty, false);
});

test("#77 persists by record key, duplicate occurrence/fingerprint, and column name across reopen and key edits", () => {
  const storage = memoryStorage();
  const original = TableDocument.fromText("records.txt", "id\tvalue\ndup\tfirst\ndup\tsecond", {
    path: "C:/mods/data/records.txt",
    dirty: false
  });
  const first = harness(original, { storage });
  first.selection.set(2, 1);
  first.controller.applyColor("purple");

  const reordered = TableDocument.fromText("records.txt", "id\tvalue\ndup\tsecond\ndup\tfirst", {
    path: "C:/mods/data/records.txt",
    dirty: false
  });
  const second = harness(reordered, { storage });
  assert.equal(second.controller.colorForCell(reordered, 1, 1), "purple", "fingerprint follows the same duplicate record after reordering");
  assert.equal(second.controller.colorForCell(reordered, 2, 1), null);

  reordered.setCell(1, 0, "renamed");
  second.controller.commitSavedDocument(reordered, {
    previousKey: second.controller.captureDocumentKey(reordered),
    saveAs: false
  });
  const reopened = TableDocument.fromText("records.txt", "id\tvalue\nrenamed\tsecond\ndup\tfirst", {
    path: "C:/mods/data/records.txt",
    dirty: false
  });
  const third = harness(reopened, { storage });
  assert.equal(third.controller.colorForCell(reopened, 1, 1), "purple", "a saved record-key edit transfers the annotation on the tracked row");
});

test("#77 structural deletion removes highlights, Undo restores them, Redo removes them, and unsaved deletion does not overwrite saved annotations", () => {
  const storage = memoryStorage();
  const doc = TableDocument.fromText("records.txt", "id\ta\tb\nrow1\t1\t2\nrow2\t3\t4", {
    path: "/mods/records.txt",
    dirty: false
  });
  const { controller, selection } = harness(doc, { storage });
  selection.setRow(2, doc.columnCount);
  controller.applyColor("green");
  selection.set(1, 2);
  controller.applyColor("orange");

  const deleteRow = deleteRowsCommand(doc, 2, 1);
  controller.beforeCommand(doc, deleteRow);
  deleteRow.redo(doc);
  controller.afterCommand(doc, deleteRow, "execute");
  assert.equal(doc.rowCount, 2);
  assert.equal(controller.colorForCell(doc, 1, 2), "orange");

  deleteRow.undo(doc);
  controller.afterCommand(doc, deleteRow, "undo");
  assert.equal(controller.colorForCell(doc, 2, 0), "green");
  assert.equal(controller.colorForCell(doc, 2, 2), "green");

  deleteRow.redo(doc);
  controller.afterCommand(doc, deleteRow, "redo");
  assert.equal(doc.rowCount, 2);

  const diskBeforeSave = TableDocument.fromText("records.txt", "id\ta\tb\nrow1\t1\t2\nrow2\t3\t4", {
    path: "/mods/records.txt",
    dirty: false
  });
  const discarded = harness(diskBeforeSave, { storage });
  assert.equal(discarded.controller.colorForCell(diskBeforeSave, 2, 1), "green", "discarding an unsaved structural delete keeps the last-saved annotation state");

  controller.commitSavedDocument(doc, {
    previousKey: manualHighlightDocumentKey(doc),
    saveAs: false
  });
  const savedShape = TableDocument.fromText("records.txt", "id\ta\tb\nrow1\t1\t2", {
    path: "/mods/records.txt",
    dirty: false
  });
  const afterSave = harness(savedShape, { storage });
  assert.equal(afterSave.controller.colorForCell(savedShape, 1, 2), "orange");
  assert.equal(afterSave.controller.hasAnyHighlights(savedShape), true);

  const deleteColumn = deleteColumnsCommand(savedShape, 2, 1);
  afterSave.controller.beforeCommand(savedShape, deleteColumn);
  deleteColumn.redo(savedShape);
  afterSave.controller.afterCommand(savedShape, deleteColumn, "execute");
  assert.equal(savedShape.columnCount, 2);
  deleteColumn.undo(savedShape);
  afterSave.controller.afterCommand(savedShape, deleteColumn, "undo");
  assert.equal(afterSave.controller.colorForCell(savedShape, 1, 2), "orange");
  deleteColumn.redo(savedShape);
  afterSave.controller.afterCommand(savedShape, deleteColumn, "redo");
  assert.equal(savedShape.columnCount, 2);
});

test("#77 inserted rows keep existing logical records and Save As copies annotations to the new document identity", () => {
  const storage = memoryStorage();
  const doc = TableDocument.fromText("old.txt", "id\tvalue\na\t1\nb\t2", {
    path: "/mods/old.txt",
    dirty: false
  });
  const { controller, selection } = harness(doc, { storage });
  selection.set(2, 1);
  controller.applyColor("sky");

  const insert = insertRowCommand(doc, 1, 1);
  controller.beforeCommand(doc, insert);
  insert.redo(doc);
  controller.afterCommand(doc, insert, "execute");
  assert.equal(controller.colorForCell(doc, 3, 1), "sky", "inserting before a record preserves its runtime identity");

  const oldKey = controller.captureDocumentKey(doc);
  doc.path = "/mods/new.txt";
  doc.name = "new.txt";
  controller.commitSavedDocument(doc, { saveAs: true, previousKey: oldKey });
  const documents = persistedDocuments(storage);
  assert.ok(documents[oldKey]);
  assert.ok(documents[manualHighlightDocumentKey(doc)]);

  const oldFile = TableDocument.fromText("old.txt", "id\tvalue\na\t1\nb\t2", { path: "/mods/old.txt", dirty: false });
  const oldHarness = harness(oldFile, { storage });
  assert.equal(oldHarness.controller.colorForCell(oldFile, 2, 1), "sky");
  const newFile = TableDocument.fromText("new.txt", "id\tvalue\n\t\na\t1\nb\t2", { path: "/mods/new.txt", dirty: false });
  const newHarness = harness(newFile, { storage });
  assert.equal(newHarness.controller.colorForCell(newFile, 3, 1), "sky");
});

test("#77 clear-all immediately removes every highlight and corrupt annotation storage never blocks opening", () => {
  const storage = memoryStorage({ [MANUAL_HIGHLIGHT_STORAGE_KEY]: "{not-json" });
  const doc = TableDocument.fromText("unicode-한글.txt", "id\tvalue\na\t1", { dirty: false });
  const { controller, selection } = harness(doc, { storage });
  assert.equal(controller.hasAnyHighlights(doc), false);
  selection.set(1, 1);
  controller.applyColor("pink");
  assert.equal(controller.clearAll(), true);
  assert.equal(controller.hasAnyHighlights(doc), false);
  assert.equal(persistedDocuments(storage)[manualHighlightDocumentKey(doc)], undefined);
});

test("#77 renderer layers subtle theme-adapted highlights below selection, diagnostics, and the active border", () => {
  const fills = [];
  let fillStyle = "";
  let strokeStyle = "";
  let lineWidth = 1;
  const ctx = {
    set fillStyle(value) { fillStyle = value; },
    get fillStyle() { return fillStyle; },
    set strokeStyle(value) { strokeStyle = value; },
    get strokeStyle() { return strokeStyle; },
    set lineWidth(value) { lineWidth = value; },
    get lineWidth() { return lineWidth; },
    fillRect(x, y, width, height) { fills.push({ fillStyle, x, y, width, height }); },
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    measureText: () => ({ width: 20 }),
    fillText() {},
    set textBaseline(value) { this._textBaseline = value; }
  };
  const grid = {
    ctx,
    selection: { focus: { row: 0, column: 0 }, contains: () => false },
    doc: { columnCount: 3, getCell: () => "value" },
    colorizeColumns: false,
    diagnosticsByCell: new Map(),
    font: () => "12px sans-serif",
    editingCell: () => null,
    fillText() {},
    drawDiagnosticMarker() {},
    manualHighlightColor: () => "rgba(59, 130, 246, .25)"
  };
  CanvasGrid.prototype.drawCell.call(grid, 1, 1, 10, 20, 80, 26);
  assert.equal(fills[1].fillStyle, "rgba(59, 130, 246, .25)");

  fills.length = 0;
  grid.selection.contains = () => true;
  CanvasGrid.prototype.drawCell.call(grid, 1, 1, 10, 20, 80, 26);
  assert.equal(fills.length, 1, "selection fill remains visually dominant");

  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const id of MANUAL_HIGHLIGHT_PALETTE.map(({ id }) => id)) {
    const values = [...css.matchAll(new RegExp(`--grid-manual-highlight-${id}: rgba\\([^;]+, \\.(\\d+)\\);`, "g"))];
    assert.equal(values.length, 2, `${id} must define dark and light values`);
    for (const match of values) {
      const alpha = Number(`0.${match[1]}`);
      assert.ok(alpha >= 0.20 && alpha <= 0.30, `${id} alpha must remain subtle`);
    }
  }

  const surfaceSource = readFileSync(new URL("../src/ui/controllers/command-surface-controller.js", import.meta.url), "utf8");
  assert.ok(surfaceSource.indexOf('tText("menu.math")') < surfaceSource.indexOf('tText("highlight.menu")'));
  assert.ok(surfaceSource.indexOf('tText("highlight.menu")') < surfaceSource.indexOf('id: "go-to-definition"'));
  assert.match(surfaceSource, /type: "separator"/);
  assert.match(surfaceSource, /data-highlight-action/);
  assert.match(surfaceSource, /id: "highlight"/);
  assert.match(css, /\.submenu-highlight\s*\{[^}]*overflow: visible;/s);

  const highlightSource = readFileSync(new URL("../src/ui/manual-highlight.js", import.meta.url), "utf8");
  assert.doesNotMatch(highlightSource, /plugin:dialog|confirmClear|highlight\.clearConfirm/);
});
