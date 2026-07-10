import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  legacyLintDocumentVersion,
  markLegacyLintDocumentChanged
} from "../src/core/lint-document-state.js";
import {
  LINT_ENGINE_LEGACY,
  documentOpenSyncRoute,
  legacyLintImmediateSchedule,
  legacyLintOpenSchedule
} from "../src/core/lint-controller-policy.js";
import { TableDocument } from "../src/core/table-model.js";
import {
  cubeInputCount,
  inputColumns,
  parseCubeItem
} from "../src/core/lint-cube.js";
import { CUBE_LINT_RULES } from "../src/core/lint-cube-rules.js";
import { duplicateRowPairs } from "../src/core/lint-duplicates.js";
import { ITEM_LINT_RULES } from "../src/core/lint-item-rules.js";
import { LEVEL_LINT_RULES } from "../src/core/lint-level-rules.js";
import {
  MONSTER_LINT_RULES,
  SKILL_LINT_RULES,
  STRING_LINT_RULES
} from "../src/core/lint-misc-rules.js";
import {
  UI_PERF_EVENT_NAMES,
  recordUiPerfSample
} from "../src/core/perf-instrumentation.js";
import { CanvasGrid } from "../src/ui/canvas-grid.js";
import { commandLabelsForEnvironment } from "../src/ui/command-registry.js";
import { finishDiagnosticNavigation } from "../src/ui/diagnostic-navigation.js";
import { diagnosticMarkerState } from "../src/ui/grid-render-policy.js";
import {
  activeDiagnosticIdsForCell,
  activeDocumentDiagnostics,
  activeDocumentDiagnosticsByCell,
  activeProblemItemState,
  diagnosticCounts,
  groupDiagnosticsByFile,
  lintEnginePanelActive,
  lintNotificationCount,
  lintNotificationsVisible,
  lintPanelActive,
  problemBadgeCountForFile,
  problemBadgeHtml,
  problemsPanelHtml,
  problemsPanelRenderEffect,
  problemsSelectionChangeEffect,
  lintSummaryText as problemsLintSummaryText,
  shouldRenderProblemsPanel
} from "../src/ui/problems-policy.js";
import {
  compareDiagnostics,
  createRuleContext,
  diagnosticsForDocument as diagnosticsForDocumentDirect,
  groupDiagnosticsByCell as groupDiagnosticsByCellDirect
} from "../src/core/lint-diagnostics.js";
import {
  baseName as lintBaseName,
  documentKey as lintDocumentKey,
  normalizePath as lintNormalizePath
} from "../src/core/lint-paths.js";
import {
  clean as lintCleanDirect,
  normalizeHeader as lintNormalizeHeaderDirect,
  normalizeToken as lintNormalizeTokenDirect,
  rowLabelFor as rowLabelForDirect,
  rowLabelsForTable as rowLabelsForTableDirect,
  setFromColumn as setFromColumnDirect,
  tableFromDocument as tableFromDocumentDirect,
  unionSets as unionSetsDirect,
  uniqueDocuments as uniqueDocumentsDirect
} from "../src/core/lint-table.js";
import {
  buildWorkspaceFileStates as buildWorkspaceFileStatesDirect,
  buildWorkspaceIndex as buildWorkspaceIndexDirect
} from "../src/core/lint-workspace-index.js";
import {
  DEFAULT_PROFILE as LINT_DEFAULT_PROFILE_DIRECT,
  PROFILE_OPTIONS as LINT_PROFILE_OPTIONS_DIRECT,
  createDefaultLintSettingsForRules,
  flattenRuleGroups,
  normalizeLintSettingsForRules,
  rule as lintRule,
  ruleGroupsForProfile,
  rulesForProfileFromRules
} from "../src/core/lint-rule-registry.js";
import {
  finalizeDiagnostics,
  labelRuleDiagnostics,
  runLintRulesWithWorkspaceIndex
} from "../src/core/lint-runner.js";
import {
  basicLintRules,
  lintLinkedExcel
} from "../src/core/lint-basic-rules.js";
import { TREASURE_LINT_RULES } from "../src/core/lint-treasure-rules.js";
import {
  BOOLEAN_FIELDS,
  DUPLICATE_KEYS,
  NUMERIC_BOUNDS,
  PROFILE_ACCEPTED_COLUMNS,
  PROFILE_NON_STANDARD_COLUMNS,
  PROFILE_NUMERIC_BOUNDS,
  REQUIRED_COLUMNS,
  VERSION_CHECKS
} from "../src/core/lint-rule-data.js";
import {
  acceptedColumnsForProfile,
  nonStandardColumnsForProfile,
  numericBoundsForProfile
} from "../src/core/lint-profile-data.js";
import {
  CUBE_OUTPUT_MOD_COLUMNS,
  STAT_PARAMETER_TUPLES,
  buildStatTuples,
  numberedFields
} from "../src/core/lint-stat-data.js";
import {
  LINT_RULES,
  LINT_DEFAULT_PROFILE,
  LINT_PROFILE_OPTIONS,
  buildWorkspaceFileStates,
  buildWorkspaceIndex,
  createDefaultLintSettings,
  diagnosticsForDocument,
  groupDiagnosticsByCell,
  lintClean,
  lintNormalizeHeader,
  lintNormalizeToken,
  lintRuleGroupsForProfile,
  normalizeLintSettings,
  runLint
} from "../src/core/lint-engine.js";
import {
  formatD2rlintCompatibleExport,
  formatTxteditorLintExport
} from "../src/core/lint-export.js";

function lintDocs(docs, profile = "RotW") {
  const settings = createDefaultLintSettings();
  settings.profile = profile;
  return runLint(docs, settings);
}

function ruleIdsForProfile(profile) {
  return lintRuleGroupsForProfile(profile).flatMap((group) => group.rules.map((rule) => rule.id));
}

test("lint rule list excludes JSON rules and has no pending TXT rule placeholders", () => {
  assert.equal(LINT_RULES.some((rule) => rule.id.toLowerCase().startsWith("json/")), false);
  assert.equal(LINT_RULES.every((rule) => rule.implemented), true);
  assert.equal(LINT_RULES.every((rule) => typeof rule.runner === "function"), true);
  assert.equal(LINT_RULES.every((rule) => !/not implemented|pending/i.test(rule.note ?? "")), true);
});

test("profile-specific rule groups exactly match RotW and 2.4 TXT rule lists", () => {
  assert.deepEqual(ruleIdsForProfile("RotW"), [
    "Basic/NoDuplicateExcel",
    "Basic/ExcelColumns",
    "Basic/LinkedExcel",
    "Basic/StringCheck",
    "Basic/NumericBounds",
    "Basic/BooleanFields",
    "Cube/ValidInputs",
    "Cube/ValidOutputs",
    "Cube/ValidOp",
    "Items/ValidSockets",
    "Items/NoIllegalGambling",
    "Items/ValidStatParameters",
    "Level/ValidWarp",
    "Level/ValidWPs",
    "Monsters/ValidChains",
    "Skills/EqualSkills",
    "String/NoUntranslated",
    "TC/ValidTreasure",
    "TC/ValidNegativePicks",
    "TC/ValidProbs"
  ]);
  assert.deepEqual(ruleIdsForProfile("2.4"), [
    "Basic/NoDuplicateExcel",
    "Basic/ExcelColumns",
    "Basic/LinkedExcel",
    "Basic/MissileRangeFieldSemantics",
    "Basic/MonstatsDesecratedTreasureClassSemantics",
    "Basic/MonEquipLevelOrder",
    "Basic/StringCheck",
    "Basic/NumericBounds",
    "Basic/BooleanFields",
    "Cube/ValidInputs",
    "Cube/ValidOutputs",
    "Cube/ValidOp",
    "Items/ValidSockets",
    "Items/NoIllegalGambling",
    "Items/ValidStatParameters",
    "Level/ValidWarp",
    "Level/ValidWPs",
    "Monsters/ValidChains",
    "Skills/EqualSkills",
    "String/NoUntranslated",
    "TC/ValidTreasure",
    "TC/ValidNegativePicks",
    "TC/ValidProbs"
  ]);
});

test("profile-specific rule groups hide 2.4-only rules from RotW", () => {
  const rotwIds = lintRuleGroupsForProfile("RotW").flatMap((group) => group.rules.map((rule) => rule.id));
  const d2r24Ids = lintRuleGroupsForProfile("2.4").flatMap((group) => group.rules.map((rule) => rule.id));
  assert.equal(rotwIds.includes("Basic/MissileRangeFieldSemantics"), false);
  assert.equal(rotwIds.includes("Basic/MonstatsDesecratedTreasureClassSemantics"), false);
  assert.equal(rotwIds.includes("Basic/MonEquipLevelOrder"), false);
  assert.equal(d2r24Ids.includes("Basic/MissileRangeFieldSemantics"), true);
  assert.equal(d2r24Ids.includes("Basic/MonstatsDesecratedTreasureClassSemantics"), true);
  assert.equal(d2r24Ids.includes("Basic/MonEquipLevelOrder"), true);
});

test("lint rule registry helpers preserve profile settings semantics behind the engine facade", () => {
  const runA = () => {};
  const groups = [
    { group: "A", rules: [lintRule("A/One", "One", runA), lintRule("A/Two", "Two", null)] },
    { group: "B", rules: [lintRule("B/RotW", "RotW only", runA, true, ["RotW"]), lintRule("B/TwoFour", "2.4 only", runA, true, ["2.4"])] }
  ];
  const rules = flattenRuleGroups(groups);
  assert.deepEqual(LINT_PROFILE_OPTIONS_DIRECT, ["RotW", "2.4"]);
  assert.equal(LINT_DEFAULT_PROFILE_DIRECT, "RotW");
  assert.deepEqual(LINT_PROFILE_OPTIONS, LINT_PROFILE_OPTIONS_DIRECT);
  assert.equal(LINT_DEFAULT_PROFILE, LINT_DEFAULT_PROFILE_DIRECT);
  assert.deepEqual(rules.map((entry) => `${entry.group}:${entry.id}:${entry.implemented}`), [
    "A:A/One:true",
    "A:A/Two:false",
    "B:B/RotW:true",
    "B:B/TwoFour:true"
  ]);
  assert.deepEqual(rulesForProfileFromRules(rules, "missing").map((entry) => entry.id), ["A/One", "A/Two", "B/RotW"]);
  assert.deepEqual(ruleGroupsForProfile(groups, rules, "2.4").map((group) => [group.group, group.rules.map((entry) => entry.id)]), [
    ["A", ["A/One", "A/Two"]],
    ["B", ["B/TwoFour"]]
  ]);
  const defaults = createDefaultLintSettingsForRules(rules);
  assert.equal(defaults.profile, "RotW");
  assert.equal(defaults.profiles.RotW.rules["A/One"].enabled, true);
  assert.equal(defaults.profiles.RotW.rules["A/Two"].enabled, false);
  assert.equal(defaults.profiles.RotW.rules["B/TwoFour"], undefined);
  const normalized = normalizeLintSettingsForRules(rules, {
    profile: "2.4",
    rules: {
      "A/One": { enabled: false, severity: "error" },
      "A/Two": { enabled: true, severity: "invalid" }
    }
  });
  assert.equal(normalized.profile, "2.4");
  assert.deepEqual(normalized.profiles["2.4"].rules["A/One"], { enabled: false, severity: "error" });
  assert.deepEqual(normalized.profiles["2.4"].rules["A/Two"], { enabled: false, severity: "warning" });
});

test("basic lint rule module owns Basic rule metadata without changing IDs", () => {
  const linkedExcel = () => {};
  const rules = basicLintRules({ lintLinkedExcel: linkedExcel });
  const defaultRules = basicLintRules();
  assert.deepEqual(rules.map((entry) => entry.id), [
    "Basic/NoDuplicateExcel",
    "Basic/ExcelColumns",
    "Basic/LinkedExcel",
    "Basic/MissileRangeFieldSemantics",
    "Basic/MonstatsDesecratedTreasureClassSemantics",
    "Basic/MonEquipLevelOrder",
    "Basic/StringCheck",
    "Basic/NumericBounds",
    "Basic/BooleanFields"
  ]);
  assert.equal(rules.find((entry) => entry.id === "Basic/LinkedExcel").runner, linkedExcel);
  assert.equal(defaultRules.find((entry) => entry.id === "Basic/LinkedExcel").runner, lintLinkedExcel);
  assert.equal(LINT_RULES.find((entry) => entry.id === "Basic/LinkedExcel").runner, lintLinkedExcel);
  assert.deepEqual(rules.find((entry) => entry.id === "Basic/MissileRangeFieldSemantics").profiles, ["2.4"]);
  assert.equal(LINT_RULES.filter((entry) => entry.group === "Basic").length, rules.length);
});

test("treasure lint rule module owns TC rule metadata without changing IDs", () => {
  assert.deepEqual(TREASURE_LINT_RULES.map((entry) => entry.id), [
    "TC/ValidTreasure",
    "TC/ValidNegativePicks",
    "TC/ValidProbs"
  ]);
  assert.deepEqual(TREASURE_LINT_RULES.map((entry) => entry.label), [
    "Valid treasure references",
    "Valid negative picks",
    "Valid probabilities"
  ]);
  assert.equal(LINT_RULES.filter((entry) => entry.group === "TC").length, TREASURE_LINT_RULES.length);
});

test("cube lint rule module owns Cube rule metadata without changing IDs", () => {
  assert.deepEqual(CUBE_LINT_RULES.map((entry) => entry.id), [
    "Cube/ValidInputs",
    "Cube/ValidOutputs",
    "Cube/ValidOp"
  ]);
  assert.deepEqual(CUBE_LINT_RULES.map((entry) => entry.label), [
    "Valid cube inputs",
    "Valid cube outputs",
    "Valid cube op"
  ]);
  assert.equal(LINT_RULES.filter((entry) => entry.group === "Cube").length, CUBE_LINT_RULES.length);
});

test("item lint rule module owns Items rule metadata without changing IDs", () => {
  assert.deepEqual(ITEM_LINT_RULES.map((entry) => [entry.id, entry.label]), [
    ["Items/ValidSockets", "Valid sockets"],
    ["Items/NoIllegalGambling", "No illegal gambling"],
    ["Items/ValidStatParameters", "Valid stat parameters"]
  ]);
  assert.equal(LINT_RULES.filter((entry) => entry.group === "Items").length, ITEM_LINT_RULES.length);
});

test("level lint rule module owns Level rule metadata without changing IDs", () => {
  assert.deepEqual(LEVEL_LINT_RULES.map((entry) => entry.id), [
    "Level/ValidWarp",
    "Level/ValidWPs"
  ]);
  assert.deepEqual(LEVEL_LINT_RULES.map((entry) => entry.label), [
    "Valid warps",
    "Valid waypoints"
  ]);
  assert.equal(LINT_RULES.filter((entry) => entry.group === "Level").length, LEVEL_LINT_RULES.length);
});

test("misc lint rule module owns single-rule group metadata without changing IDs", () => {
  assert.deepEqual(MONSTER_LINT_RULES.map((entry) => [entry.id, entry.label]), [
    ["Monsters/ValidChains", "Valid monster chains"]
  ]);
  assert.deepEqual(SKILL_LINT_RULES.map((entry) => [entry.id, entry.label]), [
    ["Skills/EqualSkills", "Equal skills"]
  ]);
  assert.deepEqual(STRING_LINT_RULES.map((entry) => [entry.id, entry.label]), [
    ["String/NoUntranslated", "No untranslated strings"]
  ]);
  assert.equal(LINT_RULES.filter((entry) => entry.group === "Monsters").length, MONSTER_LINT_RULES.length);
  assert.equal(LINT_RULES.filter((entry) => entry.group === "Skills").length, SKILL_LINT_RULES.length);
  assert.equal(LINT_RULES.filter((entry) => entry.group === "String").length, STRING_LINT_RULES.length);
});

test("lint runner applies enabled rules, metadata, sorting, and canonical IDs", () => {
  const table = {
    displayName: "b.txt",
    fileKey: "b.txt",
    path: "Data/b.txt",
    rows: [["code"], ["bad"]],
    columnIndex: () => 0,
    headerAt: () => "code"
  };
  const rules = [
    {
      id: "A/Disabled",
      label: "Disabled",
      group: "A",
      implemented: true,
      runner: (_index, ctx) => ctx.add(table, 1, "code", "disabled")
    },
    {
      id: "B/Enabled",
      label: "Enabled",
      group: "B",
      implemented: true,
      runner: (_index, ctx) => ctx.add(table, 1, "code", "enabled")
    }
  ];
  const diagnostics = runLintRulesWithWorkspaceIndex(
    { profile: "RotW" },
    {
      enabled: true,
      profile: "RotW",
      profiles: {
        RotW: {
          rules: {
            "A/Disabled": { enabled: false, severity: "warning" },
            "B/Enabled": { enabled: true, severity: "error" }
          }
        }
      }
    },
    {
      rulesForProfile: () => rules,
      rowLabelFor: () => "Bad Row"
    }
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual({
    id: diagnostics[0].id,
    ruleId: diagnostics[0].ruleId,
    ruleLabel: diagnostics[0].ruleLabel,
    group: diagnostics[0].group,
    severity: diagnostics[0].severity,
    locationLabel: diagnostics[0].locationLabel,
    offendingValue: diagnostics[0].offendingValue
  }, {
    id: "RotW:B/Enabled:b.txt:1:0:enabled",
    ruleId: "B/Enabled",
    ruleLabel: "Enabled",
    group: "B",
    severity: "error",
    locationLabel: "Bad Row > code",
    offendingValue: "bad"
  });
  assert.deepEqual(runLintRulesWithWorkspaceIndex({ profile: "RotW" }, { enabled: false }, { rulesForProfile: () => rules, rowLabelFor: () => "" }), []);

  const looseDiagnostics = [
    { profile: "RotW", ruleId: "B", fileName: "z.txt", rowIndex: 2, columnIndex: 0, message: "z" },
    { profile: "RotW", ruleId: "A", fileName: "a.txt", rowIndex: 1, columnIndex: 0, message: "a" }
  ];
  labelRuleDiagnostics(looseDiagnostics, 1, { label: "Labeled", group: "Group" });
  finalizeDiagnostics(looseDiagnostics);
  assert.deepEqual(looseDiagnostics.map((item) => item.id), [
    "RotW:A:a.txt:1:0:a",
    "RotW:B:z.txt:2:0:z"
  ]);
  assert.equal(looseDiagnostics[0].ruleLabel, "Labeled");
  assert.equal(looseDiagnostics[0].group, "Group");
});

test("lint rule data module preserves static TXT lint rule tables", () => {
  assert.deepEqual(REQUIRED_COLUMNS["cubemain.txt"], ["description", "enabled", "numinputs", "input 1", "output", "op", "param", "value"]);
  assert.deepEqual(DUPLICATE_KEYS["armor.txt"], ["code"]);
  assert.deepEqual(PROFILE_ACCEPTED_COLUMNS.RotW["soundenviron.txt"], ["inheritenvironment", "inheritenvrionment"]);
  assert.deepEqual(PROFILE_NON_STANDARD_COLUMNS["2.4"]["levels.txt"], ["completiontotalroomsoverride"]);
  assert.ok(VERSION_CHECKS.some(([fileName, keyColumn, versionColumn]) =>
    fileName === "uniqueitems.txt" && keyColumn === "index" && versionColumn === "version"
  ));
  assert.deepEqual(BOOLEAN_FIELDS["misc.txt"], ["autobelt", "multibuy"]);
  assert.deepEqual(NUMERIC_BOUNDS["treasureclassex.txt"].prob10, [0, Number.POSITIVE_INFINITY]);
  assert.deepEqual(PROFILE_NUMERIC_BOUNDS.RotW["missiles.txt"].pcltdofunc, [0, 77]);
  assert.deepEqual([...acceptedColumnsForProfile("RotW", "soundenviron.txt")], ["inheritenvironment", "inheritenvrionment"]);
  assert.deepEqual([...nonStandardColumnsForProfile("2.4", "levels.txt")], ["completiontotalroomsoverride"]);
  assert.deepEqual(numericBoundsForProfile("RotW", "missiles.txt"), { pcltdofunc: [0, 77] });
  assert.deepEqual(numericBoundsForProfile("2.4", "missiles.txt"), { pcltdofunc: [0, 76] });
});

test("lint stat data module preserves generated stat tuple columns", () => {
  assert.deepEqual(numberedFields("prop", "", 3), ["prop1", "prop2", "prop3"]);
  assert.deepEqual(numberedFields("pcode", "a", 2, 2), ["pcode2a", "pcode3a"]);
  assert.deepEqual(buildStatTuples(["code1", "code2"], ["param1"], ["min1", "min2"], ["max1"]), [
    { property: "code1", param: "param1", min: "min1", max: "max1" },
    { property: "code2", param: "", min: "min2", max: "" }
  ]);
  assert.deepEqual(CUBE_OUTPUT_MOD_COLUMNS.slice(0, 6), ["mod 1", "mod 2", "mod 3", "mod 4", "mod 5", "b mod 1"]);
  assert.deepEqual(STAT_PARAMETER_TUPLES.get("uniqueitems.txt").at(-1), {
    property: "prop12",
    param: "par12",
    min: "min12",
    max: "max12"
  });
});

test("lint settings default to RotW with implemented rules enabled only", () => {
  const settings = normalizeLintSettings({});
  assert.equal(settings.profile, "RotW");
  assert.equal(settings.profiles.RotW.rules["Basic/LinkedExcel"].enabled, true);
  assert.equal(settings.profiles.RotW.rules["Cube/ValidInputs"].enabled, true);
  assert.equal(settings.profiles.RotW.rules["Items/ValidSockets"].enabled, true);
  assert.equal(settings.profiles.RotW.rules["Basic/MissileRangeFieldSemantics"], undefined);
  assert.equal(settings.profiles["2.4"].rules["Basic/MissileRangeFieldSemantics"].enabled, true);
});

test("lint catches duplicate excel identifiers and maps diagnostics to cells", () => {
  const doc = TableDocument.fromText("armor.txt", "code\tname\nabc\tOne\nabc\tTwo");
  const diagnostics = runLint([doc], createDefaultLintSettings());
  const duplicate = diagnostics.find((item) => item.ruleId === "Basic/NoDuplicateExcel");
  assert.equal(duplicate.fileName, "armor.txt");
  assert.equal(duplicate.rowIndex, 2);
  assert.equal(duplicate.columnIndex, 0);
  assert.equal(groupDiagnosticsByCell(diagnostics).has("2:0"), true);
  assert.equal(diagnosticsForDocument(diagnostics, doc).length > 0, true);
});

test("lint diagnostic and path helpers are split behind stable facade exports", () => {
  const doc = TableDocument.fromText("armor.txt", "code\tname\nabc\tOne\nabc\tTwo", { path: "Excel\\Armor.TXT" });
  const diagnostics = [
    { fileKey: "excel/armor.txt", rowIndex: 2, columnIndex: 0 },
    { fileKey: "excel/skills.txt", rowIndex: 1, columnIndex: 3 }
  ];
  assert.equal(lintNormalizePath("Excel\\Armor.TXT"), "excel/armor.txt");
  assert.equal(lintNormalizePath("\\\\?\\E:\\Data\\Armor.TXT"), "e:/data/armor.txt");
  assert.equal(lintNormalizePath("\\\\?\\UNC\\Server\\Share\\Armor.TXT"), "//server/share/armor.txt");
  assert.equal(lintBaseName("Excel\\Armor.TXT"), "Armor.TXT");
  assert.equal(lintDocumentKey(doc), "excel/armor.txt");
  assert.deepEqual([...groupDiagnosticsByCellDirect(diagnostics).keys()], ["2:0", "1:3"]);
  assert.deepEqual(diagnosticsForDocumentDirect(diagnostics, doc), [diagnostics[0]]);
  assert.deepEqual(groupDiagnosticsByCellDirect(diagnostics), groupDiagnosticsByCell(diagnostics));
  assert.deepEqual(diagnosticsForDocumentDirect(diagnostics, doc), diagnosticsForDocument(diagnostics, doc));
  const createdDiagnostics = [];
  const table = {
    displayName: "armor.txt",
    fileKey: "excel/armor.txt",
    path: "Excel/Armor.TXT",
    rows: [["code", "name"], ["abc", "One"]],
    columnIndex: (columnName) => columnName === "name" ? 1 : 0,
    headerAt: (column) => ["code", "name"][column] ?? `Column ${column + 1}`
  };
  createRuleContext({
    ruleId: "Basic/Test",
    severity: "warning",
    diagnostics: createdDiagnostics,
    profile: "RotW",
    rowLabelFor: () => "abc"
  }).add(table, 1, "name", "Example diagnostic");
  assert.deepEqual(createdDiagnostics[0], {
    id: "",
    ruleId: "Basic/Test",
    profile: "RotW",
    severity: "warning",
    message: "Example diagnostic",
    fileName: "armor.txt",
    fileKey: "excel/armor.txt",
    filePath: "Excel/Armor.TXT",
    rowIndex: 1,
    columnIndex: 1,
    columnName: "name",
    rowLabel: "abc",
    primaryLocationLabel: "abc > name",
    technicalLocationLabel: "R2:C2",
    locationLabel: "abc > name",
    offendingValue: "One"
  });
  const sorted = [
    { fileName: "b.txt", rowIndex: 1, columnIndex: 0, ruleId: "B" },
    { fileName: "a.txt", rowIndex: 3, columnIndex: 0, ruleId: "A" },
    { fileName: "a.txt", rowIndex: 1, columnIndex: 2, ruleId: "B" }
  ].sort(compareDiagnostics);
  assert.deepEqual(sorted.map((item) => `${item.fileName}:${item.rowIndex}:${item.columnIndex}:${item.ruleId}`), [
    "a.txt:1:2:B",
    "a.txt:3:0:A",
    "b.txt:1:0:B"
  ]);
});

test("lint table helpers are split from the engine while preserving table semantics", () => {
  const doc = TableDocument.fromText("armor.txt", "Code\tName\n abc \t\"One\"\nabc\tTwo", { path: "Excel\\Armor.TXT" });
  const duplicateDoc = TableDocument.fromText("other.txt", "id\n1", { path: "Excel\\Armor.TXT" });
  const skillDoc = TableDocument.fromText("skills.txt", "skill\nx");
  const table = tableFromDocumentDirect(doc);
  assert.equal(table.fileName, "armor.txt");
  assert.equal(table.fileKey, "excel/armor.txt");
  assert.equal(table.displayName, "Armor.TXT");
  assert.equal(table.hasColumn(" code "), true);
  assert.equal(table.columnIndex("NAME"), 1);
  assert.equal(table.headerAt(3), "Column 4");
  const rows = [];
  table.eachRow((row) => rows.push([row.rowIndex, row.get("code"), row.get("name")]));
  assert.deepEqual(rows, [[1, " abc ", "\"One\""], [2, "abc", "Two"]]);
  assert.equal(rowLabelForDirect(table, 0), "Header");
  assert.equal(rowLabelForDirect(table, 1), "abc");
  assert.deepEqual([...rowLabelsForTableDirect(table)], [[1, "abc"], [2, "abc"]]);
  assert.deepEqual([...setFromColumnDirect(new Map([["armor.txt", table]]), "armor.txt", "code")], ["abc"]);
  assert.deepEqual([...setFromColumnDirect(new Map([["armor.txt", table]]), "armor.txt", "code", { caseSensitive: true })], ["abc"]);
  assert.deepEqual([...unionSetsDirect(new Set(["a", "b"]), new Set(["b", "c"]))], ["a", "b", "c"]);
  assert.deepEqual(uniqueDocumentsDirect([doc, duplicateDoc, skillDoc]), [doc, skillDoc]);
  assert.equal(lintCleanDirect("\" One \""), "One");
  assert.equal(lintNormalizeHeaderDirect("  Item   Code "), "item code");
  assert.equal(lintNormalizeTokenDirect(" AbC "), "abc");
  assert.equal(lintClean("\" One \""), lintCleanDirect("\" One \""));
  assert.equal(lintNormalizeHeader("  Item   Code "), lintNormalizeHeaderDirect("  Item   Code "));
  assert.equal(lintNormalizeToken(" AbC "), lintNormalizeTokenDirect(" AbC "));
});

test("lint cube helpers are split from the engine while preserving parser semantics", () => {
  assert.deepEqual(parseCubeItem("\"qty=3, cap, mag\""), {
    raw: "qty=3, cap, mag",
    code: "cap",
    qualifiers: ["qty=3", "mag"],
    qty: 3
  });
  assert.deepEqual(parseCubeItem("cap,qty=2,eth"), {
    raw: "cap,qty=2,eth",
    code: "cap",
    qualifiers: ["qty=2", "eth"],
    qty: 2
  });
  assert.deepEqual(parseCubeItem(""), { raw: "", code: "", qualifiers: [], qty: null });
  assert.equal(cubeInputCount("\"cap,qty=4\""), 4);
  assert.equal(cubeInputCount("cap,qty=2"), 2);
  assert.equal(cubeInputCount("cap,mag"), 1);

  const table = {
    hasColumn: (columnName) => ["input 1", "input 2", "input 4"].includes(columnName)
  };
  const row = {
    get: (columnName) => ({
      "input 1": "cap",
      "input 2": "",
      "input 4": "hpot"
    }[columnName] ?? "")
  };
  assert.deepEqual(inputColumns(row, table), ["input 1", "input 4"]);
});

test("duplicate Excel lint preserves duplicate pairs without quadratic unique-row scans", () => {
  const doc = TableDocument.fromText("armor.txt", "code\tname\nabc\tOne\nabc\tTwo\nabc\tThree\nExpansion\tSkip\nExpansion\tSkip");
  const diagnostics = runLint([doc], createDefaultLintSettings()).filter((item) => item.ruleId === "Basic/NoDuplicateExcel");
  assert.equal(diagnostics.length, 3);
  assert.deepEqual(diagnostics.map((item) => item.rowIndex), [2, 3, 3]);
  const table = {
    rows: doc.rows,
    hasColumn: (columnName) => columnName === "code",
    columnIndex: () => 0
  };
  assert.deepEqual(duplicateRowPairs(table, "code"), [
    { rowIndex: 2, previousRow: 1, value: "abc" },
    { rowIndex: 3, previousRow: 1, value: "abc" },
    { rowIndex: 3, previousRow: 2, value: "abc" }
  ]);
});

test("Basic/LinkedExcel reports bad references from workspace docs with exact cells", () => {
  const docs = [
    TableDocument.fromText("properties.txt", "code\nknown-prop", { path: "excel/properties.txt" }),
    TableDocument.fromText("itemstatcost.txt", "stat\nknown-stat", { path: "excel/itemstatcost.txt" }),
    TableDocument.fromText("missiles.txt", "missile\tskill\nknownmissile\tMissingSkill", { path: "excel/missiles.txt" }),
    TableDocument.fromText("skills.txt", "skill\tsrvmissilea\nKnownSkill\tmissingmissile", { path: "excel/skills.txt" }),
    TableDocument.fromText("uniqueitems.txt", "index\tprop3\nBad Unique\tmissing-prop", { path: "excel/uniqueitems.txt" }),
    TableDocument.fromText("misc.txt", "code\tname\tstat1\tnamestr\nbadmisc\tBad Misc\tmissing-stat\t", { path: "excel/misc.txt" })
  ];
  const diagnostics = lintDocs(docs).filter((item) => item.ruleId === "Basic/LinkedExcel");
  assert.ok(diagnostics.some((item) => item.fileName === "uniqueitems.txt" && item.rowIndex === 1 && item.columnName === "prop3" && item.rowLabel === "Bad Unique"));
  assert.ok(diagnostics.some((item) => item.fileName === "missiles.txt" && item.rowIndex === 1 && item.columnName === "skill" && item.rowLabel === "knownmissile"));
  assert.ok(diagnostics.some((item) => item.fileName === "skills.txt" && item.rowIndex === 1 && item.columnName === "srvmissilea" && item.rowLabel === "KnownSkill"));
  assert.ok(diagnostics.some((item) => item.fileName === "misc.txt" && item.rowIndex === 1 && item.columnName === "stat1" && item.rowLabel === "badmisc"));
  assert.ok(diagnostics.some((item) => item.fileName === "misc.txt" && item.rowIndex === 1 && item.columnName === "namestr" && item.d2rMessage === "misc.txt, line 2: namestr for 'Bad Misc' is blank but required"));
});

test("Basic/LinkedExcel resolves RotW propertygroups without hiding 2.4 or casing mismatches", () => {
  const docs = [
    TableDocument.fromText("properties.txt", "code\ngethit-skill"),
    TableDocument.fromText("propertygroups.txt", "code\tprop1\nGelid-Affix5\tgethit-skill\nBreaching-Affix4\tGelid-Affix5"),
    TableDocument.fromText("uniqueitems.txt", "index\tprop1\tprop2\tprop3\nRotW Item\tGelid-Affix5\tBreaching-Affix4\tGethit-skill"),
    TableDocument.fromText("magicprefix.txt", "name\tmod3code\nGelid\tGelid-Affix5")
  ];
  const rotw = lintDocs(docs, "RotW").filter((item) => item.ruleId === "Basic/LinkedExcel");
  assert.equal(rotw.some((item) => item.columnName === "prop1" && item.offendingValue === "Gelid-Affix5"), false);
  assert.equal(rotw.some((item) => item.columnName === "prop2" && item.offendingValue === "Breaching-Affix4"), false);
  assert.equal(rotw.some((item) => item.columnName === "mod3code" && item.offendingValue === "Gelid-Affix5"), false);
  assert.ok(rotw.some((item) => item.columnName === "prop3" && item.offendingValue === "Gethit-skill"));

  const d24 = lintDocs(docs, "2.4").filter((item) => item.ruleId === "Basic/LinkedExcel");
  assert.ok(d24.some((item) => item.columnName === "prop1" && item.offendingValue === "Gelid-Affix5"));
});

test("Basic/LinkedExcel covers d2rlint item type, sound, skilldesc, and summode links", () => {
  const docs = [
    TableDocument.fromText("properties.txt", "code\nknown-prop"),
    TableDocument.fromText("itemtypes.txt", "code\nwand"),
    TableDocument.fromText("magicprefix.txt", "name\titype1\nBurning\tstaff"),
    TableDocument.fromText("monsounds.txt", "id\nzombie"),
    TableDocument.fromText("monstats.txt", "id\tmonsound\tumonsound\nhorse\thorse\thorse"),
    TableDocument.fromText("skilldesc.txt", "skilldesc\nknown desc"),
    TableDocument.fromText("monmode.txt", "code\nNU"),
    TableDocument.fromText("skills.txt", "skill\tskilldesc\tsummon\tsummode\nUberAncientsHeal\tself heal\tzombie\t")
  ];
  const diagnostics = lintDocs(docs, "RotW").filter((item) => item.ruleId === "Basic/LinkedExcel");
  assert.ok(diagnostics.some((item) => item.fileName === "magicprefix.txt" && item.columnName === "itype1" && item.d2rMessage === "magicprefix.txt, line 2: itype1 'staff' not found for 'Burning'"));
  assert.ok(diagnostics.some((item) => item.fileName === "monstats.txt" && item.columnName === "monsound" && item.d2rMessage === "monstats.txt, line 2: monsound 'horse' not found for 'horse'"));
  assert.ok(diagnostics.some((item) => item.fileName === "monstats.txt" && item.columnName === "umonsound" && item.d2rMessage === "monstats.txt, line 2: umonsound 'horse' not found for 'horse'"));
  assert.ok(diagnostics.some((item) => item.fileName === "skills.txt" && item.columnName === "skilldesc" && item.d2rMessage === "skills.txt, line 2: skilldesc 'self heal' not found for 'UberAncientsHeal'"));
  assert.ok(diagnostics.some((item) => item.fileName === "skills.txt" && item.columnName === "summode" && item.d2rMessage === "skills.txt, line 2: invalid summode '' for 'UberAncientsHeal'"));
});

test("lint checks numeric bounds, boolean fields, cube rules, and treasure class rules", () => {
  const docs = [
    TableDocument.fromText("misc.txt", "code\tautobelt\nabc\t2"),
    TableDocument.fromText("armor.txt", "code\ncap"),
    TableDocument.fromText("weapons.txt", "code\naxe"),
    TableDocument.fromText("itemtypes.txt", "code\narmo"),
    TableDocument.fromText("itemstatcost.txt", "stat\nstrength"),
    TableDocument.fromText("setitems.txt", "index\nSet Cap"),
    TableDocument.fromText("uniqueitems.txt", "index\nUnique Cap"),
    TableDocument.fromText("cubemod.txt", "code\n"),
    TableDocument.fromText("cubemain.txt", "description\tenabled\tnuminputs\tinput 1\toutput\top\tparam\tvalue\nbad\t1\t2\tcap\tmissing\t5\tbadstat\t"),
    TableDocument.fromText("treasureclassex.txt", "Treasure Class\tPicks\tItem1\tProb1\tItem2\tProb2\nBadTC\t-2\tcap\t1\tmissing\t")
  ];
  const diagnostics = runLint(docs, createDefaultLintSettings());
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/BooleanFields" && item.columnName === "autobelt"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Cube/ValidInputs" && item.columnName === "numinputs"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Cube/ValidOutputs" && item.columnName === "output"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Cube/ValidOp" && item.columnName === "value"));
  assert.ok(diagnostics.some((item) => item.ruleId === "TC/ValidTreasure" && item.columnName === "Item2"));
  assert.ok(diagnostics.some((item) => item.ruleId === "TC/ValidNegativePicks" && item.columnName === "Picks"));
  assert.ok(diagnostics.some((item) => item.ruleId === "TC/ValidProbs" && item.columnName === "Prob2"));
});

test("Items/ValidSockets carries d2rlint-compatible socket messages", () => {
  const docs = [
    TableDocument.fromText("itemtypes.txt", "code\tmaxsocketslevelthreshold1\tmaxsocketslevelthreshold2\tmaxsockets1\tmaxsockets2\tmaxsockets3\namul\t0\t0\t0\t0\t0\norb\t0\t0\t3\t3\t3"),
    TableDocument.fromText("armor.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\n"),
    TableDocument.fromText("misc.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\nAmulet\tamu\tamul\t\t1\t1\t0\t1\t1"),
    TableDocument.fromText("weapons.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\nEagle Orb\tob1\torb\t\t1\t4\t0\t1\t2")
  ];
  const diagnostics = lintDocs(docs).filter((item) => item.ruleId === "Items/ValidSockets");
  assert.ok(diagnostics.some((item) => item.fileName === "misc.txt" && item.d2rMessage === "misc.txt, line 4: gemsockets (1) won't spawn on 'Amulet' because its type(s) won't allow more than 0 sockets."));
  assert.ok(diagnostics.some((item) => item.fileName === "weapons.txt" && item.d2rMessage === "weapons.txt, line 4: gemsockets (4) won't spawn on 'Eagle Orb' because its type(s) won't allow more than 3 sockets."));
  assert.ok(diagnostics.some((item) => item.fileName === "weapons.txt" && item.d2rMessage === "weapons.txt, line 4: 'Eagle Orb' has more gemsockets (4) than inventory spaces used (1 x 2 = 2)"));
});

test("remaining D2R TXT lint rules produce concrete diagnostics", () => {
  assert.ok(lintDocs([TableDocument.fromText("cubemain.txt", "description\tenabled\nbad\t1")]).some((item) => item.ruleId === "Basic/ExcelColumns"));
  assert.ok(lintDocs([TableDocument.fromText("localstrings.txt", "id\tKey\tenUS\tdeDE\n1\tHello\tHello\tHallo\n1\tOther\tOther\t")]).some((item) => item.ruleId === "Basic/StringCheck" && item.columnName === "id"));
  assert.ok(lintDocs([TableDocument.fromText("localstrings.txt", "id\tKey\tenUS\tdeDE\n1\tHello\tHello\t")]).some((item) => item.ruleId === "String/NoUntranslated" && item.columnName === "deDE"));

  const socketDocs = [
    TableDocument.fromText("itemtypes.txt", "code\tmaxsocketslevelthreshold1\tmaxsocketslevelthreshold2\tmaxsockets1\tmaxsockets2\tmaxsockets3\narmo\t30\t20\t2\t1\t7"),
    TableDocument.fromText("armor.txt", "code\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\ncap\tarmo\t\t1\t4\t5\t1\t2"),
    TableDocument.fromText("misc.txt", "code\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\n"),
    TableDocument.fromText("weapons.txt", "code\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\n")
  ];
  const socketDiagnostics = lintDocs(socketDocs);
  assert.ok(socketDiagnostics.some((item) => item.ruleId === "Items/ValidSockets" && item.columnName === "maxsocketslevelthreshold1"));
  assert.ok(socketDiagnostics.some((item) => item.ruleId === "Items/ValidSockets" && item.columnName === "gemapplytype"));

  const gambleDocs = [
    TableDocument.fromText("itemtypes.txt", "code\tequiv1\tequiv2\nchar\t\t\ncharm\tchar\t"),
    TableDocument.fromText("misc.txt", "code\ttype\ttype2\ncm1\tcharm\t"),
    TableDocument.fromText("gamble.txt", "code\ncm1")
  ];
  assert.ok(lintDocs(gambleDocs).some((item) => item.ruleId === "Items/NoIllegalGambling" && item.columnName === "code"));

  const statDocs = [
    TableDocument.fromText("properties.txt", "code\tfunc1\tstat1\nbadprop\t1\titem_strength"),
    TableDocument.fromText("itemstatcost.txt", "stat\tsave bits\tsave add\tsigned\tencode\nitem_strength\t2\t0\t0\t0"),
    TableDocument.fromText("skills.txt", "skill\nAttack"),
    TableDocument.fromText("uniqueitems.txt", "index\tprop1\tpar1\tmin1\tmax1\nBad Unique\tbadprop\t\t0\t5")
  ];
  assert.ok(lintDocs(statDocs).some((item) => item.ruleId === "Items/ValidStatParameters" && item.columnName === "max1"));

  const narrowStatDocs = [
    TableDocument.fromText("properties.txt", "code\tfunc1\tstat1\nreal-prop\t1\treal_stat\nbroad-prop\t20\t"),
    TableDocument.fromText("itemstatcost.txt", "stat\tsave bits\tsave add\tsigned\tencode\nreal_stat\t1\t0\t1\t0"),
    TableDocument.fromText("skills.txt", "skill\nAttack"),
    TableDocument.fromText("monprop.txt", "id\tprop1\tmin1\tmax1\ndruidhawk\treal-prop\t-1\t-1"),
    TableDocument.fromText("magicprefix.txt", "name\tmod1code\tmod1min\tmod1max\nMassive\tbroad-prop\t65\t65")
  ];
  const statWarnings = lintDocs(narrowStatDocs).filter((item) => item.ruleId === "Items/ValidStatParameters");
  assert.equal(statWarnings.length, 2);
  assert.ok(statWarnings.every((item) => item.fileName === "monprop.txt"));

  const levelDocs = [
    TableDocument.fromText("levels.txt", "id\tname\tvis0\twarp0\twaypoint\n1\tOne\t2\t5\t1\n2\tTwo\t0\t0\t1"),
    TableDocument.fromText("lvlwarp.txt", "name\nWarp Zero")
  ];
  const levelDiagnostics = lintDocs(levelDocs);
  assert.ok(levelDiagnostics.some((item) => item.ruleId === "Level/ValidWarp" && item.columnName === "vis0"));
  assert.ok(levelDiagnostics.some((item) => item.ruleId === "Level/ValidWPs" && item.columnName === "waypoint"));

  assert.ok(lintDocs([TableDocument.fromText("monstats.txt", "id\tbaseid\tnextinclass\tboss\tprimeevil\nzombie\tzombie\tmissing\t0\t0")]).some((item) => item.ruleId === "Monsters/ValidChains" && item.columnName === "nextinclass"));
  assert.ok(lintDocs([
    TableDocument.fromText("skills.txt", "skill\tcharclass\nA Skill\tama\nS Skill 1\tsor\nS Skill 2\tsor"),
    TableDocument.fromText("playerclass.txt", "code\nama\nsor")
  ]).some((item) => item.ruleId === "Skills/EqualSkills" && item.columnName === "code"));
});

test("d2rlint parity avoids socket checks when a required item table is absent", () => {
  const docs = [
    TableDocument.fromText("armor.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\nCap\tcap\tarmo\t\t1\t6\t9\t1\t1"),
    TableDocument.fromText("misc.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\n"),
    TableDocument.fromText("weapons.txt", "name\tcode\ttype\ttype2\thasinv\tgemsockets\tgemapplytype\tinvwidth\tinvheight\n")
  ];
  assert.equal(lintDocs(docs).some((item) => item.ruleId === "Items/ValidSockets"), false);
});

test("cube output lint resolves quoted items and property group output mods", () => {
  const docs = [
    TableDocument.fromText("armor.txt", "code\ncap"),
    TableDocument.fromText("misc.txt", "code\n"),
    TableDocument.fromText("weapons.txt", "code\n"),
    TableDocument.fromText("setitems.txt", "index\n"),
    TableDocument.fromText("uniqueitems.txt", "index\n"),
    TableDocument.fromText("itemtypes.txt", "code\narmo"),
    TableDocument.fromText("cubemod.txt", "code\n"),
    TableDocument.fromText("properties.txt", "code\nknown-property"),
    TableDocument.fromText("propertygroups.txt", "code\nknown-group"),
    TableDocument.fromText("cubemain.txt", "description\tenabled\tnuminputs\tinput 1\toutput\tb mod 1\nok\t1\t1\tcap\t\"cap,mag\"\tknown-group")
  ];
  const diagnostics = lintDocs(docs).filter((item) => item.ruleId === "Cube/ValidOutputs");
  assert.equal(diagnostics.length, 0);
});

test("valid stat parameter lint follows d2rlint file scope and ignores cubemain mods", () => {
  const docs = [
    TableDocument.fromText("properties.txt", "code\tfunc1\tstat1\nbadprop\t1\titem_strength"),
    TableDocument.fromText("itemstatcost.txt", "stat\tsave bits\tsave add\tsigned\tencode\nitem_strength\t2\t0\t0\t0"),
    TableDocument.fromText("skills.txt", "skill\nAttack"),
    TableDocument.fromText("cubemain.txt", "description\tenabled\tmod 1\tmod 1 min\tmod 1 max\ncube\t1\tbadprop\t0\t5")
  ];
  assert.equal(lintDocs(docs).some((item) => item.ruleId === "Items/ValidStatParameters"), false);
});

test("2.4-only TXT lint rules are implemented and hidden from RotW", () => {
  const docs = [
    TableDocument.fromText("missiles.txt", "missile\trange\nbolt\tpar3"),
    TableDocument.fromText("monstats.txt", "id\ttreasureclassdesecrated\ttreasureclassdesecratedchamp\ttreasureclassdesecratedunique\nzombie\t\tAct 1 Champ\t"),
    TableDocument.fromText("monequip.txt", "monster\tlevel\nzombie\t5\nzombie\t10")
  ];
  assert.equal(lintDocs(docs, "RotW").some((item) =>
    item.ruleId === "Basic/MissileRangeFieldSemantics" ||
    item.ruleId === "Basic/MonstatsDesecratedTreasureClassSemantics" ||
    item.ruleId === "Basic/MonEquipLevelOrder"
  ), false);
  const diagnostics = lintDocs(docs, "2.4");
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/MissileRangeFieldSemantics" && item.columnName === "range"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/MonstatsDesecratedTreasureClassSemantics" && item.columnName === "treasureclassdesecrated"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/MonEquipLevelOrder" && item.columnName === "level"));
});

test("RotW 3.2 schema accepts new Excel columns without Basic/ExcelColumns warnings", () => {
  const docs = [
    TableDocument.fromText("charstats.txt", "class\ttwohandedoffhandrestrictitemtype\ttwohandeddamageasonehanded\nama\taxe\t1"),
    TableDocument.fromText("levels.txt", "id\tcompletiontotalroomsoverride\n1\t0"),
    TableDocument.fromText("monpet.txt", "monster\tcalc1\tcalc2\tcalc3\tcalc4\tcalc5\tboundstat1\tboundcalc1\tboundstat2\tboundcalc2\tboundstat3\tboundcalc3\tboundstat4\tboundcalc4\tboundstat5\tboundcalc5\nwolf\t1\t2\t3\t4\t5\thp\t1\tmana\t2\tstr\t3\tdex\t4\tvit\t5"),
    TableDocument.fromText("soundenviron.txt", "index\tinheritenvironment\tinheritenvrionment\ncave\t1\t0")
  ];
  const warnings = lintDocs(docs, "RotW").filter((item) => item.ruleId === "Basic/ExcelColumns");
  assert.deepEqual(warnings.map((item) => `${item.fileName}:${item.columnName}`), []);
});

test("RotW 3.2 missile pcltdofunc allows 77 but still rejects larger values", () => {
  const doc = TableDocument.fromText("missiles.txt", "missile\tpcltdofunc\nok\t77\nbad\t78");
  const diagnostics = lintDocs([doc], "RotW").filter((item) => item.ruleId === "Basic/NumericBounds" && item.columnName === "pcltdofunc");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].rowIndex, 2);
  assert.equal(diagnostics[0].offendingValue, "78");
});

test("RotW 3.2 schema and bounds do not leak into the 2.4 profile", () => {
  const docs = [
    TableDocument.fromText("charstats.txt", "class\ttwohandedoffhandrestrictitemtype\ttwohandeddamageasonehanded\nama\taxe\t1"),
    TableDocument.fromText("levels.txt", "id\tcompletiontotalroomsoverride\n1\t0"),
    TableDocument.fromText("missiles.txt", "missile\tpcltdofunc\nbolt\t77")
  ];
  const diagnostics = lintDocs(docs, "2.4");
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/ExcelColumns" && item.fileName === "charstats.txt" && item.columnName === "twohandedoffhandrestrictitemtype"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/ExcelColumns" && item.fileName === "charstats.txt" && item.columnName === "twohandeddamageasonehanded"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/ExcelColumns" && item.fileName === "levels.txt" && item.columnName === "completiontotalroomsoverride"));
  assert.ok(diagnostics.some((item) => item.ruleId === "Basic/NumericBounds" && item.fileName === "missiles.txt" && item.columnName === "pcltdofunc" && item.offendingValue === "77"));
});

test("single-file lint avoids cross-file cube reference false positives", () => {
  const doc = TableDocument.fromText("cubemain.txt", "description\tenabled\tnuminputs\tinput 1\toutput\top\tparam\tvalue\nok\t1\t1\tunknown\talso_unknown\t0\t\t");
  const diagnostics = runLint([doc], createDefaultLintSettings());
  assert.equal(diagnostics.some((item) => item.ruleId === "Cube/ValidInputs" || item.ruleId === "Cube/ValidOutputs"), false);
});

test("lint profile affects D2R 2.4 missile range semantics", () => {
  const doc = TableDocument.fromText("missiles.txt", "missile\trange\nbolt\tpar3");
  assert.equal(runLint([doc], createDefaultLintSettings()).some((item) => item.ruleId === "Basic/MissileRangeFieldSemantics"), false);
  const settings = createDefaultLintSettings();
  settings.profile = "2.4";
  settings.profiles["2.4"].rules["Basic/MissileRangeFieldSemantics"].enabled = true;
  assert.equal(runLint([doc], settings).some((item) => item.ruleId === "Basic/MissileRangeFieldSemantics"), true);
});

test("fixed lint diagnostics disappear after re-running on edited data", () => {
  const doc = TableDocument.fromText("misc.txt", "code\tautobelt\nabc\t2");
  assert.equal(runLint([doc], createDefaultLintSettings()).some((item) => item.ruleId === "Basic/BooleanFields"), true);
  doc.setCell(1, 1, "1");
  assert.equal(runLint([doc], createDefaultLintSettings()).some((item) => item.ruleId === "Basic/BooleanFields"), false);
});

test("lint diagnostics expose semantic labels and active profile", () => {
  const doc = TableDocument.fromText("treasureclassex.txt", "Treasure Class\tPicks\tItem1\tProb1\nAct 1 (N) Unique B\t-2\tcap\t1");
  const diagnostic = runLint([doc], createDefaultLintSettings()).find((item) => item.ruleId === "TC/ValidNegativePicks");
  assert.equal(diagnostic.profile, "RotW");
  assert.equal(diagnostic.rowLabel, "Act 1 (N) Unique B");
  assert.equal(diagnostic.columnName, "Picks");
  assert.equal(diagnostic.locationLabel, "Act 1 (N) Unique B > Picks");
  assert.equal(diagnostic.primaryLocationLabel, "Act 1 (N) Unique B > Picks");
  assert.equal(diagnostic.technicalLocationLabel, "R2:C2");
  assert.equal(diagnostic.offendingValue, "-2");
});

test("d2rlint-compatible export uses WARN tab-separated diagnostics", () => {
  const doc = TableDocument.fromText("treasureclassex.txt", "Treasure Class\tPicks\tItem1\tProb1\nAct 1 (N) Unique B\t-2\tcap\t1");
  const diagnostics = runLint([doc], createDefaultLintSettings());
  const text = formatD2rlintCompatibleExport({ diagnostics });
  assert.match(text, /^WARN\tTC\/ValidNegativePicks\ttreasureclassex\.txt, line 2: 'picks' \(-2\) doesn't match negative sum of probs \(-1\) for 'Act 1 \(N\) Unique B'$/m);
  assert.equal(text.split("\n").filter(Boolean).length, diagnostics.length);
  assert.equal(/Log started|20\d\d-\d\d-\d\d|T\d\d:\d\d/.test(text), false);
  assert.equal(formatD2rlintCompatibleExport({ diagnostics }), text);
});

test("d2rlint-compatible export preserves severity labels and selected profile diagnostics", () => {
  const diagnostics = [
    { severity: "info", ruleId: "Info/Rule", fileName: "z.txt", rowIndex: 4, columnIndex: 0, message: "info message", profile: "2.4" },
    { severity: "error", ruleId: "Error/Rule", fileName: "a.txt", rowIndex: 0, columnIndex: 1, message: "error message", profile: "2.4" }
  ];
  const text = formatD2rlintCompatibleExport({ diagnostics });
  assert.match(text, /^ERROR\tError\/Rule\ta\.txt, line 1: error message$/m);
  assert.match(text, /^INFO\tInfo\/Rule\tz\.txt, line 5: info message$/m);
  assert.equal(text.split("\n").filter(Boolean).length, 2);
});

test("lint exports use the canonical diagnostics count and deterministic ordering", () => {
  const diagnostics = [
    { severity: "warning", ruleId: "B/Rule", profile: "RotW", filePath: "z/misc.txt", fileName: "misc.txt", rowIndex: 5, columnIndex: 3, rowLabel: "Zed", columnName: "code", offendingValue: "bad", message: "z message" },
    { severity: "warning", ruleId: "A/Rule", profile: "RotW", filePath: "a/armor.txt", fileName: "armor.txt", rowIndex: 1, columnIndex: 2, rowLabel: "Cap", columnName: "prop1", offendingValue: "Gelid-Affix5", message: "a message" }
  ];
  const readable = formatTxteditorLintExport({ diagnostics });
  const compatible = formatD2rlintCompatibleExport({ diagnostics });
  assert.equal(readable.trimEnd().split("\n").length - 1, diagnostics.length);
  assert.equal(compatible.trimEnd().split("\n").filter(Boolean).length, diagnostics.length);
  assert.match(readable, /^severity\truleId\tprofile\tfilePath\tfileName\trowIndex\tline\trowLabel\tcolumnName\tcellValue\tmessage\nWARN\tA\/Rule\tRotW\ta\/armor\.txt/m);
  assert.match(compatible, /^WARN\tA\/Rule\tarmor\.txt, line 2: a message\nWARN\tB\/Rule\tmisc\.txt, line 6: z message\n$/);
});

test("disabling a lint rule removes that rule's diagnostics", () => {
  const doc = TableDocument.fromText("armor.txt", "code\tname\nabc\tOne\nabc\tTwo");
  const settings = createDefaultLintSettings();
  assert.equal(runLint([doc], settings).some((item) => item.ruleId === "Basic/NoDuplicateExcel"), true);
  settings.profiles.RotW.rules["Basic/NoDuplicateExcel"].enabled = false;
  assert.equal(runLint([doc], settings).some((item) => item.ruleId === "Basic/NoDuplicateExcel"), false);
});

test("disabling Basic/LinkedExcel removes linked-reference diagnostics", () => {
  const docs = [
    TableDocument.fromText("properties.txt", "code\nknown-prop"),
    TableDocument.fromText("uniqueitems.txt", "index\tprop1\nBad Unique\tmissing-prop")
  ];
  const settings = createDefaultLintSettings();
  assert.equal(runLint(docs, settings).some((item) => item.ruleId === "Basic/LinkedExcel"), true);
  settings.profiles.RotW.rules["Basic/LinkedExcel"].enabled = false;
  assert.equal(runLint(docs, settings).some((item) => item.ruleId === "Basic/LinkedExcel"), false);
});

test("profile switching replaces previous profile diagnostics", () => {
  const doc = TableDocument.fromText("missiles.txt", "missile\trange\nbolt\tpar3");
  const settings = createDefaultLintSettings();
  assert.equal(runLint([doc], settings).some((item) => item.profile === "RotW" && item.ruleId === "Basic/MissileRangeFieldSemantics"), false);
  settings.profile = "2.4";
  settings.profiles["2.4"].rules["Basic/MissileRangeFieldSemantics"].enabled = true;
  const diagnostics = runLint([doc], settings);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].profile, "2.4");
  assert.equal(diagnostics[0].locationLabel, "bolt > range");
});

test("workspace lint can report diagnostics for files that are not the active document", () => {
  const activeDoc = TableDocument.fromText("misc.txt", "code\tautobelt\nok\t1");
  const workspaceOnlyDoc = TableDocument.fromText("armor.txt", "code\tname\nabc\tOne\nabc\tTwo");
  const diagnostics = runLint([activeDoc, workspaceOnlyDoc], createDefaultLintSettings());
  assert.equal(diagnosticsForDocument(diagnostics, activeDoc).length, 0);
  assert.equal(diagnosticsForDocument(diagnostics, workspaceOnlyDoc).some((item) => item.ruleId === "Basic/NoDuplicateExcel"), true);
});

test("workspace index represents every Explorer txt as loaded and parsed", () => {
  const explorerFiles = [
    { path: "fixtures/excel/armor.txt", name: "armor.txt" },
    { path: "fixtures/excel/misc.txt", name: "misc.txt" },
    { path: "fixtures/excel/cubemain.txt", name: "cubemain.txt" }
  ];
  const docs = [
    TableDocument.fromText("armor.txt", "code\ncap", { path: "fixtures/excel/armor.txt" }),
    TableDocument.fromText("misc.txt", "code\nhpot", { path: "fixtures/excel/misc.txt" }),
    TableDocument.fromText("cubemain.txt", "description\tenabled\tnuminputs\tinput 1\toutput\top\tparam\tvalue\nrecipe\t1\t1\thpot\tcap\t0\t\t", { path: "fixtures/excel/cubemain.txt" })
  ];
  const fileStates = buildWorkspaceFileStates(explorerFiles, docs);
  const directFileStates = buildWorkspaceFileStatesDirect(explorerFiles, docs);
  assert.equal(fileStates.size, explorerFiles.length);
  assert.equal(directFileStates.size, fileStates.size);
  for (const file of explorerFiles) {
    const state = fileStates.get(file.path.toLowerCase());
    const directState = directFileStates.get(file.path.toLowerCase());
    assert.equal(state.loadedForIndex, true);
    assert.equal(state.parsedForLint, true);
    assert.equal(directState.loadedForIndex, state.loadedForIndex);
    assert.equal(directState.parsedForLint, state.parsedForLint);
    assert.deepEqual(directState.columns, state.columns);
  }
  const index = buildWorkspaceIndex(docs, "RotW");
  const directIndex = buildWorkspaceIndexDirect(docs, "RotW");
  assert.equal(index.files.size, docs.length);
  assert.equal(directIndex.files.size, index.files.size);
  assert.equal(index.tablesByName.has("cubemain.txt"), true);
  assert.equal(directIndex.tablesByName.has("cubemain.txt"), true);
  assert.equal(index.itemCodes.has("hpot"), true);
  assert.equal(index.itemCodes.has("cap"), true);
  assert.deepEqual([...directIndex.itemCodes], [...index.itemCodes]);
  assert.equal(index.rowLabelsByFile.get("fixtures/excel/cubemain.txt").get(1), "recipe");
  assert.equal(directIndex.rowLabelsByFile.get("fixtures/excel/cubemain.txt").get(1), "recipe");
  assert.equal(runLint(docs, createDefaultLintSettings()).some((item) => item.ruleId === "Cube/ValidInputs"), false);
});

test("workspace file states keep parse errors visible instead of silently ignoring files", () => {
  const explorerFiles = [{ path: "fixtures/excel/bad.txt", name: "bad.txt" }];
  const errors = new Map([["fixtures/excel/bad.txt", "Unable to parse"]]);
  const fileStates = buildWorkspaceFileStates(explorerFiles, [], errors);
  const directFileStates = buildWorkspaceFileStatesDirect(explorerFiles, [], errors);
  const state = fileStates.get("fixtures/excel/bad.txt");
  const directState = directFileStates.get("fixtures/excel/bad.txt");
  assert.equal(state.loadedForIndex, true);
  assert.equal(state.parsedForLint, false);
  assert.equal(state.parseError, "Unable to parse");
  assert.equal(directState.loadedForIndex, state.loadedForIndex);
  assert.equal(directState.parsedForLint, state.parsedForLint);
  assert.equal(directState.parseError, state.parseError);
});

test("settings UI lives in Settings while lint controls stay in the bottom Problems panel", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const toolbar = html.match(/<section class="toolbar">([\s\S]*?)<\/section>/)?.[1] ?? "";
  const problems = html.match(/<section id="problemsPanel"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.equal(toolbar.includes("toggle-lint"), false);
  assert.equal(toolbar.includes("open-settings"), false);
  assert.equal(problems.includes("lintControls"), true);
  assert.equal(problems.includes("lintRulesPanel"), true);
  assert.equal(toolbar.includes("open-app-settings"), true);
  assert.equal(toolbar.includes("toggle-colorize"), false);
  assert.equal(toolbar.includes("fontSelect"), false);
  assert.equal(toolbar.includes("toggle-theme"), false);
  for (const removed of ["run-lint", "toggle-auto-lint", "Run Lint", "Auto Lint", "export-lint-txt", "export-d2rlint-txt", "export-lint-txt-d2rlint", "Export Lint TXT", "Export d2rlint TXT"]) {
    assert.equal(html.includes(removed), false);
  }
  assert.equal(problems.includes("problemsResizer"), true);
  assert.equal(html.includes("sidebarResizer"), true);
});

test("temporary lint TXT export commands are not exposed in the app UI", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const publicCommandText = [
    ...commandLabelsForEnvironment({ isDevelopmentMode: false }).flat(),
    ...commandLabelsForEnvironment({ isDevelopmentMode: true }).flat(),
    html
  ].join("\n");
  for (const removed of ["export-lint-txt", "export-d2rlint-txt", "Export Lint TXT", "Export d2rlint TXT"]) {
    assert.equal(publicCommandText.includes(removed), false);
  }
});

test("Problems lint panel is gated by the active P panel and lint enabled state", () => {
  const diagnostics = [{ id: "d", rowIndex: 1, columnIndex: 2 }];
  const doc = TableDocument.fromText("items.txt", "id\n1", { dirty: false });
  const diagnosticsForDocumentStub = (items, targetDoc) => targetDoc === doc ? items : [];
  const groupDiagnosticsByCellStub = (items) => new Map(items.map((item) => [`${item.rowIndex}:${item.columnIndex}`, [item]]));
  assert.equal(lintPanelActive({ problemsVisible: true, lintEnabled: true }), true);
  assert.equal(lintPanelActive({ problemsVisible: false, lintEnabled: true }), false);
  assert.equal(lintPanelActive({ problemsVisible: true, lintEnabled: false }), false);
  assert.equal(shouldRenderProblemsPanel({ hasProblemsList: true, problemsVisible: true, bottomTab: "problems" }), true);
  assert.equal(shouldRenderProblemsPanel({ hasProblemsList: false, problemsVisible: true, bottomTab: "problems" }), false);
  assert.equal(shouldRenderProblemsPanel({ hasProblemsList: true, problemsVisible: true, bottomTab: "logs" }), false);
  assert.deepEqual(activeDocumentDiagnostics({
    lintActive: true,
    diagnostics,
    doc,
    diagnosticsForDocument: diagnosticsForDocumentStub
  }), diagnostics);
  assert.deepEqual(activeDocumentDiagnostics({
    lintActive: false,
    diagnostics,
    doc,
    diagnosticsForDocument: diagnosticsForDocumentStub
  }), []);
  assert.deepEqual([...activeDocumentDiagnosticsByCell({
    lintActive: true,
    diagnostics,
    doc,
    diagnosticsForDocument: diagnosticsForDocumentStub,
    groupDiagnosticsByCell: groupDiagnosticsByCellStub
  }).keys()], ["1:2"]);
  assert.equal(activeDocumentDiagnosticsByCell({
    lintActive: false,
    diagnostics,
    doc,
    diagnosticsForDocument: diagnosticsForDocumentStub,
    groupDiagnosticsByCell: groupDiagnosticsByCellStub
  }).size, 0);
});

test("Explorer problem badges are visible only while Problems lint notifications are active", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const diagnostics = [{ fileKey: "data/items.txt" }, { fileKey: "data/items.txt" }, { fileKey: "data/skills.txt" }];
  assert.equal(lintNotificationsVisible({ problemsVisible: true, lintEnabled: true, diagnostics }), true);
  assert.equal(lintNotificationsVisible({ problemsVisible: false, lintEnabled: true, diagnostics }), false);
  assert.equal(lintNotificationsVisible({ problemsVisible: true, lintEnabled: true, diagnostics: [] }), false);
  assert.equal(lintNotificationCount({ problemsVisible: true, lintEnabled: true, diagnostics }), 3);
  assert.equal(lintNotificationCount({ problemsVisible: false, lintEnabled: true, diagnostics }), 0);
  assert.equal(problemBadgeCountForFile({ diagnostics, fileKey: "data/items.txt", notificationsVisible: true }), 2);
  assert.equal(problemBadgeCountForFile({ diagnostics, fileKey: "data/items.txt", notificationsVisible: false }), 0);
  assert.equal(problemBadgeHtml({ diagnostics, fileKey: "data/items.txt", notificationsVisible: true }), ` <span class="file-problem-badge">2</span>`);
  assert.equal(problemBadgeHtml({ diagnostics, fileKey: "data/items.txt", notificationsVisible: false }), "");
  assert.match(css, /\.activity-button\[data-badge\]::after/);
});

test("Problems panel policy renders grouped diagnostics and summary text", () => {
  const diagnostics = [
    {
      id: "b&2",
      fileName: "b.txt",
      fileKey: "data/b.txt",
      rowIndex: 2,
      columnIndex: 3,
      severity: "warning",
      message: "Needs <value>",
      ruleId: "Rule/B",
      profile: "RotW"
    },
    {
      id: "a1",
      fileName: "a.txt",
      fileKey: "data/a.txt",
      rowIndex: 0,
      columnIndex: 1,
      severity: "error",
      message: "Broken",
      ruleId: "",
      profile: ""
    },
    {
      id: "b3",
      fileName: "b.txt",
      fileKey: "data/b.txt",
      rowIndex: 3,
      columnIndex: 0,
      severity: "info",
      message: "FYI",
      ruleId: "Rule/I",
      profile: ""
    }
  ];

  assert.deepEqual(diagnosticCounts(diagnostics), { error: 1, warning: 1, info: 1 });
  assert.deepEqual(groupDiagnosticsByFile(diagnostics).map(([fileName, items]) => [fileName, items.length]), [["a.txt", 1], ["b.txt", 2]]);
  assert.equal(problemsPanelHtml({ lintEnabled: false }), `<div class="empty-problems">Lint is off.</div>`);
  assert.equal(problemsPanelHtml({ lintEnabled: true, vectorEngine: true, lspStarted: false }), `<div class="empty-problems">Open a folder to enable linting.</div>`);
  assert.equal(problemsPanelHtml({ lintEnabled: true, vectorEngine: true, lspStarted: true, diagnostics: [] }), `<div class="empty-problems">No problems.</div>`);

  const html = problemsPanelHtml({
    lintEnabled: true,
    vectorEngine: true,
    lspStarted: true,
    diagnostics,
    collapsedFiles: new Set(["b.txt"])
  });
  assert.match(html, /data-file-name="a\.txt" open/);
  assert.match(html, /data-file-name="b\.txt">/);
  assert.match(html, /<span class="problem-location">R3:C4<\/span>/);
  assert.match(html, /Needs &lt;value&gt;/);
  assert.match(html, /data-diagnostic-id="b&amp;2"/);
  assert.match(html, /<span class="problem-rule">Rule\/B<\/span>/);
  assert.match(html, /<span class="problem-rule">RotW<\/span>/);

  assert.equal(problemsLintSummaryText({ lintEnabled: false }), "Lint off");
  assert.equal(problemsLintSummaryText({ lintEnabled: true, legacyEngine: true, legacyStatus: "Legacy running", legacyProfile: "RotW" }), "Legacy running");
  assert.equal(problemsLintSummaryText({ lintEnabled: true, legacyEngine: true, legacyWorkspaceLoadStatus: "failed", legacyProfile: "RotW" }), "Workspace index failed - RotW");
  assert.equal(problemsLintSummaryText({ lintEnabled: true, legacyEngine: true, legacyProfile: "RotW", diagnostics: [] }), "No problems - RotW");
  assert.equal(problemsLintSummaryText({ lintEnabled: true, legacyEngine: true, legacyProfile: "RotW", diagnostics }), "1 errors, 1 warnings, 1 info - RotW");
  assert.equal(problemsLintSummaryText({ lintEnabled: true, vectorEngine: true, lspStarted: false }), "Open a folder to enable linting");
  assert.equal(problemsLintSummaryText({ lintEnabled: true, vectorEngine: true, lspStarted: true, lintStatus: "Vector busy", diagnostics }), "Vector busy");
  assert.equal(problemsLintSummaryText({ lintEnabled: true, vectorEngine: true, lspStarted: true, diagnostics: [], openFileCount: 1 }), "No problems (1 file linted)");
  assert.equal(problemsLintSummaryText({ lintEnabled: true, vectorEngine: true, lspStarted: true, diagnostics, openFileCount: 3 }), "1 errors, 1 warnings, 1 info (3 files)");
});

test("Legacy Lint activation paths schedule immediate runs without changing the P tab model", () => {
  assert.equal(lintEnginePanelActive({ problemsVisible: true, lintEnabled: true, engine: "legacy", targetEngine: "legacy" }), true);
  assert.equal(lintEnginePanelActive({ problemsVisible: true, lintEnabled: true, engine: "vector-lsp", targetEngine: "legacy" }), false);
  for (const reason of ["workspace-opened", "engine-switched-legacy", "lint-enabled", "profile-changed", "problems-opened"]) {
    assert.deepEqual(legacyLintImmediateSchedule(reason), { reason, delay: 0 });
  }
  assert.deepEqual(legacyLintOpenSchedule("file-opened"), { reason: "file-opened", delay: 0 });
  assert.equal(documentOpenSyncRoute(LINT_ENGINE_LEGACY), "legacy-lint-open");
});

test("legacy lint cache version is kept outside TableDocument fields", () => {
  const doc = TableDocument.fromText("items.txt", "id\n1", { dirty: false });
  assert.equal(legacyLintDocumentVersion(doc), 0);
  assert.equal(markLegacyLintDocumentChanged(doc), 1);
  assert.equal(markLegacyLintDocumentChanged(doc), 2);
  assert.equal(legacyLintDocumentVersion(doc), 2);
  assert.equal(Object.hasOwn(doc, "legacyLintVersion"), false);
  assert.equal(doc.dirty, false);
});

test("Problems list highlights diagnostics for the active or edited marker cell", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.deepEqual(problemsSelectionChangeEffect(), { updateActiveHighlight: true });
  assert.deepEqual([...activeDiagnosticIdsForCell({
    diagnostics: [
      { id: "hit", fileKey: "items.txt", rowIndex: 3, columnIndex: 1 },
      { id: "wrong-cell", fileKey: "items.txt", rowIndex: 4, columnIndex: 1 },
      { id: "wrong-file", fileKey: "skills.txt", rowIndex: 3, columnIndex: 1 }
    ],
    fileKey: "items.txt",
    activeCell: { row: 3, column: 1 },
    lintActive: true,
    hasOpenDocument: true
  })], ["hit"]);
  assert.equal(activeDiagnosticIdsForCell({
    diagnostics: [{ id: "hit", fileKey: "items.txt", rowIndex: 3, columnIndex: 1 }],
    fileKey: "items.txt",
    activeCell: { row: 3, column: 1 },
    lintActive: false,
    hasOpenDocument: true
  }).size, 0);
  assert.deepEqual(activeProblemItemState(true), { active: true, ariaCurrent: "location" });
  assert.deepEqual(activeProblemItemState(false), { active: false, ariaCurrent: null });
  assert.deepEqual(problemsPanelRenderEffect("cached"), { updateActiveHighlight: true, perfDetails: { cached: true } });
  assert.deepEqual(problemsPanelRenderEffect("render"), { updateActiveHighlight: true, perfDetails: { rendered: true } });
  assert.deepEqual(problemsPanelRenderEffect("skipped"), { updateActiveHighlight: false, perfDetails: { skipped: true } });
  const notifications = [];
  const grid = {
    selection: { focus: { row: 3, column: 1 } },
    editingCell: () => ({ row: 3, column: 1 }),
    onSelectionChanged: (event) => notifications.push(event)
  };
  for (const reason of ["pointer-selection", "keyboard-selection", "edit-start"]) {
    CanvasGrid.prototype.notifySelectionChanged.call(grid, reason);
  }
  assert.deepEqual(notifications, [
    { reason: "pointer-selection", focus: { row: 3, column: 1 }, editingCell: { row: 3, column: 1 } },
    { reason: "keyboard-selection", focus: { row: 3, column: 1 }, editingCell: { row: 3, column: 1 } },
    { reason: "edit-start", focus: { row: 3, column: 1 }, editingCell: { row: 3, column: 1 } }
  ]);
  assert.match(css, /\.problem-item\.problem-item-active-cell\s*\{[\s\S]*background:\s*color-mix/);
});

test("diagnostic navigation centers the grid cell and active problem item", () => {
  const calls = [];
  const state = { problemsVisible: false, selection: { focus: { row: 12, column: 4 } } };
  const grid = {
    layout: () => calls.push("layout"),
    scrollCellToCenter: (row, column) => calls.push(["center", row, column]),
    draw: () => calls.push("draw")
  };
  const storage = { setItem: (key, value) => calls.push(["storage", key, value]) };
  const result = finishDiagnosticNavigation({
    state,
    grid,
    storage,
    updateGridDiagnostics: () => calls.push("diagnostics"),
    renderChrome: () => calls.push("render"),
    updateActiveProblemHighlight: (options) => calls.push(["active-problem", options]),
    host: { focus: () => calls.push("focus") }
  });
  assert.equal(state.problemsVisible, true);
  assert.deepEqual(result, { row: 12, column: 4 });
  assert.deepEqual(calls, [
    ["storage", "txteditor.problems", "visible"],
    "diagnostics",
    "render",
    "layout",
    ["center", 12, 4],
    "draw",
    ["active-problem", { scroll: true }],
    "focus"
  ]);
});

test("UI performance instrumentation records row and lint display work", () => {
  const samples = [];
  assert.deepEqual(UI_PERF_EVENT_NAMES, [
    "row-command",
    "update-grid-diagnostics",
    "update-overview-ruler",
    "render-problems-panel",
    "render-chrome"
  ]);
  assert.deepEqual(recordUiPerfSample(samples, {
    name: "render-problems-panel",
    started: 10,
    diagnostics: 3,
    problemsVisible: true,
    bottomTab: "problems",
    details: { cached: true },
    now: () => 14.236
  }), {
    name: "render-problems-panel",
    ms: 4.24,
    diagnostics: 3,
    problemsVisible: true,
    bottomTab: "problems",
    cached: true
  });
});

test("diagnostic marker policy chooses severity color and triangle geometry", () => {
  assert.equal(diagnosticMarkerState([], { x: 10, y: 20, width: 40, height: 26 }), null);
  assert.deepEqual(diagnosticMarkerState([{ severity: "warning" }], { x: 10, y: 20, width: 40, height: 26 }), {
    severity: "warning",
    color: "#cca700",
    points: [[40, 45], [49, 45], [49, 36]]
  });
  assert.deepEqual(diagnosticMarkerState([{ severity: "info" }, { severity: "error" }], { x: 0, y: 0, width: 12, height: 12 }), {
    severity: "error",
    color: "#f14c4c",
    points: [[5, 11], [11, 11], [11, 5]]
  });
});
