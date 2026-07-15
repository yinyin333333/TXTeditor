import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  NO_VECTOR_LSP_EXE_MESSAGE,
  defaultVectorRoot,
  findExistingVectorLspExecutable,
  missingVectorLspContribMessage,
  prepareStaging,
  resolveVectorLspExecutable,
  runVectorLspRuntimeSmoke,
  vectorLspExecutableCandidates
} from "../scripts/vector-lsp-runtime-smoke.mjs";

test("Vector-LSP runtime smoke executable candidates are platform-aware", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "txteditor-vlsp-smoke-"));
  const vectorRoot = path.join(repoRoot, "missing-vector-lsp");
  try {
    assert.deepEqual(vectorLspExecutableCandidates(vectorRoot, { platform: "win32" }), [
      path.join(vectorRoot, "vector-lsp.exe"),
      path.join(vectorRoot, "target", "release", "vector-lsp.exe"),
      path.join(vectorRoot, "target", "x86_64-pc-windows-msvc", "release", "vector-lsp.exe")
    ]);
    assert.deepEqual(vectorLspExecutableCandidates(vectorRoot, { platform: "linux" }), [
      path.join(vectorRoot, "vector-lsp"),
      path.join(vectorRoot, "target", "release", "vector-lsp"),
      path.join(vectorRoot, "target", "x86_64-pc-windows-msvc", "release", "vector-lsp")
    ]);
    const releaseCandidate = path.join(vectorRoot, "target", "release", "vector-lsp");
    assert.equal(findExistingVectorLspExecutable(vectorRoot, (candidate) => candidate === releaseCandidate, { platform: "linux" }), releaseCandidate);
    assert.equal(resolveVectorLspExecutable({ vectorRoot, exists: (candidate) => candidate === releaseCandidate, platform: "linux" }), releaseCandidate);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("Vector-LSP no-executable diagnostic text is explicit without running optional smoke", () => {
  const vectorRoot = path.join(tmpdir(), "missing-vector-lsp");
  assert.equal(findExistingVectorLspExecutable(vectorRoot), null);
  assert.equal(resolveVectorLspExecutable({ vectorRoot }), null);
  assert.match(NO_VECTOR_LSP_EXE_MESSAGE, /^REAL VECTOR-LSP SMOKE NOT RUN:/);
  assert.match(NO_VECTOR_LSP_EXE_MESSAGE, /--vector-lsp-exe or --vector-lsp-root/);
  assert.doesNotMatch(NO_VECTOR_LSP_EXE_MESSAGE, /[A-Za-z]:\\/);
  assert.equal(defaultVectorRoot(repoRootForDefault()), path.resolve(repoRootForDefault(), "..", "vector-lsp"));
});

test("Vector-LSP required runtime smoke fails nonzero semantics when executable is missing", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "txteditor-vlsp-smoke-"));
  const vectorRoot = path.join(repoRoot, "missing-vector-lsp");
  try {
    await assert.rejects(
      () => runVectorLspRuntimeSmoke({ repoRoot, vectorRoot, requireReal: true }),
      /never builds an external repository/
    );
    assert.equal(existsSync(path.join(repoRoot, ".runtime-smoke", "vector-lsp-smoke-result.json")), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function repoRootForDefault() {
  return path.join(tmpdir(), "txteditor-repo");
}

test("Vector-LSP required runtime smoke fails before staging when contrib is missing", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "txteditor-vlsp-smoke-"));
  const vectorRoot = path.join(repoRoot, "vector-lsp");
  const explicitExe = path.join(repoRoot, "vector-lsp.exe");
  try {
    mkdirSync(vectorRoot, { recursive: true });
    writeFileSync(explicitExe, "");
    await assert.rejects(
      () => runVectorLspRuntimeSmoke({ repoRoot, vectorRoot, vectorLspExe: explicitExe, requireReal: true }),
      new RegExp(missingVectorLspContribMessage(path.join(vectorRoot, "contrib")).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
    assert.equal(existsSync(path.join(repoRoot, ".runtime-smoke", "vector-lsp-bundle")), false);
    assert.equal(existsSync(path.join(repoRoot, ".runtime-smoke", "vector-lsp-smoke-result.json")), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("Vector-LSP runtime smoke can use an explicit executable outside the external repo", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "txteditor-vlsp-smoke-"));
  try {
    const explicitExe = path.join(repoRoot, "vector-lsp.exe");
    writeFileSync(explicitExe, "");
    assert.equal(resolveVectorLspExecutable({
      vectorRoot: path.join(repoRoot, "missing-vector-lsp"),
      vectorLspExe: explicitExe
    }), explicitExe);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("Vector-LSP runtime staging copies the executable and mandatory contrib set", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "txteditor-vlsp-smoke-"));
  const vectorRoot = path.join(repoRoot, "vector-lsp");
  const explicitExe = path.join(repoRoot, "tools", "vector-lsp.exe");
  try {
    mkdirSync(path.dirname(explicitExe), { recursive: true });
    mkdirSync(path.join(vectorRoot, "contrib", "schemas"), { recursive: true });
    writeFileSync(explicitExe, "fake exe");
    writeFileSync(path.join(vectorRoot, "contrib", "schemas", "schema.json"), "{}\n");
    const paths = {
      repoRoot,
      vectorRoot,
      contribSource: path.join(vectorRoot, "contrib"),
      stagingDir: path.join(repoRoot, ".runtime-smoke", "vector-lsp-bundle"),
      workspaceDir: path.join(repoRoot, ".runtime-smoke", "vector-lsp-workspace"),
      reportPath: path.join(repoRoot, ".runtime-smoke", "vector-lsp-smoke-result.json")
    };
    prepareStaging({ exePath: explicitExe, paths, requireContrib: true });
    assert.equal(existsSync(path.join(paths.stagingDir, "vector-lsp.exe")), true);
    assert.equal(existsSync(path.join(paths.stagingDir, "contrib", "schemas", "schema.json")), true);
    assert.equal(existsSync(path.join(paths.workspaceDir, "skills.txt")), true);
    assert.equal(existsSync(path.join(paths.workspaceDir, "data", "global", "excel", "upper.TXT")), true);
    assert.equal(existsSync(path.join(paths.workspaceDir, "data", "local", "lng", "strings")), true);
    assert.equal(existsSync(path.join(paths.workspaceDir, "data", "local", "lng", "strings", "item-names.json")), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
