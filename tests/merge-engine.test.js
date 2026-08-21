import test from "node:test";
import assert from "node:assert/strict";
import { TableDocument } from "../src/core/table-model.js";
import {
  MERGE_MISSING,
  mergeScalar,
  mergeTableDocuments,
  mergeFileChanges,
  mergeValueForDisplay,
  resolveMergeConflict,
  serializeMergeFile,
  unresolvedMergeConflicts
} from "../src/core/merge-engine.js";

function doc(name, text) {
  return TableDocument.fromText(name, text);
}

test("three-way cell merge combines independent A and B changes", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tA\tB\nx\t0\t0\n"),
    a: doc("skills.txt", "skill\tA\tB\nx\t1\t0\n"),
    b: doc("skills.txt", "skill\tA\tB\nx\t0\t2\n"),
    fileName: "skills.txt"
  });
  assert.equal(file.status, "auto-merged");
  assert.deepEqual(file.result.rows, [["skill", "A", "B"], ["x", "1", "2"]]);
  assert.equal(unresolvedMergeConflicts(file).length, 0);
});

test("row identity reuses the schema's ASCII case-insensitive key policy", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tA\tB\nFireBolt\t0\t0\n"),
    a: doc("skills.txt", "skill\tA\tB\nfirebolt\t1\t0\n"),
    b: doc("skills.txt", "skill\tA\tB\nFireBolt\t0\t2\n"),
    fileName: "skills.txt"
  });
  assert.deepEqual(file.keySpec, {
    names: ["skill"],
    strategy: "schema-aware",
    comparisons: ["ascii-ci"]
  });
  assert.deepEqual(file.result.rows, [["skill", "A", "B"], ["firebolt", "1", "2"]]);
  assert.equal(file.metrics.addedRows, 0);
  assert.equal(unresolvedMergeConflicts(file).length, 0);
});

test("row identity reuses the schema's integer key policy without rewriting stored text", () => {
  const file = mergeTableDocuments({
    base: doc("levels.txt", "Id\tA\tB\n1\t0\t0\n"),
    a: doc("levels.txt", "Id\tA\tB\n01\t1\t0\n"),
    b: doc("levels.txt", "Id\tA\tB\n1\t0\t2\n"),
    fileName: "levels.txt"
  });
  assert.equal(file.keySpec.comparisons[0], "integer");
  assert.deepEqual(file.result.rows, [["Id", "A", "B"], ["01", "1", "2"]]);
  assert.equal(file.metrics.addedRows, 0);
});

test("row identity reuses the schema's fixed four-byte code policy", () => {
  const file = mergeTableDocuments({
    base: doc("armor.txt", "code\tA\tB\nabcd\t0\t0\n"),
    a: doc("armor.txt", "code\tA\tB\nabcde\t1\t0\n"),
    b: doc("armor.txt", "code\tA\tB\nabcd\t0\t2\n"),
    fileName: "armor.txt"
  });
  assert.equal(file.keySpec.comparisons[0], "fixed4cc");
  assert.deepEqual(file.result.rows, [["code", "A", "B"], ["abcde", "1", "2"]]);
  assert.equal(file.metrics.addedRows, 0);
});

test("same-cell changes stay unresolved until A, B, Base, or custom is selected", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tvalue\nx\t0\n"),
    a: doc("skills.txt", "skill\tvalue\nx\t1\n"),
    b: doc("skills.txt", "skill\tvalue\nx\t2\n"),
    fileName: "skills.txt"
  });
  assert.equal(unresolvedMergeConflicts(file).length, 1);
  const [conflict] = file.conflicts;
  assert.equal(conflict.kind, "value");
  resolveMergeConflict(file, conflict.id, { choice: "custom", value: "42" });
  assert.equal(unresolvedMergeConflicts(file).length, 0);
  assert.equal(file.result.rows[1][1], "42");
  assert.equal(file.status, "resolved");
});

test("empty string and missing trailing cell are compared as different values", () => {
  assert.equal(mergeScalar("0", "", "0").value, "");
  const conflict = mergeScalar("0", "", "2");
  assert.equal(conflict.conflict, true);
  assert.equal(mergeValueForDisplay(MERGE_MISSING), "<missing>");
  const missingConflict = mergeScalar("0", MERGE_MISSING, "2");
  assert.equal(missingConflict.conflict, true);
});

test("one-sided row additions are included without shifting unrelated rows", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tvalue\na\t0\nc\t0\n"),
    a: doc("skills.txt", "skill\tvalue\na\t0\nb\t1\nc\t0\n"),
    b: doc("skills.txt", "skill\tvalue\na\t0\nc\t2\n"),
    fileName: "skills.txt"
  });
  assert.deepEqual(file.result.rows, [
    ["skill", "value"],
    ["a", "0"],
    ["b", "1"],
    ["c", "2"]
  ]);
  assert.equal(file.metrics.addedRows, 1);
});

test("same added key with different values creates add-add conflict", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tvalue\na\t0\n"),
    a: doc("skills.txt", "skill\tvalue\na\t0\nb\t1\n"),
    b: doc("skills.txt", "skill\tvalue\na\t0\nb\t2\n"),
    fileName: "skills.txt"
  });
  assert.equal(file.conflicts.some((conflict) => conflict.kind === "add-add"), true);
});

test("delete versus unchanged deletes automatically", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tvalue\na\t0\nb\t0\n"),
    a: doc("skills.txt", "skill\tvalue\na\t0\n"),
    b: doc("skills.txt", "skill\tvalue\na\t0\nb\t0\n"),
    fileName: "skills.txt"
  });
  assert.deepEqual(file.result.rows, [["skill", "value"], ["a", "0"]]);
  assert.equal(file.metrics.deletedRows, 1);
  assert.equal(unresolvedMergeConflicts(file).length, 0);
});

test("delete versus modify creates row conflict and can choose deletion", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tvalue\na\t0\nb\t0\n"),
    a: doc("skills.txt", "skill\tvalue\na\t0\n"),
    b: doc("skills.txt", "skill\tvalue\na\t0\nb\t9\n"),
    fileName: "skills.txt"
  });
  const conflict = file.conflicts.find((candidate) => candidate.kind === "delete-modify");
  assert.ok(conflict);
  resolveMergeConflict(file, conflict.id, { choice: "a" });
  assert.deepEqual(file.result.rows, [["skill", "value"], ["a", "0"]]);
  assert.equal(file.metrics.deletedRows, 1);
});

test("a one-sided row reorder is preserved", () => {
  const base = "skill\tvalue\na\t0\nb\t0\nc\t0\n";
  const file = mergeTableDocuments({
    base: doc("skills.txt", base),
    a: doc("skills.txt", "skill\tvalue\nc\t0\na\t0\nb\t0\n"),
    b: doc("skills.txt", base),
    fileName: "skills.txt"
  });
  assert.deepEqual(file.result.rows.slice(1).map((row) => row[0]), ["c", "a", "b"]);
  assert.equal(file.conflicts.some((conflict) => conflict.kind === "row-order"), false);
});

test("incompatible two-sided row reorders create an order conflict", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tvalue\na\t0\nb\t0\nc\t0\n"),
    a: doc("skills.txt", "skill\tvalue\nb\t0\na\t0\nc\t0\n"),
    b: doc("skills.txt", "skill\tvalue\na\t0\nc\t0\nb\t0\n"),
    fileName: "skills.txt"
  });
  assert.equal(file.conflicts.some((conflict) => conflict.kind === "row-order"), true);
});

test("column deletion versus modification is a structural conflict", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tA\tB\nx\t0\t0\n"),
    a: doc("skills.txt", "skill\tB\nx\t0\n"),
    b: doc("skills.txt", "skill\tA\tB\nx\t9\t0\n"),
    fileName: "skills.txt"
  });
  assert.equal(file.conflicts.some((conflict) => conflict.kind === "column-delete-modify"), true);
});

test("resolving a column delete-modify conflict resolves the whole column without hidden cell conflicts", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tA\tB\nx\t0\t0\n"),
    a: doc("skills.txt", "skill\tB\nx\t0\n"),
    b: doc("skills.txt", "skill\tA\tB\nx\t9\t0\n"),
    fileName: "skills.txt"
  });
  assert.equal(file.conflicts.length, 1);
  const [conflict] = file.conflicts;
  assert.equal(conflict.kind, "column-delete-modify");
  resolveMergeConflict(file, conflict.id, { choice: "a" });
  assert.equal(unresolvedMergeConflicts(file).length, 0);
  assert.deepEqual(file.result.rows, [["skill", "B"], ["x", "0"]]);
  assert.equal(file.metrics.deletedColumns, 1);

  resolveMergeConflict(file, conflict.id, { choice: "b" });
  assert.equal(unresolvedMergeConflicts(file).length, 0);
  assert.deepEqual(file.result.rows, [["skill", "A", "B"], ["x", "9", "0"]]);
  assert.equal(file.metrics.deletedColumns, 0);
});

test("ambiguous row identity never silently falls back to row numbers", () => {
  const file = mergeTableDocuments({
    base: doc("unknown.txt", "value\tother\nx\t0\nx\t1\n"),
    a: doc("unknown.txt", "value\tother\nx\t2\nx\t1\n"),
    b: doc("unknown.txt", "value\tother\nx\t0\nx\t3\n"),
    fileName: "unknown.txt"
  });
  assert.equal(file.conflicts.some((conflict) => conflict.kind === "ambiguous-row-key"), true);
  assert.equal(file.overrideSource, "a");
});

test("serialization preserves the selected line ending and final newline", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tvalue\r\nx\t0\r\n"),
    a: doc("skills.txt", "skill\tvalue\r\nx\t1\r\n"),
    b: doc("skills.txt", "skill\tvalue\r\nx\t0\r\n"),
    fileName: "skills.txt"
  });
  assert.equal(serializeMergeFile(file), "skill\tvalue\r\nx\t1\r\n");
});

test("whole-table fallback still auto-merges a one-sided change without a stable key", () => {
  const base = doc("unknown.txt", "left\tright\nx\t0\n");
  const file = mergeTableDocuments({
    base,
    a: doc("unknown.txt", "left\tright\nx\t1\n"),
    b: doc("unknown.txt", "left\tright\nx\t0\n"),
    fileName: "unknown.txt"
  });
  assert.equal(file.overrideSource, "a");
  assert.equal(file.conflicts.length, 0);
  assert.equal(file.status, "auto-merged");
  assert.equal(serializeMergeFile(file), "left\tright\nx\t1\n");
});

test("whole-file change projection keeps Result semantic instead of copying raw rows", () => {
  const file = mergeTableDocuments({
    base: doc("unknown.txt", "left\tright\nx\t0\n"),
    a: doc("unknown.txt", "left\tright\nx\t1\n"),
    b: doc("unknown.txt", "left\tright\nx\t0\n"),
    fileName: "unknown.txt"
  });
  const change = mergeFileChanges(file).find((candidate) => candidate.kind === "file");
  assert.ok(change);
  assert.equal(change.source, "a");
  assert.equal(change.result, "A file selected");
  assert.notDeepEqual(change.result, file.result.rows);
  assert.doesNotMatch(JSON.stringify(change), /left|right/);
});

test("a delete-modify conflict can be re-resolved and restores source-relative row order", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tvalue\na\t0\nb\t0\nc\t0\n"),
    a: doc("skills.txt", "skill\tvalue\na\t0\nc\t0\n"),
    b: doc("skills.txt", "skill\tvalue\na\t0\nb\t9\nc\t0\n"),
    fileName: "skills.txt"
  });
  const conflict = file.conflicts.find((candidate) => candidate.kind === "delete-modify");
  assert.ok(conflict);
  resolveMergeConflict(file, conflict.id, { choice: "a" });
  assert.deepEqual(file.result.rows.slice(1).map((row) => row[0]), ["a", "c"]);
  resolveMergeConflict(file, conflict.id, { choice: "b" });
  assert.deepEqual(file.result.rows.slice(1).map((row) => row[0]), ["a", "b", "c"]);
  assert.equal(file.result.rows[2][1], "9");
});

test("rows wider than their headers are never structurally auto-mapped", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tvalue\nx\t0\n"),
    a: doc("skills.txt", "skill\tvalue\nx\t1\textra\n"),
    b: doc("skills.txt", "skill\tvalue\nx\t2\textra\n"),
    fileName: "skills.txt"
  });
  assert.equal(file.conflicts.some((conflict) => conflict.kind === "ambiguous-schema"), true);
  assert.equal(file.overrideSource, "a");
});

test("automatic output format uses verified Base even when A and B differ", () => {
  const base = doc("skills.txt", "skill\tvalue\r\nx\t0\r\n");
  const file = mergeTableDocuments({
    base,
    a: doc("skills.txt", "skill\tvalue\nx\t1\n"),
    b: doc("skills.txt", "skill\tvalue\nx\t0\n"),
    fileName: "skills.txt",
  });
  assert.equal(file.formatSource, "base");
  assert.equal(file.result.lineEnding, "\r\n");
  assert.equal(file.result.finalNewline, true);
});

test("a Base-missing custom file uses A format, then B when A is absent", () => {
  const aFile = mergeTableDocuments({
    a: doc("custom.txt", "name\tvalue\r\nitem\tA\r\n"),
    b: doc("custom.txt", "name\tvalue\nitem\tB\n"),
    fileName: "custom.txt"
  });
  assert.equal(aFile.baseAvailable, false);
  assert.equal(aFile.formatSource, "a");
  assert.equal(aFile.result.lineEnding, "\r\n");

  const bFile = mergeTableDocuments({
    a: null,
    b: doc("custom.txt", "name\tvalue\r\nitem\tB\r\n"),
    fileName: "custom.txt"
  });
  assert.equal(bFile.formatSource, "b");
  assert.equal(bFile.result.lineEnding, "\r\n");
});

test("mergeFileChanges reports independent cell changes with values and sources", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tA\tB\nx\t0\t0\n"),
    a: doc("skills.txt", "skill\tA\tB\nx\t1\t0\n"),
    b: doc("skills.txt", "skill\tA\tB\nx\t0\t2\n"),
    fileName: "skills.txt"
  });
  const cells = mergeFileChanges(file).filter((change) => change.kind === "cell");
  assert.equal(cells.length, 2);
  assert.deepEqual(cells.map(({ columnLabel, base, a, b, result, source }) => ({ columnLabel, base, a, b, result, source })), [
    { columnLabel: "A", base: "0", a: "1", b: "0", result: "1", source: "a" },
    { columnLabel: "B", base: "0", a: "0", b: "2", result: "2", source: "b" }
  ]);
});

test("mergeFileChanges reports an added row once instead of per-cell noise", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tvalue\na\t0\n"),
    a: doc("skills.txt", "skill\tvalue\na\t0\nb\t1\n"),
    b: doc("skills.txt", "skill\tvalue\na\t0\n"),
    fileName: "skills.txt"
  });
  const changes = mergeFileChanges(file);
  assert.equal(changes.filter((change) => change.kind === "row-added").length, 1);
  assert.equal(changes.filter((change) => change.kind === "cell" && change.rowLabel === "b").length, 0);
});

test("mergeFileChanges attributes deleted rows to the side missing them relative to Base", () => {
  const cases = [
    {
      source: "a",
      a: "skill\tvalue\na\t0\n",
      b: "skill\tvalue\na\t0\nb\t0\n"
    },
    {
      source: "b",
      a: "skill\tvalue\na\t0\nb\t0\n",
      b: "skill\tvalue\na\t0\n"
    },
    {
      source: "both",
      a: "skill\tvalue\na\t0\n",
      b: "skill\tvalue\na\t0\n"
    }
  ];

  for (const { source, a, b } of cases) {
    const file = mergeTableDocuments({
      base: doc("skills.txt", "skill\tvalue\na\t0\nb\t0\n"),
      a: doc("skills.txt", a),
      b: doc("skills.txt", b),
      fileName: "skills.txt"
    });
    const deleted = mergeFileChanges(file).find((change) => change.kind === "row-deleted");
    assert.ok(deleted);
    assert.equal(deleted.rowLabel, "b");
    assert.equal(deleted.result, "<missing>");
    assert.equal(deleted.source, source);
  }
});

test("conflict review item links resolution and reflects the Result", () => {
  const file = mergeTableDocuments({
    base: doc("skills.txt", "skill\tvalue\nx\t0\n"),
    a: doc("skills.txt", "skill\tvalue\nx\t1\n"),
    b: doc("skills.txt", "skill\tvalue\nx\t2\n"),
    fileName: "skills.txt"
  });
  const conflict = file.conflicts[0];
  const before = mergeFileChanges(file).find((change) => change.conflictId === conflict.id);
  assert.equal(before.result, "0");
  assert.equal(before.resolution, null);
  resolveMergeConflict(file, conflict.id, { choice: "b" });
  const after = mergeFileChanges(file).find((change) => change.conflictId === conflict.id);
  assert.deepEqual(after.resolution, { choice: "b" });
  assert.equal(after.result, "2");
});
