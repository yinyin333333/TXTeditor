import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultLintSettings, runLint } from "../src/core/lint-engine.js";
import { formatD2rlintCompatibleExport } from "../src/core/lint-export.js";
import { ITEM_LINT_RULES } from "../src/core/lint-item-rules.js";
import { TableDocument } from "../src/core/table-model.js";
import { TREASURE_LINT_RULES } from "../src/core/lint-treasure-rules.js";

function lintDocs(documents) {
  return runLint(documents, createDefaultLintSettings());
}

function ruleDiagnostics(documents, ruleId) {
  return lintDocs(documents).filter((diagnostic) => diagnostic.ruleId === ruleId);
}

function monstatsDocument(rows) {
  return TableDocument.fromText(
    "monstats.txt",
    ["Id\tBaseId\tNextInClass\tBoss\tPrimeEvil", ...rows].join("\n")
  );
}

function linearMonsterChain(hops) {
  const rows = [];
  for (let node = 0; node <= hops; node += 1) {
    rows.push(`node${node}\tnode0\t${node < hops ? `node${node + 1}` : ""}\t0\t0`);
  }
  return monstatsDocument(rows);
}

test("negative Picks does not require abs(Picks) to equal the probability sum", () => {
  const document = TableDocument.fromText(
    "treasureclassex.txt",
    "Treasure Class\tPicks\tItem1\tProb1\tItem2\tProb2\nMismatch\t-4\tcap\t1\taxe\t2"
  );
  const diagnostics = lintDocs([document]);

  assert.equal(diagnostics.some((diagnostic) => diagnostic.ruleId === "TC/ValidNegativePicks"), false);
  assert.equal(formatD2rlintCompatibleExport({ diagnostics }).includes("TC/ValidNegativePicks"), false);
  assert.match(
    TREASURE_LINT_RULES.find((rule) => rule.id === "TC/ValidNegativePicks").note,
    /does not require their sum to equal abs\(Picks\)/
  );
});

test("negative Picks still requires every non-empty probability to be an integer", () => {
  const document = TableDocument.fromText(
    "treasureclassex.txt",
    "Treasure Class\tPicks\tItem1\tProb1\nNonInteger\t-1\tcap\t1.5"
  );
  const diagnostics = ruleDiagnostics([document], "TC/ValidNegativePicks");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].columnName, "Prob1");
  assert.equal(diagnostics[0].message, "Probability prob1 must be numeric when picks is negative.");
  assert.match(
    formatD2rlintCompatibleExport({ diagnostics }),
    /^WARN\tTC\/ValidNegativePicks\ttreasureclassex\.txt, line 2: Probability prob1 must be numeric when picks is negative\.$/m
  );
});

test("monster chains use exact cleaned references and do not normalize casing", () => {
  const diagnostics = ruleDiagnostics([
    monstatsDocument([
      "Alpha\talpha\t\t0\t0",
      "Beta\tBeta\talpha\t0\t0"
    ])
  ], "Monsters/ValidChains");

  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.columnName).sort(), ["BaseId", "NextInClass"]);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes('baseId "alpha" does not exist')));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes('nextInClass for "Beta" (alpha) does not exist')));
});

test("monster chains resolve reordered rows without physical adjacency", () => {
  const diagnostics = ruleDiagnostics([
    monstatsDocument([
      "variant\troot\t\t1\t0",
      "root\troot\tvariant\t0\t0",
      "prime\tprime\t\t0\t1"
    ])
  ], "Monsters/ValidChains");

  assert.deepEqual(diagnostics, []);
});

test("monster reference diagnostics include boss and primeevil rows and compatible log messages", () => {
  const diagnostics = ruleDiagnostics([
    monstatsDocument([
      "boss\tMissingBossBase\tMissingBossNext\t1\t0",
      "prime\tMissingPrimeBase\tMissingPrimeNext\t0\t1"
    ])
  ], "Monsters/ValidChains");

  assert.equal(diagnostics.length, 4);
  assert.ok(diagnostics.every((diagnostic) => diagnostic.d2rMessage));
  assert.deepEqual(
    diagnostics.map((diagnostic) => `${diagnostic.rowIndex}:${diagnostic.columnName}`).sort(),
    ["1:BaseId", "1:NextInClass", "2:BaseId", "2:NextInClass"]
  );
  const compatible = formatD2rlintCompatibleExport({ diagnostics });
  assert.match(compatible, /monstats\.txt, line 2: baseId 'MissingBossBase' doesn't exist for 'boss'\./);
  assert.match(compatible, /monstats\.txt, line 3: nextInClass for 'prime' \(MissingPrimeNext\) doesn't exist\./);
});

test("monster traversal stops at duplicate IDs instead of selecting an arbitrary row", () => {
  const document = monstatsDocument([
    "duplicate\tduplicate\tduplicate\t0\t0",
    "duplicate\tduplicate\tduplicate\t0\t0",
    "consumer\tduplicate\tduplicate\t0\t0"
  ]);
  const diagnostics = lintDocs([document]);

  assert.equal(diagnostics.some((diagnostic) => diagnostic.ruleId === "Monsters/ValidChains"), false);
  assert.equal(diagnostics.some((diagnostic) => diagnostic.ruleId === "Basic/NoDuplicateExcel" && diagnostic.columnName === "Id"), true);
});

test("monster chains report reachable self and multi-node cycles with compatible messages", () => {
  const diagnostics = ruleDiagnostics([
    monstatsDocument([
      "self\tself\tself\t0\t0",
      "alpha\talpha\tbeta\t0\t0",
      "beta\talpha\talpha\t0\t0"
    ])
  ], "Monsters/ValidChains");

  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((diagnostic) => diagnostic.columnName === "NextInClass"));
  assert.ok(diagnostics.every((diagnostic) => diagnostic.d2rMessage));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes('"self" -> "self"')));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes('"alpha" -> "beta" -> "alpha"')));
  const compatible = formatD2rlintCompatibleExport({ diagnostics });
  assert.match(compatible, /nextInClass cycle detected after 1 hop from 'self': 'self' -> 'self'\./);
  assert.match(compatible, /nextInClass cycle detected after 2 hops from 'alpha': 'alpha' -> 'beta' -> 'alpha'\./);
});

test("monster chain traversal allows 255 hops and diagnoses the 256th hop as node 257", () => {
  assert.deepEqual(ruleDiagnostics([linearMonsterChain(255)], "Monsters/ValidChains"), []);

  const diagnostics = ruleDiagnostics([linearMonsterChain(256)], "Monsters/ValidChains");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].rowIndex, 256);
  assert.equal(diagnostics[0].columnName, "NextInClass");
  assert.equal(
    diagnostics[0].message,
    'nextInClass chain from "node0" exceeds 255 hops: "node255" -> "node256" reaches hop 256 (node 257).'
  );
  assert.equal(
    diagnostics[0].d2rMessage,
    "monstats.txt, line 257: nextInClass chain from 'node0' exceeds 255 hops; 'node255' -> 'node256' reaches hop 256 (node 257)."
  );
  assert.match(formatD2rlintCompatibleExport({ diagnostics }), /reaches hop 256 \(node 257\)/);
});

test("item serialization range uses (2^SaveBits - 1) - SaveAdd as its upper bound", () => {
  const documents = [
    TableDocument.fromText("properties.txt", "code\tfunc1\tstat1\nbounded\t1\tbounded_stat"),
    TableDocument.fromText("itemstatcost.txt", "stat\tsave bits\tsave add\tsigned\tencode\nbounded_stat\t3\t2\t0\t0"),
    TableDocument.fromText("skills.txt", "skill\nAttack"),
    TableDocument.fromText(
      "automagic.txt",
      "name\tmod1code\tmod1param\tmod1min\tmod1max\nAt Limit\tbounded\t\t5\t5\nAbove Limit\tbounded\t\t6\t6"
    )
  ];
  const diagnostics = ruleDiagnostics(documents, "Items/ValidStatParameters");

  assert.equal(diagnostics.some((diagnostic) => diagnostic.rowIndex === 1), false);
  assert.deepEqual(
    diagnostics.filter((diagnostic) => diagnostic.rowIndex === 2).map((diagnostic) => diagnostic.columnName).sort(),
    ["mod1max", "mod1min"]
  );
  assert.ok(diagnostics.filter((diagnostic) => diagnostic.rowIndex === 2).every((diagnostic) => diagnostic.message.includes("maximum 5")));
});

test("monprop skips item serialization ranges but retains policy spelling, func22 skill, and max4 checks", () => {
  const documents = [
    TableDocument.fromText(
      "properties.txt",
      "code\tfunc1\tstat1\nstupidity-prop\t1\tstupidity\nskill-prop\t22\tskill_stat"
    ),
    TableDocument.fromText(
      "itemstatcost.txt",
      "stat\tsave bits\tsave add\tsigned\tencode\nstupidity\t7\t0\t1\t0\nskill_stat\t8\t0\t0\t1"
    ),
    TableDocument.fromText("skills.txt", "skill\nAttack"),
    TableDocument.fromText(
      "monprop.txt",
      "id\tprop1\tpar1\tmin1\tmax1\tprop2\tpar2\tmin2\tmax2\tprop4\tmin4\tmax4\n" +
        "druidhawk\tstupidity-prop\t\t-1\t-1\tskill-prop\tMissingSkill\t0\t0\tstupidity-prop\t-1\tnot-an-integer"
    )
  ];
  const diagnostics = ruleDiagnostics(documents, "Items/ValidStatParameters");

  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.columnName).sort(), ["max4", "par2"]);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.columnName === "max4" && diagnostic.severity === "warning" && diagnostic.message.includes("not a normal integer")));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.columnName === "par2" && diagnostic.message.includes('"MissingSkill" is not a known skill')));
  assert.equal(diagnostics.some((diagnostic) => diagnostic.columnName === "min1" || diagnostic.columnName === "max1"), false);
  assert.match(
    ITEM_LINT_RULES.find((rule) => rule.id === "Items/ValidStatParameters").note,
    /saved item stat ranges/
  );
});
