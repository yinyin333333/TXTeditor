import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ensureLspDocumentVersion,
  lspDocumentState,
  nextLspDocumentVersion,
  resetLspDocumentState
} from "../src/core/lsp-document-state.js";
import {
  lspChangedRowsToIncrementalChanges,
  lspDocumentMatchesSessionScope,
  lspHoverReady,
  lspOpenDocumentPolicy,
  lspUpdateDocumentPolicy,
  lspWorkspaceSessionPolicy,
  normalizeLspDocumentChange
} from "../src/core/lsp-session-policy.js";
import {
  docToUri,
  fileNameFromUri,
  lspSiblingParentPath,
  lspStandaloneParentPath,
  pathFromUri,
  uriToFileKey
} from "../src/core/lsp-uri-policy.js";
import {
  LINT_ENGINE_LEGACY,
  LINT_ENGINE_VECTOR,
  documentChangeSyncRoute,
  documentOpenSyncRoute,
  effectiveVectorLspHover,
  isLegacyLintEngineValue,
  isVectorLintEngineValue,
  lintEngineStorageValue,
  legacyLintEditSchedule,
  legacyLintOpenSchedule,
  legacyLintSettingsStorageValue,
  lintSettingsStorageValue,
  normalizeLintEngine,
  vectorLspHoverFromStorage,
  vectorLspHoverStorageValue,
  vectorSessionAvailable
} from "../src/core/lint-controller-policy.js";
import { TableDocument } from "../src/core/table-model.js";
import {
  clearLspUpdateFailureStatus,
  lspRequestErrorMessage,
  reportLspRequestFailure,
  reportLspUpdateFailure
} from "../src/core/lsp-update-status.js";
import {
  backgroundTaskErrorMessage,
  reportBackgroundTaskFailure
} from "../src/core/background-task-status.js";
import {
  DEFAULT_LSP_TRAFFIC_COUNTERS,
  createLspReadinessState,
  createLspTrafficState,
  exposeTxteditorPerf,
  recordLspReadinessSample,
  recordLspTrafficSample
} from "../src/core/perf-instrumentation.js";
import {
  CanvasGrid,
  applyGridScrollState,
  bindHoverExitEvents,
  normalizeVectorLspTooltip,
  VECTOR_LSP_HOVER_DELAY_MS
} from "../src/ui/canvas-grid.js";
import {
  contextMenuHiddenState,
  contextMenuOpenTransition,
  visibleHoverClearEvent,
  visibleHoverClearKeepsPendingRequests
} from "../src/ui/context-menu-policy.js";
import {
  lintControlsModel,
  lintToggleControl
} from "../src/ui/lint-controls-policy.js";
import {
  hoverRequestPolicy,
  hoverStateHasActivity,
  hoverTooltipPresentation,
  isGridHoverAllowed,
  isHoverTargetCurrent,
  diagnosticUserGuidance,
  diagnosticTooltipText,
  shouldClearHoverForInteraction,
  vectorTooltipPosition,
  vectorTooltipSections,
  vectorTooltipShouldOwnCell
} from "../src/ui/hover-policy.js";
import { createLspHoverController } from "../src/ui/controllers/lsp-hover-controller.js";
import { createLspController, mapLspDiagnosticToDisplay } from "../src/ui/controllers/lsp-controller.js";
import { createDocumentController } from "../src/ui/controllers/document-controller.js";
import { appSettingsVisualControls } from "../src/ui/app-settings-policy.js";
import { lintEnginePanelActive } from "../src/ui/problems-policy.js";
import {
  createDefaultLintSettings,
  lintRuleGroupsForProfile,
  runLint
} from "../src/core/lint-engine.js";
import {
  HOVER_NO_CONTENT_TTL_MS,
  hoverCacheHitState,
  hoverCacheStoredState,
  isHoverCacheEntryUsable,
  makeHoverCacheEntry,
  makeHoverSemanticCacheKey,
  targetHasImmediateTooltip
} from "../src/core/vector-hover-cache.js";
import {
  cancelVectorHoverSample,
  finishVectorHoverSample,
  makeVectorHoverTarget,
  markVectorHoverRequested,
  shouldAcceptVectorHoverResult,
  startVectorHoverSample
} from "../src/core/vector-hover.js";
import {
  activeHoverQueueLength,
  createUserHoverRequest,
  planUserHoverEnqueue,
  takeLatestQueuedHover
} from "../src/core/vector-hover-queue.js";

function lintDocs(docs, profile = "RotW") {
  const settings = createDefaultLintSettings();
  settings.profile = profile;
  return runLint(docs, settings);
}

function ruleIdsForProfile(profile) {
  return lintRuleGroupsForProfile(profile).flatMap((group) => group.rules.map((rule) => rule.id));
}

test("JS LSP URI policy encodes and decodes path edge cases", () => {
  const lintPathKey = (pathValue) => String(pathValue || "").replace(/\\/g, "/").toLowerCase();
  const windowsPath = "E:\\Game Data\\skills#100%\\한글.txt";
  const windowsUri = docToUri({ path: windowsPath });
  assert.equal(windowsUri, "file:///E:/Game%20Data/skills%23100%25/%ED%95%9C%EA%B8%80.txt");
  assert.equal(pathFromUri(windowsUri), "E:/Game Data/skills#100%/한글.txt");
  assert.equal(fileNameFromUri(windowsUri), "한글.txt");
  const windowsKey = "e:/game data/skills#100%/한글.txt";
  assert.equal(uriToFileKey(windowsUri, lintPathKey), windowsKey);
  assert.equal(uriToFileKey("file:///e:/GAME%20DATA/skills%23100%25/%ED%95%9C%EA%B8%80.txt", lintPathKey), windowsKey);
  assert.equal(uriToFileKey("file:///E:/Game%20Data/skills%23100%25/%ED%95%9C%EA%B8%80.txt", lintPathKey), windowsKey);
  assert.equal(uriToFileKey("file:///E:/bad%ZZ.txt", lintPathKey), "e:/bad%zz.txt");

  const posixUri = docToUri({ path: "/home/user/Data Files/cube#main%25.txt" });
  assert.equal(posixUri, "file:///home/user/Data%20Files/cube%23main%2525.txt");
  assert.equal(pathFromUri(posixUri), "/home/user/Data Files/cube#main%25.txt");

  const uncUri = docToUri({ path: "\\\\Server\\Share\\Data File.txt" });
  assert.equal(pathFromUri(uncUri), "//server/Share/Data File.txt");
  assert.equal(pathFromUri("file://SERVER/Share/Data%20File.txt"), "//server/Share/Data File.txt");
  assert.equal(uriToFileKey("file://SERVER/Share/Data%20File.txt", lintPathKey), "//server/share/data file.txt");
  assert.equal(docToUri({ path: "" }), null);
  assert.equal(lspSiblingParentPath("E:\\Mods\\TXT\\magicprefix.txt"), "E:\\Mods\\TXT");
  assert.equal(lspSiblingParentPath("E:\\magicprefix.txt"), "E:\\");
  assert.equal(lspSiblingParentPath("/mods/txt/magicprefix.txt"), "/mods/txt");
  assert.equal(lspSiblingParentPath("magicprefix.txt"), null);
  assert.equal(lspStandaloneParentPath("E:\\Mods\\TXT\\magicprefix.txt", "E:\\Workspace"), "E:\\Mods\\TXT");
  assert.equal(lspStandaloneParentPath("E:\\Workspace\\global\\excel\\skills.txt", "e:/workspace/"), null);
  assert.equal(lspStandaloneParentPath(
    "E:\\Workspace\\global\\excel\\skills.txt",
    "e:/workspace/",
    { includeSubfolders: false }
  ), "E:\\Workspace\\global\\excel");
});

test("sibling and full workspace contexts never reuse the same Vector session", () => {
  assert.equal(lspWorkspaceSessionPolicy({
    started: true,
    activeWorkspacePath: "E:\\Mods\\TXT",
    requestedWorkspacePath: "e:/mods/txt/",
    activeContextMode: "sibling",
    requestedContextMode: "sibling"
  }).action, "sync");
  assert.equal(lspWorkspaceSessionPolicy({
    started: true,
    activeWorkspacePath: "E:\\Mods\\TXT",
    requestedWorkspacePath: "E:\\Mods\\TXT",
    activeContextMode: "sibling",
    requestedContextMode: "workspace"
  }).action, "restart");
  assert.equal(lspWorkspaceSessionPolicy({
    started: true,
    activeWorkspacePath: "E:\\Workspace",
    requestedWorkspacePath: "E:\\Workspace",
    activeIncludeSubfolders: true,
    requestedIncludeSubfolders: false
  }).action, "restart");
  assert.equal(lspWorkspaceSessionPolicy({
    started: true,
    activeWorkspacePath: "E:\\Mods\\TXT",
    requestedWorkspacePath: "E:\\Mods\\TXT",
    activeContextMode: "sibling",
    requestedContextMode: "sibling",
    activeReferenceRootPath: "E:\\ReferenceA",
    requestedReferenceRootPath: "E:\\ReferenceB"
  }).action, "restart");
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\Reference\\global\\excel\\ItemTypes.txt",
    workspacePath: "E:\\Mods\\TXT",
    contextMode: "sibling",
    referenceRootPath: "E:\\Reference"
  }), true);
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\Reference\\global\\excel\\ItemTypes.txt",
    workspacePath: "E:\\Mods\\TXT",
    contextMode: "sibling",
    referenceRootPath: "E:\\Reference",
    includeSubfolders: false
  }), false);
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\Reference\\ItemTypes.txt",
    workspacePath: "E:\\Mods\\TXT",
    contextMode: "sibling",
    referenceRootPath: "E:\\Reference",
    includeSubfolders: false
  }), true);
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\Workspace\\global\\excel\\MagicPrefix.txt",
    workspacePath: "E:\\Workspace",
    contextMode: "workspace",
    includeSubfolders: false
  }), false);
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\Workspace\\MagicPrefix.txt",
    workspacePath: "E:\\Workspace",
    contextMode: "workspace",
    includeSubfolders: false
  }), true);
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\OtherMod\\ItemTypes.txt",
    workspacePath: "E:\\Mods\\TXT",
    contextMode: "sibling",
    referenceRootPath: "E:\\Reference"
  }), false);
});

test("Vector session scope keeps workspace and standalone mod parents isolated", () => {
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\Workspace\\global\\excel\\MagicPrefix.txt",
    workspacePath: "",
    contextMode: "workspace"
  }), true);
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\MagicPrefix.txt",
    workspacePath: "E:\\",
    contextMode: "workspace"
  }), true);
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\Workspace\\global\\excel\\MagicPrefix.txt",
    workspacePath: "E:\\Workspace",
    contextMode: "workspace"
  }), true);
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\OtherMod\\global\\excel\\ItemTypes.txt",
    workspacePath: "E:\\Workspace",
    contextMode: "workspace"
  }), false);
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\OtherMod\\global\\excel\\ItemTypes.txt",
    workspacePath: "E:\\OtherMod\\global\\excel",
    contextMode: "sibling",
    referenceRootPath: "E:\\Workspace"
  }), true);
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\ThirdMod\\global\\excel\\ItemTypes.txt",
    workspacePath: "E:\\OtherMod\\global\\excel",
    contextMode: "sibling",
    referenceRootPath: "E:\\Workspace"
  }), false);
  assert.equal(lspDocumentMatchesSessionScope({
    documentPath: "E:\\Workspace\\global\\excel\\ItemTypes.txt",
    workspacePath: "E:\\OtherMod\\global\\excel",
    contextMode: "sibling",
    referenceRootPath: "E:\\Workspace"
  }), true);
});

test("closing active standalone tab rebinds the revealed document to its different parent generation", async () => {
  const originalWindow = globalThis.window;
  const first = TableDocument.fromText("magicprefix.txt", "name\titype1\na\tstaff", {
    path: "E:\\Mods\\A\\magicprefix.txt"
  });
  const second = TableDocument.fromText("magicsuffix.txt", "name\tetype1\nb\tring", {
    path: "E:\\Mods\\B\\magicsuffix.txt"
  });
  const calls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          if (command === "lsp_start" || command === "lsp_open_file" || command === "lsp_close_file") return;
          throw new Error(`unexpected invoke: ${command}`);
        }
      }
    }
  };
  const state = {
    docs: [first, second],
    active: 1,
    workspace: null,
    lint: { engine: LINT_ENGINE_VECTOR, diagnostics: [], status: "" },
    lsp: { started: false, generation: 0, readiness: "stopped", openFileCount: 0 },
    lspLogs: [],
    bottomTab: "problems",
    contextMenuOpen: false
  };
  try {
    const controller = createLspController({
      state,
      els: { logList: null, host: { focus() {} } },
      grid: {
        clearLspHovers() {},
        visibleRowIndexes: () => [],
        visibleColumnIndexes: () => [],
        setDocument() {},
        scrollCellIntoView() {},
        draw() {}
      },
      activeDoc: () => state.docs[state.active],
      isVectorLintEngine: () => true,
      effectiveVectorLspHoverEnabled: () => false,
      recordLintEngineEvent: () => {},
      perfNow: () => 1,
      showToast: () => {},
      showError: (error) => { throw error; },
      setLintDiagnostics: (diagnostics) => { state.lint.diagnostics = diagnostics; },
      updateGridDiagnostics: () => {},
      renderChrome: () => {},
      addDocument: async () => {},
      applyFreezeToDoc: () => {},
      updateActiveProblemHighlight: () => {},
      lintPathKey: (value) => String(value || "").replace(/\\/g, "/").toLowerCase()
    });

    await controller.startWorkspace("E:\\Mods\\B", { contextMode: "sibling" });
    assert.deepEqual(calls, [
      ["lsp_start", { workspacePath: "E:\\Mods\\B", contextMode: "sibling", generation: 1 }],
      ["lsp_open_file", { uri: docToUri(second), version: 1, text: second.toText(), generation: 1 }]
    ]);

    const documentController = createDocumentController({
      state,
      els: {
        host: { focus() {} },
        closeDialog: { classList: { add() {}, remove() {} } },
        closeDialogText: { textContent: "" },
        fileInput: { click() {} }
      },
      grid: { commitEdit() {}, draw() {}, setDocument() {} },
      emptyDoc: TableDocument.fromText("empty.txt", ""),
      activeDoc: () => state.docs[state.active],
      saveSelectionState() {},
      applyFreezeToDoc() {},
      renderChrome() {},
      showError: (error) => { throw error; },
      reportWindowCloseFailure() {},
      lspOpenDoc: controller.openDoc,
      reportLspOpenFailure: controller.reportOpenFailure,
      lspCloseDoc: controller.closeDoc,
      reportLspCloseFailure: controller.reportCloseFailure,
      lspStartWorkspace: controller.startWorkspace,
      ensureDocumentSession: controller.ensureStandaloneSession,
      scheduleHoverPrewarm() {},
      resetUndoManagerForDocument() {},
      resetLegacyWorkspaceIndex() {},
      scheduleLegacyLintForOpen() {},
      scheduleLegacyLintFull() {},
      cancelLegacyLintJobs() {},
      isVectorLintEngine: () => true,
      isLegacyLintEngine: () => false,
      updateGridDiagnostics() {},
      scrollProblemsToActiveFile() {}
    });

    await documentController.closeTab(1);
    assert.deepEqual(calls.slice(2), [
      ["lsp_close_file", { uri: docToUri(second), generation: 1 }],
      ["lsp_start", { workspacePath: "E:\\Mods\\A", contextMode: "sibling", generation: 2 }],
      ["lsp_open_file", { uri: docToUri(first), version: 1, text: first.toText(), generation: 2 }]
    ]);
    assert.deepEqual(state.docs, [first]);
    assert.equal(state.active, 0);
    assert.equal(state.lsp.workspacePath, "E:\\Mods\\A");
    assert.equal(state.lsp.generation, 2);
    assert.equal(lspDocumentState(first).sessionGeneration, 2);
  } finally {
    resetLspDocumentState(first);
    resetLspDocumentState(second);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("closing active standalone tab reuses the existing sibling session for the same parent", async () => {
  const originalWindow = globalThis.window;
  const first = TableDocument.fromText("magicprefix.txt", "name\titype1\na\tstaff", {
    path: "E:\\Mods\\Same\\magicprefix.txt"
  });
  const second = TableDocument.fromText("magicsuffix.txt", "name\tetype1\nb\tring", {
    path: "E:\\Mods\\Same\\magicsuffix.txt"
  });
  const calls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          if (command === "lsp_get_diagnostics_batch") return args.requests.map(() => []);
          if (["lsp_start", "lsp_open_file", "lsp_close_file"].includes(command)) return;
          throw new Error(`unexpected invoke: ${command}`);
        }
      }
    }
  };
  const state = {
    docs: [first, second],
    active: 1,
    workspace: null,
    lint: { engine: LINT_ENGINE_VECTOR, diagnostics: [], status: "" },
    lsp: { started: false, generation: 0, readiness: "stopped", openFileCount: 0 },
    lspLogs: [],
    bottomTab: "problems",
    contextMenuOpen: false
  };
  let closePromise;
  try {
    const controller = createLspController({
      state,
      els: { logList: null, host: { focus() {} } },
      grid: {
        clearLspHovers() {},
        visibleRowIndexes: () => [],
        visibleColumnIndexes: () => [],
        setDocument() {},
        scrollCellIntoView() {},
        draw() {}
      },
      activeDoc: () => state.docs[state.active],
      isVectorLintEngine: () => true,
      effectiveVectorLspHoverEnabled: () => false,
      recordLintEngineEvent: () => {},
      perfNow: () => 1,
      showToast: () => {},
      showError: (error) => { throw error; },
      setLintDiagnostics: (diagnostics) => { state.lint.diagnostics = diagnostics; },
      updateGridDiagnostics: () => {},
      renderChrome: () => {},
      addDocument: async () => {},
      applyFreezeToDoc: () => {},
      updateActiveProblemHighlight: () => {},
      lintPathKey: (value) => String(value || "").replace(/\\/g, "/").toLowerCase()
    });

    await controller.startWorkspace("E:\\Mods\\Same", { contextMode: "sibling" });

    const documentController = createDocumentController({
      state,
      els: {
        host: { focus() {} },
        closeDialog: { classList: { add() {}, remove() {} } },
        closeDialogText: { textContent: "" },
        fileInput: { click() {} }
      },
      grid: { commitEdit() {}, draw() {}, setDocument() {} },
      emptyDoc: TableDocument.fromText("empty.txt", ""),
      activeDoc: () => state.docs[state.active],
      saveSelectionState() {},
      applyFreezeToDoc() {},
      renderChrome() {},
      showError: (error) => { throw error; },
      reportWindowCloseFailure() {},
      lspOpenDoc: controller.openDoc,
      reportLspOpenFailure: controller.reportOpenFailure,
      lspCloseDoc: (doc) => {
        closePromise = controller.closeDoc(doc);
        return closePromise;
      },
      reportLspCloseFailure: controller.reportCloseFailure,
      lspStartWorkspace: controller.startWorkspace,
      ensureDocumentSession: controller.ensureStandaloneSession,
      scheduleHoverPrewarm() {},
      resetUndoManagerForDocument() {},
      resetLegacyWorkspaceIndex() {},
      scheduleLegacyLintForOpen() {},
      scheduleLegacyLintFull() {},
      cancelLegacyLintJobs() {},
      isVectorLintEngine: () => true,
      isLegacyLintEngine: () => false,
      updateGridDiagnostics() {},
      scrollProblemsToActiveFile() {}
    });

    await documentController.closeTab(1);
    await closePromise;

    assert.equal(calls.filter(([command]) => command === "lsp_start").length, 1);
    assert.equal(calls.filter(([command]) => command === "lsp_open_file").length, 2);
    assert.deepEqual(calls.filter(([command]) => command === "lsp_close_file"), [[
      "lsp_close_file",
      { uri: docToUri(second), generation: 1 }
    ]]);
    assert.deepEqual(state.docs, [first]);
    assert.equal(state.active, 0);
    assert.equal(state.lsp.workspacePath, "E:\\Mods\\Same");
    assert.equal(state.lsp.generation, 1);
    assert.equal(lspDocumentState(first).sessionGeneration, 1);
  } finally {
    resetLspDocumentState(first);
    resetLspDocumentState(second);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("incremental LSP row text preserves sparse appended columns", () => {
  const doc = TableDocument.fromText("items.txt", "a\tb\n1\t2", { dirty: false });
  doc.insertColumns(doc.columnCount, 2);
  doc.setCell(1, 0, "updated");

  assert.equal(doc.rows[1].length, 2);
  assert.equal(doc.toRowText(1), "updated\t2\t\t");
  assert.deepEqual(
    lspChangedRowsToIncrementalChanges(doc, { kind: "replaceRows", rows: [1] }),
    [{
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0xFFFFFF } },
      text: "updated\t2\t\t"
    }]
  );
});

test("LSP hover controller queues not-ready hover targets and clears visible hover state", async () => {
  const doc = TableDocument.fromText("skills.txt", "code\tname\nabc\tAlpha", { path: "E:\\Data\\skills.txt" });
  const traffic = [];
  const readiness = [];
  const lintEvents = [];
  const gridCalls = [];
  const state = {
    docs: [doc],
    lint: {
      engine: LINT_ENGINE_VECTOR,
      version: 1,
      diagnostics: [{
        fileKey: "e:/data/skills.txt",
        rowIndex: 1,
        columnIndex: 0,
        message: "warn"
      }]
    },
    lsp: { started: true },
    contextMenuOpen: false
  };
  let now = 100;
  const controller = createLspHoverController({
    state,
    grid: {
      clearLspHovers: () => gridCalls.push("clear"),
      setLspHover: (...args) => gridCalls.push(["hover", ...args]),
      visibleRowIndexes: () => [0, 1],
      visibleColumnIndexes: () => [0, 1]
    },
    activeDoc: () => doc,
    docToUri,
    isDocReadyForHover: () => false,
    effectiveVectorLspHoverEnabled: () => true,
    recordLintEngineEvent: (name, details) => lintEvents.push([name, details]),
    recordLspTraffic: (uri, kind, details) => traffic.push([uri, kind, details]),
    recordLspReadiness: (uri, kind, details) => readiness.push([uri, kind, details]),
    reportHoverFailure: (target, error, context) => gridCalls.push(["failure", target?.fileName, String(error), context]),
    computeCharOffset: () => 0,
    perfNow: () => now += 5
  });

  await controller.requestHover(1, 0);

  assert.equal(controller.perf.hoverPerfSamples.length, 1);
  assert.equal(controller.perf.hoverPerfSamples[0].targetKind, "diagnostic-cell");
  assert.equal(controller.perf.hoverQueueSamples.at(-1).reason, "queued-until-ready");
  assert.equal(readiness[0][1], "firstHoverRequested");
  assert.equal(traffic.at(-1)[1], "hover_cache_miss");
  assert.deepEqual(lintEvents, []);

  controller.clearVisibleHover("unit-clear");
  assert.equal(controller.perf.hoverQueueSamples.at(-1).reason, "unit-clear");
  controller.invalidateHover(true, "unit-invalidate");
  assert.deepEqual(gridCalls, ["clear"]);
});

test("workspace start full invalidation clears semantic Vector-LSP hover cache", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("skills.txt", "skill\tskilldesc\nsmoke-skill\tdesc-smoke", { path: "E:\\Data\\skills.txt" });
  const uri = docToUri(doc);
  resetLspDocumentState(doc, { version: 1 });
  const docState = lspDocumentState(doc);
  docState.opened = true;
  docState.openedUri = uri;
  docState.openedVersion = 1;
  docState.hoverReady = true;
  const state = {
    docs: [doc],
    active: 0,
    lint: {
      enabled: true,
      engine: LINT_ENGINE_VECTOR,
      version: 1,
      status: "",
      diagnostics: [{
        fileKey: "e:/data/skills.txt",
        rowIndex: 1,
        columnIndex: 0,
        message: "diagnostic on another cell"
      }]
    },
    lsp: { started: true, openFileCount: 0 },
    lspLogs: [],
    bottomTab: "problems",
    contextMenuOpen: false
  };
  const hoverCalls = [];
  const gridCalls = [];
  const tauriCalls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          tauriCalls.push([command, args]);
          if (command === "lsp_start" || command === "lsp_open_file") return;
          throw new Error(`unexpected invoke: ${command}`);
        }
      },
      event: { listen: async () => () => {} }
    }
  };
  const flushHover = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const hoverTexts = ["FIRST", "SECOND"];

  try {
    const controller = createLspController({
      state,
      els: { logList: null, host: { focus() {} } },
      grid: {
        clearLspHovers: () => gridCalls.push(["clear"]),
        setLspHover: (...args) => gridCalls.push(["hover", ...args]),
        visibleRowIndexes: () => [0, 1],
        visibleColumnIndexes: () => [0, 1],
        setDocument() {},
        scrollCellIntoView() {},
        draw() {}
      },
      activeDoc: () => doc,
      isVectorLintEngine: () => true,
      effectiveVectorLspHoverEnabled: () => true,
      recordLintEngineEvent: () => {},
      perfNow: () => 100,
      showToast: () => {},
      showError: () => {},
      setLintDiagnostics: (diagnostics) => { state.lint.diagnostics = diagnostics; },
      updateGridDiagnostics: () => {},
      renderChrome: () => {},
      addDocument: async () => {},
      applyFreezeToDoc: () => {},
      updateActiveProblemHighlight: () => {},
      lintPathKey: (pathValue) => String(pathValue || "").replace(/\\/g, "/").toLowerCase(),
      lspHoverRequest: async (...args) => {
        hoverCalls.push(args);
        return hoverTexts.shift();
      }
    });

    await controller.requestHover(1, 1);
    await flushHover();
    await controller.requestHover(1, 1);
    await flushHover();
    assert.equal(hoverCalls.length, 1);
    assert.deepEqual(gridCalls.filter((call) => call[0] === "hover").map((call) => call[3]), ["FIRST", "FIRST"]);

    await controller.startWorkspace("E:\\Data");
    const restartedState = lspDocumentState(doc);
    restartedState.opened = true;
    restartedState.openedUri = uri;
    restartedState.openedVersion = 1;
    restartedState.hoverReady = true;

    await controller.requestHover(1, 1);
    await flushHover();
    assert.equal(hoverCalls.length, 2);
    assert.equal(gridCalls.filter((call) => call[0] === "hover").at(-1)[3], "SECOND");
    assert.deepEqual(tauriCalls, [
      ["lsp_start", { workspacePath: "E:\\Data", generation: 1 }],
      ["lsp_open_file", { uri, version: 1, text: doc.toText(), generation: 1 }]
    ]);
  } finally {
    resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("TXTeditor LSP controller routes runtime operations through the Tauri boundary", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("skills.txt", "skill\tskilldesc\tsrvstfunc\nsmoke-skill\tdesc-smoke\tbad-int", { path: "E:\\Data\\skills.txt" });
  const uri = docToUri(doc);
  const listeners = new Map();
  const calls = [];
  const gridCalls = [];
  const renderStatuses = [];
  const diagnosticResponses = [
    [{
      row: 1,
      col: 2,
      startCharacter: 27,
      endCharacter: 30,
      cellStartCharacter: 23,
      cellEndCharacter: 30,
      severity: "error",
      message: "bad integer",
      code: "type"
    }],
    []
  ];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          if (command === "lsp_get_diagnostics_batch") {
            return args.requests.map(() => diagnosticResponses.shift() ?? []);
          }
          if (command === "lsp_hover") return "BOUNDARY-HOVER";
          if (command === "lsp_definition") return { uri, line: 1, character: 0 };
          return undefined;
        }
      },
      event: {
        listen: async (event, callback) => {
          listeners.set(event, callback);
          return () => listeners.delete(event);
        }
      }
    }
  };
  const state = {
    docs: [doc],
    active: 0,
    lint: { enabled: true, engine: LINT_ENGINE_VECTOR, version: 1, status: "", diagnostics: [] },
    lsp: { started: false, openFileCount: 0 },
    lspLogs: [],
    bottomTab: "problems",
    contextMenuOpen: false,
    contextHit: null,
    selection: {
      focus: { row: 1, column: 1 },
      set(row, column) {
        this.focus = { row, column };
      }
    }
  };
  const flushAsync = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  try {
    const controller = createLspController({
      state,
      els: { logList: null, host: { focus: () => calls.push(["focus"]) } },
      grid: {
        clearLspHovers: () => gridCalls.push(["clear"]),
        setLspHover: (...args) => gridCalls.push(["hover", ...args]),
        visibleRowIndexes: () => [0, 1],
        visibleColumnIndexes: () => [0, 1, 2],
        setDocument: () => gridCalls.push(["set-document"]),
        scrollCellIntoView: (...args) => gridCalls.push(["scroll", ...args]),
        draw: () => gridCalls.push(["draw"])
      },
      activeDoc: () => state.docs[state.active],
      isVectorLintEngine: () => true,
      effectiveVectorLspHoverEnabled: () => true,
      recordLintEngineEvent: () => {},
      perfNow: () => 200,
      showToast: (message) => calls.push(["toast", message]),
      showError: (error) => calls.push(["show-error", String(error)]),
      setLintDiagnostics: (diagnostics) => { state.lint.diagnostics = diagnostics; },
      updateGridDiagnostics: () => gridCalls.push(["diagnostics"]),
      renderChrome: () => renderStatuses.push(state.lint.status),
      addDocument: async () => {},
      applyFreezeToDoc: () => {},
      updateActiveProblemHighlight: () => gridCalls.push(["active-problem"]),
      lintPathKey: (pathValue) => String(pathValue || "").replace(/\\/g, "/").toLowerCase()
    });

    controller.startListeners();
    await flushAsync();
    await controller.startWorkspace("E:\\Data");
    await listeners.get("lsp-diagnostics-changed")?.({ payload: uri });
    assert.equal(state.lint.diagnostics.length, 1);
    assert.equal(state.lint.diagnostics[0].localStart, 4);
    assert.equal(state.lint.diagnostics[0].localEnd, 7);
    assert.equal(state.lint.diagnostics[0].hasPreciseRange, true);
    assert.equal(lspDocumentState(doc).hoverReady, true);

    doc.setCell(1, 2, "0");
    await controller.updateDoc(doc, { kind: "replaceRows", rows: [1] });
    await listeners.get("lsp-diagnostics-changed")?.({ payload: uri });
    assert.equal(state.lint.diagnostics.length, 0);
    await controller.requestHover(1, 1);
    await flushAsync();
    await controller.goToDefinition();
    await controller.closeDoc(doc);

    assert.deepEqual(calls.filter((call) => call[0] === "lsp_start" || call[0] === "lsp_open_file" || call[0] === "lsp_get_diagnostics_batch" || call[0] === "lsp_update_file_incremental" || call[0] === "lsp_hover" || call[0] === "lsp_definition" || call[0] === "lsp_close_file").map((call) => call[0]), [
      "lsp_start",
      "lsp_open_file",
      "lsp_get_diagnostics_batch",
      "lsp_update_file_incremental",
      "lsp_get_diagnostics_batch",
      "lsp_hover",
      "lsp_definition",
      "lsp_close_file",
      "lsp_get_diagnostics_batch"
    ]);
    assert.equal(gridCalls.some((call) => call[0] === "hover" && call[3] === "BOUNDARY-HOVER"), true);
    assert.deepEqual(state.selection.focus, { row: 1, column: 0 });
    assert.equal(state.lint.diagnostics.length, 0);
    assert.equal(renderStatuses.includes("Connecting to linter..."), true);
  } finally {
    resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Vector-LSP tooltip removes duplicate value titles only", () => {
  assert.deepEqual(
    normalizeVectorLspTooltip("StrClassOnly", "StrClassOnly\r\n\r\nLookup column used by string class filters."),
    { title: "StrClassOnly", detail: "Lookup column used by string class filters." }
  );
  assert.deepEqual(
    normalizeVectorLspTooltip("StrClassOnly", "Different title\n\nStrClassOnly is referenced in another note."),
    { title: "StrClassOnly", detail: "Different title\n\nStrClassOnly is referenced in another note." }
  );
  assert.deepEqual(
    normalizeVectorLspTooltip("", "StrClassOnly\n\nLookup column used by string class filters."),
    { title: "StrClassOnly", detail: "Lookup column used by string class filters." }
  );
});

test("Vector-LSP tooltip policy builds sections and viewport-aware positions", () => {
  assert.deepEqual(
    vectorTooltipSections({
      value: "StrClassOnly",
      hoverText: "StrClassOnly\n\nLookup column used by string class filters.",
      diagnostics: []
    }),
    [
      { kind: "value", className: "cell-tooltip-value", text: "StrClassOnly" },
      { kind: "hover", className: "cell-tooltip-hover", text: "Lookup column used by string class filters." }
    ]
  );
  assert.deepEqual(
    vectorTooltipSections({
      value: "StrClassOnly",
      hoverText: "StrClassOnly\n\nLookup column used by string class filters.",
      diagnostics: [{ severity: "warning", message: "Header is non-standard." }]
    }),
    [
      { kind: "diagnostic", className: "cell-tooltip-diag cell-tooltip-diag-warning", text: "Header is non-standard." }
    ]
  );
  assert.deepEqual(vectorTooltipSections({ value: "", hoverText: "", diagnostics: [] }), []);
  assert.deepEqual(
    vectorTooltipPosition({
      clientX: 100,
      clientY: 50,
      rect: { width: 80, height: 40 },
      viewportWidth: 400,
      viewportHeight: 300
    }),
    { left: "114px", top: "64px" }
  );
  assert.deepEqual(
    vectorTooltipPosition({
      clientX: 390,
      clientY: 290,
      rect: { width: 80, height: 40 },
      viewportWidth: 400,
      viewportHeight: 300
    }),
    { left: "304px", top: "244px" }
  );
});

test("Vector-LSP display diagnostics retain precise range metadata", () => {
  const doc = TableDocument.fromText("skills.txt", "name\tcalc\n\uD55C\uAE00\tskill(Hammer of the Ancients'.blvl)", { path: "E:\\Data\\skills.txt" });
  const uri = docToUri(doc);
  const cellValue = doc.getCell(1, 1);
  const cellStartCharacter = "\uD55C\uAE00\t".length;
  const startCharacter = cellStartCharacter + "skill(Hammer of the Ancients".length;
  const diagnostic = mapLspDiagnosticToDisplay({
    row: 1,
    col: 1,
    startCharacter,
    endCharacter: startCharacter + 1,
    cellStartCharacter,
    cellEndCharacter: cellStartCharacter + cellValue.length,
    severity: "error",
    message: "Invalid calc formula at position 108",
    code: "calcCheck"
  }, {
    uri,
    fileKey: "e:/data/skills.txt",
    fileName: "skills.txt",
    filePath: "E:\\Data\\skills.txt",
    index: 0,
    doc
  });

  assert.equal(diagnostic.rowIndex, 1);
  assert.equal(diagnostic.columnIndex, 1);
  assert.equal(diagnostic.localStart, "skill(Hammer of the Ancients".length);
  assert.equal(diagnostic.localEnd, "skill(Hammer of the Ancients'".length);
  assert.equal(diagnostic.hasPreciseRange, true);
  assert.equal(diagnostic.message, "Invalid calc formula at position 108");
  assert.equal(diagnostic.ruleId, "calcCheck");
  assert.equal(diagnostic.locationLabel, "Row 2, Col 2");
});

test("Vector-LSP display diagnostics preserve structured data and insertion points", () => {
  const formula = "min(5,1+skill('Fire Ball'.blvl)/5";
  const doc = TableDocument.fromText("skills.txt", `id\tcalc\n1\t${formula}`, { path: "E:\\Data\\skills.txt" });
  const cellStartCharacter = "1\t".length;
  const rangeInsertionPoint = cellStartCharacter + formula.length;
  const data = {
    rule: "calcCheck",
    kind: "missing-token",
    expected: ")",
    actual: "EOF",
    insertionPoint: formula.length,
    insertText: ")",
    hint: "Insert ')' at the end of this expression."
  };
  const diagnostic = mapLspDiagnosticToDisplay({
    row: 1,
    col: 1,
    startCharacter: rangeInsertionPoint,
    endCharacter: rangeInsertionPoint,
    cellStartCharacter,
    cellEndCharacter: rangeInsertionPoint,
    severity: "error",
    message: "calcCheck: Missing ')' before end of formula",
    code: "calc.expected-rparen.eof",
    data
  }, {
    uri: docToUri(doc),
    fileKey: "e:/data/skills.txt",
    fileName: "skills.txt",
    filePath: "E:\\Data\\skills.txt",
    index: 0,
    doc
  });

  assert.equal(diagnostic.code, "calc.expected-rparen.eof");
  assert.equal(diagnostic.ruleId, "calc.expected-rparen.eof");
  assert.deepEqual(diagnostic.data, data);
  assert.equal(diagnostic.insertionPoint, formula.length);
  assert.equal(diagnostic.localInsertionPoint, formula.length);
  assert.equal(diagnostic.isInsertionPoint, true);
  assert.equal(diagnostic.hasPreciseRange, true);
});

test("Vector-LSP display diagnostics do not invent precise local ranges without a known cell value", () => {
  const data = {
    kind: "missing-token",
    expected: ")",
    insertionPoint: 17,
    insertText: ")"
  };
  const diagnostic = mapLspDiagnosticToDisplay({
    row: 4,
    col: 2,
    startCharacter: 17,
    endCharacter: 17,
    cellStartCharacter: 0,
    cellEndCharacter: 17,
    severity: "error",
    message: "Invalid calc formula at position 108",
    code: "calc.expected-rparen.eof",
    data
  }, {
    uri: "file:///skills.txt",
    fileKey: "skills.txt",
    fileName: "skills.txt",
    index: 0,
    doc: null
  });

  assert.equal(diagnostic.rowIndex, 4);
  assert.equal(diagnostic.columnIndex, 2);
  assert.equal(diagnostic.startCharacter, 17);
  assert.equal(diagnostic.endCharacter, 17);
  assert.deepEqual(diagnostic.data, data);
  assert.equal(diagnostic.localStart, null);
  assert.equal(diagnostic.localEnd, null);
  assert.equal(diagnostic.localInsertionPoint, null);
  assert.equal(diagnostic.isInsertionPoint, false);
  assert.equal(diagnostic.hasPreciseRange, false);
  assert.equal(diagnostic.locationLabel, "Row 5, Col 3");
});

test("Vector-LSP display diagnostics distinguish known empty cells from unknown cells", () => {
  const doc = TableDocument.fromText("skills.txt", "id\tcalc\n1\t", { path: "E:\\Data\\skills.txt" });
  const data = {
    kind: "missing-token",
    expected: ")",
    insertionPoint: 0,
    insertText: ")"
  };
  const diagnostic = mapLspDiagnosticToDisplay({
    row: 1,
    col: 1,
    startCharacter: 2,
    endCharacter: 2,
    cellStartCharacter: 2,
    cellEndCharacter: 2,
    severity: "error",
    message: "calcCheck: Missing ')' before end of formula",
    code: "calc.expected-rparen.eof",
    data
  }, {
    uri: docToUri(doc),
    fileKey: "e:/data/skills.txt",
    fileName: "skills.txt",
    index: 0,
    doc
  });

  assert.equal(doc.getCell(1, 1), "");
  assert.equal(diagnostic.localStart, 0);
  assert.equal(diagnostic.localEnd, 0);
  assert.equal(diagnostic.localInsertionPoint, 0);
  assert.equal(diagnostic.isInsertionPoint, true);
  assert.equal(diagnostic.hasPreciseRange, true);
});

test("Vector-LSP display diagnostics reject edge-clamped local ranges", () => {
  const doc = TableDocument.fromText("skills.txt", "id\tcalc\n1\tabc", { path: "E:\\Data\\skills.txt" });
  const diagnostic = mapLspDiagnosticToDisplay({
    row: 1,
    col: 1,
    startCharacter: 1,
    endCharacter: 2,
    cellStartCharacter: 2,
    cellEndCharacter: 5,
    severity: "error",
    message: "Invalid calc formula at position 108",
    code: "calcCheck"
  }, {
    uri: docToUri(doc),
    fileKey: "e:/data/skills.txt",
    fileName: "skills.txt",
    index: 0,
    doc
  });

  assert.equal(diagnostic.localStart, null);
  assert.equal(diagnostic.localEnd, null);
  assert.equal(diagnostic.localInsertionPoint, null);
  assert.equal(diagnostic.isInsertionPoint, false);
  assert.equal(diagnostic.hasPreciseRange, false);
});

test("Vector-LSP diagnostic tooltip omits precise range excerpts", () => {
  const singleCharacter = {
    severity: "error",
    message: "Invalid cube input",
    localStart: 2,
    localEnd: 2,
    hasPreciseRange: true
  };
  assert.equal(
    diagnosticTooltipText(singleCharacter),
    "Invalid cube input"
  );
  assert.deepEqual(
    vectorTooltipSections({
      value: "hpot,qty=abc",
      diagnostics: [{
        severity: "error",
        message: "Invalid cube input",
        localStart: 9,
        localEnd: 12,
        hasPreciseRange: true
      }]
    }),
    [{
      kind: "diagnostic",
      className: "cell-tooltip-diag cell-tooltip-diag-error",
      text: "Invalid cube input"
    }]
  );
});

test("Vector-LSP Problems tooltip preserves plain gameplay and fix explanations", () => {
  const missileMessage = "Unknown missile value 'ulvl'. The game treats it as 0, so this part of the calculation has no effect.";
  const consumeMessage = "Unknown stat name 'item_addsksrc _tab'. This Consume bonus is not applied; other Consume slots still work. Use the exact Stat name from itemstatcost.txt.";
  const propertyMessage = "Unknown stat name 'item_strengthpercent_perlevel'. This property has no effect. Use the exact Stat name from itemstatcost.txt.";

  assert.equal(diagnosticTooltipText({
    severity: "error",
    message: missileMessage,
    data: {
      kind: "invalid-argument",
      scope: "Missile scope BBE",
      namespace: "MissCalc.code",
      binaryFallback: "integer constant 0",
      compileEffect: "remaining formula continues"
    }
  }), missileMessage);
  assert.equal(diagnosticTooltipText({
    severity: "warning",
    message: consumeMessage,
    data: {
      kind: "unresolved-reference",
      scope: "monpet-consumestat",
      storedValue: 65535,
      runtimeEffect: "Consume skips only this slot"
    }
  }), consumeMessage);
  assert.equal(diagnosticTooltipText({
    severity: "warning",
    message: propertyMessage,
    data: {
      kind: "unresolved-reference",
      scope: "properties-stat",
      storedValue: 65535,
      runtimeEffect: "The active property slot applies no stat"
    }
  }), propertyMessage);
});

test("Vector-LSP tooltip does not repeat guidance already present in the message", () => {
  const decimal = "Decimal values are not supported here. The game reads '-6.25' as '-6' and ignores '.25'. Use an integer expression that matches your intent.";
  assert.equal(diagnosticTooltipText({
    severity: "warning",
    message: decimal,
    data: {
      kind: "decimal-policy",
      hint: "Use an integer expression that matches your intent."
    }
  }), decimal);

  const prefixStop = "Character ';' is not supported here. The game uses the valid part before it and ignores the rest. Rewrite the expression if the ignored part is intended to run.";
  assert.equal(diagnosticTooltipText({
    severity: "warning",
    message: prefixStop,
    data: {
      kind: "ignored-suffix",
      hint: "Rewrite the expression if the ignored part is intended to run."
    }
  }), prefixStop);

  assert.equal(diagnosticTooltipText({
    severity: "error",
    message: "Invalid calculation: Function 'min()' expects 2 arguments, got 1",
    data: {
      kind: "invalid-argument",
      hint: "Use exactly 2 arguments."
    }
  }), "Invalid calculation: Function 'min()' expects 2 arguments, got 1\n\nWhat to do:\nUse exactly 2 arguments.");
});

test("Vector-LSP tooltip uses structured missing-token data for insertion hints", () => {
  const formula = "min(5,1";
  const diagnostic = {
    severity: "error",
    message: "calcCheck: Missing ')' before end of formula",
    localStart: formula.length,
    localEnd: formula.length,
    localInsertionPoint: formula.length,
    isInsertionPoint: true,
    hasPreciseRange: true,
    data: {
      kind: "missing-token",
      expected: ")",
      actual: "EOF",
      insertionPoint: formula.length,
      insertText: ")"
    }
  };

  assert.equal(diagnosticUserGuidance(diagnostic), "Insert ')' at the marked position.");
  assert.equal(
    diagnosticTooltipText(diagnostic),
    "calcCheck: Missing ')' before end of formula\n\nWhat to do:\nInsert ')' at the marked position."
  );
  assert.deepEqual(
    vectorTooltipSections({
      value: formula,
      diagnostics: [diagnostic]
    }),
    [{
      kind: "diagnostic",
      className: "cell-tooltip-diag cell-tooltip-diag-error",
      text: "calcCheck: Missing ')' before end of formula\n\nWhat to do:\nInsert ')' at the marked position."
    }]
  );
});

test("Vector-LSP tooltip uses structured unexpected-character data for guidance", () => {
  const diagnostic = {
    severity: "error",
    message: "calcCheck: Unexpected character '\"'",
    localStart: 0,
    localEnd: 1,
    hasPreciseRange: true,
    data: {
      kind: "unexpected-character",
      actual: "\""
    }
  };

  assert.equal(
    diagnosticTooltipText(diagnostic),
    "calcCheck: Unexpected character '\"'\n\nWhat to do:\nRemove or replace '\"' at the marked position."
  );
});

test("Vector-LSP tooltip keeps diagnostics message-only when precise range has no action hint", () => {
  const longValue = `${"a".repeat(48)}target-token${"z".repeat(48)}`;
  assert.equal(
    diagnosticTooltipText({
      severity: "error",
      message: "Unknown token",
      localStart: 48,
      localEnd: 54,
      hasPreciseRange: true
    }),
    "Unknown token"
  );
  assert.deepEqual(
    vectorTooltipSections({
      value: longValue,
      diagnostics: [{
        severity: "error",
        message: "Unknown token",
        localStart: 48,
        localEnd: 54,
        hasPreciseRange: true
      }]
    }),
    [{
      kind: "diagnostic",
      className: "cell-tooltip-diag cell-tooltip-diag-error",
      text: "Unknown token"
    }]
  );
  assert.deepEqual(
    vectorTooltipSections({
      value: "whole-cell",
      diagnostics: [{
        severity: "warning",
        message: "Full cell warning",
        localStart: 0,
        localEnd: "whole-cell".length,
        hasPreciseRange: false
      }]
    }),
    [{
      kind: "diagnostic",
      className: "cell-tooltip-diag cell-tooltip-diag-warning",
      text: "Full cell warning"
    }]
  );
});

test("Vector-LSP diagnostics do not parse message text for locations and legacy diagnostics remain unchanged", () => {
  const doc = TableDocument.fromText("skills.txt", "id\tcalc\n1\tabcdef", { path: "E:\\Data\\skills.txt" });
  const diagnostic = mapLspDiagnosticToDisplay({
    row: 1,
    col: 1,
    severity: "error",
    message: "Invalid calc formula at position 4"
  }, {
    uri: docToUri(doc),
    fileKey: "e:/data/skills.txt",
    fileName: "skills.txt",
    index: 2,
    doc
  });

  assert.equal(diagnostic.localStart, null);
  assert.equal(diagnostic.localEnd, null);
  assert.equal(diagnostic.hasPreciseRange, false);
  assert.deepEqual(
    vectorTooltipSections({
      diagnostics: [{ severity: "warning", message: "Legacy lint warning" }]
    }),
    [{
      kind: "diagnostic",
      className: "cell-tooltip-diag cell-tooltip-diag-warning",
      text: "Legacy lint warning"
    }]
  );
});

test("delayed Vector-LSP header and cell hovers are accepted while the target is stable", () => {
  const header = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 0, column: 0, columnName: "description" });
  const cell = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 1, column: 18, columnName: "output" });
  assert.equal(header.targetKind, "header");
  assert.equal(cell.targetKind, "cell");
  assert.deepEqual(
    shouldAcceptVectorHoverResult({
      target: header,
      generation: 2,
      currentTargetKey: header.key,
      currentGeneration: 2,
      vectorHoverEnabled: true,
      contextMenuOpen: false
    }),
    { accepted: true, reason: "" }
  );
  assert.deepEqual(
    shouldAcceptVectorHoverResult({
      target: cell,
      generation: 3,
      currentTargetKey: cell.key,
      currentGeneration: 3,
      vectorHoverEnabled: true,
      contextMenuOpen: false
    }),
    { accepted: true, reason: "" }
  );
});

test("late Vector-LSP result can be accepted by stable target key after version churn", () => {
  const beforeReady = makeVectorHoverTarget({
    uri: "file:///cubemain.txt",
    fileName: "cubemain.txt",
    row: 1,
    column: 6,
    columnName: "op",
    cellValue: "18",
    documentVersion: 1
  });
  const afterReady = makeVectorHoverTarget({
    uri: "file:///cubemain.txt",
    fileName: "cubemain.txt",
    row: 1,
    column: 6,
    columnName: "op",
    cellValue: "18",
    documentVersion: 2
  });
  assert.notEqual(beforeReady.key, afterReady.key);
  assert.equal(beforeReady.matchKey, afterReady.matchKey);
  assert.deepEqual(
    shouldAcceptVectorHoverResult({
      target: beforeReady,
      generation: 1,
      currentTargetKey: afterReady.matchKey,
      currentGeneration: 1,
      vectorHoverEnabled: true,
      contextMenuOpen: false
    }),
    { accepted: true, reason: "" }
  );
});

test("Vector-LSP hover target identity includes version value and diagnostics state", () => {
  const base = makeVectorHoverTarget({
    uri: "file:///cubemain.txt",
    fileName: "cubemain.txt",
    row: 8,
    column: 4,
    columnName: "op",
    cellValue: "useitem",
    documentVersion: 3
  });
  const edited = makeVectorHoverTarget({
    uri: "file:///cubemain.txt",
    fileName: "cubemain.txt",
    row: 8,
    column: 4,
    columnName: "op",
    cellValue: "usetype",
    documentVersion: 4
  });
  const diagnostic = makeVectorHoverTarget({
    uri: "file:///cubemain.txt",
    fileName: "cubemain.txt",
    row: 8,
    column: 4,
    columnName: "op",
    cellValue: "useitem",
    documentVersion: 3,
    hasDiagnostics: true
  });
  assert.equal(base.targetKind, "cell");
  assert.equal(diagnostic.targetKind, "diagnostic-cell");
  assert.notEqual(base.key, edited.key);
  assert.notEqual(base.key, diagnostic.key);
});

test("pending Vector-LSP hover results are discarded for leave, target change, disabled hover, and context menu", () => {
  const first = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 0, column: 0, columnName: "description" });
  const second = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 0, column: 1, columnName: "enabled" });
  assert.equal(
    shouldAcceptVectorHoverResult({
      target: first,
      generation: 1,
      currentTargetKey: first.key,
      currentGeneration: 2,
      vectorHoverEnabled: true,
      contextMenuOpen: false
    }).reason,
    "generation-changed"
  );
  assert.equal(
    shouldAcceptVectorHoverResult({
      target: first,
      generation: 1,
      currentTargetKey: second.key,
      currentGeneration: 1,
      vectorHoverEnabled: true,
      contextMenuOpen: false
    }).reason,
    "target-changed"
  );
  assert.equal(
    shouldAcceptVectorHoverResult({
      target: first,
      generation: 1,
      currentTargetKey: first.key,
      currentGeneration: 1,
      vectorHoverEnabled: false,
      contextMenuOpen: false
    }).reason,
    "hover-disabled"
  );
  assert.equal(
    shouldAcceptVectorHoverResult({
      target: first,
      generation: 1,
      currentTargetKey: first.key,
      currentGeneration: 1,
      vectorHoverEnabled: true,
      contextMenuOpen: true
    }).reason,
    "context-menu-open"
  );
});

test("Vector-LSP hover samples record queued, requested, rendered, and canceled timings", () => {
  let tick = 100;
  const now = () => tick;
  const target = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 4, column: 0, columnName: "description" });
  const sample = startVectorHoverSample(target, { now, vectorHoverEnabled: true, cached: false, lspReady: false });
  assert.equal(sample.targetKind, "leftmost");
  assert.equal(sample.requestedAt, null);
  assert.equal(sample.lspReady, false);
  tick = 130;
  markVectorHoverRequested(sample, now);
  assert.equal(sample.requestedAt, 130);
  assert.equal(sample.lspReady, true);
  tick = 165;
  sample.responseAt = now();
  tick = 170;
  finishVectorHoverSample(sample, { now, contentReturned: true, rendered: true });
  assert.equal(sample.contentReturned, true);
  assert.equal(sample.noContent, false);
  assert.equal(sample.accepted, true);
  assert.equal(sample.renderedAt, 170);
  assert.equal(sample.tooltipRenderedAt, 170);
  assert.equal(sample.requestSentAt, 130);
  assert.equal(sample.lspResponseAt, 165);
  assert.equal(sample.totalMs, 70);
  assert.equal(sample.lspMs, 35);
  assert.equal(sample.renderMs, 5);

  const canceled = startVectorHoverSample(target, { now, vectorHoverEnabled: true, cached: false, lspReady: true });
  tick = 180;
  cancelVectorHoverSample(canceled, "grid-hover-cleared", now);
  assert.equal(canceled.canceled, true);
  assert.equal(canceled.cancelReason, "grid-hover-cleared");
  assert.equal(canceled.discarded, true);
  assert.equal(canceled.discardReason, "grid-hover-cleared");
});

test("accepted Vector-LSP no-content samples are recorded without rendering", () => {
  let tick = 300;
  const now = () => tick;
  const target = makeVectorHoverTarget({ uri: "file:///armor.txt", fileName: "armor.txt", row: 1, column: 4, columnName: "code", cellValue: "cap" });
  const sample = startVectorHoverSample(target, { now, vectorHoverEnabled: true, cached: false, lspReady: true });
  tick = 310;
  markVectorHoverRequested(sample, now);
  tick = 340;
  finishVectorHoverSample(sample, { now, contentReturned: false, rendered: false, pointerStillOnTarget: true });
  assert.equal(sample.accepted, true);
  assert.equal(sample.noContent, true);
  assert.equal(sample.contentReturned, false);
  assert.equal(sample.tooltipRenderedAt, null);
  assert.equal(sample.totalMs, 40);
});

test("canceled Vector-LSP hover samples cannot be finished by late responses", () => {
  let tick = 200;
  const now = () => tick;
  const target = makeVectorHoverTarget({ uri: "file:///cubemain.txt", fileName: "cubemain.txt", row: 1, column: 0, columnName: "description", cellValue: "test" });
  const sample = startVectorHoverSample(target, { now, vectorHoverEnabled: true, cached: false, lspReady: true });
  tick = 220;
  cancelVectorHoverSample(sample, "target-changed", now);
  tick = 260;
  finishVectorHoverSample(sample, { now, contentReturned: true, rendered: true, pointerStillOnTarget: true });
  assert.equal(sample.canceled, true);
  assert.equal(sample.accepted, false);
  assert.equal(sample.cancelReason, "target-changed");
  assert.equal(sample.renderedAt, null);
  assert.equal(sample.totalMs, 20);
});

test("Vector-LSP hover dispatch has no artificial delay", () => {
  assert.equal(VECTOR_LSP_HOVER_DELAY_MS, 0);
  assert.equal(hoverRequestPolicy({
    pendingRow: -1,
    pendingCol: -1,
    lastRequestRow: -1,
    lastRequestCol: -1,
    row: 3,
    column: 1
  }).shouldRequest, true);
});

test("Legacy Lint and Vector-LSP activation stay independent of dock placement", () => {
  assert.equal(lintEnginePanelActive({ problemsVisible: true, lintEnabled: true, engine: "legacy", targetEngine: "legacy" }), true);
  assert.equal(lintEnginePanelActive({ problemsVisible: true, lintEnabled: true, engine: "vector-lsp", targetEngine: "legacy" }), false);
  assert.equal(lintEnginePanelActive({ problemsVisible: false, lintEnabled: true, engine: "legacy", targetEngine: "legacy" }), false);
  assert.equal(lintEnginePanelActive({
    problemsVisible: true,
    lintEnabled: true,
    engine: "legacy",
    targetEngine: "legacy",
    dockLayout: { problems: "left" }
  }), true);
});

test("context menu suspends default and Vector-LSP hover until it closes", () => {
  assert.deepEqual(contextMenuHiddenState(), { contextMenuActiveGroup: "", contextMenuOpen: false });
  assert.deepEqual(contextMenuOpenTransition(true), {
    contextMenuOpen: true,
    hoverSuspended: true,
    clearVisibleHoverReason: "context-menu-open"
  });
  assert.deepEqual(contextMenuOpenTransition(false), {
    contextMenuOpen: false,
    hoverSuspended: false,
    clearVisibleHoverReason: null
  });
  assert.deepEqual(visibleHoverClearEvent({ reason: "grid-hover-cleared", inFlight: 2 }), {
    reason: "grid-hover-cleared",
    visibleClear: true,
    inFlight: 2
  });
  assert.equal(visibleHoverClearKeepsPendingRequests(), true);
  const hoverStateCalls = [];
  const hoverGrid = {
    hoverSuspended: false,
    clearHoverState: () => hoverStateCalls.push("clear-hover")
  };
  CanvasGrid.prototype.setHoverSuspended.call(hoverGrid, true);
  CanvasGrid.prototype.setHoverSuspended.call(hoverGrid, false);
  assert.equal(hoverGrid.hoverSuspended, false);
  assert.deepEqual(hoverStateCalls, ["clear-hover"]);
  assert.equal(isGridHoverAllowed({ hoverSuspended: true, resizing: null, dragging: false }), false);
  assert.equal(isGridHoverAllowed({ hoverSuspended: false, resizing: null, dragging: false }), true);
  assert.deepEqual(hoverTooltipPresentation({
    hoverAllowed: false,
    hitKind: "cell",
    dragging: false,
    vectorLspHoverEnabled: true
  }), { action: "clear" });
  assert.deepEqual(hoverTooltipPresentation({
    hoverAllowed: true,
    hitKind: "row-header",
    dragging: false,
    vectorLspHoverEnabled: true
  }), { action: "clear" });
  const hoverRequests = [];
  CanvasGrid.prototype._scheduleHoverRequest.call({
    isHoverAllowed: () => false,
    vectorLspHoverEnabled: true,
    onHoverRequest: (...args) => hoverRequests.push(args)
  }, 2, 1);
  assert.deepEqual(hoverRequests, []);
  assert.equal(isHoverTargetCurrent({ row: 2, col: 1 }, 2, 1), true);
  assert.equal(isHoverTargetCurrent({ row: 2, col: 1 }, 2, 0), false);
  assert.equal(hoverStateHasActivity({ hoveredCell: null, pendingRow: -1, pendingCol: -1, legacyPreviewVisible: false, vectorTooltipVisible: false }), false);
  assert.equal(hoverStateHasActivity({ hoveredCell: { row: 2, col: 1 } }), true);
  assert.equal(hoverStateHasActivity({ pendingRow: 2 }), true);
  assert.equal(hoverStateHasActivity({ legacyPreviewVisible: true }), true);
});

test("Vector-LSP hover can be disabled without clearing baseline hover behavior", () => {
  assert.equal(vectorLspHoverFromStorage(null), true);
  assert.equal(vectorLspHoverFromStorage("on"), true);
  assert.equal(vectorLspHoverFromStorage("off"), false);
  assert.equal(vectorLspHoverStorageValue(true), "on");
  assert.equal(vectorLspHoverStorageValue(false), "off");
  assert.equal(effectiveVectorLspHover({ engine: LINT_ENGINE_VECTOR, vectorLspHover: true }), true);
  assert.equal(effectiveVectorLspHover({ engine: LINT_ENGINE_VECTOR, vectorLspHover: false }), false);
  assert.equal(effectiveVectorLspHover({ engine: LINT_ENGINE_LEGACY, vectorLspHover: true }), false);
  const target = makeVectorHoverTarget({ uri: "file:///skills.txt", fileName: "skills.txt", row: 2, column: 0, cellValue: "cap" });
  const rejected = shouldAcceptVectorHoverResult({
    target,
    generation: 1,
    currentTargetKey: target.matchKey,
    currentGeneration: 1,
    vectorHoverEnabled: false,
    contextMenuOpen: false
  });
  assert.deepEqual(rejected, { accepted: false, reason: "hover-disabled" });
  let now = 10;
  const sample = startVectorHoverSample(target, { now: () => now, vectorHoverEnabled: false, cached: false, lspReady: true });
  now = 12;
  assert.equal(cancelVectorHoverSample(sample, rejected.reason, () => now).cancelReason, "hover-disabled");
  const hoverToggleCalls = [];
  const toggleGrid = {
    vectorLspHoverEnabled: true,
    clearLspHovers: () => hoverToggleCalls.push("clear-lsp"),
    requestRender: (reason) => hoverToggleCalls.push(["render", reason])
  };
  CanvasGrid.prototype.setVectorLspHoverEnabled.call(toggleGrid, false);
  assert.equal(toggleGrid.vectorLspHoverEnabled, false);
  assert.deepEqual(hoverToggleCalls, ["clear-lsp", ["render", "vector-lsp-hover"]]);

  const hoverRequests = [];
  CanvasGrid.prototype._scheduleHoverRequest.call({
    isHoverAllowed: () => true,
    vectorLspHoverEnabled: false,
    onHoverRequest: (...args) => hoverRequests.push(args)
  }, 2, 0);
  assert.deepEqual(hoverRequests, []);
  assert.deepEqual(hoverTooltipPresentation({
    hoverAllowed: true,
    hitKind: "cell",
    dragging: false,
    vectorLspHoverEnabled: false,
    value: "cap"
  }), { action: "legacy-disabled" });
  assert.deepEqual(hoverTooltipPresentation({
    hoverAllowed: true,
    hitKind: "cell",
    dragging: false,
    vectorLspHoverEnabled: true,
    value: "cap"
  }), { action: "vector-tooltip" });
  assert.deepEqual(hoverTooltipPresentation({
    hoverAllowed: true,
    hitKind: "cell",
    dragging: false,
    vectorLspHoverEnabled: true,
    value: ""
  }), { action: "legacy-fallback" });
  const legacyCalls = [];
  const legacyGrid = {
    hideVectorTooltip: () => legacyCalls.push("hide-vector"),
    updateFirstColumnHoverPreview: (hit, event) => legacyCalls.push(["update-preview", hit, event]),
    hideFirstColumnHoverPreview: () => legacyCalls.push("hide-preview")
  };
  const event = { clientX: 20, clientY: 30 };
  CanvasGrid.prototype.showLegacyHoverPreview.call(legacyGrid, { kind: "cell", row: 2, column: 0 }, event, "cap");
  CanvasGrid.prototype.showLegacyHoverPreview.call(legacyGrid, { kind: "cell", row: 2, column: 1 }, event, "cap");
  assert.deepEqual(legacyCalls, [
    "hide-vector",
    ["update-preview", { kind: "cell", row: 2, column: 0 }, event],
    "hide-vector",
    "hide-preview"
  ]);
});

test("lint engine selector defaults to Vector-LSP and persists separately from lint settings", () => {
  assert.equal(LINT_ENGINE_VECTOR, "vector-lsp");
  assert.equal(LINT_ENGINE_LEGACY, "legacy");
  assert.equal(normalizeLintEngine("legacy"), LINT_ENGINE_LEGACY);
  assert.equal(normalizeLintEngine("other"), LINT_ENGINE_VECTOR);
  assert.equal(isVectorLintEngineValue(LINT_ENGINE_VECTOR), true);
  assert.equal(isLegacyLintEngineValue(LINT_ENGINE_LEGACY), true);
  assert.equal(documentChangeSyncRoute(LINT_ENGINE_VECTOR), "vector-update");
  assert.equal(documentChangeSyncRoute(LINT_ENGINE_LEGACY), "legacy-lint-edit");
  assert.equal(documentOpenSyncRoute(LINT_ENGINE_VECTOR), "vector-open");
  assert.equal(documentOpenSyncRoute(LINT_ENGINE_LEGACY), "legacy-lint-open");
  assert.equal(vectorSessionAvailable({ engine: LINT_ENGINE_VECTOR, lspStarted: true }), true);
  assert.equal(vectorSessionAvailable({ engine: LINT_ENGINE_VECTOR, lspStarted: false }), false);
  assert.equal(vectorSessionAvailable({ engine: LINT_ENGINE_LEGACY, lspStarted: true }), false);
  assert.equal(lintEngineStorageValue("legacy"), "legacy");
  assert.equal(lintEngineStorageValue("other"), "vector-lsp");
  assert.equal(lintSettingsStorageValue({ enabled: false }), "{\"enabled\":false}");
  assert.equal(legacyLintSettingsStorageValue({ profile: "RotW" }), "{\"profile\":\"RotW\"}");
});

test("Settings and Problems controls switch between Vector-LSP and Legacy Lint", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const settingsControls = appSettingsVisualControls({ vectorLspHover: true, legacyLintEngine: true });
  const vectorControls = lintControlsModel({ engine: LINT_ENGINE_VECTOR, lintEnabled: true });
  const legacyControls = lintControlsModel({
    engine: LINT_ENGINE_LEGACY,
    lintEnabled: false,
    profiles: ["RotW", "2.4"],
    activeProfile: "2.4",
    activeReferenceVersion: "3.1",
    rulesOpen: true
  });
  assert.match(html, /id="lintControls" class="lint-controls"/);
  assert.match(html, /id="lintRulesPanel" class="lint-rules-panel hidden"/);
  assert.equal(settingsControls.vectorHover.checked, true);
  assert.equal(settingsControls.vectorHover.disabled, true);
  assert.equal(settingsControls.vectorHover.hintHidden, false);
  assert.deepEqual(lintToggleControl(true), { id: "toggle-lint", label: "Lint: On", active: true });
  assert.equal(vectorControls.mode, "vector-lsp");
  assert.deepEqual(vectorControls.settingsButton, { id: "open-settings", label: "Lint Options", title: "Lint options" });
  assert.equal(vectorControls.hideRulesPanel, true);
  assert.equal(legacyControls.mode, "legacy");
  assert.equal(legacyControls.profileSelect.id, "lintProfileSelect");
  assert.deepEqual(legacyControls.profileSelect.options, [
    { value: "RotW", label: "RotW", selected: false },
    { value: "2.4", label: "2.4", selected: true }
  ]);
  assert.equal(legacyControls.referenceSelect.id, "lintReferenceVersionSelect");
  assert.deepEqual(legacyControls.referenceSelect.options, [
    { value: "", label: "Profile", selected: false },
    { value: "3.2", label: "3.2", selected: false },
    { value: "3.1", label: "3.1", selected: true },
    { value: "2.4", label: "2.4", selected: false },
    { value: "1.13c", label: "1.13c", selected: false }
  ]);
  assert.deepEqual(legacyControls.rulesButton, { id: "toggle-lint-rules", label: "Rules", active: true });
  assert.equal(legacyControls.settingsButton, null);
});

test("Legacy Lint is isolated from Vector-LSP traffic and writes the shared diagnostic pipeline", () => {
  assert.deepEqual(legacyLintOpenSchedule("file-opened"), { reason: "file-opened", delay: 0 });
  assert.deepEqual(legacyLintEditSchedule({ displayActive: false, hasDiagnostics: true }), null);
  assert.deepEqual(legacyLintEditSchedule({ displayActive: true, hasDiagnostics: true }), { reason: "diagnostic-file-edited", delay: 120 });
  assert.deepEqual(legacyLintEditSchedule({ displayActive: true, hasDiagnostics: false }), { reason: "file-edited", delay: 180 });
  assert.equal(documentChangeSyncRoute(LINT_ENGINE_VECTOR), "vector-update");
  assert.equal(documentChangeSyncRoute(LINT_ENGINE_LEGACY), "legacy-lint-edit");
  assert.equal(documentOpenSyncRoute(LINT_ENGINE_VECTOR), "vector-open");
  assert.equal(documentOpenSyncRoute(LINT_ENGINE_LEGACY), "legacy-lint-open");
  assert.equal(vectorSessionAvailable({ engine: LINT_ENGINE_VECTOR, lspStarted: true }), true);
  assert.equal(vectorSessionAvailable({ engine: LINT_ENGINE_VECTOR, lspStarted: false }), false);
  assert.equal(vectorSessionAvailable({ engine: LINT_ENGINE_LEGACY, lspStarted: true }), false);
});

test("resize interactions clear hover state and block stale hover results", () => {
  assert.equal(shouldClearHoverForInteraction({ resizeHandle: true }), true);
  assert.equal(shouldClearHoverForInteraction({ resizing: true }), true);
  assert.equal(shouldClearHoverForInteraction({}), false);
  assert.equal(isGridHoverAllowed({ hoverSuspended: false, resizing: null, dragging: false }), true);
  assert.equal(isGridHoverAllowed({ hoverSuspended: true, resizing: null, dragging: false }), false);
  assert.equal(isGridHoverAllowed({ hoverSuspended: false, resizing: { kind: "row" }, dragging: false }), false);
  assert.equal(isGridHoverAllowed({ hoverSuspended: false, resizing: null, dragging: true }), false);
  assert.equal(isHoverTargetCurrent({ row: 3, col: 1 }, 3, 1), true);
  assert.equal(isHoverTargetCurrent({ row: 3, col: 1 }, 3, 2), false);
});

test("header and Vector-LSP hover clear immediately on pointer leave", () => {
  const listeners = {};
  const leaveEvents = [];
  bindHoverExitEvents({
    addEventListener: (eventName, handler) => {
      listeners[eventName] = handler;
    }
  }, (event) => leaveEvents.push(event));
  listeners.mouseleave({ type: "mouseleave" });
  listeners.pointerleave({ type: "pointerleave" });
  assert.deepEqual(leaveEvents, [{ type: "mouseleave" }, { type: "pointerleave" }]);
  assert.equal(shouldClearHoverForInteraction({ pointerLeave: true }), true);
  assert.equal(shouldClearHoverForInteraction({ scroll: true }), true);
  assert.equal(hoverStateHasActivity({ hoverDebounceTimer: 1 }), true);
  assert.equal(hoverStateHasActivity({ vectorTooltipVisible: true }), true);
  const doc = {};
  const scrollCalls = [];
  applyGridScrollState({
    doc,
    scrollLeft: 13,
    scrollTop: 21,
    clearHoverState: () => scrollCalls.push("clear-hover"),
    requestRender: (reason) => scrollCalls.push(["render", reason]),
    onViewportChanged: (reason) => scrollCalls.push(["viewport", reason])
  });
  assert.deepEqual(doc, { scrollLeft: 13, scrollTop: 21 });
  assert.deepEqual(scrollCalls, ["clear-hover", ["render", "scroll"], ["viewport", "scroll"]]);
});

test("Vector-LSP tooltip owns leftmost hover and legacy preview is fallback only", () => {
  assert.equal(vectorTooltipShouldOwnCell({ hoverText: "docs", diagnostics: [], value: "" }), true);
  assert.equal(vectorTooltipShouldOwnCell({ hoverText: "", diagnostics: [{ message: "warn" }], value: "" }), true);
  assert.equal(vectorTooltipShouldOwnCell({ hoverText: "", diagnostics: [], value: "  local value  " }), true);
  assert.equal(vectorTooltipShouldOwnCell({ hoverText: "", diagnostics: [], value: "   " }), false);
  assert.equal(isHoverTargetCurrent({ row: 2, col: 0 }, 2, 0), true);
  assert.equal(isHoverTargetCurrent({ row: 2, col: 0 }, 3, 0), false);
});

test("Vector-LSP hover app cache stores ready no-content results with version and TTL", () => {
  const target = {
    key: "exact-key",
    uri: "file:///skills.txt",
    documentVersion: 4,
    targetKind: "diagnostic-cell",
    column: 2,
    columnName: "skilldesc",
    cellValue: "Firebolt",
    hasDiagnostics: false
  };
  assert.equal(HOVER_NO_CONTENT_TTL_MS, 60_000);
  assert.equal(makeHoverSemanticCacheKey(target), "file:///skills.txt\u001f4\u001fcell\u001fskilldesc\u001fFirebolt");
  assert.equal(makeHoverSemanticCacheKey({ ...target, targetKind: "header", column: 2 }), "file:///skills.txt\u001f4\u001fheader\u001f2\u001fskilldesc");

  const noContent = makeHoverCacheEntry(target, "", { now: () => 1_000 });
  assert.deepEqual(noContent, {
    text: null,
    hasContent: false,
    noContent: true,
    uri: "file:///skills.txt",
    documentVersion: 4,
    semanticKey: "file:///skills.txt\u001f4\u001fcell\u001fskilldesc\u001fFirebolt",
    cachedAt: 1_000
  });
  assert.equal(isHoverCacheEntryUsable(noContent, target, { now: () => 1_000 + HOVER_NO_CONTENT_TTL_MS }), true);
  assert.equal(isHoverCacheEntryUsable(noContent, target, { now: () => 1_001 + HOVER_NO_CONTENT_TTL_MS }), false);
  assert.equal(isHoverCacheEntryUsable(noContent, { ...target, documentVersion: 5 }, { now: () => 1_100 }), false);

  const withContent = { ...makeHoverCacheEntry(target, "docs", { now: () => 2_000 }), cacheSource: "semantic" };
  assert.equal(withContent.text, "docs");
  assert.equal(withContent.hasContent, true);
  assert.equal(hoverCacheStoredState(noContent), "no-content-stored");
  assert.equal(hoverCacheStoredState(withContent), "stored");
  assert.equal(hoverCacheHitState({ ...noContent, cacheSource: "exact" }), "exact-no-content-hit");
  assert.equal(hoverCacheHitState(withContent), "semantic-hit");
  assert.equal(targetHasImmediateTooltip({ hasDiagnostics: true, cellValue: "" }), true);
  assert.equal(targetHasImmediateTooltip({ hasDiagnostics: false, cellValue: "  local  " }), true);
  assert.equal(targetHasImmediateTooltip({ hasDiagnostics: false, cellValue: "   " }), false);
});

test("Vector-LSP hover queue keeps one active request and one latest replacement", () => {
  const target = { key: "hover:1" };
  const sample = { id: "sample" };
  const request = createUserHoverRequest({ target, generation: 3, sample, queuedAt: 42 });
  assert.deepEqual(request, { target, generation: 3, sample, queuedAt: 42 });

  assert.equal(activeHoverQueueLength({ activeRequest: null, latestQueuedRequest: null }), 0);
  assert.equal(activeHoverQueueLength({ activeRequest: request, latestQueuedRequest: null }), 1);
  assert.equal(activeHoverQueueLength({ activeRequest: request, latestQueuedRequest: { sample: { id: "latest" } } }), 2);

  assert.deepEqual(planUserHoverEnqueue({ hasPending: true, activeRequest: null, latestQueuedRequest: null }), {
    action: "attach-pending",
    replaceLatest: false
  });
  assert.deepEqual(planUserHoverEnqueue({ hasPending: false, activeRequest: null, latestQueuedRequest: null }), {
    action: "dispatch",
    replaceLatest: false
  });
  assert.deepEqual(planUserHoverEnqueue({ hasPending: false, activeRequest: request, latestQueuedRequest: null }), {
    action: "queue-latest",
    replaceLatest: false
  });
  assert.deepEqual(planUserHoverEnqueue({ hasPending: false, activeRequest: request, latestQueuedRequest: { sample: { id: "older" } } }), {
    action: "queue-latest",
    replaceLatest: true
  });
  assert.deepEqual(takeLatestQueuedHover(request), { next: request, latestQueuedRequest: null });
  assert.deepEqual(takeLatestQueuedHover(null), { next: null, latestQueuedRequest: null });
});

test("Vector-LSP traffic counters and idempotent didOpen state are exposed for runtime proof", () => {
  const lspTraffic = createLspTrafficState();
  const lspReadiness = createLspReadinessState();
  const perfTarget = {};
  const perf = exposeTxteditorPerf(perfTarget, {
    uiPerfSamples: [],
    hoverPerfSamples: ["hover"],
    hoverPrewarmSamples: ["prewarm"],
    hoverQueueSamples: ["queue"],
    lintEngineEvents: ["lint"],
    lspTraffic,
    lspReadiness
  });
  assert.equal(perfTarget.__txteditorPerf, perf);
  assert.deepEqual(perf.hoverQueueSamples, ["queue"]);
  assert.equal(perf.lspTraffic, lspTraffic);
  assert.equal(perf.lspReadiness, lspReadiness);
  assert.deepEqual(DEFAULT_LSP_TRAFFIC_COUNTERS, {
    lsp_open_file: 0,
    lsp_update_file: 0,
    lsp_update_file_incremental: 0,
    lsp_get_diagnostics: 0,
    lsp_hover: 0,
    diagnostics_changed: 0,
    lsp_close_file: 0,
    hover_cache_hit: 0,
    hover_cache_miss: 0,
    hover_semantic_cache_hit: 0,
    hover_header_cache_hit: 0,
    hover_diagnostic_local_only: 0,
    hover_prewarm_queued: 0,
    hover_prewarm_canceled: 0
  });
  assert.deepEqual(recordLspTrafficSample(lspTraffic, "file:///skills.txt", "lsp_hover", { row: 2 }, { now: () => 42 }), {
    timestamp: 42,
    uri: "file:///skills.txt",
    kind: "lsp_hover",
    row: 2
  });
  assert.equal(lspTraffic.totals.lsp_hover, 1);
  assert.deepEqual(lspTraffic.byUri["file:///skills.txt"], { ...DEFAULT_LSP_TRAFFIC_COUNTERS, lsp_hover: 1 });
  assert.deepEqual(recordLspReadinessSample(lspReadiness, "file:///skills.txt", "didOpenSent", { fileName: "skills.txt" }, { now: () => 43 }), {
    timestamp: 43,
    uri: "file:///skills.txt",
    eventKind: "didOpenSent",
    fileName: "skills.txt"
  });
  assert.deepEqual(recordLspReadinessSample(lspReadiness, "file:///skills.txt", "firstHoverResponse", {}, { now: () => 44 }), {
    timestamp: 44,
    uri: "file:///skills.txt",
    eventKind: "firstHoverResponse"
  });
  assert.deepEqual(lspReadiness.byUri["file:///skills.txt"], {
    didOpenSent: 43,
    firstHoverResponse: 44,
    fileName: "skills.txt",
    lastEventKind: "firstHoverResponse",
    lastEventAt: 44
  });
  const openPromise = Promise.resolve("opening");
  assert.deepEqual(lspOpenDocumentPolicy({
    vectorEngine: false,
    lspStarted: true,
    uri: "file:///skills.txt",
    docState: {},
    version: 1
  }), { action: "skip-legacy", event: "vector-open-skipped-legacy" });
  assert.deepEqual(lspOpenDocumentPolicy({
    vectorEngine: true,
    lspStarted: false,
    uri: "file:///skills.txt",
    docState: {},
    version: 1
  }), { action: "skip-not-started" });
  assert.deepEqual(lspOpenDocumentPolicy({
    vectorEngine: true,
    lspStarted: true,
    uri: "",
    docState: {},
    version: 1
  }), { action: "skip-no-uri" });
  assert.deepEqual(lspOpenDocumentPolicy({
    vectorEngine: true,
    lspStarted: true,
    uri: "file:///skills.txt",
    docState: { opened: true, openedUri: "file:///skills.txt", openedVersion: 3 },
    version: 3
  }), { action: "already-open" });
  assert.deepEqual(lspOpenDocumentPolicy({
    vectorEngine: true,
    lspStarted: true,
    uri: "file:///skills.txt",
    docState: { openPromise },
    version: 1
  }), { action: "reuse-open-promise", promise: openPromise });
  assert.deepEqual(lspOpenDocumentPolicy({
    vectorEngine: true,
    lspStarted: true,
    uri: "file:///skills.txt",
    docState: {},
    version: 1
  }), { action: "open" });
  assert.deepEqual(lspUpdateDocumentPolicy({
    vectorEngine: false,
    lspStarted: true,
    uri: "file:///skills.txt",
    changedRows: { kind: "replaceRows", rows: [1] }
  }), { action: "skip-legacy", event: "vector-update-skipped-legacy" });
  assert.deepEqual(lspUpdateDocumentPolicy({
    vectorEngine: true,
    lspStarted: true,
    uri: "file:///skills.txt",
    changedRows: { kind: "replaceRows", rows: [1, 3] }
  }), { action: "update-incremental", changedRowCount: 2, change: { kind: "replaceRows", rows: [1, 3] } });
  assert.deepEqual(lspUpdateDocumentPolicy({
    vectorEngine: true,
    lspStarted: true,
    uri: "file:///skills.txt",
    changedRows: null
  }), { action: "update-full", changedRowCount: 0, change: { kind: "full", reason: "unspecified" } });
  assert.deepEqual(lspUpdateDocumentPolicy({
    vectorEngine: true,
    lspStarted: true,
    uri: "file:///skills.txt",
    changedRows: { kind: "none" }
  }), { action: "skip-no-change", changedRowCount: 0, change: { kind: "none" } });
  assert.deepEqual(lspUpdateDocumentPolicy({
    vectorEngine: true,
    lspStarted: true,
    uri: "file:///skills.txt",
    changedRows: { kind: "insertRows", index: 10, count: 10000 }
  }), {
    action: "update-full-deferred",
    changedRowCount: 0,
    change: { kind: "insertRows", index: 10, count: 10000 },
    reason: "insertRows"
  });
  const changedDoc = TableDocument.fromText("skills.txt", "id\tname\n1\tcap\n2\tboots", { dirty: false });
  assert.deepEqual(lspChangedRowsToIncrementalChanges(changedDoc, { kind: "replaceRows", rows: [1, 9] }), [
    { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0xFFFFFF } }, text: "1\tcap" },
    { range: { start: { line: 9, character: 0 }, end: { line: 9, character: 0xFFFFFF } }, text: "" }
  ]);
  assert.deepEqual(lspChangedRowsToIncrementalChanges(changedDoc, { kind: "replaceRows", rows: [2] }), [
    { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0xFFFFFF } }, text: "2\tboots" }
  ]);
  assert.equal(lspHoverReady({
    vectorHoverEnabled: true,
    lspStarted: true,
    uri: "file:///skills.txt",
    docState: { opened: true, hoverReady: true }
  }), true);
  assert.equal(lspHoverReady({
    vectorHoverEnabled: true,
    lspStarted: true,
    uri: "file:///skills.txt",
    docState: { opened: true, hoverReady: false }
  }), false);
  const scrollCalls = [];
  applyGridScrollState({
    doc: {},
    scrollLeft: 0,
    scrollTop: 0,
    clearHoverState: () => scrollCalls.push("clear-hover"),
    requestRender: (reason) => scrollCalls.push(["render", reason]),
    onViewportChanged: (reason) => scrollCalls.push(["viewport", reason])
  });
  assert.deepEqual(scrollCalls, ["clear-hover", ["render", "scroll"], ["viewport", "scroll"]]);
});

test("Vector-LSP document runtime state is kept outside TableDocument fields", () => {
  const doc = TableDocument.fromText("skills.txt", "id\n1", { dirty: false });
  const state = lspDocumentState(doc);
  assert.equal(state.version, 0);
  assert.equal(ensureLspDocumentVersion(doc), 1);
  assert.equal(nextLspDocumentVersion(doc), 2);
  state.opened = true;
  state.openedUri = "file:///skills.txt";
  assert.equal(Object.hasOwn(doc, "_lspVersion"), false);
  assert.equal(Object.hasOwn(doc, "_lspOpened"), false);
  assert.equal(doc.dirty, false);
  const reset = resetLspDocumentState(doc, { version: 5 });
  assert.equal(reset.version, 5);
  assert.equal(reset.opened, false);
});

test("LSP update failures are reported without blocking edit commands", () => {
  const calls = [];
  const state = { lint: { status: "" } };
  const message = reportLspUpdateFailure({
    state,
    doc: { name: "skills.txt" },
    uri: "file:///skills.txt",
    error: new Error("connection closed"),
    context: "edit",
    recordLspTraffic: (...args) => calls.push(["traffic", ...args]),
    appendLspLog: (entry) => calls.push(["log", entry]),
    renderChrome: () => calls.push(["render"])
  });
  assert.equal(message.status, "Vector-LSP update failed for skills.txt");
  assert.equal(state.lint.status, "Vector-LSP update failed for skills.txt");
  assert.deepEqual(calls[0], ["traffic", "file:///skills.txt", "lsp_update_failed", { fileName: "skills.txt", context: "edit", error: "connection closed" }]);
  assert.deepEqual(calls[1], ["log", "[edit] Vector-LSP update failed for skills.txt: connection closed"]);
  assert.deepEqual(calls[2], ["render"]);
  assert.equal(clearLspUpdateFailureStatus(state, () => calls.push(["clear-render"])), true);
  assert.equal(state.lint.status, "");
  assert.deepEqual(calls.at(-1), ["clear-render"]);
});

test("LSP request failures record traffic and log entries without changing status", () => {
  const calls = [];
  const message = reportLspRequestFailure({
    uri: "file:///skills.txt",
    operation: "open",
    eventKind: "lsp_open_failed",
    fileName: "skills.txt",
    error: new Error("spawn failed"),
    context: "document-open",
    recordLspTraffic: (...args) => calls.push(["traffic", ...args]),
    appendLspLog: (entry) => calls.push(["log", entry])
  });

  assert.deepEqual(message, {
    log: "Vector-LSP open failed for skills.txt: spawn failed",
    detail: "spawn failed"
  });
  assert.deepEqual(calls, [
    ["traffic", "file:///skills.txt", "lsp_open_failed", { fileName: "skills.txt", context: "document-open", operation: "open", error: "spawn failed" }],
    ["log", "[document-open] Vector-LSP open failed for skills.txt: spawn failed"]
  ]);
  assert.deepEqual(lspRequestErrorMessage("get diagnostics", "", "offline"), {
    log: "Vector-LSP get diagnostics failed for document: offline",
    detail: "offline"
  });
  assert.deepEqual(lspRequestErrorMessage("close", "skills.txt", new Error("channel closed")), {
    log: "Vector-LSP close failed for skills.txt: channel closed",
    detail: "channel closed"
  });
  assert.deepEqual(lspRequestErrorMessage("definition", "skills.txt", new Error("timeout")), {
    log: "Vector-LSP definition failed for skills.txt: timeout",
    detail: "timeout"
  });
  assert.deepEqual(lspRequestErrorMessage("hover", "skills.txt", new Error("timeout")), {
    log: "Vector-LSP hover failed for skills.txt: timeout",
    detail: "timeout"
  });
});

test("background task failures surface status and log entries without throwing", () => {
  const calls = [];
  const state = { lint: { status: "" } };
  const message = reportBackgroundTaskFailure({
    state,
    label: "Configuration load",
    error: new Error("missing settings"),
    context: "startup",
    appendLog: (entry) => calls.push(["log", entry]),
    renderChrome: () => calls.push(["render"])
  });

  assert.deepEqual(message, {
    status: "Configuration load failed",
    log: "Configuration load failed: missing settings",
    detail: "missing settings"
  });
  assert.equal(state.lint.status, "Configuration load failed");
  assert.deepEqual(calls, [["log", "[startup] Configuration load failed: missing settings"], ["render"]]);
  assert.deepEqual(backgroundTaskErrorMessage("Vector-LSP log listener", "offline"), {
    status: "Vector-LSP log listener failed",
    log: "Vector-LSP log listener failed: offline",
    detail: "offline"
  });
  assert.deepEqual(backgroundTaskErrorMessage("Definition file open", new Error("denied")), {
    status: "Definition file open failed",
    log: "Definition file open failed: denied",
    detail: "denied"
  });
  assert.deepEqual(backgroundTaskErrorMessage("Vector-LSP path picker", new Error("dialog unavailable")), {
    status: "Vector-LSP path picker failed",
    log: "Vector-LSP path picker failed: dialog unavailable",
    detail: "dialog unavailable"
  });
  assert.deepEqual(backgroundTaskErrorMessage("Vector-LSP startup", new Error("spawn failed")), {
    status: "Vector-LSP startup failed",
    log: "Vector-LSP startup failed: spawn failed",
    detail: "spawn failed"
  });
});

test("Vector-LSP startup failure replaces the connecting status", async () => {
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          if (command === "lsp_start") throw new Error("spawn failed");
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const state = {
      docs: [],
      lint: { engine: LINT_ENGINE_VECTOR, status: "", diagnostics: [] },
      lsp: { started: false, openFileCount: 0 },
      lspLogs: [],
      bottomTab: "problems",
      contextMenuOpen: false
    };
    const renderStatuses = [];
    const controller = createLspController({
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
      activeDoc: () => null,
      isVectorLintEngine: () => true,
      effectiveVectorLspHoverEnabled: () => false,
      recordLintEngineEvent: () => {},
      perfNow: () => 0,
      showToast: () => {},
      showError: () => {},
      setLintDiagnostics: (diagnostics) => { state.lint.diagnostics = diagnostics; },
      updateGridDiagnostics: () => {},
      renderChrome: () => renderStatuses.push(state.lint.status),
      addDocument: async () => {},
      applyFreezeToDoc: () => {},
      updateActiveProblemHighlight: () => {},
      lintPathKey: (pathValue) => String(pathValue || "").replace(/\\/g, "/").toLowerCase()
    });

    await assert.rejects(() => controller.startWorkspace("E:\\Workspace"), /spawn failed/);
    assert.deepEqual(calls, [["lsp_start", { workspacePath: "E:\\Workspace", generation: 1 }]]);
    assert.equal(state.lsp.started, false);
    assert.equal(state.lsp.openFileCount, 0);
    assert.equal(state.lint.status, "Vector-LSP startup failed");
    assert.equal(renderStatuses.includes("Connecting to linter..."), true);
    assert.equal(renderStatuses.at(-1), "Vector-LSP startup failed");
    assert.deepEqual(state.lspLogs, ["[startup] Vector-LSP startup failed: spawn failed"]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
