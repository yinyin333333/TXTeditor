import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultLintSettings, runLint } from "../src/core/lint-engine.js";
import { TableDocument } from "../src/core/table-model.js";

function linkedDiagnostics(documents) {
  return runLint(documents, createDefaultLintSettings())
    .filter((diagnostic) => diagnostic.ruleId === "Basic/LinkedExcel");
}

test("Legacy Properties stat references follow dispatcher reachability", () => {
  const properties = TableDocument.fromText(
    "properties.txt",
    "code\tfunc1\tstat1\tfunc2\tstat2\n" +
      "active\t17\tunknown1\t\t\n" +
      "blank\t\tunknown_blank\t\t\n" +
      "zero\t0\tunknown_zero\t\t\n" +
      "current-blank\t17\tvalid\t\tunknown2\n" +
      "prior-null\t26\tignored1\t17\tunknown2\n" +
      "current-null\t17\tvalid\t26\tunknown2\n" +
      "active-two\t17\tvalid\t1\tunknown2\n" +
      "valid\t17\tVaLiD\t\t"
  );
  const itemStatCost = TableDocument.fromText("itemstatcost.txt", "Stat\nvalid\n");

  const diagnostics = linkedDiagnostics([properties, itemStatCost])
    .filter((diagnostic) => diagnostic.fileName === "properties.txt");

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics, null, 2));
  assert.deepEqual(
    diagnostics.map(({ rowIndex, columnName, severity, message }) => ({ rowIndex, columnName, severity, message })),
    [
      {
        rowIndex: 1,
        columnName: "stat1",
        severity: "warning",
        message: "Unknown stat name 'unknown1'. This property has no effect. Use the exact Stat name from itemstatcost.txt."
      },
      {
        rowIndex: 7,
        columnName: "stat2",
        severity: "warning",
        message: "Unknown stat name 'unknown2'. Use the exact Stat name from itemstatcost.txt."
      }
    ]
  );
  assert.equal(
    diagnostics[0].d2rMessage,
    "properties.txt, line 2: Unknown stat name 'unknown1'. This property has no effect. Use the exact Stat name from itemstatcost.txt."
  );
  assert.equal(diagnostics[0].offendingValue, "unknown1");
  assert.equal(diagnostics[1].offendingValue, "unknown2");
});

test("Legacy MonPet consumestat keeps whole-key warning and slot-local effect", () => {
  const monpet = TableDocument.fromText(
    "monpet.txt",
    "monster\tconsumestat1\tconsumestat2\n" +
      "row\titem_addsksrc _tab\tStReNgTh\n"
  );
  const itemStatCost = TableDocument.fromText("itemstatcost.txt", "Stat\nstrength\n");

  const diagnostics = linkedDiagnostics([monpet, itemStatCost])
    .filter((diagnostic) => diagnostic.fileName === "monpet.txt");

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics, null, 2));
  assert.equal(diagnostics[0].columnName, "consumestat1");
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(
    diagnostics[0].message,
    "Unknown stat name 'item_addsksrc _tab'. This Consume bonus is not applied; other Consume slots still work. Use the exact Stat name from itemstatcost.txt."
  );
  assert.equal(diagnostics[0].d2rMessage, `monpet.txt, line 2: ${diagnostics[0].message}`);
  assert.equal(diagnostics[0].offendingValue, "item_addsksrc _tab");
});
