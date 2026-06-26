import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireBaselineDir } from "./baseline-paths.mjs";
import { isTextLikePath } from "../src/core/text-file-policy.js";
import { commandActionForId } from "../src/ui/command-registry.js";
import { renderWorkspaceFileList } from "../src/ui/workspace-file-list-policy.js";

const ROOT = process.cwd();
const BASELINE = requireBaselineDir({ currentRoot: ROOT });
const BASELINE_DIR = BASELINE.path;

async function loadPublicModules(root) {
  const suffix = `?baselineContract=${Date.now()}-${Math.random()}`;
  const table = await import(pathToFileURL(path.join(root, "src/core/table-model.js")).href + suffix);
  const lint = await import(pathToFileURL(path.join(root, "src/core/lint-engine.js")).href + suffix);
  return {
    TableDocument: table.TableDocument,
    createDefaultLintSettings: lint.createDefaultLintSettings,
    normalizeLintSettings: lint.normalizeLintSettings,
    runLint: lint.runLint,
    diagnosticsForDocument: lint.diagnosticsForDocument
  };
}

async function loadModuleNamespace(root, relativePath) {
  const suffix = `?baselineContract=${Date.now()}-${Math.random()}`;
  return import(pathToFileURL(path.join(root, relativePath)).href + suffix);
}

function makeDocs(api, entries) {
  return entries.map(([name, text]) => api.TableDocument.fromText(name, text, { path: `E:/baseline-fixtures/${name}` }));
}

function normalizeDoc(doc) {
  return {
    name: doc.name,
    path: doc.path,
    rows: doc.rows,
    lineEnding: doc.lineEnding,
    finalNewline: doc.finalNewline,
    dirty: doc.dirty,
    hiddenRows: [...doc.hiddenRows],
    hiddenColumns: [...doc.hiddenColumns],
    columnWidths: doc.columnWidths,
    rowHeights: doc.rowHeights,
    rowCount: doc.rowCount,
    columnCount: doc.columnCount,
    text: doc.toText()
  };
}

function normalizeDiagnostics(diagnostics) {
  return diagnostics.map((item) => ({
    id: item.id,
    ruleId: item.ruleId,
    severity: item.severity,
    message: item.message,
    table: item.table,
    fileKey: item.fileKey,
    fileName: item.fileName,
    rowIndex: item.rowIndex,
    columnIndex: item.columnIndex,
    columnName: item.columnName,
    rowLabel: item.rowLabel,
    locationLabel: item.locationLabel,
    d2rMessage: item.d2rMessage,
    offendingValue: item.offendingValue
  }));
}

function compareTableBehavior(name, baselineApi, currentApi, text) {
  const baselineDoc = baselineApi.TableDocument.fromText(`${name}.txt`, text, { path: `E:/baseline-fixtures/${name}.txt` });
  const currentDoc = currentApi.TableDocument.fromText(`${name}.txt`, text, { path: `E:/baseline-fixtures/${name}.txt` });
  assert.deepEqual(normalizeDoc(currentDoc), normalizeDoc(baselineDoc), `${name}: parse/no-op serialize changed`);

  baselineDoc.setCell(1, 1, "changed");
  currentDoc.setCell(1, 1, "changed");
  assert.deepEqual(normalizeDoc(currentDoc), normalizeDoc(baselineDoc), `${name}: setCell behavior changed`);

  baselineDoc.insertRow(2, ["new", "row"]);
  currentDoc.insertRow(2, ["new", "row"]);
  assert.deepEqual(normalizeDoc(currentDoc), normalizeDoc(baselineDoc), `${name}: insertRow behavior changed`);

  baselineDoc.insertColumn(1, "Inserted");
  currentDoc.insertColumn(1, "Inserted");
  assert.deepEqual(normalizeDoc(currentDoc), normalizeDoc(baselineDoc), `${name}: insertColumn behavior changed`);

  baselineDoc.deleteRows(1, 1);
  currentDoc.deleteRows(1, 1);
  assert.deepEqual(normalizeDoc(currentDoc), normalizeDoc(baselineDoc), `${name}: deleteRows behavior changed`);

  baselineDoc.deleteColumns(1, 1);
  currentDoc.deleteColumns(1, 1);
  assert.deepEqual(normalizeDoc(currentDoc), normalizeDoc(baselineDoc), `${name}: deleteColumns behavior changed`);
}

function compareLintFixture(name, baselineApi, currentApi, entries, profile = "RotW") {
  const baselineDocs = makeDocs(baselineApi, entries);
  const currentDocs = makeDocs(currentApi, entries);
  const baselineSettings = baselineApi.normalizeLintSettings({ enabled: true, profile });
  const currentSettings = currentApi.normalizeLintSettings({ enabled: true, profile });
  const baselineDiagnostics = normalizeDiagnostics(baselineApi.runLint(baselineDocs, baselineSettings));
  const currentDiagnostics = normalizeDiagnostics(currentApi.runLint(currentDocs, currentSettings));
  assert.deepEqual(currentDiagnostics, baselineDiagnostics, `${name}: lint diagnostics changed`);
  return { baselineDiagnostics, currentDiagnostics };
}

function assertPlatformContract() {
  const lspClient = fs.readFileSync(path.join(ROOT, "src/core/platform/lsp-client.js"), "utf8");
  const fileIo = fs.readFileSync(path.join(ROOT, "src/core/platform/file-io.js"), "utf8");
  const rustLib = fs.readFileSync(path.join(ROOT, "src-tauri/src/lib.rs"), "utf8");
  const required = {
    lsp_start: ["workspacePath"],
    lsp_open_file: ["uri", "text"],
    lsp_update_file: ["uri", "version", "text"],
    lsp_update_file_incremental: ["uri", "version", "changes"],
    lsp_close_file: ["uri"],
    lsp_get_diagnostics: ["uri"],
    lsp_hover: ["uri", "line", "character"],
    lsp_definition: ["uri", "line", "character"],
    open_files_dialog: [],
    open_folder_dialog: [],
    save_file_dialog: ["defaultName"],
    read_text_files: ["paths"],
    list_workspace_files: ["path"],
    write_text_file_safe: ["path", "text"],
    get_config: [],
    save_config: [],
    pick_file_path: []
  };
  const combined = `${lspClient}\n${fileIo}\n${rustLib}`;
  for (const [command, keys] of Object.entries(required)) {
    assert.match(combined, new RegExp(command), `missing Tauri command ${command}`);
    for (const key of keys) {
      assert.match(combined, new RegExp(`\\b${key}\\b`), `missing payload key ${command}.${key}`);
    }
  }
}

function extractFunctionSource(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing baseline function ${name}`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `missing baseline function body ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated baseline function ${name}`);
}

function baselineAppFunction(root, name) {
  const appSource = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const functionSource = extractFunctionSource(appSource, name);
  return (...args) => Function(
    "state",
    "collapsedFileGroups",
    "lintPathKey",
    "escapeHtml",
    "problemBadgeForPath",
    "args",
    `${functionSource}; return ${name}(...args);`
  )(...args);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lintPathKey(pathValue) {
  return String(pathValue || "").replace(/\\/g, "/").toLowerCase();
}

function compareWorkspaceExplorerBehavior() {
  const workspace = {
    path: "E:/Game/Data",
    files: [
      { name: "armor.txt", path: "E:/Game/Data/armor.txt" },
      { name: "weapons.txt", path: "E:/Game/Data/weapons.txt" },
      { name: "skills<bad>.txt", path: "E:/Game/Data/skills<bad>.txt" },
      { name: "fallen.txt", path: "E:/Game/Data/monsters/fallen.txt" },
      { name: "quote.txt", path: "E:/Game/Data/quoted\"dir/quote.txt" }
    ]
  };
  const docs = [{ name: "armor.txt", path: "E:/Game/Data/armor.txt" }];
  const collapsedFileGroups = new Set(["monsters"]);
  const problemBadgeForPath = (pathValue) => pathValue.endsWith("weapons.txt")
    ? ` <span class="file-problem-badge">2</span>`
    : "";
  const state = { workspace };
  const baselineRenderWorkspaceFileList = baselineAppFunction(BASELINE_DIR, "renderWorkspaceFileList");
  const baselineHtml = baselineRenderWorkspaceFileList(
    state,
    collapsedFileGroups,
    lintPathKey,
    escapeHtml,
    problemBadgeForPath,
    [docs]
  );
  const currentHtml = renderWorkspaceFileList({
    workspace,
    docs,
    collapsedFileGroups,
    pathKey: lintPathKey,
    escapeHtml,
    problemBadgeForPath
  });
  assert.equal(currentHtml, baselineHtml, "workspace Explorer file-list rendering changed");
  return { baselineHtml, currentHtml };
}

function compareTextFilePolicy() {
  const baselineIsTextLikePath = baselineAppFunction(BASELINE_DIR, "isTextLikePath");
  const paths = [
    "E:/Game/Data/armor.txt",
    "skills.TSV",
    "levels.tbl",
    "inventory.csv",
    "notes.txt.bak",
    "config.json",
    ""
  ];
  for (const pathValue of paths) {
    assert.equal(
      isTextLikePath(pathValue),
      baselineIsTextLikePath({}, new Set(), lintPathKey, escapeHtml, () => "", [pathValue]),
      `text-like path behavior changed for ${pathValue}`
    );
  }
}

function assertCommandToggleHandlers() {
  const baselineApp = fs.readFileSync(path.join(BASELINE_DIR, "src/app.js"), "utf8");
  for (const id of ["show-explorer", "show-problems", "toggle-sidebar"]) {
    assert.match(baselineApp, new RegExp(`["']${id}["']`), `baseline missing command ${id}`);
  }
  assert.deepEqual(commandActionForId("show-explorer"), { type: "handler", name: "toggleExplorerPane" });
  assert.deepEqual(commandActionForId("show-problems"), { type: "handler", name: "toggleProblemsPanel" });
  assert.deepEqual(commandActionForId("toggle-sidebar"), { type: "handler", name: "toggleSidebar" });
}

function runStartupSmoke(root) {
  execFileSync(process.execPath, [path.join(ROOT, "scripts/app-startup-smoke.mjs"), "--root", root], {
    cwd: ROOT,
    stdio: "pipe",
    windowsHide: true
  });
}

async function assertPublicFacadeExports() {
  for (const relativePath of ["src/core/io.js", "src/core/lint-engine.js", "src/core/table-model.js"]) {
    const baselineModule = await loadModuleNamespace(BASELINE_DIR, relativePath);
    const currentModule = await loadModuleNamespace(ROOT, relativePath);
    for (const exportName of Object.keys(baselineModule)) {
      assert.ok(exportName in currentModule, `${relativePath} no longer exports ${exportName}`);
    }
  }

  const { CanvasGrid } = await loadModuleNamespace(ROOT, "src/ui/canvas-grid.js");
  const requiredGridMethods = [
    "setDocument",
    "setFontFamily",
    "setColorizeColumns",
    "setVectorLspHoverEnabled",
    "setHoverSuspended",
    "setDiagnostics",
    "layout",
    "requestRender",
    "draw",
    "hitTest",
    "setZoom",
    "zoomReset",
    "autoFitInitialColumns",
    "editingCell",
    "scrollCellIntoView"
  ];
  const currentMethods = new Set(Object.getOwnPropertyNames(CanvasGrid.prototype));
  for (const method of requiredGridMethods) {
    assert.ok(currentMethods.has(method), `CanvasGrid no longer exposes ${method}`);
  }
}

const baselineApi = await loadPublicModules(BASELINE_DIR);
const currentApi = await loadPublicModules(ROOT);

const tableFixtures = [
  ["crlf-final-newline", "code\tname\r\nabc\tOne\r\nxyz\tTwo\r\n"],
  ["ragged-no-final-newline", "id\tvalue\n1\talpha\n2"]
];
for (const [name, text] of tableFixtures) compareTableBehavior(name, baselineApi, currentApi, text);

const lintResults = [
  ["legacy-duplicate", compareLintFixture("legacy-duplicate", baselineApi, currentApi, [
    ["weapons.txt", "code\ttype\naxe\taxe\naxe\taxe\n"]
  ])],
  ["missing-invalid-fields", compareLintFixture("missing-invalid-fields", baselineApi, currentApi, [
    ["weapons.txt", "type\naxe\n"],
    ["misc.txt", "code\tautobelt\nabc\t2\n"]
  ])],
  ["invalid-cross-file-references", compareLintFixture("invalid-cross-file-references", baselineApi, currentApi, [
    ["properties.txt", "code\nknown-prop\n"],
    ["itemstatcost.txt", "stat\nknown-stat\n"],
    ["missiles.txt", "missile\tskill\nknownmissile\tMissingSkill\n"],
    ["skills.txt", "skill\tsrvmissilea\nKnownSkill\tmissingmissile\n"],
    ["uniqueitems.txt", "index\tprop3\nBad Unique\tmissing-prop\n"],
    ["misc.txt", "code\tname\tstat1\tnamestr\nbadmisc\tBad Misc\tmissing-stat\t\n"]
  ])],
  ["vector-2-4-like", compareLintFixture("vector-2-4-like", baselineApi, currentApi, [
    ["missiles.txt", "missile\trange\tpcltdofunc\nfoo\t1\t78\n"]
  ], "2.4")],
  ["profile-specific-enablements", compareLintFixture("profile-specific-enablements", baselineApi, currentApi, [
    ["properties.txt", "code\ngethit-skill\n"],
    ["propertygroups.txt", "code\tprop1\nGelid-Affix5\tgethit-skill\nBreaching-Affix4\tGelid-Affix5\n"],
    ["uniqueitems.txt", "index\tprop1\tprop2\tprop3\nRotW Item\tGelid-Affix5\tBreaching-Affix4\tGethit-skill\n"]
  ], "RotW")]
];

assertPlatformContract();
runStartupSmoke(BASELINE_DIR);
runStartupSmoke(ROOT);
const workspaceExplorerResult = compareWorkspaceExplorerBehavior();
compareTextFilePolicy();
assertCommandToggleHandlers();
await assertPublicFacadeExports();

console.log("# Behavior Baseline Comparison\n");
console.log(`- Baseline: ${BASELINE_DIR}`);
console.log(`- Baseline source: ${BASELINE.source}`);
console.log(`- Current: ${ROOT}`);
console.log("- Result: PASS\n");
console.log("## Compared Behaviors\n");
for (const [name] of tableFixtures) {
  console.log(`- table-model/${name}`);
  console.log("  - fixture used: inline table fixture in `scripts/baseline-contract.mjs`");
  console.log("  - baseline output source: baseline `src/core/table-model.js` parse/mutation/readback");
  console.log("  - current output source: current `src/core/table-model.js` parse/mutation/readback");
  console.log("  - result: exact-match");
}
for (const [name, result] of lintResults) {
  console.log(`- lint-engine/${name}`);
  console.log("  - fixture used: inline lint workspace fixture in `scripts/baseline-contract.mjs`");
  console.log("  - baseline output source: baseline `src/core/lint-engine.js` `runLint` diagnostics");
  console.log("  - current output source: current `src/core/lint-engine.js` `runLint` diagnostics");
  console.log(`  - result: exact-match (${result.currentDiagnostics.length} diagnostics)`);
}
console.log("- platform-tauri-contract");
console.log("  - fixture used: native command allowlist in `scripts/baseline-contract.mjs`");
console.log("  - baseline output source: 0.4.3 native command names used as the public contract");
console.log("  - current output source: current JS platform adapters plus `src-tauri/src/lib.rs` registrations");
console.log("  - result: exact-match/deliberate assertion of unchanged command names and payload keys");
console.log("- app-startup-smoke");
console.log("  - fixture used: fake app window in `tests/helpers/fake-dom-app-startup.mjs`");
console.log("  - baseline output source: baseline `src/app.js` imported by `scripts/app-startup-smoke.mjs`");
console.log("  - current output source: current `src/app.js` imported by `scripts/app-startup-smoke.mjs`");
console.log("  - result: both import without synchronous startup errors");
console.log("- app-shell/workspace-explorer");
console.log("  - fixture used: inline workspace with an already-open root file, grouped subdirectory files, a collapsed group, problem badge, and escaped labels");
console.log("  - baseline output source: extracted 0.4.3 `renderWorkspaceFileList` function");
console.log("  - current output source: current `src/ui/workspace-file-list-policy.js`");
console.log(`  - result: exact-match (${workspaceExplorerResult.currentHtml.length} HTML chars)`);
console.log("- app-shell/command-toggle-handlers");
console.log("  - fixture used: Explorer, Problems, and sidebar command ids");
console.log("  - baseline output source: command ids present in 0.4.3 `src/app.js`");
console.log("  - current output source: current `src/ui/command-registry.js` handler actions");
console.log("  - result: handlers remain available");
console.log("- text-file-policy");
console.log("  - fixture used: .txt/.tsv/.tbl/.csv and rejected non-text paths");
console.log("  - baseline output source: extracted 0.4.3 `isTextLikePath` function");
console.log("  - current output source: current `src/core/text-file-policy.js`");
console.log("  - result: exact-match");
console.log("- public-facade-exports");
console.log("  - fixture used: baseline export names for `src/core/io.js`, `src/core/lint-engine.js`, `src/core/table-model.js`, plus app-used `CanvasGrid` methods");
console.log("  - baseline output source: 0.4.3 module namespaces and public app calls");
console.log("  - current output source: current module namespaces and `CanvasGrid.prototype`");
console.log("  - result: all required exports/methods remain present");
