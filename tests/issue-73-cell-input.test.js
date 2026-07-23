import assert from "node:assert/strict";
import test from "node:test";
import {
  calculationMetadata,
  unicodeCharacterCount
} from "../src/ui/controllers/cell-input-controller.js";

test("cell input counts Unicode characters rather than UTF-16 code units", () => {
  assert.equal(unicodeCharacterCount("A😀한"), 3);
});

test("cell input enables the counter only for schema-backed Parse fields with limit 255", () => {
  assert.deepEqual(calculationMetadata({ fieldType: "parse", maxLength: 255 }), { maxLength: 255 });
  assert.equal(calculationMetadata({ fieldType: "parse", maxLength: 254 }), null);
  assert.equal(calculationMetadata({ fieldType: "string", maxLength: 255 }), null);
  assert.equal(calculationMetadata({ fieldType: "parse", maxLength: "255" })?.maxLength, 255);
});
