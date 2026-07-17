import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultLintSettings, runLint } from "../src/core/lint-engine.js";
import { TableDocument } from "../src/core/table-model.js";

function document(name, text) {
  return TableDocument.fromText(name, text);
}

function validStatDiagnostics({ properties, itemStats, items, skills = ["Attack", "Skill One", "Skill Two", "Skill Three"] }) {
  const documents = [
    document("properties.txt", ["code\tfunc1\tstat1", ...properties].join("\n")),
    document("itemstatcost.txt", ["stat\tsave bits\tsave add\tsigned\tencode\tsave param bits\tstuff", ...itemStats].join("\n")),
    document("skills.txt", ["skill", ...skills].join("\n")),
    document("uniqueitems.txt", ["index\tprop1\tpar1\tmin1\tmax1", ...items].join("\n"))
  ];
  return runLint(documents, createDefaultLintSettings())
    .filter((diagnostic) => diagnostic.ruleId === "Items/ValidStatParameters");
}

test("func17 uses stat and selects param or random min/max as the saved value source", () => {
  const diagnostics = validStatDiagnostics({
    properties: ["source-aware\t17\tbounded"],
    itemStats: ["bounded\t3\t0\t0\t0\t0\t6"],
    items: [
      "Param In Range\tsource-aware\t7\t99\t99",
      "Param Out Of Range\tsource-aware\t8\t0\t0",
      "Fallback In Range\tsource-aware\t0\t7\t7",
      "Fallback Out Of Range\tsource-aware\t0\t8\t8"
    ]
  });

  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 1), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 2).map((entry) => entry.columnName), ["par1"]);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 3), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 4).map((entry) => entry.columnName).sort(), ["max1", "min1"]);
});

test("func5/6/7 cover every implicit lane without applying the narrowest unknown lane as a hard error", () => {
  const diagnostics = validStatDiagnostics({
    properties: [
      "implicit-five\t5\t",
      "implicit-six\t6\t",
      "implicit-seven\t7\t"
    ],
    itemStats: [
      "mindamage\t1\t10\t0\t0\t0\t6",
      "secondary_mindamage\t1\t20\t0\t0\t0\t6",
      "item_throw_mindamage\t1\t30\t0\t0\t0\t6",
      "maxdamage\t1\t40\t0\t0\t0\t6",
      "secondary_maxdamage\t1\t50\t0\t0\t0\t6",
      "item_throw_maxdamage\t1\t60\t0\t0\t0\t6",
      "item_maxdamage_percent\t1\t70\t0\t0\t0\t6",
      "item_mindamage_percent\t1\t80\t0\t0\t0\t6"
    ],
    items: [
      "Primary Min Lane\timplicit-five\t\t-10\t-10",
      "Secondary Min Lane\timplicit-five\t\t-20\t-20",
      "Throw Min Lane\timplicit-five\t\t-30\t-30",
      "Primary Max Lane\timplicit-six\t\t-40\t-40",
      "Secondary Max Lane\timplicit-six\t\t-50\t-50",
      "Throw Max Lane\timplicit-six\t\t-60\t-60",
      "Max Percent Lane\timplicit-seven\t\t-70\t-70",
      "Min Percent Lane\timplicit-seven\t\t-80\t-80",
      "Outside Every Lane\timplicit-five\t\t0\t0"
    ]
  });

  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex <= 8), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 9).map((entry) => entry.columnName).sort(), ["max1", "min1"]);

  const incompleteReferenceDiagnostics = validStatDiagnostics({
    properties: ["implicit-five\t5\t"],
    itemStats: ["mindamage\t1\t0\t0\t0\t0\t6"],
    items: ["Unknown Base Lane\timplicit-five\t\t99\t99"]
  });
  assert.deepEqual(incompleteReferenceDiagnostics, []);
});

test("func15/16 inspect only their consumed column and unsigned stats still use the SaveAdd lower bound", () => {
  const diagnostics = validStatDiagnostics({
    properties: [
      "minimum-only\t15\tshifted",
      "maximum-only\t16\tshifted",
      "generic\t1\tshifted"
    ],
    itemStats: ["shifted\t8\t32\t0\t0\t0\t6"],
    items: [
      "Func 15\tminimum-only\t\t10\t999",
      "Func 16\tmaximum-only\t\t-999\t20",
      "Lower Limit\tgeneric\t\t-32\t-32",
      "Below Lower Limit\tgeneric\t\t-33\t-33"
    ]
  });

  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex <= 3), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 4).map((entry) => entry.columnName).sort(), ["max1", "min1"]);
  assert.ok(diagnostics.filter((entry) => entry.rowIndex === 4).every((entry) => entry.message.includes("minimum -32")));
});

test("func18 and func19 use dedicated packed semantics instead of generic min/max SaveBits", () => {
  const diagnostics = validStatDiagnostics({
    properties: [
      "by-time\t18\tbytime_stat",
      "charged\t19\titem_charged_skill"
    ],
    itemStats: [
      "bytime_stat\t1\t0\t0\t0\t0\t6",
      "item_charged_skill\t16\t0\t0\t3\t16\t6"
    ],
    items: [
      "Valid By Time\tby-time\t3\t-256\t767",
      "Invalid By Time\tby-time\t4\t-257\t768",
      "Valid Charged\tcharged\tsKiLl One\t255\t63",
      "Dynamic Charged\tcharged\tSkill One\t-1\t-1",
      "Invalid Charged\tcharged\t-1\t256\t64",
      "Unknown Charged\tcharged\tMissing Skill\t1\t1"
    ]
  });

  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 1), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 2).map((entry) => entry.columnName).sort(), ["max1", "min1", "par1"]);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 3), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 4), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 5).map((entry) => entry.columnName).sort(), ["max1", "min1", "par1"]);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 6).map((entry) => entry.columnName), ["par1"]);
});

test("func11, func22 aura, and func12 skill-rand keep distinct skill and value layouts", () => {
  const diagnostics = validStatDiagnostics({
    properties: [
      "event-skill\t11\tevent_stat",
      "aura\t22\titem_aura",
      "skill-rand\t12\titem_singleskill"
    ],
    itemStats: [
      "event_stat\t7\t0\t0\t2\t16\t6",
      "item_aura\t5\t0\t0\t0\t1\t6",
      "item_singleskill\t3\t0\t0\t1\t2\t6"
    ],
    items: [
      "Valid Event\tevent-skill\tsKiLl One\t5\t63",
      "Invalid Event\tevent-skill\t-1\t5\t64",
      "Valid Aura\taura\tSkill One\t1\t1",
      "Aura SaveParam Overflow\taura\tSkill Two\t1\t1",
      "Valid Random Skill\tskill-rand\t7\t0\t3",
      "Random Value Overflow\tskill-rand\t8\t0\t3",
      "Random Skill Bounds\tskill-rand\t7\t-1\t4"
    ]
  });

  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 1), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 2).map((entry) => entry.columnName).sort(), ["max1", "par1"]);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 3), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 4).map((entry) => entry.columnName), ["par1"]);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 5), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 6).map((entry) => entry.columnName), ["par1"]);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 7).map((entry) => entry.columnName).sort(), ["max1", "min1"]);
});

test("numeric prefix and fallback spellings are policy warnings while parsed values still receive range checks", () => {
  const diagnostics = validStatDiagnostics({
    properties: ["generic\t1\tshifted"],
    itemStats: ["shifted\t8\t32\t0\t0\t0\t6"],
    items: [
      "Canonical\tgeneric\t\t-32\t223",
      "Prefix And Plus\tgeneric\t\t12junk\t+12",
      "Space And Name\tgeneric\t\t 12\tabc",
      "Overflow\tgeneric\t\t0\t999999999999"
    ]
  });

  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 1), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 2).map((entry) => entry.columnName).sort(), ["max1", "min1"]);
  assert.ok(diagnostics.filter((entry) => entry.rowIndex === 2).every((entry) => entry.severity === "warning"));
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 3).map((entry) => entry.columnName).sort(), ["max1", "min1"]);
  assert.ok(diagnostics.filter((entry) => entry.rowIndex === 3).every((entry) => entry.severity === "warning"));
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 4).map((entry) => entry.columnName), ["max1"]);
  assert.equal(diagnostics.find((entry) => entry.rowIndex === 4).severity, "error");
});
