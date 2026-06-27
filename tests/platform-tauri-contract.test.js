import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TableDocument } from "../src/core/table-model.js";
import {
  isTextInputTarget,
  shouldCloseSearchKey,
  shouldSubmitSearchKey
} from "../src/ui/search-policy.js";
import {
  closeWindow,
  getConfig,
  isTauriRuntime,
  lspCloseFile,
  lspDefinition,
  lspGetDiagnostics,
  lspHover,
  lspListen,
  lspLogListen,
  lspOpenFile,
  lspStart,
  lspUpdateFile,
  lspUpdateFileIncremental,
  openNativePathsBulk,
  openWorkspaceNative,
  pickFilePath,
  pickFolderPath,
  saveConfig,
  saveDocumentNative,
  saveTextNative
} from "../src/core/io.js";
import {
  applySavedTextPayload,
  documentFromTextPayload,
  documentOpenResultFromNativeRead,
  normalizeNativeReadResult
} from "../src/core/platform/file-payloads.js";
import { readNativeTextFiles } from "../src/core/platform/native-read.js";
import {
  legacyWorkspaceFileSignature,
  legacyWorkspaceIndexCacheHit,
  legacyWorkspaceLoadCacheHit,
  mergeOpenLegacyWorkspaceDocs
} from "../src/core/lint-workspace-index.js";
import {
  createDefaultLintSettings,
  lintRuleGroupsForProfile,
  runLint
} from "../src/core/lint-engine.js";

function lintDocs(docs, profile = "RotW") {
  const settings = createDefaultLintSettings();
  settings.profile = profile;
  return runLint(docs, settings);
}

function ruleIdsForProfile(profile) {
  return lintRuleGroupsForProfile(profile).flatMap((group) => group.rules.map((rule) => rule.id));
}

function releaseWorkflowSteps(workflow) {
  const matches = [...workflow.matchAll(/^      - name: (.+)$/gm)];
  return matches.map((match, index) => ({
    name: match[1].trim(),
    index,
    body: workflow.slice(match.index, matches[index + 1]?.index ?? workflow.length)
  }));
}

function releaseWorkflowStepByName(workflow, name) {
  const step = releaseWorkflowSteps(workflow).find((candidate) => candidate.name === name);
  assert.ok(step, `release workflow step is missing: ${name}`);
  return step;
}

test("Legacy Lint workspace loading uses bulk native reads and cache signatures", async () => {
  const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const rustFileIo = readFileSync(new URL("../src-tauri/src/file_io.rs", import.meta.url), "utf8");
  const rustWorkspaceFiles = readFileSync(new URL("../src-tauri/src/workspace_files.rs", import.meta.url), "utf8");
  const explorerFiles = [
    { path: "Data\\Items.txt", name: "Items.txt", modified_ms: 20, size: 300 },
    { path: "Data/Skills.txt", name: "Skills.txt", modifiedMs: 21, size: 301 }
  ];
  const signature = legacyWorkspaceFileSignature(explorerFiles);
  assert.equal(signature, ["data/items.txt:20:300", "data/skills.txt:21:301"].join("\u001f"));
  assert.equal(legacyWorkspaceLoadCacheHit({ status: "ready", signature }, signature), true);
  assert.equal(legacyWorkspaceLoadCacheHit({ status: "loading", signature }, signature), false);
  assert.deepEqual(legacyWorkspaceIndexCacheHit({ signature, profile: "RotW", index: { tables: [] } }, signature, "RotW"), {
    index: { tables: [] },
    ms: 0,
    cached: true
  });
  assert.equal(legacyWorkspaceIndexCacheHit({ signature, profile: "2.4", index: { tables: [] } }, signature, "RotW"), null);
  const workspaceDoc = TableDocument.fromText("Items.txt", "code\nold", { path: "Data/Items.txt" });
  const openDoc = TableDocument.fromText("Items.txt", "code\nopen", { path: "Data\\Items.txt" });
  const otherDoc = TableDocument.fromText("Skills.txt", "skill\n1", { path: "Data/Skills.txt" });
  assert.deepEqual(mergeOpenLegacyWorkspaceDocs([workspaceDoc, otherDoc], [openDoc]), [openDoc, otherDoc]);
  assert.match(rustFileIo, /fn read_text_files\(paths: Vec<String>\) -> Vec<Result<TextFilePayload, String>>/);
  assert.match(rust, /file_io::read_text_files,/);
  assert.match(rust, /workspace_files::list_workspace_files,/);
  assert.match(rustWorkspaceFiles, /modified_ms: Option<u64>/);
  const results = await openNativePathsBulk(["a.txt", "bad.txt"], TableDocument, async (command, args) => {
    assert.equal(command, "read_text_files");
    assert.deepEqual(args.paths, ["a.txt", "bad.txt"]);
    return [
      { Ok: { path: "a.txt", name: "a.txt", text: "col\n1\n", encoding: "utf-8" } },
      { Err: "failed to read" }
    ];
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].doc.name, "a.txt");
  assert.equal(results[0].bulkRead, true);
  assert.equal(results[1].error, "failed to read");
});

test("platform file payload helpers normalize native reads and saved document metadata", () => {
  assert.deepEqual(normalizeNativeReadResult(
    { Ok: { path: "a.txt", name: "a.txt", text: "id\n1", encoding: "utf-8" } },
    "fallback.txt",
    true
  ), {
    path: "a.txt",
    payload: { path: "a.txt", name: "a.txt", text: "id\n1", encoding: "utf-8" },
    bulkRead: true
  });
  assert.deepEqual(normalizeNativeReadResult({ Err: "nope" }, "fallback.txt", true), {
    path: "fallback.txt",
    error: "nope",
    bulkRead: true
  });
  assert.deepEqual(normalizeNativeReadResult({ ok: { name: "b.txt", text: "id\n2" } }, "fallback-b.txt", false), {
    path: "fallback-b.txt",
    payload: { name: "b.txt", text: "id\n2" },
    bulkRead: false
  });
  assert.deepEqual(normalizeNativeReadResult({ err: "bad" }, "fallback-c.txt", false), {
    path: "fallback-c.txt",
    error: "bad",
    bulkRead: false
  });
  assert.deepEqual(normalizeNativeReadResult({ path: "direct.txt", name: "direct.txt", text: "id\n3" }, "fallback-d.txt", true), {
    path: "direct.txt",
    payload: { path: "direct.txt", name: "direct.txt", text: "id\n3" },
    bulkRead: true
  });
  assert.deepEqual(normalizeNativeReadResult({}, "fallback-e.txt", true), {
    path: "fallback-e.txt",
    error: "Unexpected native read result.",
    bulkRead: true
  });

  const doc = documentFromTextPayload({
    path: "Data\\items.txt",
    name: "items.txt",
    text: "id\r\n1\r\n",
    encoding: "windows-1252"
  }, TableDocument);
  assert.equal(doc.path, "Data\\items.txt");
  assert.equal(doc.name, "items.txt");
  assert.equal(doc.encoding, "windows-1252");
  assert.equal(doc.dirty, false);
  assert.equal(doc.toText(), "id\r\n1\r\n");

  doc.dirty = true;
  applySavedTextPayload(doc, { path: "Data\\renamed.txt", name: "renamed.txt" });
  assert.equal(doc.path, "Data\\renamed.txt");
  assert.equal(doc.name, "renamed.txt");
  assert.equal(doc.dirty, false);

  const ticks = [10, 12.345, 20, 20.004];
  const opened = documentOpenResultFromNativeRead({
    path: "ok.txt",
    payload: { path: "ok.txt", name: "ok.txt", text: "id\n1", encoding: "utf-8" },
    bulkRead: true
  }, TableDocument, { now: () => ticks.shift() });
  assert.equal(opened.path, "ok.txt");
  assert.equal(opened.name, "ok.txt");
  assert.equal(opened.bulkRead, true);
  assert.equal(opened.parseMs, 2.35);
  assert.equal(opened.doc.toText(), "id\n1");
  assert.equal(opened.doc.dirty, false);

  const badDocumentType = {
    fromText() {
      throw new Error("parse failed");
    }
  };
  assert.deepEqual(documentOpenResultFromNativeRead({
    path: "bad.txt",
    payload: { path: "bad.txt", name: "bad.txt", text: "broken", encoding: "utf-8" },
    bulkRead: false
  }, badDocumentType, { now: () => ticks.shift() }), {
    path: "bad.txt",
    name: "bad.txt",
    bulkRead: false,
    parseMs: 0,
    error: "parse failed"
  });
  const readFailure = { path: "missing.txt", error: "read failed", bulkRead: true };
  assert.equal(documentOpenResultFromNativeRead(readFailure, TableDocument), readFailure);
});

test("native text file reads fall back from bulk command to per-file reads", async () => {
  const calls = [];
  const results = await readNativeTextFiles(["a.txt", "bad.txt"], async (command, args) => {
    calls.push([command, args]);
    if (command === "read_text_files") throw new Error("bulk unavailable");
    if (args.path === "bad.txt") throw new Error("single failed");
    return { path: args.path, name: args.path, text: "id\n1", encoding: "utf-8" };
  });

  assert.deepEqual(calls, [
    ["read_text_files", { paths: ["a.txt", "bad.txt"] }],
    ["read_text_file", { path: "a.txt" }],
    ["read_text_file", { path: "bad.txt" }]
  ]);
  assert.deepEqual(results, [
    { path: "a.txt", payload: { path: "a.txt", name: "a.txt", text: "id\n1", encoding: "utf-8" }, bulkRead: false },
    { path: "bad.txt", error: "single failed", bulkRead: false }
  ]);
  assert.deepEqual(await readNativeTextFiles([], async () => {
    throw new Error("should not invoke");
  }), []);
});

test("Tauri command boundary preserves JS invoke names and Rust registrations", () => {
  const platformSources = [
    "../src/core/platform/config.js",
    "../src/core/platform/file-io.js",
    "../src/core/platform/lsp-client.js",
    "../src/core/platform/native-read.js"
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const jsCommands = [...platformSources.matchAll(/(?:^|[^\w.])(?:api\.)?invoke\("([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
  const rustCommands = [...rust.matchAll(/\b[a-z_]+::([a-z_]+),/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual([...new Set(jsCommands)], [
    "close_window",
    "get_config",
    "list_workspace_files",
    "lsp_close_file",
    "lsp_definition",
    "lsp_get_diagnostics",
    "lsp_hover",
    "lsp_open_file",
    "lsp_start",
    "lsp_update_file",
    "lsp_update_file_incremental",
    "open_files_dialog",
    "open_folder_dialog",
    "pick_file_path",
    "read_text_file",
    "read_text_files",
    "save_config",
    "save_file_dialog",
    "write_text_file_safe"
  ]);
  assert.deepEqual([...new Set(rustCommands)], [...new Set(jsCommands)]);
});

test("Vector-LSP packaging contract keeps adjacent executable and contrib resources", () => {
  const rustLspService = readFileSync(new URL("../src-tauri/src/lsp_service.rs", import.meta.url), "utf8");
  const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

  assert.match(rustLspService, /std::env::current_exe\(\)/);
  assert.match(rustLspService, /candidates\.push\(dir\.join\(exe\)\)/);
  assert.match(rustLspService, /target\/x86_64-pc-windows-msvc\/release/);
  assert.match(releaseWorkflow, /"\.\.\/vector-lsp\/target\/x86_64-pc-windows-msvc\/release\/vector-lsp\.exe": "vector-lsp\.exe"/);
  assert.match(releaseWorkflow, /"\.\.\/vector-lsp\/contrib": "contrib"/);
  assert.match(releaseWorkflow, /VECTOR_LSP_REF: ff93bdb5954fffbe8d231902efe05f7181085afa/);
  assert.match(releaseWorkflow, /ref: \$\{\{ env\.VECTOR_LSP_REF \}\}/);
  assert.match(releaseWorkflow, /\$txteditorExe = "src-tauri\\target\\release\\txteditor\.exe"/);
  assert.match(releaseWorkflow, /Copy-Item \$txteditorExe "\$portableDir\\TXTeditor\.exe"/);
  assert.doesNotMatch(releaseWorkflow, /src-tauri\\target\\release\\TXTeditor\.exe/);
  assert.match(releaseWorkflow, /Copy-Item \$vlspExe \$portableDir/);
  assert.match(releaseWorkflow, /\$vlspContrib = "vector-lsp\\contrib"/);
  assert.match(releaseWorkflow, /Test-Path \$vlspContrib -PathType Container/);
  assert.match(releaseWorkflow, /Copy-Item \$vlspContrib "\$portableDir\\contrib" -Recurse/);
  assert.doesNotMatch(releaseWorkflow, /if \(Test-Path "vector-lsp\\contrib"\)/);
});

test("release workflow requires Vector-LSP smoke before packaging artifacts", () => {
  const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const runTests = releaseWorkflowStepByName(releaseWorkflow, "Run tests");
  const buildVectorLsp = releaseWorkflowStepByName(releaseWorkflow, "Build vector-lsp");
  const smokeGate = releaseWorkflowStepByName(releaseWorkflow, "Required Vector-LSP runtime smoke");
  const writeTauriConfig = releaseWorkflowStepByName(releaseWorkflow, "Write Tauri resource config");
  const buildTxteditor = releaseWorkflowStepByName(releaseWorkflow, "Build TXTeditor (Tauri + bundled vector-lsp)");
  const stageArtifacts = releaseWorkflowStepByName(releaseWorkflow, "Stage release artifacts");
  const uploadInstaller = releaseWorkflowStepByName(releaseWorkflow, "Upload installer artifact");

  assert.ok(runTests.index < buildVectorLsp.index, "portable npm test must run before the CI vector-lsp build");
  assert.ok(smokeGate.index > buildVectorLsp.index, "smoke gate must run after the CI vector-lsp build");
  assert.ok(smokeGate.index < writeTauriConfig.index, "smoke gate must run before Tauri resource config is written");
  assert.ok(smokeGate.index < buildTxteditor.index, "smoke gate must run before Tauri packaging");
  assert.ok(smokeGate.index < stageArtifacts.index, "smoke gate must run before release artifact staging");
  assert.ok(smokeGate.index < uploadInstaller.index, "smoke gate must run before installer upload");
  assert.match(runTests.body, /^\s*run: npm test$/m);
  assert.doesNotMatch(runTests.body, /baseline-contract|TXTEDITOR_BASELINE_DIR/);
  assert.match(smokeGate.body, /npm run test:vector-lsp-smoke:required --/);
  assert.match(smokeGate.body, /\$vlspExe = \(Resolve-Path -LiteralPath "vector-lsp\\target\\x86_64-pc-windows-msvc\\release\\vector-lsp\.exe"\)\.Path/);
  assert.match(smokeGate.body, /\$vlspRoot = \(Resolve-Path -LiteralPath "vector-lsp"\)\.Path/);
  assert.match(smokeGate.body, /--vector-lsp-exe "\$vlspExe"/);
  assert.match(smokeGate.body, /--vector-lsp-root "\$vlspRoot"/);
  assert.match(smokeGate.body, /--timeout-ms 30000/);
  assert.doesNotMatch(smokeGate.body, /^\s*if:\s*/m);
  assert.doesNotMatch(smokeGate.body, /continue-on-error/i);
  assert.doesNotMatch(smokeGate.body, /npm run test:vector-lsp-smoke(?:\s|$| --)/);
  assert.doesNotMatch(smokeGate.body, /optional|not-run|missing-contrib|fallback/i);
  assert.doesNotMatch(smokeGate.body, /if\s*\(.*contrib|Test-Path.*contrib/i);
});

test("platform facade preserves Tauri command payload shapes", async () => {
  assert.equal(isTauriRuntime(), false);
  const originalWindow = globalThis.window;
  const calls = [];
  const responses = new Map([
    ["get_config", [{ lintMode: "advanced", schemaVersion: "3.2" }]],
    ["pick_file_path", ["E:\\Tools\\vector-lsp.exe"]],
    ["open_folder_dialog", ["E:\\PickedFolder", "E:\\Workspace"]],
    ["list_workspace_files", [{ path: "E:\\Workspace", files: [{ path: "E:\\Workspace\\items.txt", name: "items.txt" }] }]],
    ["save_file_dialog", ["E:\\SavedAs.txt", "E:\\Export.txt"]],
    ["lsp_get_diagnostics", [{ version: 2, diagnostics: [{ row: 1, column: 2, message: "warn" }] }]],
    ["lsp_hover", [{ contents: "hover" }]],
    ["lsp_definition", [{ uri: "file:///skills.txt", range: { start: { line: 0, character: 0 } } }]]
  ]);
  const invoke = async (command, args) => {
    calls.push(["invoke", command, args]);
    if (command === "write_text_file_safe") return { path: args.path, name: args.path.split(/[/\\]/).pop() };
    const queue = responses.get(command) ?? [];
    return queue.length ? queue.shift() : undefined;
  };
  const listen = async (event, callback) => {
    calls.push(["listen", event]);
    callback({ payload: { event } });
    return () => calls.push(["unlisten", event]);
  };

  globalThis.window = {
    __TAURI__: {
      core: { invoke },
      event: { listen, TauriEvent: { DRAG_DROP: "tauri://drag-drop" } }
    }
  };

  try {
    assert.equal(isTauriRuntime(), true);
    assert.deepEqual(await getConfig(), { lintMode: "advanced", schemaVersion: "3.2" });
    await saveConfig({ lintMode: "basic" });
    assert.equal(await pickFilePath(), "E:\\Tools\\vector-lsp.exe");
    assert.equal(await pickFolderPath(), "E:\\PickedFolder");
    await closeWindow();
    assert.deepEqual(await openWorkspaceNative(), {
      path: "E:\\Workspace",
      files: [{ path: "E:\\Workspace\\items.txt", name: "items.txt" }]
    });

    const existingDoc = TableDocument.fromText("items.txt", "id\n1", { path: "E:\\items.txt" });
    existingDoc.dirty = true;
    assert.equal(await saveDocumentNative(existingDoc, false), true);
    assert.equal(existingDoc.path, "E:\\items.txt");
    assert.equal(existingDoc.name, "items.txt");
    assert.equal(existingDoc.dirty, false);

    const saveAsDoc = TableDocument.fromText("items.txt", "id\n2");
    saveAsDoc.dirty = true;
    assert.equal(await saveDocumentNative(saveAsDoc, true), true);
    assert.equal(saveAsDoc.path, "E:\\SavedAs.txt");
    assert.equal(saveAsDoc.name, "SavedAs.txt");
    assert.equal(saveAsDoc.dirty, false);
    assert.equal(await saveTextNative("export.txt", "id\n3"), true);

    await lspStart("E:\\Workspace");
    await lspOpenFile("file:///items.txt", "id\n1", 1);
    await lspUpdateFile("file:///items.txt", 2, "id\n2");
    await lspUpdateFileIncremental("file:///items.txt", 3, [{ range: { start: { line: 0, character: 0 } }, text: "id" }]);
    await lspCloseFile("file:///items.txt");
    assert.deepEqual(await lspGetDiagnostics("file:///items.txt"), { version: 2, diagnostics: [{ row: 1, column: 2, message: "warn" }] });
    assert.deepEqual(await lspHover("file:///items.txt", 4, 5), { contents: "hover" });
    assert.deepEqual(await lspDefinition("file:///items.txt", 6, 7), { uri: "file:///skills.txt", range: { start: { line: 0, character: 0 } } });
    const diagnosticsEvents = [];
    const logEvents = [];
    const unlistenDiagnostics = await lspListen((payload) => diagnosticsEvents.push(payload));
    const unlistenLog = await lspLogListen((payload) => logEvents.push(payload));
    unlistenDiagnostics();
    unlistenLog();

    assert.deepEqual(diagnosticsEvents, [{ event: "lsp-diagnostics-changed" }]);
    assert.deepEqual(logEvents, [{ event: "lsp-log" }]);
    assert.deepEqual(calls, [
      ["invoke", "get_config", undefined],
      ["invoke", "save_config", { config: { lintMode: "basic" } }],
      ["invoke", "pick_file_path", undefined],
      ["invoke", "open_folder_dialog", undefined],
      ["invoke", "close_window", undefined],
      ["invoke", "open_folder_dialog", undefined],
      ["invoke", "list_workspace_files", { path: "E:\\Workspace" }],
      ["invoke", "write_text_file_safe", { path: "E:\\items.txt", text: "id\n1", encoding: "utf-8" }],
      ["invoke", "save_file_dialog", { defaultName: "items.txt" }],
      ["invoke", "write_text_file_safe", { path: "E:\\SavedAs.txt", text: "id\n2", encoding: "utf-8" }],
      ["invoke", "save_file_dialog", { defaultName: "export.txt" }],
      ["invoke", "write_text_file_safe", { path: "E:\\Export.txt", text: "id\n3", encoding: "utf-8" }],
      ["invoke", "lsp_start", { workspacePath: "E:\\Workspace" }],
      ["invoke", "lsp_open_file", { uri: "file:///items.txt", text: "id\n1", version: 1 }],
      ["invoke", "lsp_update_file", { uri: "file:///items.txt", version: 2, text: "id\n2" }],
      ["invoke", "lsp_update_file_incremental", { uri: "file:///items.txt", version: 3, changes: [{ range: { start: { line: 0, character: 0 } }, text: "id" }] }],
      ["invoke", "lsp_close_file", { uri: "file:///items.txt" }],
      ["invoke", "lsp_get_diagnostics", { uri: "file:///items.txt" }],
      ["invoke", "lsp_hover", { uri: "file:///items.txt", line: 4, character: 5 }],
      ["invoke", "lsp_definition", { uri: "file:///items.txt", line: 6, character: 7 }],
      ["listen", "lsp-diagnostics-changed"],
      ["listen", "lsp-log"],
      ["unlisten", "lsp-diagnostics-changed"],
      ["unlisten", "lsp-log"]
    ]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Find UI is a centered modal and text inputs keep native shortcuts", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(html, /id="searchPanel" class="modal-backdrop search-backdrop hidden"/);
  assert.match(html, /class="modal search-modal"/);
  assert.match(html, /id="searchInput" class="modal-input"/);
  assert.match(html, /data-search-close/);
  assert.doesNotMatch(html, /id="searchPanel" class="quick-panel/);
  class FakeElement {
    constructor(match) {
      this.match = match;
      this.selector = "";
    }

    closest(selector) {
      this.selector = selector;
      return this.match ? this : null;
    }
  }
  const inputTarget = new FakeElement(true);
  assert.equal(isTextInputTarget(inputTarget, FakeElement), true);
  assert.equal(inputTarget.selector, "input, textarea, select, [contenteditable=''], [contenteditable='true']");
  assert.equal(isTextInputTarget(new FakeElement(false), FakeElement), false);
  assert.equal(isTextInputTarget({}, FakeElement), false);
  assert.equal(shouldSubmitSearchKey("Enter"), true);
  assert.equal(shouldSubmitSearchKey("Escape"), false);
  assert.equal(shouldCloseSearchKey("Escape"), true);
  assert.equal(shouldCloseSearchKey("Enter"), false);
  assert.match(css, /\.modal-backdrop\s*\{[\s\S]*align-items: center;[\s\S]*justify-content: center;/);
  assert.match(css, /\.search-modal\s*\{/);
});
