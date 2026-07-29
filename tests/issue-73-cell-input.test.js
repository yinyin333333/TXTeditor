import assert from "node:assert/strict";
import test from "node:test";
import {
  calculationMetadata,
  unicodeCharacterCount
} from "../src/ui/controllers/cell-input-controller.js";
import { CanvasGrid } from "../src/ui/canvas-grid.js";
import { vectorTooltipSections } from "../src/ui/hover-policy.js";

test("cell input counts Unicode characters rather than UTF-16 code units", () => {
  assert.equal(unicodeCharacterCount("A😀한"), 3);
});

test("cell input enables the counter only for schema-backed Parse fields with limit 255", () => {
  assert.deepEqual(calculationMetadata({ fieldType: "parse", maxLength: 255 }), { maxLength: 255 });
  assert.equal(calculationMetadata({ fieldType: "parse", maxLength: 254 }), null);
  assert.equal(calculationMetadata({ fieldType: "string", maxLength: 255 }), null);
  assert.equal(calculationMetadata({ fieldType: "parse", maxLength: "255" })?.maxLength, 255);
});

test("calculation hover details remain visible alongside cell diagnostics", () => {
  const formula = "(skill('Fire Arrow'.blvl))*par8";
  const sections = vectorTooltipSections({
    value: formula,
    hoverText: `Cell value\n\n${formula}\n\nCharacter count: 31/255`,
    diagnostics: [{
      severity: "error",
      message: "Unknown missile value 'par8'."
    }]
  });

  assert.deepEqual(sections.map((section) => section.kind), ["diagnostic", "hover"]);
  assert.match(sections[1].text, /Character count: 31\/255/);
});

test("calculation hover count follows the live cell input preview", () => {
  const savedFormula = "x".repeat(95);
  const editedFormula = "x".repeat(93);
  const sections = vectorTooltipSections({
    value: editedFormula,
    hoverText: `Cell value\n\n${savedFormula}\n\nCharacter count: 95/255`,
    diagnostics: [{
      severity: "error",
      message: "Unknown calculation value."
    }]
  });

  assert.match(sections[1].text, /Character count: 93\/255/);
  assert.doesNotMatch(sections[1].text, /95\/255/);
});

test("an open hover is refreshed as soon as cell diagnostics change", () => {
  const calls = [];
  const diagnostics = new Map([["758:141", [{ severity: "error" }]]]);
  const grid = {
    diagnosticsByCell: new Map(),
    _hoveredCell: { row: 758, col: 141 },
    _tooltip: { style: { display: "block" } },
    _lastTooltipX: 320,
    _lastTooltipY: 180,
    draw: () => calls.push(["draw"]),
    _renderTooltip: (...args) => calls.push(["tooltip", ...args])
  };

  CanvasGrid.prototype.setDiagnostics.call(grid, diagnostics);

  assert.equal(grid.diagnosticsByCell, diagnostics);
  assert.deepEqual(calls, [
    ["draw"],
    ["tooltip", 758, 141, 320, 180]
  ]);
});
