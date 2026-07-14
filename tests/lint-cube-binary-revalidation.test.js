import assert from "node:assert/strict";
import test from "node:test";
import { parseCubeOutput } from "../src/core/lint-cube.js";
import { createDefaultLintSettings, runLint } from "../src/core/lint-engine.js";
import { TableDocument } from "../src/core/table-model.js";

function lintCubeOutputs(cubeText, extraDocs = []) {
  const replacementNames = new Set(extraDocs.map((doc) => String(doc.name ?? "").toLowerCase()));
  const standardDocs = [
    TableDocument.fromText("armor.txt", "code\nAbC1\ncap"),
    TableDocument.fromText("misc.txt", "code\nhpot"),
    TableDocument.fromText("weapons.txt", "code\naxe1"),
    TableDocument.fromText("setitems.txt", "index\nNamed Set"),
    TableDocument.fromText("uniqueitems.txt", "index\nNamed Relic"),
    TableDocument.fromText("itemtypes.txt", "code\nTYP1\narmo"),
    TableDocument.fromText("properties.txt", "code\nKnown-Property"),
    TableDocument.fromText("propertygroups.txt", "code\nKnown-Group")
  ].filter((doc) => !replacementNames.has(String(doc.name ?? "").toLowerCase()));
  const docs = [
    ...standardDocs,
    ...extraDocs,
    TableDocument.fromText("cubemain.txt", cubeText)
  ];
  return runLint(docs, createDefaultLintSettings()).filter((diagnostic) => diagnostic.ruleId === "Cube/ValidOutputs");
}

test("Cube output parser pairs comma parameters without normalizing suffix tokens", () => {
  assert.deepEqual(parseCubeOutput('"cap,pre,162,mag,lvl=255"'), {
    raw: '"cap,pre,162,mag,lvl=255"',
    formula: "cap,pre,162,mag,lvl=255",
    code: "cap",
    modifiers: [
      { raw: "pre,162", name: "pre", value: "162", separator: "," },
      { raw: "mag", name: "mag", value: null, separator: null },
      { raw: "lvl=255", name: "lvl", value: "255", separator: "=" }
    ],
    ignoredSuffix: null
  });

  const parsed = parseCubeOutput("cap,mag, WAT=7,qty=3");
  assert.deepEqual(parsed.modifiers, [{ raw: "mag", name: "mag", value: null, separator: null }]);
  assert.deepEqual(parsed.ignoredSuffix, {
    raw: " WAT=7,qty=3",
    token: " WAT=7",
    reason: "unknown-modifier"
  });
});

test("Cube output validation runs without optional cubemod.txt and diagnoses a real invalid base", () => {
  const diagnostics = lintCubeOutputs("description\tenabled\tnuminputs\tinput 1\toutput\nmissing base\t1\t1\tcap\tmissing");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].columnName, "output");
  assert.match(diagnostics[0].message, /Unknown cube output/);
  assert.match(diagnostics[0].d2rMessage, /could not find 'missing'/);
});

test("Cube output base diagnostics wait for every required lookup column", () => {
  const diagnostics = lintCubeOutputs(
    "description\tenabled\tnuminputs\tinput 1\toutput\npartial workspace\t1\t1\tcap\tmissing",
    [TableDocument.fromText("uniqueitems.txt", "not-index\nplaceholder")]
  );
  assert.deepEqual(diagnostics, []);
});

test("Cube outputs accept equal and comma parameters plus positional useitem and usetype", () => {
  const diagnostics = lintCubeOutputs([
    "description\tenabled\tnuminputs\tinput 1\tinput 2\tinput 3\toutput\toutput b\toutput c",
    "comma parameters\t1\t3\tcap\tAbC1\tTYP1\t\"cap,pre,162,qty,3\"\tuseitem\tusetype",
    "equals parameters\t1\t1\tcap\t\t\tcap,pre=162,sock=2,lvl=255\t\t"
  ].join("\n"));
  assert.deepEqual(diagnostics, []);
});

test("Cube positional outputs require the input at the same ordinal", () => {
  const diagnostics = lintCubeOutputs([
    "description\tenabled\tnuminputs\tinput 1\tinput 2\toutput\toutput b",
    "missing second input\t1\t1\tcap\t\tcap\tuseitem"
  ].join("\n"));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].columnName, "output b");
  assert.match(diagnostics[0].message, /matching input 2/);
  assert.match(diagnostics[0].d2rMessage, /no matching 'input 2'/);
});

test("Cube portal specials require exact spaced ASCII-case-insensitive phrases", () => {
  const diagnostics = lintCubeOutputs([
    "description\tenabled\tnuminputs\tinput 1\toutput",
    "cow\t1\t1\tcap\tcOw PoRtAl",
    "red\t1\t1\tcap\tRED PORTAL",
    "pandemonium\t1\t1\tcap\tPandemonium Portal",
    "finale\t1\t1\tcap\tPandemonium Finale Portal",
    "compact\t1\t1\tcap\tCowPortal",
    "legacy alias\t1\t1\tcap\tpandportal"
  ].join("\n"));
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.offendingValue), ["CowPortal", "pandportal"]);
  assert.ok(diagnostics.every((diagnostic) => /Unknown cube output/.test(diagnostic.message)));
});

test("Cube output references keep packed codes exact while named targets and properties are ASCII-CI", () => {
  const diagnostics = lintCubeOutputs([
    "description\tenabled\tnuminputs\tinput 1\toutput\tmod 1",
    "exact item\t1\t1\tcap\tAbC1\tknown-property",
    "wrong item case\t1\t1\tcap\tabc1\tKNOWN-PROPERTY",
    "exact type\t1\t1\tcap\tTYP1\tKnown-Group",
    "wrong type case\t1\t1\tcap\ttyp1\tknown-group",
    "named unique\t1\t1\tcap\tnAmEd ReLiC\t",
    "named set\t1\t1\tcap\tNAMED SET\t"
  ].join("\n"));
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.offendingValue), ["abc1", "typ1"]);
});

test("Cube packed-code lookup does not trim reference-table or output bytes", () => {
  const diagnostics = lintCubeOutputs([
    "description\tenabled\tnuminputs\tinput 1\toutput",
    "trimmed candidate\t1\t1\tcap\tSp1",
    "exact spaced bytes\t1\t1\tcap\t Sp1"
  ].join("\n"), [TableDocument.fromText("armor.txt", "code\n Sp1")]);
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.offendingValue), ["Sp1"]);
});

test("Cube raw item codes use the binary four-byte boundary, not JavaScript character count", () => {
  const diagnostics = lintCubeOutputs([
    "description\tenabled\tnuminputs\tinput 1\toutput",
    "four bytes\t1\t1\tcap\téab",
    "five bytes\t1\t1\tcap\téabc"
  ].join("\n"), [TableDocument.fromText("armor.txt", "code\néab")]);
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.offendingValue), ["éabc"]);
});

test("Cube property lookup folds ASCII case but does not trim cell bytes", () => {
  const diagnostics = lintCubeOutputs([
    "description\tenabled\tnuminputs\tinput 1\toutput\tmod 1",
    "case only\t1\t1\tcap\tcap\tKNOWN-PROPERTY",
    "leading space\t1\t1\tcap\tcap\t known-property",
    "trailing space\t1\t1\tcap\tcap\tknown-property "
  ].join("\n"));
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.offendingValue), [" known-property", "known-property "]);
  assert.ok(diagnostics.every((diagnostic) => /Unknown cube output property/.test(diagnostic.message)));
});

test("Cube property diagnostics wait for both property lookup namespaces", () => {
  const diagnostics = lintCubeOutputs([
    "description\tenabled\tnuminputs\tinput 1\toutput\tmod 1",
    "partial workspace\t1\t1\tcap\tcap\tunknown-group"
  ].join("\n"), [
    TableDocument.fromText("propertygroups.txt", "not-code\nplaceholder")
  ]);
  assert.deepEqual(diagnostics, []);
});

test("Cube unknown modifier warnings explain preserved output and ignored suffix", () => {
  const diagnostics = lintCubeOutputs([
    "description\tenabled\tnuminputs\tinput 1\toutput",
    "unknown\t1\t1\tcap\tcap,mag,wat=7,qty=3",
    "bare param\t1\t1\tcap\tcap,pre",
    "empty\t1\t1\tcap\tcap,,qty=3",
    "unsupported old allowlist\t1\t1\tcap\tcap,noe"
  ].join("\n"));
  assert.equal(diagnostics.length, 4);
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.severity, "warning");
    assert.match(diagnostic.message, /game stops at .*base and modifiers before it still work/i);
    assert.match(diagnostic.d2rMessage, /game stops at .*everything after it are ignored/i);
    assert.doesNotMatch(diagnostic.message, /row.*fail|compile.*fail|load.*fail/i);
  }
});

test("Cube invalid bases suppress misleading preserved-prefix suffix diagnostics", () => {
  const diagnostics = lintCubeOutputs("description\tenabled\tnuminputs\tinput 1\toutput\ninvalid base\t1\t1\tcap\tmissing,wat=7");
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /Unknown cube output/);
  assert.doesNotMatch(diagnostics[0].message, /preserved|suffix.*ignored/i);
});

test("Cube output byte-backed modifiers and ordinal level columns diagnose truncation", () => {
  const diagnostics = lintCubeOutputs([
    "description\tenabled\tnuminputs\tinput 1\toutput\tlvl\tplvl\tilvl",
    "byte bounds\t1\t1\tcap\tcap,qty=256\t255\t-1\t256"
  ].join("\n"));
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.columnName), ["output", "plvl", "ilvl"]);
  assert.ok(diagnostics.every((diagnostic) => diagnostic.severity === "warning"));
  assert.ok(diagnostics.every((diagnostic) => /outside 0 through 255/.test(diagnostic.message)));
  assert.ok(diagnostics.every((diagnostic) => /truncat/.test(diagnostic.d2rMessage)));
});
