import assert from "node:assert/strict";
import test from "node:test";
import { hitSummonModeResult, integerPolicyMessage, parseType2Uint32 } from "../src/core/lint-basic-rules.js";
import { parseCubeInput } from "../src/core/lint-cube.js";
import { createDefaultLintSettings, runLint } from "../src/core/lint-engine.js";
import { fitsFixed4cc, fixed4cc, fixed4Key } from "../src/core/lint-reference-semantics.js";
import { TableDocument } from "../src/core/table-model.js";

function diagnosticsFor(documents, ruleId) {
  return runLint(documents, createDefaultLintSettings()).filter((diagnostic) => diagnostic.ruleId === ruleId);
}

function cubeReferenceDocuments() {
  return [
    TableDocument.fromText("armor.txt", "code\ncap"),
    TableDocument.fromText("misc.txt", "code\nhpot"),
    TableDocument.fromText("weapons.txt", "code\naxe"),
    TableDocument.fromText("itemtypes.txt", "code\tTreasureClass\narmo\t1"),
    TableDocument.fromText("setitems.txt", "index\nNamed Set"),
    TableDocument.fromText("uniqueitems.txt", "index\nNamed Unique")
  ];
}

test("HitSummon sHitPar2 uses the verified numeric monster mode IDs only in the 3.2 profile", () => {
  const vectors = new Map([
    ["", 0], ["0", 0], ["1", 1], ["15", 15], ["16", 16], ["NU", 337], ["nu", 689],
    ["NU ", 3354], [" NU", 4294966033], ["NUxx", 34492], ["-1", 4294967295], [":", 10]
  ]);
  for (const [value, parsed] of vectors) assert.equal(parseType2Uint32(value), parsed, value);

  for (const value of ["", "0", "1", "15"]) {
    assert.equal(hitSummonModeResult(value).message, null, value);
  }
  for (const value of ["16", "-1", "NU", "nu", "NU ", " NU", "NUxx"]) {
    assert.equal(hitSummonModeResult(value).effective, 1, value);
    assert.ok(hitSummonModeResult(value).message, value);
  }
  assert.equal(
    hitSummonModeResult("NU").message,
    "'NU' is not a numeric mode ID here. The game replaces it with 1 (NU). Use 1 for neutral mode."
  );
  assert.equal(hitSummonModeResult(":").effective, 10);
  assert.equal(hitSummonModeResult(":").fallbackApplied, false);
  assert.match(hitSummonModeResult(":").message, /game reads it as 10 \(S3\)/);
  assert.match(hitSummonModeResult("NU ").message, /'NU␠'/);
  assert.match(hitSummonModeResult(" NU").message, /'␠NU'/);

  const document = TableDocument.fromText(
    "missiles.txt",
    "missile\tpSrvHitFunc\tsHitPar2\tcHitPar2\nblank\t6\t\tNU\ndt\t6\t0\tNU\nnu-id\t6\t1\tNU\nrn\t6\t15\tNU\nhigh\t6\t16\tNU\nnegative\t6\t-1\tNU\ntext\t6\tNU\tNU\nother\t5\tNU\tNU"
  );
  const diagnostics = diagnosticsFor([document], "Basic/NumericBounds")
    .filter((item) => item.columnName === "sHitPar2");
  assert.deepEqual(diagnostics.map((item) => item.offendingValue), ["16", "-1", "NU"]);
  assert.ok(diagnostics.every((item) => item.severity === "warning"));
  assert.equal(diagnostics[2].message, hitSummonModeResult("NU").message);
  assert.equal(diagnostics[2].d2rMessage.includes(hitSummonModeResult("NU").message), true);

  const settings24 = createDefaultLintSettings();
  settings24.profile = "2.4";
  assert.equal(
    runLint([document], settings24).some((item) => item.columnName === "sHitPar2"),
    false
  );
});

test("duplicate keys use fixed-4CC, parsed integer, and ASCII-CI identities", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("armor.txt", "code\nAbCd-one\nAbCd-two\nabCd"),
    TableDocument.fromText("levels.txt", "Id\n1\n01"),
    TableDocument.fromText("skills.txt", "skill\nTeleport\nteleport")
  ], "Basic/NoDuplicateExcel");

  assert.deepEqual(diagnostics.map((item) => `${item.fileName}:${item.rowIndex}:${item.columnName}`), [
    "armor.txt:2:code",
    "levels.txt:2:Id",
    "skills.txt:2:skill"
  ]);
  assert.equal(diagnostics.some((item) => item.offendingValue === "abCd"), false);
  assert.ok(diagnostics.every((item) => item.d2rMessage));
});

test("magic affix item-type links use the game's exact first-four-byte conversion", () => {
  assert.equal(fixed4cc("staff"), "staf");
  assert.equal(fixed4cc("ring  "), "ring");
  assert.equal(fixed4cc("éabc"), "éab");
  assert.equal(fitsFixed4cc("éab"), true);
  assert.equal(fitsFixed4cc("éabc"), false);
  assert.notEqual(fixed4Key("abcé"), fixed4Key("abc€"));
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("itemtypes.txt", "Code\nstaf\nring"),
    TableDocument.fromText("properties.txt", "code\ngethit-skill"),
    TableDocument.fromText("propertygroups.txt", "code\n"),
    TableDocument.fromText("magicprefix.txt", "name\titype1\tmod1code\nStaff Affix\tstaff\tGETHIT-SKILL\nWrong Case\tStaff\tgethit-skill\nQuoted Raw\t\"staff\"\tgethit-skill\nTrailing Property Space\tstaf\tgethit-skill "),
    TableDocument.fromText("magicsuffix.txt", "name\titype1\nRing Affix\tring  ")
  ], "Basic/LinkedExcel");

  assert.deepEqual(diagnostics.map((item) => `${item.rowLabel}:${item.columnName}`), [
    "Wrong Case:itype1",
    "Quoted Raw:itype1",
    "Trailing Property Space:mod1code"
  ]);
  assert.equal(diagnostics[0].message, "Unknown code 'Staff'. The game reads this code as 'Staf'. Check the four-character code and letter case.");
  assert.match(diagnostics[1].message, /game reads this code as '\"sta'/);
  assert.match(diagnostics[2].message, /mod1code .*not found/);
  assert.match(diagnostics[0].d2rMessage, /Unknown code 'Staff'.*four-character code and letter case\.$/);
});

test("fixed-4CC lookups keep truncated UTF-8 bytes distinct", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("itemtypes.txt", "Code\nabcé"),
    TableDocument.fromText("magicprefix.txt", "name\titype1\nDifferent fourth byte\tabc€")
  ], "Basic/LinkedExcel");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].offendingValue, "abc€");
  assert.match(diagnostics[0].message, /four-character code and letter case/);
});

test("Treasure modifier conversion does not recommend the converted value", () => {
  const diagnostic = diagnosticsFor([
    ...cubeReferenceDocuments(),
    TableDocument.fromText(
      "treasureclassex.txt",
      "Treasure Class\tItem1\nRange\tcap,mul=65536"
    )
  ], "TC/ValidTreasure")[0];
  const expected = "Modifier 'mul=65536' is outside 0..65535. The game converts it to 0. Replace it with the number you actually want.";

  assert.equal(diagnostic.message, expected);
  assert.match(diagnostic.d2rMessage, /The game converts it to 0\. Replace it with the number you actually want\./);
  assert.doesNotMatch(diagnostic.message, /Enter 0/);
});

test("fixed-4CC diagnostics make leading and padded spaces visible", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("itemtypes.txt", "Code\nstaf"),
    TableDocument.fromText("magicprefix.txt", "name\titype1\nLeading space\t Staff")
  ], "Basic/LinkedExcel");

  assert.equal(diagnostics.length, 1);
  assert.equal(
    diagnostics[0].message,
    "Unknown code '␠Staff'. The game reads this code as '␠Sta'. ␠ = space. Check the four-character code and letter case."
  );
});

test("an available header-only item type table proves a missing fixed-4CC reference", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("itemtypes.txt", "Code\n"),
    TableDocument.fromText("magicprefix.txt", "name\titype1\nMissing\tstaff")
  ], "Basic/LinkedExcel");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].offendingValue, "staff");
});

test("comment rows neither supply nor receive Legacy linked-reference diagnostics", () => {
  const targetComment = diagnosticsFor([
    TableDocument.fromText("itemtypes.txt", "Name\tCode\n*comment\tstaf"),
    TableDocument.fromText("magicprefix.txt", "name\titype1\nAffix\tstaff")
  ], "Basic/LinkedExcel");
  assert.equal(targetComment.length, 1);
  assert.equal(targetComment[0].offendingValue, "staff");

  const sourceComment = diagnosticsFor([
    TableDocument.fromText("itemtypes.txt", "Code\nstaf"),
    TableDocument.fromText("magicprefix.txt", "name\titype1\n*comment\tmissing")
  ], "Basic/LinkedExcel");
  assert.deepEqual(sourceComment, []);
});

test("available header-only name-map tables prove unresolved linked references", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("properties.txt", "code\n"),
    TableDocument.fromText("propertygroups.txt", "code\n"),
    TableDocument.fromText("magicprefix.txt", "name\tmod1code\nMissing\tnot-a-property")
  ], "Basic/LinkedExcel");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].offendingValue, "not-a-property");
});

test("numeric bounds accept byte-backed intensity 140 and reject noncanonical or overflowing values", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("levels.txt", "Id\tName\tIntensity\n1\tStock Town\t140\n2\tOverflow\t256\n3\tMalformed\t12abc")
  ], "Basic/NumericBounds");

  assert.equal(diagnostics.some((item) => item.offendingValue === "140"), false);
  assert.deepEqual(diagnostics.map((item) => item.offendingValue), ["256", "12abc"]);
  assert.match(diagnostics[1].message, /not a standard integer/);
  assert.match(diagnostics[1].d2rMessage, /Use a plain whole number/);
  assert.ok(diagnostics.every((item) => item.d2rMessage));
});

test("CltParam5 backtick warning reports conversion without recommending 48", () => {
  const expected = "'`' is not written as a normal integer. The game converts it to 48. Replace it with the number you actually want.";
  const message = integerPolicyMessage("missiles.txt", "CltParam5", "`");

  assert.equal(message, expected);
  assert.doesNotMatch(message, /Enter 48/);
});

test("policy-only Legacy wording does not export unverified runtime rejection claims", () => {
  const duplicate = diagnosticsFor([
    TableDocument.fromText("monai.txt", "AI\nCustomAI\nCustomAI")
  ], "Basic/NoDuplicateExcel")[0];
  assert.equal(duplicate.severity, "warning");
  assert.match(duplicate.message, /game's handling of duplicates for this field is not confirmed/);
  assert.match(duplicate.d2rMessage, /game's handling of duplicates for this field is not confirmed/);

  const linked = diagnosticsFor([
    TableDocument.fromText("misc.txt", "code\tname\tnamestr\nkey\tCustom Item\t"),
    TableDocument.fromText("monmode.txt", "Code\nNU"),
    TableDocument.fromText("skills.txt", "skill\tsummon\tsummode\nCustom Skill\tpet\tXX")
  ], "Basic/LinkedExcel");
  const namestr = linked.find((item) => item.columnName === "namestr");
  const summode = linked.find((item) => item.columnName === "summode");
  assert.match(namestr.message, /Add the localization key/);
  assert.match(namestr.d2rMessage, /TXTEditor and other tools/);
  assert.match(summode.message, /Unknown summode/);
  assert.match(summode.d2rMessage, /Choose a valid code from monmode\.txt/);

  const version = diagnosticsFor([
    TableDocument.fromText("uniqueitems.txt", "index\tversion\nCustom Unique\t2")
  ], "Basic/NumericBounds")[0];
  assert.match(version.message, /Unusual version value/);
  assert.match(version.d2rMessage, /Use 0, 1, or 100 for this profile/);
});

test("column and boolean policy warnings do not claim unverified loader rejection", () => {
  const columnDiagnostics = diagnosticsFor([
    TableDocument.fromText("cubemain.txt", "enabled\tnuminputs\tinput 1\toutput\top\tparam\tvalue\n1\t1\tcap\tcap\t0\t\t")
  ], "Basic/ExcelColumns");
  const description = columnDiagnostics.find((item) => item.message.includes('"description"'));
  assert.ok(description);
  assert.match(description.message, /TXTEditor uses it to label recipes/);
  assert.match(description.message, /game does not require it/);
  assert.equal(description.severity, "warning");
  assert.match(description.d2rMessage, /TXTEditor uses it to label recipes/);

  const booleanDiagnostics = diagnosticsFor([
    TableDocument.fromText("misc.txt", "code\tautobelt\nkey\t2")
  ], "Basic/BooleanFields");
  assert.equal(booleanDiagnostics.length, 1);
  assert.equal(booleanDiagnostics[0].columnName, "autobelt");
  assert.equal(booleanDiagnostics[0].offendingValue, "2");
  assert.equal(booleanDiagnostics[0].severity, "warning");
  assert.match(booleanDiagnostics[0].message, /'2' is not a standard boolean value/);
  assert.match(booleanDiagnostics[0].message, /Use 0 for false or 1 for true/);
  assert.match(booleanDiagnostics[0].d2rMessage, /'2' is not a standard boolean value/);
});

test("type-29 booleans use numeric zero versus nonzero semantics without canonical warnings", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText(
      "missiles.txt",
      "missile\texplosion\tnomultishot\n" +
      "zero\t0\t-0\n" +
      "one\t1\t000\n" +
      "two\t2\t3\n" +
      "large\t999999\t184467440737095516160000\n" +
      "negative\t-1\t-987654321\n" +
      "invalid\ttrue\t+1\n" +
      "spaced\t 1\t\t"
    )
  ], "Basic/BooleanFields");

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics, null, 2));
  assert.deepEqual(diagnostics.map((item) => item.offendingValue).sort(), [" 1", "+1", "true"]);
  assert.ok(diagnostics.every((item) => /Use 0 for false or any nonzero integer for true/.test(item.message)));
  assert.ok(diagnostics.every((item) => /not a number/.test(item.d2rMessage)));
});

test("cube inputs accept qty comma and id but preserve prefixes before exact-modifier failures", () => {
  assert.deepEqual(parseCubeInput("cap,qty,3,id"), {
    raw: "cap,qty,3,id",
    formula: "cap,qty,3,id",
    code: "cap",
    qualifiers: ["qty,3", "id"],
    qty: "3",
    storedQty: 3,
    effectiveQty: 3,
    ignoredSuffix: null
  });
  assert.deepEqual(parseCubeInput("cap,sockjunk").qualifiers, []);
  assert.equal(parseCubeInput("cap,sockjunk").ignoredSuffix?.token, "sockjunk");
  assert.deepEqual(parseCubeInput("cap,sock=3").qualifiers, ["sock"]);
  assert.deepEqual(parseCubeInput("cap,sock").qualifiers, ["sock"]);
  const diagnostics = diagnosticsFor([
    ...cubeReferenceDocuments(),
    TableDocument.fromText("cubemain.txt", [
      "description\tenabled\tnuminputs\tinput 1\toutput",
      "valid comma\t1\t3\tcap,qty,3,id\tcap",
      "sock suffix\t1\t1\tcap,sock=3\tcap",
      "junk suffix\t1\t1\tcap,sockjunk\tcap",
      "case suffix\t1\t1\tcap,Mag\tcap",
      "space suffix\t1\t1\tcap, mag\tcap",
      "not input special\t1\t1\tuseitem\tcap",
      "byte quantity\t1\t1\tcap,qty=256\tcap"
    ].join("\n"))
  ], "Cube/ValidInputs");

  assert.equal(diagnostics.some((item) => item.rowIndex === 1), false);
  assert.deepEqual(diagnostics.map((item) => item.rowIndex), [2, 3, 4, 5, 6, 7]);
  assert.ok(diagnostics.filter((item) => item.rowIndex >= 2 && item.rowIndex <= 5).every((item) => /everything after it are ignored/i.test(item.message)));
  assert.match(diagnostics.find((item) => item.rowIndex === 6).message, /Unknown cube input/);
  assert.match(diagnostics.find((item) => item.rowIndex === 7).message, /outside 0 through 255/);
  assert.ok(diagnostics.every((item) => item.columnName === "input 1" && item.d2rMessage));
});

test("cube op accepts ASCII-CI stat names and requires value for op 2 and 27", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("itemstatcost.txt", "Stat\nKnownStat"),
    TableDocument.fromText("cubemain.txt", [
      "description\tenabled\top\tparam\tvalue",
      "name param\t1\t1\tknownstat\t10",
      "op two\t1\t2\t\t",
      "op twenty-seven\t1\t27\t\t",
      "bad param\t1\t3\tMissingStat\t1"
    ].join("\n"))
  ], "Cube/ValidOp");

  assert.deepEqual(diagnostics.map((item) => `${item.rowIndex}:${item.columnName}`), ["2:value", "3:value", "4:param"]);
  assert.ok(diagnostics.every((item) => item.d2rMessage));
});

test("socket cap uses direct Type only and GemApplyType accepts exactly 0 through 2", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("itemtypes.txt", "Code\tMaxSockets1\tMaxSockets2\tMaxSockets3\nlow\t1\t1\t1\nhigh\t6\t6\t6"),
    TableDocument.fromText("armor.txt", "Name\tcode\tType\tType2\tHasInv\tGemSockets\tGemApplyType\tInvWidth\tInvHeight\nDirect Type\tcap\tlow\thigh\t1\t2\t3\t2\t2"),
    TableDocument.fromText("misc.txt", "code\n"),
    TableDocument.fromText("weapons.txt", "code\n")
  ], "Items/ValidSockets");

  assert.deepEqual(diagnostics.map((item) => item.columnName).sort(), ["GemApplyType", "GemSockets"]);
  assert.match(diagnostics.find((item) => item.columnName === "GemSockets").message, /direct Type socket cap \(1\).*clamps/);
  assert.match(diagnostics.find((item) => item.columnName === "GemApplyType").message, /supports 0, 1, or 2/);
  assert.ok(diagnostics.every((item) => /line 2/.test(item.d2rMessage)));
});

test("gamble item lookup is exact 4CC while char ancestry remains a policy warning", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("itemtypes.txt", "Code\tEquiv1\tEquiv2\nchar\t\t"),
    TableDocument.fromText("armor.txt", "code\tType\tType2\nAbC1\tchar\t"),
    TableDocument.fromText("misc.txt", "code\n"),
    TableDocument.fromText("weapons.txt", "code\n"),
    TableDocument.fromText("gamble.txt", "code\nAbC1\nabc1")
  ], "Items/NoIllegalGambling");

  assert.equal(diagnostics.length, 2);
  assert.match(diagnostics[0].message, /character-only item type tree/);
  assert.match(diagnostics[1].message, /Unknown item code/);
  assert.ok(diagnostics.every((item) => item.d2rMessage));
});

test("level warps resolve sparse lvlwarp Ids without row-index or backlink requirements", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("lvlwarp.txt", "Id\tName\tLitVersion\n82\tSparse\t0\n82\tSparse Variant\t1"),
    TableDocument.fromText("levels.txt", "Id\tName\tVis0\tWarp0\n0\tSource\t1\t82\n1\tTarget\t0\t0\n2\tBad\t1\t81")
  ], "Level/ValidWarp");

  assert.equal(diagnostics.some((item) => item.rowIndex === 1), false);
  assert.deepEqual(diagnostics.map((item) => `${item.rowIndex}:${item.columnName}`), ["3:Warp0"]);
  assert.match(diagnostics[0].d2rMessage, /line 4: invalid warp0/);
});

test("waypoint uniqueness compares the parsed stored unsigned byte", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("levels.txt", "Id\tName\tWaypoint\n1\tOne\t1\n2\tLeading Zero\t01\n3\tSentinel\t255\n4\tSentinel Leading Zero\t0255")
  ], "Level/ValidWPs");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].rowIndex, 2);
  assert.equal(diagnostics[0].columnName, "Waypoint");
  assert.match(diagnostics[0].message, /Waypoint 1 is also used/);
  assert.match(diagnostics[0].d2rMessage, /waypoint 1 is already used/);
});

test("treasure items use exact item 4CC then sequential ASCII-CI TC, unique, and set lookup", () => {
  const diagnostics = diagnosticsFor([
    ...cubeReferenceDocuments(),
    TableDocument.fromText("treasureclassex.txt", [
      "Treasure Class\tItem1\tItem2\tItem3\tItem4\tItem5",
      "Earlier\tcap\t\t\t\t",
      "Current\tCurrent\tNAMED UNIQUE\tnamed set\tCAP\tarmo1",
      "Forward User\tLater\t\t\t\t",
      "Modifier\t\"hpot,mul=1280\"\t\"hpot,mul,3\"\t\"hpot,MUL=3\"\t\t",
      "Later\tLater\t\t\t\t",
      "Generated\tarmo3\t\t\t\t",
      "Unsupported pattern\tarmo5\t\t\t\t"
    ].join("\n"))
  ], "TC/ValidTreasure");

  assert.deepEqual(diagnostics.map((item) => `${item.rowIndex}:${item.columnName}`), [
    "2:Item4",
    "2:Item5",
    "3:Item1",
    "4:Item2",
    "4:Item3",
    "7:Item1"
  ]);
  assert.ok(diagnostics.filter((item) => [2, 3, 7].includes(item.rowIndex)).every((item) => /can't find/.test(item.d2rMessage)));
  assert.ok(diagnostics.filter((item) => item.rowIndex === 4).every((item) => /everything after it are ignored/.test(item.message)));
});

test("treasure raw item codes enforce the binary four-byte boundary", () => {
  const diagnostics = diagnosticsFor([
    ...cubeReferenceDocuments().filter((document) => String(document.name).toLowerCase() !== "armor.txt"),
    TableDocument.fromText("armor.txt", "code\néab"),
    TableDocument.fromText("treasureclassex.txt", [
      "Treasure Class\tItem1\tItem2",
      "Unicode bytes\téab\téabc"
    ].join("\n"))
  ], "TC/ValidTreasure");

  assert.deepEqual(diagnostics.map((item) => item.offendingValue), ["éabc"]);
});

test("treasure probabilities explain omissions, orphan values, and first-gap suffixes", () => {
  const diagnostics = diagnosticsFor([
    TableDocument.fromText("treasureclassex.txt", [
      "Treasure Class\tPicks\tItem1\tProb1\tItem2\tProb2\tItem3\tProb3",
      "Gaps\t1\tcap\t\t\t7\taxe\t3",
      "Nonpositive\t1\tcap\t0\t\t\t\t"
    ].join("\n"))
  ], "TC/ValidProbs");

  assert.deepEqual(diagnostics.map((item) => `${item.rowIndex}:${item.columnName}`), [
    "1:Prob1",
    "1:Prob2",
    "1:Item3",
    "1:Prob3",
    "2:Prob1"
  ]);
  assert.match(diagnostics[0].message, /skipped.*blank/);
  assert.match(diagnostics[1].message, /orphaned and ignored/);
  assert.match(diagnostics[2].message, /ignored.*first empty Item slot/);
  assert.match(diagnostics[4].message, /skipped.*zero or negative/);
  assert.ok(diagnostics.every((item) => item.d2rMessage));
});

test("a missing Item header is the binary first-empty slot and ignores later populated slots", () => {
  const documents = [
    ...cubeReferenceDocuments(),
    TableDocument.fromText("treasureclassex.txt", [
      "Treasure Class\tItem1\tProb1\tItem3\tProb3",
      "Header gap\tcap\t1\tbad-after-gap\t7"
    ].join("\n"))
  ];

  assert.deepEqual(diagnosticsFor(documents, "TC/ValidTreasure"), []);
  const probabilities = diagnosticsFor(documents, "TC/ValidProbs");
  assert.deepEqual(probabilities.map((item) => `${item.columnName}:${item.offendingValue}`), [
    "Item3:bad-after-gap",
    "Prob3:7"
  ]);
  assert.ok(probabilities.every((item) => /first empty Item slot/.test(item.message)));
});
