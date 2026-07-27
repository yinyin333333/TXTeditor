import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkspaceIndex, createDefaultLintSettings, runLint, runLintWithWorkspaceIndex } from "../src/core/lint-engine.js";
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
      "Exact Zero Has No Writer\timplicit-five\t\t0\t0"
    ]
  });

  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex <= 8), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 9), []);

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

test("type-2 numeric fields use whole-cell accumulation instead of callback prefixes", () => {
  const diagnostics = validStatDiagnostics({
    properties: ["generic\t1\tshifted"],
    itemStats: ["shifted\t8\t32\t0\t0\t0\t6"],
    items: [
      "Canonical\tgeneric\t\t-32\t223",
      "Suffix\tgeneric\t\t12junk\t0",
      "Letters\tgeneric\t\tabc\t0",
      "Plus\tgeneric\t\t+12\t0",
      "Overflow\tgeneric\t\t999999999999\t0"
    ]
  });

  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 1), []);
  for (const [rowIndex, effective] of [[2, 185579], [3, 5451], [4, -488], [5, -727379969]]) {
    const rangeDiagnostic = diagnostics.find((entry) => entry.rowIndex === rowIndex && entry.severity === "error");
    assert.ok(rangeDiagnostic, `missing range error for row ${rowIndex}`);
    assert.ok(rangeDiagnostic.message.includes(String(effective)), rangeDiagnostic.message);
  }
});

test("func11 uses min <= 0 as five and always packs six level bits", () => {
  const minimums = validStatDiagnostics({
    properties: ["event\t11\tevent_stat"],
    itemStats: ["event_stat\t3\t-5\t0\t2\t16\t5"],
    items: [
      "Negative Default\tevent\tAttack\t-1\t1",
      "Zero Default\tevent\tAttack\t0\t1",
      "One Is Not Default\tevent\tAttack\t1\t1"
    ]
  });
  assert.deepEqual(minimums.filter((entry) => entry.rowIndex <= 2), []);
  assert.deepEqual(minimums.filter((entry) => entry.rowIndex === 3).map((entry) => entry.columnName), ["min1"]);

  const fixedWidth = validStatDiagnostics({
    properties: ["event\t11\tevent_stat"],
    itemStats: ["padding\t1\t0\t0\t0\t0\t0", "event_stat\t8\t0\t0\t2\t16\t5"],
    items: ["Stuff Five Level 63\tevent\tAttack\t5\t63"]
  });
  assert.deepEqual(fixedWidth, []);

  const wrapsAtSixBits = validStatDiagnostics({
    properties: ["event\t11\tevent_stat"],
    itemStats: ["padding\t1\t0\t0\t0\t0\t0", "event_stat\t8\t0\t0\t2\t16\t7"],
    items: ["Stuff Seven Level 64\tevent\tAttack\t5\t64"]
  });
  assert.deepEqual(wrapsAtSixBits.map((entry) => entry.columnName), ["max1"]);
});

test("packed func11 and func19 validate the complete SaveParamBits capacity", () => {
  const diagnostics = validStatDiagnostics({
    properties: ["event\t11\tevent_stat", "charged\t19\titem_charged_skill"],
    itemStats: [
      "event_stat\t8\t0\t0\t2\t5\t6",
      "item_charged_skill\t16\t0\t0\t3\t5\t6"
    ],
    items: [
      "Event Small SaveParam\tevent\tAttack\t5\t32",
      "Charged Small SaveParam\tcharged\tAttack\t1\t32"
    ]
  });
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 1).map((entry) => entry.columnName), ["max1"]);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 2).map((entry) => entry.columnName), ["max1"]);
});

test("Properties dispatcher stops at null handler slots", () => {
  const base = [
    document("itemstatcost.txt", "stat\tsave bits\tsave add\nbounded\t1\t0"),
    document("skills.txt", "skill\nAttack"),
    document("uniqueitems.txt", "index\tprop1\tpar1\tmin1\tmax1\nStop\tstops\t\t99\t99")
  ];
  for (const func of ["0", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35"]) {
    const docs = [document("properties.txt", `code\tfunc1\tstat1\tfunc2\tstat2\nstops\t${func}\t\t1\tbounded`), ...base];
    assert.deepEqual(runLint(docs, createDefaultLintSettings()).filter((entry) => entry.ruleId === "Items/ValidStatParameters"), []);
  }
});

test("saved-stat intervals ignore exact zero but still reject invalid nonzero possibilities", () => {
  const diagnostics = validStatDiagnostics({
    properties: ["generic\t1\tbounded"],
    itemStats: ["bounded\t3\t-5\t0\t0\t0\t6"],
    items: ["Only Zero\tgeneric\t\t0\t0", "Zero Through Five\tgeneric\t\t0\t5"]
  });
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 1), []);
  assert.deepEqual(diagnostics.filter((entry) => entry.rowIndex === 2).map((entry) => entry.columnName), ["min1"]);
});

test("CubeMain's fifteen property tuples use signed sixteen-bit values", () => {
  const prefixes = ["", "b ", "c "];
  const columns = [];
  const values = [];
  for (const prefix of prefixes) {
    for (let slot = 1; slot <= 5; slot += 1) {
      const base = `${prefix}mod ${slot}`;
      columns.push(base, `${base} param`, `${base} min`, `${base} max`);
      values.push("bounded", "", "65535", "65535");
    }
  }
  const docs = [
    document("properties.txt", "code\tfunc1\tstat1\nbounded\t1\tstat"),
    document("itemstatcost.txt", "stat\tsave bits\tsave add\nstat\t1\t1"),
    document("skills.txt", "skill\nAttack"),
    document("cubemain.txt", `${columns.join("\t")}\n${values.join("\t")}`)
  ];
  assert.deepEqual(runLint(docs, createDefaultLintSettings()).filter((entry) => entry.ruleId === "Items/ValidStatParameters"), []);
});

test("1.13c CubeMain uses an unsigned word parameter and signed word values", () => {
  const docs = [
    document("properties.txt", "code\tfunc1\tstat1\nskill\t22\titem_singleskill\nbounded\t1\tbounded"),
    document("itemstatcost.txt", "stat\tsave bits\tsave add\tsave param bits\nstuff\t8\t0\t8\nitem_singleskill\t8\t0\t8\nbounded\t1\t0\t0"),
    document("skills.txt", "skill\nAttack"),
    document("cubemain.txt", "mod 1\tmod 1 param\tmod 1 min\tmod 1 max\nskill\t65535\t0\t0\nbounded\t0\t65535\t65536\nskill\t-1\t0\t0")
  ];
  const index = buildWorkspaceIndex(docs, "1.13c", { referenceVersion: "1.13c" });
  const diagnostics = runLintWithWorkspaceIndex(index, { ...createDefaultLintSettings(), profile: "1.13c" })
    .filter((entry) => entry.ruleId === "Items/ValidStatParameters");
  assert.deepEqual(diagnostics.map((entry) => [entry.rowIndex, entry.columnName]).sort(), [[1, "mod 1 param"], [2, "mod 1 min"], [3, "mod 1 param"]]);
});

test("QualityItems and MonProp parameters use numeric fields rather than skill names", () => {
  const references = [
    document("properties.txt", "code\tfunc1\tstat1\nskill\t22\tstat"),
    document("itemstatcost.txt", "stat\tsave bits\tsave param bits\nstat\t8\t2"),
    document("skills.txt", "skill\nAttack")
  ];
  const quality = document("qualityitems.txt", "mod1code\tmod1param\tmod1min\tmod1max\nskill\tAttack\t0\t0");
  const monprop = document("monprop.txt", "prop1\tpar1\tmin1\tmax1\nskill\tAttack\t0\t0");
  const diagnostics = runLint([...references, quality, monprop], createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Items/ValidStatParameters" && (entry.columnName === "mod1param" || entry.columnName === "par1"));
  assert.deepEqual(diagnostics.map((entry) => entry.columnName).sort(), ["mod1param", "par1"]);
});

test("func12 min and max are numeric skill ids, never callback skill names", () => {
  const diagnostics = validStatDiagnostics({
    properties: ["random\t12\titem_singleskill"],
    itemStats: ["item_singleskill\t8\t0\t0\t1\t8\t6"],
    items: ["Names Are Numeric\trandom\t0\tAttack\tAttack"]
  });
  const errors = diagnostics.filter((entry) => entry.severity === "error");
  assert.deepEqual(errors.map((entry) => entry.columnName).sort(), ["max1", "min1"]);
  assert.ok(errors.every((entry) => entry.message.includes("skill id")));
});

test("PropertyGroups expand only for RotW reference versions 3.1 and 3.2", () => {
  const docs = [
    document("properties.txt", "code\tfunc1\tstat1\nbounded\t1\tstat"),
    document("propertygroups.txt", "code\tpickmode\tprop1\tparmin1\tparmax1\tmodmin1\tmodmax1\tchance1\ngroup\t1\tbounded\t\t\t99\t99\t1"),
    document("itemstatcost.txt", "stat\tsave bits\tsave add\nstat\t1\t0"),
    document("skills.txt", "skill\nAttack"),
    document("uniqueitems.txt", "index\tprop1\tpar1\tmin1\tmax1\nrow\tgroup\t\t\t")
  ];
  for (const version of ["3.1", "3.2"]) {
    const index = buildWorkspaceIndex(docs, "RotW", { referenceVersion: version });
    assert.ok(runLintWithWorkspaceIndex(index, createDefaultLintSettings()).some((entry) => entry.ruleId === "Items/ValidStatParameters"));
  }
  for (const version of ["2.4", "1.13c"]) {
    const index = buildWorkspaceIndex(docs, "RotW", { referenceVersion: version });
    assert.deepEqual(runLintWithWorkspaceIndex(index, createDefaultLintSettings()).filter((entry) => entry.ruleId === "Items/ValidStatParameters"), []);
  }
});

test("PropertyGroups keep populated members possible for zero selection counts and nonpositive Chances", () => {
  const makeDocs = (pickMode, chance1, chance2, min = 0, max = 0) => [
    document("properties.txt", "code\tfunc1\tstat1\nskilltab\t22\tstat"),
    document("propertygroups.txt", "code\tpickmode\tprop1\tparmin1\tparmax1\tmodmin1\tmodmax1\tchance1\tprop2\tparmin2\tparmax2\tmodmin2\tmodmax2\tchance2\nskilltab-war\t" + pickMode + "\tskilltab\t21\t99\t1\t1\t" + chance1 + "\tskilltab\t0\t0\t1\t1\t" + chance2),
    document("itemstatcost.txt", "stat\tsave bits\tsave param bits\nstat\t8\t2"),
    document("skills.txt", "skill\nAttack"),
    document("uniqueitems.txt", "index\tprop1\tmin1\tmax1\nWraithstep\tskilltab-war\t" + min + "\t" + max)
  ];
  const diagnosticsFor = (pickMode, chance1, chance2, min, max) => runLintWithWorkspaceIndex(buildWorkspaceIndex(makeDocs(pickMode, chance1, chance2, min, max), "RotW", { referenceVersion: "3.1" }), createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Items/ValidStatParameters");

  for (const pickMode of [0, 1, 2]) {
    for (const chance of ["", "0", "-1", "1"]) {
      const diagnostics = diagnosticsFor(pickMode, chance, 1, 0, 0);
      assert.ok(diagnostics.some((entry) => entry.messageArgs.memberCode === "skilltab" && entry.messageArgs.groupField === "parmax1"), `PickMode=${pickMode}, Chance1=${JSON.stringify(chance)}, min/max=0/0`);
    }
  }
});

test("PropertyGroups carry both parameter endpoints and both mod endpoints to member analysis", () => {
  const docs = [
    document("properties.txt", "code\tfunc1\tstat1\nmember\t22\tstat"),
    document("propertygroups.txt", "code\tpickmode\tprop1\tparmin1\tparmax1\tmodmin1\tmodmax1\tchance1\ngroup\t0\tmember\t0\t99\t0\t99\t1"),
    document("itemstatcost.txt", "stat\tsave bits\tsave param bits\nstat\t1\t2"),
    document("skills.txt", "skill\nAttack"),
    document("uniqueitems.txt", "index\tprop1\tmin1\tmax1\nrow\tgroup\t1\t1")
  ];
  const diagnostics = runLintWithWorkspaceIndex(buildWorkspaceIndex(docs, "RotW", { referenceVersion: "3.1" }), createDefaultLintSettings()).filter((entry) => entry.ruleId === "Items/ValidStatParameters");
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics.map((entry) => [entry.columnName, entry.columnIndex, entry.offendingValue, entry.messageArgs.memberCode, entry.messageArgs.groupField, entry.messageArgs.groupValue]).sort((left, right) => left[4].localeCompare(right[4])), [
    ["prop1", 1, "group", "member", "modmax1", "99"],
    ["prop1", 1, "group", "member", "parmax1", "99"]
  ]);
  assert.ok(diagnostics.every((entry) => /member.*member/i.test(entry.message)));
  assert.ok(diagnostics.every((entry) => !/UniqueItems.*index/i.test(entry.message)));

  const groupCase = (property, itemStats, parMin, parMax, modMin, modMax) => runLintWithWorkspaceIndex(buildWorkspaceIndex([
    document("properties.txt", `code\tfunc1\tstat1\nmember\t${property.func}\tstat`),
    document("propertygroups.txt", `code\tpickmode\tprop1\tparmin1\tparmax1\tmodmin1\tmodmax1\tchance1\ngroup\t0\tmember\t${parMin}\t${parMax}\t${modMin}\t${modMax}\t1`),
    document("itemstatcost.txt", itemStats),
    document("skills.txt", "skill\nAttack"),
    document("uniqueitems.txt", "index\tprop1\tmin1\tmax1\nrow\tgroup\t1\t1")
  ], "RotW", { referenceVersion: "3.1" }), createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Items/ValidStatParameters");
  assert.equal(groupCase({ func: 1 }, "stat\tsave bits\tsave add\nstat\t1\t0", "", "", "99", "0")[0].messageArgs.groupField, "modmin1");
  assert.equal(groupCase({ func: 1 }, "stat\tsave bits\tsave add\nstat\t1\t0", "", "", "0", "99")[0].messageArgs.groupField, "modmax1");
  assert.equal(groupCase({ func: 22 }, "stat\tsave bits\tsave param bits\nstat\t8\t2", "99", "0", "0", "0")[0].messageArgs.groupField, "parmin1");
  assert.equal(groupCase({ func: 22 }, "stat\tsave bits\tsave param bits\nstat\t8\t2", "0", "99", "0", "0")[0].messageArgs.groupField, "parmax1");
});

test("PropertyGroups retain nested recursion bounds and suppress cycles", () => {
  const nested = [
    document("properties.txt", "code\tfunc1\tstat1\ninvalid\t1\tstat"),
    document("propertygroups.txt", "code\tpickmode\tprop1\tmodmin1\tmodmax1\tchance1\nouter\t0\tmiddle\t1\t1\t1\nmiddle\t0\touter\t1\t1\t1"),
    document("itemstatcost.txt", "stat\tsave bits\tsave add\nstat\t1\t0"),
    document("skills.txt", "skill\nAttack"),
    document("uniqueitems.txt", "index\tprop1\tmin1\tmax1\nrow\touter\t1\t1")
  ];
  assert.deepEqual(runLint(nested, createDefaultLintSettings()).filter((entry) => entry.ruleId === "Items/ValidStatParameters"), []);

  const deepGroups = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"];
  const groupRows = deepGroups.map((code, index) => `${code}\t0\t${deepGroups[index + 1] ?? "invalid"}\t1\t1\t1`).join("\n");
  const bounded = [
    document("properties.txt", "code\tfunc1\tstat1\ninvalid\t1\tstat"),
    document("propertygroups.txt", "code\tpickmode\tprop1\tmodmin1\tmodmax1\tchance1\n" + groupRows),
    document("itemstatcost.txt", "stat\tsave bits\tsave add\nstat\t1\t0"),
    document("skills.txt", "skill\nAttack"),
    document("uniqueitems.txt", "index\tprop1\tmin1\tmax1\nrow\tg1\t1\t1")
  ];
  assert.deepEqual(runLint(bounded, createDefaultLintSettings()).filter((entry) => entry.ruleId === "Items/ValidStatParameters"), []);
});

test("PropertyGroups memoize repeated states while retaining reachable member diagnostics", () => {
  const repeatedMembers = Array.from({ length: 8 }, (_, index) => `middle\t\t\t1\t1\t1`).join("\t");
  const docs = [
    document("properties.txt", "code\tfunc1\tstat1\ninvalid\t1\tstat"),
    document("propertygroups.txt", "code\tpickmode\tprop1\tparmin1\tparmax1\tmodmin1\tmodmax1\tchance1\tprop2\tparmin2\tparmax2\tmodmin2\tmodmax2\tchance2\tprop3\tparmin3\tparmax3\tmodmin3\tmodmax3\tchance3\tprop4\tparmin4\tparmax4\tmodmin4\tmodmax4\tchance4\tprop5\tparmin5\tparmax5\tmodmin5\tmodmax5\tchance5\tprop6\tparmin6\tparmax6\tmodmin6\tmodmax6\tchance6\tprop7\tparmin7\tparmax7\tmodmin7\tmodmax7\tchance7\tprop8\tparmin8\tparmax8\tmodmin8\tmodmax8\tchance8\nouter\t0\t" + repeatedMembers + "\nmiddle\t0\tinvalid\t\t\t99\t99\t1"),
    document("itemstatcost.txt", "stat\tsave bits\tsave add\nstat\t1\t0"),
    document("skills.txt", "skill\nAttack"),
    document("uniqueitems.txt", "index\tprop1\tmin1\tmax1\nrow\touter\t1\t1")
  ];
  const diagnostics = runLintWithWorkspaceIndex(buildWorkspaceIndex(docs, "RotW", { referenceVersion: "3.2" }), createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Items/ValidStatParameters");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].messageArgs.memberCode, "invalid");
});

test("numeric-only noncanonical guidance excludes skill-name fallback while callback fields retain it", () => {
  const numericDocs = [
    document("properties.txt", "code\tfunc1\tstat1\nrandom\t12\tstat"),
    document("itemstatcost.txt", "stat\tsave bits\nstat\t2"),
    document("skills.txt", "skill\nAttack"),
    document("qualityitems.txt", "mod1code\tmod1param\tmod1min\tmod1max\nrandom\tAttack\tAttack\tAttack"),
    document("uniqueitems.txt", "index\tprop1\tpar1\tmin1\tmax1\nrow\trandom\t\tAttack\tAttack")
  ];
  const numericDiagnostics = runLint(numericDocs, createDefaultLintSettings()).filter((entry) => entry.ruleId === "Items/ValidStatParameters" && entry.severity === "warning");
  assert.ok(numericDiagnostics.length > 0);
  assert.ok(numericDiagnostics.every((entry) => !/valid skill name|valid skill name accepted|스킬 이름/i.test(`${entry.message} ${entry.d2rMessage}`)));

  const callbackDocs = [
    document("properties.txt", "code\tfunc1\tstat1\ncallback\t22\tstat"),
    document("itemstatcost.txt", "stat\tsave bits\nstat\t8"),
    document("skills.txt", "skill\nAttack"),
    document("uniqueitems.txt", "index\tprop1\tpar1\tmin1\tmax1\nrow\tcallback\t Attack \t1\t1")
  ];
  const callbackDiagnostics = runLint(callbackDocs, createDefaultLintSettings()).filter((entry) => entry.ruleId === "Items/ValidStatParameters");
  assert.ok(callbackDiagnostics.some((entry) => /valid skill name/i.test(`${entry.message} ${entry.d2rMessage}`)));
});
