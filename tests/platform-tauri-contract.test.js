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
  lspFieldMetadata,
  lspGetDiagnostics,
  lspGetDiagnosticsBatch,
  lspHover,
  lspListen,
  lspLogListen,
  lspOpenFile,
  lspReadyListen,
  lspStart,
  lspStop,
  lspStoppedListen,
  lspUpdateFile,
  lspUpdateFileIncremental,
  listSiblingTextFilesNative,
  listWorkspaceNative,
  loadLintReferenceDataset,
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
  documentFromTextPayloadAsync,
  documentFromTextPayload,
  normalizeNativeReadResult
} from "../src/core/platform/file-payloads.js";
import { LARGE_FILE_THRESHOLDS } from "../src/core/large-file-policy.js";
import { tableFileState } from "../src/core/table-file-state.js";
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

});

test("large file payloads can parse through a worker before document construction", async () => {
  const originalWorker = globalThis.Worker;
  const calls = [];
  globalThis.Worker = class FakeWorker {
    constructor(url, options) {
      calls.push({ url: String(url), options, terminated: false });
    }

    postMessage(message, transfer) {
      calls.at(-1).message = { ...message, buffer: Boolean(message.buffer) };
      calls.at(-1).transferLength = transfer.length;
      queueMicrotask(() => this.onmessage?.({
        data: {
          id: message.id,
          parsed: { rows: [["id"], ["1"]], lineEnding: "\n", finalNewline: false },
          encoding: "utf-8",
          fileSizeBytes: message.fileSizeBytes
        }
      }));
    }

    terminate() {
      calls.at(-1).terminated = true;
    }
  };

  try {
    const doc = await documentFromTextPayloadAsync({
      path: "huge.txt",
      name: "huge.txt",
      text: "worker should replace this text",
      encoding: "utf-8",
      fileSizeBytes: LARGE_FILE_THRESHOLDS.fileSizeBytes
    }, TableDocument);

    assert.equal(doc.toText(), "id\n1");
    assert.equal(doc.fileSizeBytes, LARGE_FILE_THRESHOLDS.fileSizeBytes);
    assert.equal(doc.largeFileMode, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.type, "module");
    assert.equal(calls[0].terminated, true);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test("Tauri command boundary preserves JS invoke names and Rust registrations", () => {
  const platformSources = [
    "../src/ui/app-runtime-utils.js",
    "../src/core/platform/config.js",
    "../src/core/platform/file-io.js",
    "../src/core/platform/lsp-client.js",
    "../src/core/platform/native-read.js"
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const jsCommands = [...platformSources.matchAll(/(?:^|[^\w.])(?:api\.)?invoke\("([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
  const rustHandler = rust.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1] ?? "";
  const rustCommands = [...rustHandler.matchAll(/\b[a-z_]+::([a-z_]+),/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual([...new Set(jsCommands)], [
    "close_window",
    "get_config",
    "list_sibling_txt_files",
    "list_workspace_files",
    "load_lint_reference_dataset",
    "lsp_close_file",
    "lsp_definition",
    "lsp_field_metadata",
    "lsp_get_diagnostics",
    "lsp_get_diagnostics_batch",
    "lsp_hover",
      "lsp_open_file",
      "lsp_start",
      "lsp_stop",
      "lsp_update_file",
    "lsp_update_file_incremental",
    "open_files_dialog",
    "open_folder_dialog",
    "pick_file_path",
    "read_clipboard_text",
    "read_text_files",
    "save_config",
    "save_file_dialog",
    "startup_open_paths",
    "take_pending_open_paths",
    "write_clipboard_text",
    "write_text_file_chunk_safe",
    "write_text_file_safe"
  ]);
  assert.deepEqual([...new Set(rustCommands)], [...new Set(jsCommands)]);
});

test("native exit explicitly reaps active and starting Vector-LSP children", () => {
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const bootstrap = readFileSync(new URL("../src-tauri/src/app_bootstrap.rs", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src-tauri/src/lsp_service.rs", import.meta.url), "utf8");

  assert.match(lib, /tauri::RunEvent::Exit/);
  assert.match(lib, /state::<lsp_service::LspManager>\(\)\.shutdown\(\)/);
  assert.match(bootstrap, /lsp_manager\.shutdown\(\);[\s\S]*window\.destroy\(\)/);
  assert.match(service, /starting: HashMap<u64, Child>/);
  assert.match(service, /shutdown_requested: AtomicBool/);
  assert.match(service, /fn shutdown_lsp_manager\(/);
});

test("Vector-LSP packaging contract keeps adjacent executable and contrib resources", () => {
  const rustLspService = readFileSync(new URL("../src-tauri/src/lsp_service.rs", import.meta.url), "utf8");
  const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

  assert.match(rustLspService, /std::env::current_exe\(\)/);
  assert.match(rustLspService, /candidates\.push\(dir\.join\(exe\)\)/);
  assert.match(releaseWorkflow, /repository:\s+yinyin333333\/vector-lsp/);
  assert.doesNotMatch(releaseWorkflow, /repository:\s+eezstreet\/vector-lsp/);
  assert.match(releaseWorkflow, /"\.\.\/vector-lsp\/target\/x86_64-pc-windows-msvc\/release\/vector-lsp\.exe": "vector-lsp\.exe"/);
  assert.match(releaseWorkflow, /"\.\.\/vector-lsp\/contrib": "contrib"/);
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
    ["load_lint_reference_dataset", [{ gameVersion: "3.2", canonicalSha256: "verified", files: [] }]],
    ["pick_file_path", ["E:\\Tools\\vector-lsp.exe"]],
    ["open_folder_dialog", ["E:\\PickedFolder", "E:\\Workspace"]],
    ["list_workspace_files", [
      { path: "E:\\Workspace", files: [{ path: "E:\\Workspace\\items.txt", name: "items.txt" }] },
      { path: "E:\\Workspace", files: [{ path: "E:\\Workspace\\items.txt", name: "items.txt" }] },
      { path: "E:\\Workspace", files: [{ path: "E:\\Workspace\\items.txt", name: "items.txt" }] }
    ]],
    ["list_sibling_txt_files", [{
      path: "E:\\Mod\\global\\excel",
      files: [{ path: "E:\\Mod\\global\\excel\\ItemTypes.txt", name: "ItemTypes.txt" }]
    }]],
    ["save_file_dialog", ["E:\\SavedAs.txt", "E:\\Export.txt"]],
    ["lsp_get_diagnostics", [[{ row: 1, column: 2, message: "warn" }]]],
    ["lsp_get_diagnostics_batch", [[{
      generation: 7,
      uri: "file:///items.txt",
      sequence: 9,
      diagnostics: [{ row: 1, column: 2, message: "warn" }]
    }]]],
    ["lsp_hover", [{ contents: "hover" }]],
    ["lsp_field_metadata", [{ fieldType: "parse", maxLength: 255, source: "schema" }]],
    ["lsp_definition", [{ uri: "file:///skills.txt", range: { start: { line: 0, character: 0 } } }]]
  ]);
  const invoke = async (command, args) => {
    calls.push(["invoke", command, args]);
    if (command === "write_text_file_safe" || command === "write_text_file_chunk_safe") return { path: args.path, name: args.path.split(/[/\\]/).pop() };
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
    assert.deepEqual(await loadLintReferenceDataset("3.2"), { gameVersion: "3.2", canonicalSha256: "verified", files: [] });
    await saveConfig({ lintMode: "basic" });
    assert.equal(await pickFilePath(), "E:\\Tools\\vector-lsp.exe");
    assert.equal(await pickFolderPath(), "E:\\PickedFolder");
    await closeWindow();
    assert.deepEqual(await openWorkspaceNative(), {
      path: "E:\\Workspace",
      files: [{ path: "E:\\Workspace\\items.txt", name: "items.txt" }]
    });
    assert.deepEqual(await listWorkspaceNative("E:\\Workspace"), {
      path: "E:\\Workspace",
      files: [{ path: "E:\\Workspace\\items.txt", name: "items.txt" }]
    });
    assert.deepEqual(await listWorkspaceNative("E:\\Workspace", null, { includeSubfolders: false }), {
      path: "E:\\Workspace",
      files: [{ path: "E:\\Workspace\\items.txt", name: "items.txt" }]
    });
    assert.deepEqual(await listSiblingTextFilesNative("E:\\Mod\\global\\excel\\MagicPrefix.txt"), {
      path: "E:\\Mod\\global\\excel",
      files: [{ path: "E:\\Mod\\global\\excel\\ItemTypes.txt", name: "ItemTypes.txt" }]
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

    await lspStart("E:\\Workspace", 7);
    await lspStart("E:\\Mod\\TXT", 8, "sibling", "E:\\Workspace", true, "koKR");
    await lspStart("E:\\Workspace", 9, "workspace", "", false);
    await lspStop(9);
    await lspOpenFile("file:///items.txt", 1, "id\n1", 7);
    await lspUpdateFile("file:///items.txt", 2, "id\n2", 7);
    await lspUpdateFileIncremental("file:///items.txt", 3, [{ range: { start: { line: 0, character: 0 } }, text: "id" }], 7);
    await lspCloseFile("file:///items.txt", 7);
    assert.deepEqual(await lspGetDiagnostics("file:///items.txt", 7, 9), [{ row: 1, column: 2, message: "warn" }]);
    assert.deepEqual(await lspGetDiagnosticsBatch([{ uri: "file:///items.txt", sequence: 9 }], 7), [{
      generation: 7,
      uri: "file:///items.txt",
      sequence: 9,
      diagnostics: [{ row: 1, column: 2, message: "warn" }]
    }]);
    assert.deepEqual(await lspHover("file:///items.txt", 4, 5, 7), { contents: "hover" });
    assert.deepEqual(await lspFieldMetadata("file:///items.txt", "calc1", 7), { fieldType: "parse", maxLength: 255, source: "schema" });
    assert.deepEqual(await lspDefinition("file:///items.txt", 6, 7, 7), { uri: "file:///skills.txt", range: { start: { line: 0, character: 0 } } });
    const diagnosticsEvents = [];
    const logEvents = [];
    const readyEvents = [];
    const stoppedEvents = [];
    const unlistenDiagnostics = await lspListen((payload) => diagnosticsEvents.push(payload));
    const unlistenLog = await lspLogListen((payload) => logEvents.push(payload));
    const unlistenReady = await lspReadyListen((payload) => readyEvents.push(payload));
    const unlistenStopped = await lspStoppedListen((payload) => stoppedEvents.push(payload));
    unlistenDiagnostics();
    unlistenLog();
    unlistenReady();
    unlistenStopped();

    assert.deepEqual(diagnosticsEvents, [{ event: "lsp-diagnostics-changed" }]);
    assert.deepEqual(logEvents, [{ event: "lsp-log" }]);
    assert.deepEqual(readyEvents, [{ event: "lsp-ready" }]);
    assert.deepEqual(stoppedEvents, [{ event: "lsp-stopped" }]);
    const chunkTransactionIds = calls
      .filter((call) => call[0] === "invoke" && call[1] === "write_text_file_chunk_safe")
      .map((call) => call[2].transactionId);
    assert.equal(chunkTransactionIds.length, 2);
    assert.equal(chunkTransactionIds.every((value) => typeof value === "string" && value.length > 0), true);
    assert.notEqual(chunkTransactionIds[0], chunkTransactionIds[1]);
    assert.deepEqual(calls, [
      ["invoke", "get_config", undefined],
      ["invoke", "load_lint_reference_dataset", { gameVersion: "3.2" }],
      ["invoke", "save_config", { config: { lintMode: "basic" } }],
      ["invoke", "pick_file_path", undefined],
      ["invoke", "open_folder_dialog", undefined],
      ["invoke", "close_window", undefined],
      ["invoke", "open_folder_dialog", undefined],
      ["invoke", "list_workspace_files", { path: "E:\\Workspace" }],
      ["invoke", "list_workspace_files", { path: "E:\\Workspace" }],
      ["invoke", "list_workspace_files", { path: "E:\\Workspace", includeSubfolders: false }],
      ["invoke", "list_sibling_txt_files", { path: "E:\\Mod\\global\\excel\\MagicPrefix.txt" }],
      ["invoke", "write_text_file_chunk_safe", { path: "E:\\items.txt", text: "id\n1", encoding: "utf-8", transactionId: chunkTransactionIds[0], first: true, last: true }],
      ["invoke", "save_file_dialog", { defaultName: "items.txt" }],
      ["invoke", "write_text_file_chunk_safe", { path: "E:\\SavedAs.txt", text: "id\n2", encoding: "utf-8", transactionId: chunkTransactionIds[1], first: true, last: true }],
      ["invoke", "save_file_dialog", { defaultName: "export.txt" }],
      ["invoke", "write_text_file_safe", { path: "E:\\Export.txt", text: "id\n3", encoding: "utf-8" }],
      ["invoke", "lsp_start", { workspacePath: "E:\\Workspace", generation: 7, locale: "enUS" }],
      ["invoke", "lsp_start", { workspacePath: "E:\\Mod\\TXT", contextMode: "sibling", referenceRootPath: "E:\\Workspace", generation: 8, locale: "koKR" }],
      ["invoke", "lsp_start", { workspacePath: "E:\\Workspace", includeSubfolders: false, generation: 9, locale: "enUS" }],
      ["invoke", "lsp_stop", { generation: 9 }],
      ["invoke", "lsp_open_file", { uri: "file:///items.txt", version: 1, text: "id\n1", generation: 7 }],
      ["invoke", "lsp_update_file", { uri: "file:///items.txt", version: 2, text: "id\n2", generation: 7 }],
      ["invoke", "lsp_update_file_incremental", { uri: "file:///items.txt", version: 3, changes: [{ range: { start: { line: 0, character: 0 } }, text: "id" }], generation: 7 }],
      ["invoke", "lsp_close_file", { uri: "file:///items.txt", generation: 7 }],
      ["invoke", "lsp_get_diagnostics", { uri: "file:///items.txt", generation: 7, sequence: 9 }],
      ["invoke", "lsp_get_diagnostics_batch", { requests: [{ uri: "file:///items.txt", sequence: 9 }], generation: 7 }],
      ["invoke", "lsp_hover", { uri: "file:///items.txt", line: 4, character: 5, generation: 7 }],
      ["invoke", "lsp_field_metadata", { uri: "file:///items.txt", columnName: "calc1", generation: 7 }],
      ["invoke", "lsp_definition", { uri: "file:///items.txt", line: 6, character: 7, generation: 7 }],
      ["listen", "lsp-diagnostics-changed"],
      ["listen", "lsp-log"],
      ["listen", "lsp-ready"],
      ["listen", "lsp-stopped"],
      ["unlisten", "lsp-diagnostics-changed"],
      ["unlisten", "lsp-log"],
      ["unlisten", "lsp-ready"],
      ["unlisten", "lsp-stopped"]
    ]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("native save leaves dirty set when content changes during the write", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("items.txt", "id\nold", { path: "E:\\items.txt", dirty: true });
  const writes = [];

  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          assert.equal(command, "write_text_file_chunk_safe");
          const gate = deferredPlatformWrite();
          writes.push({ args, gate });
          await gate.promise;
          return { path: args.path, name: "items.txt" };
        }
      }
    }
  };

  try {
    const saving = saveDocumentNative(doc, false);
    await waitForPlatformWrite(() => writes.length === 1);
    assert.equal(writes[0].args.text, "id\nold");
    assert.deepEqual([writes[0].args.first, writes[0].args.last], [true, true]);
    doc.setCell(1, 0, "new");
    writes[0].gate.resolve();

    assert.equal(await saving, true);
    assert.equal(doc.dirty, true);
    assert.equal(doc.toText(), "id\nnew");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("native document save streams chunks without full serialization", async () => {
  const originalWindow = globalThis.window;
  const text = Array.from({ length: 2505 }, (_, index) => index === 0 ? "id" : String(index)).join("\n");
  const doc = TableDocument.fromText("items.txt", text, { path: "E:\\items.txt", dirty: true });
  const expected = doc.toText();
  const writes = [];
  doc.toText = () => {
    throw new Error("native document save should stream chunks instead of calling toText");
  };

  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          assert.equal(command, "write_text_file_chunk_safe");
          writes.push(args);
          return args.last ? { path: args.path, name: "items.txt" } : null;
        }
      }
    }
  };

  try {
    assert.equal(await saveDocumentNative(doc, false), true);
    assert.ok(writes.length > 1);
    assert.deepEqual(writes.map((write) => write.first), [true, ...Array.from({ length: writes.length - 1 }, () => false)]);
    assert.equal(writes.at(-1).last, true);
    assert.equal(writes.map((write) => write.text).join(""), expected);
    assert.equal(doc.dirty, false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("saved native payload does not clear dirty for a stale document revision", () => {
  const doc = TableDocument.fromText("items.txt", "id\nold", { path: "E:\\items.txt", dirty: true });
  const savingRevision = tableFileState(doc).revision;
  doc.setCell(1, 0, "new");

  applySavedTextPayload(doc, { path: "E:\\renamed.txt", name: "renamed.txt" }, savingRevision);

  assert.equal(doc.path, "E:\\renamed.txt");
  assert.equal(doc.name, "renamed.txt");
  assert.equal(doc.dirty, true);
  assert.equal(doc.toText(), "id\nnew");
});

test("native save as cancel leaves dirty set and does not write", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("items.txt", "id\nold", { dirty: true });
  const calls = [];

  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          assert.equal(command, "save_file_dialog");
          return null;
        }
      }
    }
  };

  try {
    assert.equal(await saveDocumentNative(doc, true), false);
    assert.equal(doc.dirty, true);
    assert.equal(doc.path, "");
    assert.deepEqual(calls, [["save_file_dialog", { defaultName: "items.txt" }]]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("native write failure leaves dirty set", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("items.txt", "id\nold", { path: "E:\\items.txt", dirty: true });

  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          assert.equal(command, "write_text_file_chunk_safe");
          assert.equal(typeof args.transactionId, "string");
          const { transactionId: _transactionId, ...payload } = args;
          assert.deepEqual(payload, { path: "E:\\items.txt", text: "id\nold", encoding: "utf-8", first: true, last: true });
          throw new Error("disk blocked");
        }
      }
    }
  };

  try {
    await assert.rejects(() => saveDocumentNative(doc, false), /disk blocked/);
    assert.equal(doc.dirty, true);
    assert.equal(doc.path, "E:\\items.txt");
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
  assert.match(html, /id="searchInput" class="modal-input" type="search"[^>]*autocomplete="off"[^>]*spellcheck="false"/);
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

function deferredPlatformWrite() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForPlatformWrite(condition) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(condition(), true);
}
