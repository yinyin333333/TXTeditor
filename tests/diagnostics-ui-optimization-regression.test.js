import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LINT_ENGINE_VECTOR } from "../src/core/lint-controller-policy.js";
import { normalizePath } from "../src/core/lint-paths.js";
import { lspDocumentState, resetLspDocumentState } from "../src/core/lsp-document-state.js";
import { docToUri } from "../src/core/lsp-uri-policy.js";
import { TableDocument } from "../src/core/table-model.js";
import { createDiagnosticsController } from "../src/ui/controllers/diagnostics-controller.js";
import { createLspController } from "../src/ui/controllers/lsp-controller.js";
import { createShellController } from "../src/ui/controllers/shell-controller.js";
import { installFakeAppStartupDom } from "./helpers/fake-dom-app-startup.mjs";

function pathKey(path) {
  return normalizePath(path ?? "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

test("Stage 1-B derived diagnostics cache preserves the flat source and avoids global filters", () => {
  const active = TableDocument.fromText("a.txt", "id\n1\n2", { path: "E:\\Data\\a.txt" });
  const other = TableDocument.fromText("b.txt", "id\n1", { path: "E:\\Data\\b.txt" });
  const state = {
    docs: [active, other],
    active: 0,
    selection: { focus: { row: 1, column: 0 } },
    problemsVisible: true,
    bottomTab: "problems",
    lint: {
      diagnostics: [],
      enabled: true,
      engine: LINT_ENGINE_VECTOR,
      status: "",
      version: 0,
      legacy: {
        status: "",
        rulesOpen: false,
        settings: { profile: "basic" },
        workspaceDocs: [],
        workspaceLoad: { status: "ready" }
      }
    },
    lsp: { started: true, openFileCount: 2 }
  };
  const gridSnapshots = [];
  const controller = createDiagnosticsController({
    state,
    els: { overviewRuler: null, problemsList: null },
    grid: {
      editingCell: () => null,
      setDiagnostics: (diagnostics) => gridSnapshots.push(diagnostics)
    },
    activeDoc: () => state.docs[state.active],
    hasOpenDocument: () => true,
    addDocument: async () => {},
    renderChrome: () => {},
    recordUiPerf: () => {},
    showError: (error) => { throw error; },
    lintDocKey: (doc) => pathKey(doc?.path || doc?.name),
    lintPathKey: pathKey,
    escapeHtml,
    storage: { setItem() {} }
  });
  const diagnostics = [
    { id: "a-error", fileKey: pathKey(active.path), fileName: active.name, rowIndex: 1, columnIndex: 0, severity: "error", message: "a error" },
    { id: "a-info", fileKey: pathKey(active.path), fileName: active.name, rowIndex: 1, columnIndex: 0, severity: "info", message: "a info" },
    { id: "b-warning", fileKey: pathKey(other.path), fileName: other.name, rowIndex: 1, columnIndex: 0, severity: "warning", message: "b warning" }
  ];

  controller.setLintDiagnostics(diagnostics);

  assert.equal(state.lint.diagnostics, diagnostics);
  assert.equal(state.lint.diagnostics[0], diagnostics[0]);
  assert.equal(state.lint.diagnostics[1], diagnostics[1]);
  assert.equal(state.lint.diagnostics[2], diagnostics[2]);
  assert.equal(state.lint.version, 1);

  let globalFilterCalls = 0;
  diagnostics.filter = () => {
    globalFilterCalls += 1;
    throw new Error("global diagnostics filter must not run after indexing");
  };

  assert.equal(controller.problemBadgeCountForPath("E:\\DATA\\A.TXT"), 2);
  assert.equal(controller.problemBadgeCountForPath("\\\\?\\E:\\Data\\a.txt"), 2);
  assert.equal(controller.problemBadgeForPath("E:\\Data\\b.txt"), " <span class=\"file-problem-badge\">1</span>");
  assert.equal(controller.docHasDiagnostics(active), true);
  assert.equal(controller.docHasDiagnostics(other), true);
  assert.equal(controller.lintSummaryText(), "1 errors, 1 warnings, 1 info (2 files)");
  controller.updateGridDiagnostics();

  assert.equal(globalFilterCalls, 0);
  assert.deepEqual([...gridSnapshots.at(-1).keys()], ["1:0"]);
  assert.equal(gridSnapshots.at(-1).get("1:0")[0], diagnostics[0]);
  assert.equal(gridSnapshots.at(-1).get("1:0")[1], diagnostics[1]);

  const empty = [];
  controller.setLintDiagnostics(empty);
  controller.updateGridDiagnostics();
  assert.equal(state.lint.diagnostics, empty);
  assert.equal(state.lint.version, 2);
  assert.equal(controller.problemBadgeCountForPath(active.path), 0);
  assert.equal(controller.docHasDiagnostics(active), false);
  assert.equal(gridSnapshots.at(-1).size, 0);
  assert.equal(controller.lintSummaryText(), "No problems (2 files linted)");
});

test("Stage 1-E diagnostics-only refresh preserves tab and file DOM while patching badges", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const { document } = installFakeAppStartupDom({ indexHtml });
  const openPath = "E:/Game/Data/open.txt";
  const workspacePath = "E:/Game/Data/sub/workspace.txt";
  const counts = new Map();
  const counters = {
    grid: 0,
    lintControls: 0,
    problems: 0,
    syncDock: 0,
    syncHeader: 0,
    tabSeverity: 0
  };
  let total = 0;
  let summary = "No problems";
  const state = {
    docs: [{ name: "open.txt", path: openPath, dirty: false }],
    active: 0,
    workspace: {
      path: "E:/Game/Data",
      files: [
        { name: "open.txt", path: openPath },
        { name: "workspace.txt", path: workspacePath }
      ]
    },
    sidebarVisible: true,
    problemsVisible: true,
    bottomTab: "problems",
    lint: { diagnostics: [], enabled: true },
    freezeRow: false,
    freezeColumn: false,
    colorizeColumns: false,
    theme: "dark",
    selection: { set() {} }
  };
  const ids = [
    "sidebar",
    "problemsPanel",
    "problemsList",
    "logList",
    "emptyState",
    "lintSummary",
    "tabs",
    "fileList",
    "explorerFilter",
    "explorerSearchResults",
    "host"
  ];
  const els = {
    shell: document.getElementById("app"),
    ...Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]))
  };
  const perfSamples = [];
  const controller = createShellController({
    state,
    els,
    grid: { setDocument() {} },
    activeDoc: () => state.docs[state.active],
    hasOpenDocument: () => true,
    applyFreezeToDoc: () => {},
    closeTab: async () => {},
    openDroppedNativePaths: async () => {},
    updateGridDiagnostics: () => { counters.grid += 1; },
    renderProblemsPanelIfNeeded: () => { counters.problems += 1; },
    scrollProblemsToActiveFile: () => {},
    docDiagnosticSeverity: () => {
      counters.tabSeverity += 1;
      return null;
    },
    lintSummaryText: () => summary,
    problemBadgeForPath: (path) => {
      const count = counts.get(pathKey(path)) ?? 0;
      return count ? ` <span class="file-problem-badge">${count}</span>` : "";
    },
    problemBadgeCountForPath: (path) => counts.get(pathKey(path)) ?? 0,
    lintNotificationCount: () => total,
    renderLintControls: () => { counters.lintControls += 1; },
    syncDockLayout: () => { counters.syncDock += 1; },
    syncProblemsHeaderLayout: () => { counters.syncHeader += 1; },
    scheduleHoverPrewarm: () => {},
    recordUiPerf: (name, _started, details) => perfSamples.push({ name, ...details }),
    perfNow: () => 0,
    showError: (error) => { throw error; },
    lintPathKey: pathKey,
    escapeHtml,
    documentRef: document
  });

  try {
    controller.renderChrome();
    const tab = els.tabs.querySelector("[data-tab]");
    const openButton = els.fileList.querySelector("[data-problem-path]");
    const workspaceButton = els.fileList.querySelector("[data-open-path]");
    const fileGroup = els.fileList.querySelector("details[data-file-group]");
    const tabClickListeners = tab.listeners.get("click")?.length ?? 0;
    const openClickListeners = openButton.listeners.get("click")?.length ?? 0;
    const workspaceClickListeners = workspaceButton.listeners.get("click")?.length ?? 0;
    assert.equal(tabClickListeners, 1);
    assert.equal(openClickListeners, 1);
    assert.equal(workspaceClickListeners, 1);
    fileGroup.open = false;
    fileGroup.dispatchEvent({ type: "toggle" });

    counts.set(pathKey(openPath), 2);
    counts.set(pathKey(workspacePath), 3);
    total = 5;
    summary = "1 error, 4 warnings";
    state.lint.diagnostics = Array.from({ length: total }, (_, id) => ({ id }));
    controller.renderDiagnosticsChrome();

    assert.equal(els.tabs.querySelector("[data-tab]"), tab);
    assert.equal(els.fileList.querySelector("[data-problem-path]"), openButton);
    assert.equal(els.fileList.querySelector("[data-open-path]"), workspaceButton);
    assert.equal(els.fileList.querySelector("details[data-file-group]"), fileGroup);
    assert.equal(fileGroup.open, false);
    assert.equal(tab.listeners.get("click")?.length ?? 0, tabClickListeners);
    assert.equal(openButton.listeners.get("click")?.length ?? 0, openClickListeners);
    assert.equal(workspaceButton.listeners.get("click")?.length ?? 0, workspaceClickListeners);
    const openBadge = openButton.querySelector(".file-problem-badge");
    assert.equal(openBadge.textContent, "2");
    assert.equal(workspaceButton.querySelector(".file-problem-badge").textContent, "3");
    assert.equal(document.querySelector("[data-command='show-explorer']").dataset.badge, "5");
    assert.equal(document.querySelector("[data-command='show-problems']").title, "Problems (5)");
    assert.equal(els.lintSummary.textContent, summary);

    counts.set(pathKey(openPath), 4);
    counts.delete(pathKey(workspacePath));
    total = 4;
    summary = "4 warnings";
    state.lint.diagnostics = Array.from({ length: total }, (_, id) => ({ id }));
    controller.renderDiagnosticsChrome();

    assert.equal(openButton.querySelector(".file-problem-badge"), openBadge);
    assert.equal(openBadge.textContent, "4");
    assert.equal(workspaceButton.querySelector(".file-problem-badge"), null);

    counts.clear();
    total = 0;
    summary = "No problems";
    state.lint.diagnostics = [];
    controller.renderDiagnosticsChrome();

    assert.equal(openButton.querySelector(".file-problem-badge"), null);
    assert.equal(workspaceButton.querySelector(".file-problem-badge"), null);
    assert.equal(els.tabs.querySelector("[data-tab]"), tab);
    assert.equal(els.fileList.querySelector("[data-problem-path]"), openButton);
    assert.equal(els.fileList.querySelector("[data-open-path]"), workspaceButton);
    assert.equal(document.querySelector("[data-command='show-explorer']").dataset.badge, undefined);
    assert.equal(document.querySelector("[data-command='show-problems']").title, "Problems");
    assert.equal(els.lintSummary.textContent, "No problems");
    assert.deepEqual(counters, {
      grid: 4,
      lintControls: 1,
      problems: 4,
      syncDock: 1,
      syncHeader: 1,
      tabSeverity: 1
    });
    assert.equal(perfSamples.filter((sample) => sample.diagnosticsOnly).length, 3);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("product diagnostics commits rebuild Explorer so unopened workspace badges use current diagnostics", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(
    appSource,
    /function renderDiagnosticsChrome\(\)\s*\{\s*return shellController\.renderChrome\(\);\s*\}/,
    "Vector-LSP diagnostics must rebuild the Explorer file list; the partial patch path missed unopened-file badges"
  );
});

function createBulkState(docs, { started, generation }) {
  return {
    docs,
    active: 0,
    lint: {
      diagnostics: [],
      enabled: true,
      engine: LINT_ENGINE_VECTOR,
      status: "",
      version: 0
    },
    lsp: {
      started,
      generation,
      readiness: started ? "ready" : "stopped",
      workspacePath: started ? "E:\\Data" : "",
      workspaceKey: started ? "e:/data" : "",
      openFileCount: 0
    },
    lspLogs: [],
    bottomTab: "problems",
    contextMenuOpen: false
  };
}

function createBulkController(state, renderSnapshots) {
  return createLspController({
    state,
    els: { logList: null, host: { focus() {} } },
    grid: {
      clearLspHovers() {},
      setLspHover() {},
      visibleRowIndexes: () => [],
      visibleColumnIndexes: () => [],
      setDocument() {},
      scrollCellIntoView() {},
      draw() {}
    },
    activeDoc: () => state.docs[state.active] ?? null,
    isVectorLintEngine: () => state.lint.engine === LINT_ENGINE_VECTOR,
    effectiveVectorLspHoverEnabled: () => false,
    recordLintEngineEvent() {},
    perfNow: () => 0,
    showToast() {},
    showError(error) { throw error; },
    setLintDiagnostics(diagnostics) {
      state.lint.diagnostics = diagnostics;
      state.lint.version += 1;
    },
    updateGridDiagnostics() {},
    renderChrome() {
      renderSnapshots.push({
        generation: state.lsp.generation,
        openFileCount: state.lsp.openFileCount,
        started: state.lsp.started
      });
    },
    addDocument: async () => {},
    applyFreezeToDoc() {},
    updateActiveProblemHighlight() {},
    lintPathKey: pathKey,
    lspHoverRequest: async () => null
  });
}

function createBulkDocuments(prefix) {
  return Array.from({ length: 3 }, (_, index) => TableDocument.fromText(
    `${prefix}-${index + 1}.txt`,
    `id\n${index + 1}`,
    { path: `E:\\Data\\${prefix}-${index + 1}.txt` }
  ));
}

function openedDocumentSnapshot(doc) {
  const docState = lspDocumentState(doc);
  return {
    opened: docState.opened,
    openedUri: docState.openedUri,
    openedVersion: docState.openedVersion,
    sessionGeneration: docState.sessionGeneration,
    version: docState.version
  };
}

test("Stage 1-D bulk start and sync render once per batch without changing didOpen identity", async () => {
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          if (command === "lsp_start" || command === "lsp_open_file") return;
          throw new Error(`unexpected invoke: ${command}`);
        }
      }
    }
  };
  const startDocs = createBulkDocuments("start");
  const syncDocs = createBulkDocuments("sync");

  try {
    const startState = createBulkState(startDocs, { started: false, generation: 0 });
    const startRenders = [];
    const startController = createBulkController(startState, startRenders);
    await startController.startWorkspace("E:\\Data");

    const startCalls = calls.splice(0);
    assert.deepEqual(startCalls.filter(([command]) => command === "lsp_start"), [
      ["lsp_start", { workspacePath: "E:\\Data", generation: 1, locale: "enUS" }]
    ]);
    assert.deepEqual(
      startCalls.filter(([command]) => command === "lsp_open_file").map(([, args]) => ({
        generation: args.generation,
        text: args.text,
        uri: args.uri,
        version: args.version
      })),
      startDocs.map((doc) => ({ generation: 1, text: doc.toText(), uri: docToUri(doc), version: 1 }))
    );
    assert.deepEqual(startRenders, [
      { generation: 1, openFileCount: 0, started: false },
      { generation: 1, openFileCount: 3, started: true }
    ]);
    assert.deepEqual(startDocs.map(openedDocumentSnapshot), startDocs.map((doc) => ({
      opened: true,
      openedUri: docToUri(doc),
      openedVersion: 1,
      sessionGeneration: 1,
      version: 1
    })));

    const syncState = createBulkState(syncDocs, { started: true, generation: 9 });
    const syncRenders = [];
    const syncController = createBulkController(syncState, syncRenders);
    await syncController.syncOpenDocs();

    const syncCalls = calls.splice(0);
    assert.equal(syncCalls.some(([command]) => command === "lsp_start"), false);
    assert.deepEqual(
      syncCalls.filter(([command]) => command === "lsp_open_file").map(([, args]) => ({
        generation: args.generation,
        text: args.text,
        uri: args.uri,
        version: args.version
      })),
      syncDocs.map((doc) => ({ generation: 9, text: doc.toText(), uri: docToUri(doc), version: 1 }))
    );
    assert.deepEqual(syncRenders, [
      { generation: 9, openFileCount: 3, started: true }
    ]);
    assert.deepEqual(syncDocs.map(openedDocumentSnapshot), syncDocs.map((doc) => ({
      opened: true,
      openedUri: docToUri(doc),
      openedVersion: 1,
      sessionGeneration: 9,
      version: 1
    })));
  } finally {
    for (const doc of [...startDocs, ...syncDocs]) resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
