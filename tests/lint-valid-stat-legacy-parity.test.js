import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkspaceIndex, createDefaultLintSettings, runLint, runLintWithWorkspaceIndex } from "../src/core/lint-engine.js";
import { TableDocument } from "../src/core/table-model.js";

function docs(properties, stats, items) {
  return [
    TableDocument.fromText("properties.txt", `code\tfunc1\tstat1\n${properties}`),
    TableDocument.fromText("itemstatcost.txt", `stat\tsave bits\tsave add\tsigned\tencode\n${stats}`),
    TableDocument.fromText("skills.txt", "skill\nAttack\nFireball"),
    TableDocument.fromText("uniqueitems.txt", `index\tprop1\tpar1\tmin1\tmax1\n${items}`)
  ];
}

function diagnostics(...args) {
  return runLint(docs(...args), createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Items/ValidStatParameters");
}

test("ValidStatParameters preserves d2rlint's func17 silence and ignores missing ItemStatCost targets", () => {
  const func17 = diagnostics("encoded\t17\tbounded", "bounded\t1\t0\t0\t0", "row\tencoded\t99\t99\t99");
  const missing = diagnostics("missing\t1\tnot_in_itemstatcost", "bounded\t1\t0\t0\t0", "row\tmissing\t\t99\t99");
  assert.deepEqual(func17, []);
  assert.deepEqual(missing, []);
});

test("ValidStatParameters preserves d2rlint's parseInt charge normalization and signed-only lower bound", () => {
  const charge = diagnostics("charged\t19\tcharged_stat", "charged_stat\t1\t0\t1\t0", "row\tcharged\t\t999junk\t-999junk");
  const unsigned = diagnostics("unsigned\t1\tunsigned_stat", "unsigned_stat\t8\t32\t0\t0", "row\tunsigned\t\t-33\t-33");
  const signed = diagnostics("signed\t1\tsigned_stat", "signed_stat\t8\t32\t1\t0", "row\tsigned\t\t-33\t-33");
  assert.deepEqual(charge.map((entry) => entry.columnName), ["min1"]);
  assert.deepEqual(unsigned, []);
  assert.deepEqual(signed.map((entry) => entry.columnName).sort(), ["max1", "min1"]);
});

test("ValidStatParameters preserves d2rlint's historical upper formula", () => {
  const results = diagnostics("bounded\t1\tbounded_stat", "bounded_stat\t3\t2\t0\t0", "at-limit\tbounded\t\t6\t6\nabove\tbounded\t\t7\t7");
  assert.deepEqual(results.filter((entry) => entry.rowIndex === 1), []);
  assert.deepEqual(results.filter((entry) => entry.rowIndex === 2).map((entry) => entry.columnName).sort(), ["max1", "min1"]);
});

test("ValidStatParameters excludes MonProp from saved-item ranges for every public profile mapping", () => {
  const documents = [
    TableDocument.fromText("properties.txt", "code\tfunc1\tstat1\nstupidity\t1\titem_stupidity"),
    TableDocument.fromText("itemstatcost.txt", "stat\tsave bits\tsave add\tsigned\tencode\nitem_stupidity\t8\t0\t1\t0"),
    TableDocument.fromText("skills.txt", "skill\nAttack"),
    TableDocument.fromText("monprop.txt", "id\tprop1\tmin1\tmax1\ndruidhawk\tstupidity\t-1\t-1")
  ];
  for (const [profile, referenceVersion] of [["RotW", "3.3"], ["RotW", "3.2"], ["RotW", "3.1"], ["2.4", "2.4"], ["1.13c", "1.13c"]]) {
    const index = buildWorkspaceIndex(documents, profile, { referenceVersion });
    const settings = { ...createDefaultLintSettings(), profile };
    const results = runLintWithWorkspaceIndex(index, settings)
      .filter((entry) => entry.ruleId === "Items/ValidStatParameters");
    assert.deepEqual(results, [], `${profile}/${referenceVersion}`);
  }
});

test("ValidStatParameters still applies saved ranges to persisted tables and validates MonProp skills", () => {
  const persisted = diagnostics("bounded\t1\tbounded_stat", "bounded_stat\t1\t0\t1\t0", "row\tbounded\t\t-1\t-1");
  assert.deepEqual(persisted.map((entry) => entry.columnName).sort(), ["max1", "min1"]);

  const monprop = [
    TableDocument.fromText("properties.txt", "code\tfunc1\tstat1\nskill\t22\tskill_stat"),
    TableDocument.fromText("itemstatcost.txt", "stat\tsave bits\tsave add\tsigned\tencode\nskill_stat\t8\t0\t0\t1"),
    TableDocument.fromText("skills.txt", "skill\nAttack"),
    TableDocument.fromText("monprop.txt", "id\tprop1\tpar1\tmin1\tmax1\nrow\tskill\tMissingSkill\t-1\t-1")
  ];
  const skillDiagnostics = runLint(monprop, createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Items/ValidStatParameters");
  assert.deepEqual(skillDiagnostics.map((entry) => entry.columnName), ["par1"]);
});
