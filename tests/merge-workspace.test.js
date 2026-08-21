import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeFileMerge,
  analyzeFolderMerge,
  canonicalMergeFileKey,
  mergeInputFileFromPayload,
  mergeOutputPayload,
  mergeSessionCanSave,
  normalizeMergeRelativePath,
  referenceFilesFromDataset
} from "../src/core/merge-workspace.js";
import { resolveMergeConflict, unresolvedMergeConflicts } from "../src/core/merge-engine.js";

function file(relativePath, text) {
  return mergeInputFileFromPayload({
    name: relativePath.split("/").pop(),
    path: `/mods/${relativePath}`,
    text,
    encoding: "utf-8"
  }, { root: "/mods", relativePath });
}

test("merge paths normalize Windows separators and known D2 excel roots", () => {
  assert.equal(normalizeMergeRelativePath("C:\\mod\\global\\excel\\skills.txt", "C:\\mod"), "global/excel/skills.txt");
  assert.equal(canonicalMergeFileKey("data/global/excel/Skills.txt"), "skills.txt");
});

test("folder absence on one mod side means unchanged Base, not file deletion", () => {
  const base = file("skills.txt", "skill\tA\tB\nx\t0\t0\n");
  const a = file("global/excel/skills.txt", "skill\tA\tB\nx\t1\t0\n");
  const session = analyzeFolderMerge({ baseFiles: [base], aFiles: [a], bFiles: [] });
  assert.equal(session.files.length, 1);
  assert.equal(session.files[0].sidePresence.b, false);
  assert.deepEqual(session.files[0].result.rows[1], ["x", "1", "0"]);
  assert.equal(session.files[0].result.rows.length, 2);
});

test("custom files on one side are copied and marked as custom", () => {
  const custom = file("custom/newtable.txt", "id\tvalue\nx\t1\n");
  const session = analyzeFolderMerge({ baseFiles: [], aFiles: [custom], bFiles: [] });
  assert.equal(session.files[0].custom, true);
  assert.equal(session.files[0].status, "custom-a");
  assert.equal(mergeSessionCanSave(session), true);
  assert.deepEqual(mergeOutputPayload(session), [{
    relativePath: "custom/newtable.txt",
    text: "id\tvalue\nx\t1\n",
    encoding: "utf-8"
  }]);
});

test("folder merge pairs matching normalized relative tables and combines changes", () => {
  const base = file("skills.txt", "skill\tA\tB\nx\t0\t0\n");
  const a = file("data/global/excel/skills.txt", "skill\tA\tB\nx\t1\t0\n");
  const b = file("global/excel/skills.txt", "skill\tA\tB\nx\t0\t2\n");
  const session = analyzeFolderMerge({ baseFiles: [base], aFiles: [a], bFiles: [b] });
  assert.equal(session.summary.autoMergedFiles, 1);
  assert.deepEqual(session.files[0].result.rows[1], ["x", "1", "2"]);
});

test("reference payload conversion keeps verified dataset-relative names", () => {
  const result = referenceFilesFromDataset({ files: [{ name: "skills.txt", text: "skill\tvalue\n", encoding: "utf-8", bytes: 12 }] });
  assert.equal(result[0].relativePath, "skills.txt");
  assert.equal(result[0].encoding, "utf-8");
});

test("a one-sided custom table is copied exactly even when no row key can be inferred", () => {
  const custom = file("custom/raw.txt", "left\tright\nx\t1\n");
  const session = analyzeFolderMerge({ baseFiles: [], aFiles: [custom], bFiles: [] });
  assert.equal(session.files[0].status, "custom-a");
  assert.equal(unresolvedMergeConflicts(session.files[0]).length, 0);
  assert.equal(mergeSessionCanSave(session), true);
  assert.equal(mergeOutputPayload(session)[0].text, "left\tright\nx\t1\n");
});

test("same-path custom tables on both sides use conservative 2-way conflicts", () => {
  const a = file("custom/shared.txt", "id\tvalue\nx\t1\n");
  const b = file("custom/shared.txt", "id\tvalue\nx\t2\n");
  const session = analyzeFolderMerge({ baseFiles: [], aFiles: [a], bFiles: [b] });
  const [merged] = session.files;
  assert.equal(merged.custom, true);
  assert.equal(merged.status, "conflict");
  const [conflict] = unresolvedMergeConflicts(merged);
  assert.ok(conflict);
  resolveMergeConflict(merged, conflict.id, { choice: "b" });
  assert.equal(merged.status, "custom-both");
  assert.equal(mergeOutputPayload(session)[0].text, "id\tvalue\nx\t2\n");
});

test("a missing mod side does not become an eligible format source", () => {
  const base = file("skills.txt", "skill\tvalue\nx\t0\n");
  const a = file("skills.txt", "skill\tvalue\r\nx\t1\r\n");
  const session = analyzeFolderMerge({ baseFiles: [base], aFiles: [a], bFiles: [] });
  assert.equal(session.files[0].formatSource, "a");
  assert.equal(mergeOutputPayload(session)[0].text, "skill\tvalue\r\nx\t1\r\n");
});

test("folder merge rejects two folders with no supported tables", () => {
  assert.throws(() => analyzeFolderMerge({ baseFiles: [], aFiles: [], bFiles: [] }), /no supported tabular text files/i);
});

test("file merge always emits the reviewed Result even when it is unchanged", () => {
  const base = file("skills.txt", "skill\tvalue\nx\t0\n");
  const a = file("skills.txt", "skill\tvalue\nx\t0\n");
  const b = file("skills.txt", "skill\tvalue\nx\t0\n");
  const session = analyzeFileMerge({ baseFile: base, aFile: a, bFile: b });
  assert.equal(session.files[0].status, "unchanged");
  assert.equal(session.files[0].includeInOutput, true);
  assert.equal(mergeOutputPayload(session).length, 1);
});

test("folder merge with only unchanged files has no saveable output", () => {
  const base = file("skills.txt", "skill\tvalue\nx\t0\n");
  const session = analyzeFolderMerge({ baseFiles: [base], aFiles: [base], bFiles: [base] });
  assert.equal(session.summary.outputFiles, 0);
  assert.equal(session.files[0].includeInOutput, false);
  assert.equal(mergeSessionCanSave(session), false);
  assert.throws(() => mergeOutputPayload(session), /resolve all conflicts|schema warnings/i);
});
