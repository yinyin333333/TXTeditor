import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TableDocument } from "../src/core/table-model.js";
import { SelectionModel } from "../src/core/selection.js";
import { clearRangesCommand } from "../src/core/operations.js";
import {
  CanvasGrid,
  gridColor
} from "../src/ui/canvas-grid.js";
import { centeredTextY } from "../src/ui/grid-render-policy.js";
import { hoverRequestPolicy } from "../src/ui/hover-policy.js";
import {
  createDefaultLintSettings,
  lintRuleGroupsForProfile,
  runLint
} from "../src/core/lint-engine.js";
import {
  HOVER_PREWARM_ENABLED,
  hoverPrewarmSchedulePolicy,
  shouldCancelPrewarmForUserHover
} from "../src/core/vector-hover-prewarm.js";

function lintDocs(docs, profile = "RotW") {
  const settings = createDefaultLintSettings();
  settings.profile = profile;
  return runLint(docs, settings);
}

function ruleIdsForProfile(profile) {
  return lintRuleGroupsForProfile(profile).flatMap((group) => group.rules.map((rule) => rule.id));
}

test("shift-style extension preserves the original anchor", () => {
  const selection = new SelectionModel();
  selection.set(1, 1);
  selection.toggleCell(4, 4);
  selection.extend(8, 3);
  assert.deepEqual(selection.rect, { top: 1, left: 1, bottom: 8, right: 3 });
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

test("explicit auto-fit can still expand for long body content", () => {
  const doc = TableDocument.fromText("x.txt", "Id\nForsaken 01 (Act1 Pit Cave)");
  const initial = doc.columnWidths[0];
  doc.autoFitColumn(0, 300);
  assert.ok(doc.columnWidths[0] > initial);
});

test("editing cell drawing suppresses selected chrome only for the editing cell", () => {
  const operations = [];
  let fillStyle = "";
  let strokeStyle = "";
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
    fillRect: (x, y, width, height) => operations.push({ kind: "fillRect", fillStyle, x, y, width, height }),
    strokeRect: (x, y, width, height) => operations.push({ kind: "strokeRect", strokeStyle, lineWidth, x, y, width, height })
  };
  const drawnText = [];
  const grid = {
    ctx,
    colorizeColumns: false,
    editor: { style: {} },
    gridFontFamily: "Test Font",
    selection: {
      focus: { row: 1, column: 2 },
      contains: () => true
    },
    doc: {
      freezeFirstRow: false,
      freezeFirstColumn: false,
      getCell: () => "cell"
    },
    font: () => "12px sans-serif",
    editingCell: () => ({ row: 1, column: 1 }),
    fillText: (...args) => drawnText.push(args),
    drawDiagnosticMarker: (row, column) => operations.push({ kind: "diagnostic", row, column })
  };

  CanvasGrid.prototype.drawCell.call(grid, 1, 1, 10, 20, 80, 26);
  CanvasGrid.prototype.drawCell.call(grid, 1, 2, 100, 20, 80, 26);
  CanvasGrid.prototype.styleEditorForCell.call(grid, 1, 1);

  assert.equal(operations[0].fillStyle, gridColor("rowOdd"));
  assert.deepEqual(operations.filter((operation) => operation.kind === "diagnostic").map(({ row, column }) => [row, column]), [[1, 1], [1, 2]]);
  assert.equal(drawnText.length, 1);
  assert.deepEqual(drawnText[0], ["cell", 108, centeredTextY(20, 26), 68]);
  assert.equal(operations.some((operation) => operation.kind === "strokeRect" && operation.x === 11 && operation.lineWidth === 2), false);
  assert.equal(operations.some((operation) => operation.kind === "strokeRect" && operation.x === 101 && operation.lineWidth === 2), true);
  assert.equal(grid.editor.style.backgroundColor, gridColor("rowOdd"));
  assert.equal(grid.editor.style.color, gridColor("text"));
  assert.equal(grid.editor.style.fontFamily, "Test Font");
  assert.equal(grid.editor.style.fontWeight, "400");
});

test("hover delay is not restarted by repeated movement inside the same target", () => {
  assert.deepEqual(hoverRequestPolicy({
    pendingRow: 4,
    pendingCol: 2,
    lastRequestRow: -1,
    lastRequestCol: -1,
    row: 4,
    column: 2
  }), {
    samePendingTarget: true,
    sameRequestedTarget: false,
    shouldRequest: true,
    shouldResetRequestedTarget: false
  });
  assert.deepEqual(hoverRequestPolicy({
    pendingRow: 4,
    pendingCol: 2,
    lastRequestRow: 4,
    lastRequestCol: 2,
    row: 4,
    column: 2
  }), {
    samePendingTarget: true,
    sameRequestedTarget: true,
    shouldRequest: false,
    shouldResetRequestedTarget: false
  });
  assert.equal(hoverRequestPolicy({
    pendingRow: 4,
    pendingCol: 2,
    lastRequestRow: 4,
    lastRequestCol: 2,
    row: 5,
    column: 2
  }).shouldResetRequestedTarget, true);
});

test("prewarm is disabled so background hover cannot block user hover", () => {
  assert.equal(HOVER_PREWARM_ENABLED, false);
  assert.deepEqual(hoverPrewarmSchedulePolicy({ vectorHoverEnabled: false }), {
    action: "cancel",
    disabled: true,
    recordTraffic: false,
    event: { skipped: true, disabled: true, queued: 0 }
  });
  assert.deepEqual(hoverPrewarmSchedulePolicy({ vectorHoverEnabled: true }), {
    action: "cancel",
    disabled: true,
    recordTraffic: true,
    event: { skipped: true, disabled: true, queued: 0 }
  });
  assert.deepEqual(hoverPrewarmSchedulePolicy({ vectorHoverEnabled: true, prewarmEnabled: true }), {
    action: "schedule",
    disabled: false,
    recordTraffic: false,
    event: { skipped: false, disabled: false }
  });
  assert.equal(shouldCancelPrewarmForUserHover(), true);
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
