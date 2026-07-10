import assert from "node:assert/strict";
import test from "node:test";

import { TableDocument } from "../src/core/table-model.js";
import {
  lspDocumentState,
  resetLspDocumentState
} from "../src/core/lsp-document-state.js";
import { docToUri } from "../src/core/lsp-uri-policy.js";
import { lspWorkspaceSessionPolicy } from "../src/core/lsp-session-policy.js";
import { tableFileState } from "../src/core/table-file-state.js";
import { createDocumentController } from "../src/ui/controllers/document-controller.js";
import { createLspController } from "../src/ui/controllers/lsp-controller.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function lspStateSnapshot(doc) {
  const state = lspDocumentState(doc);
  return {
    version: state.version,
    ready: state.ready,
    opened: state.opened,
    openedUri: state.openedUri,
    openedVersion: state.openedVersion
  };
}

function createLspHarness(state, doc, overrides = {}) {
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
    activeDoc: () => doc,
    isVectorLintEngine: () => state.lint.engine === "vector-lsp",
    effectiveVectorLspHoverEnabled: () => false,
    recordLintEngineEvent() {},
    perfNow: () => 0,
    showToast() {},
    showError(error) { throw error; },
    setLintDiagnostics(diagnostics) { state.lint.diagnostics = diagnostics; },
    updateGridDiagnostics() {},
    renderChrome() {},
    addDocument: async () => {},
    applyFreezeToDoc() {},
    updateActiveProblemHighlight() {},
    lintPathKey: (pathValue) => String(pathValue ?? "").replace(/\\/g, "/").toLowerCase(),
    lspHoverRequest: async () => null,
    ...overrides
  });
}

function createState(doc, engine = "vector-lsp") {
  return {
    docs: [doc],
    active: 0,
    lint: {
      enabled: true,
      engine,
      version: 1,
      status: "",
      diagnostics: []
    },
    lsp: { started: true, openFileCount: 1 },
    lspLogs: [],
    bottomTab: "problems",
    contextMenuOpen: false
  };
}

test("V-TXT-05 Legacy edits receive one full Vector resync without duplicate didOpen", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("skills.txt", "id\nOLD", {
    path: "E:\\Data\\skills.txt",
    dirty: false
  });
  const uri = docToUri(doc);
  const state = createState(doc, "legacy");
  const serverDocuments = new Map([[uri, doc.toText()]]);
  const protocolCalls = [];
  let duplicateDidOpen = 0;
  resetLspDocumentState(doc, { version: 1 });
  Object.assign(lspDocumentState(doc), {
    opened: true,
    openedUri: uri,
    openedVersion: 1,
    ready: true,
    diagnosticsReady: true,
    hoverReady: true
  });
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          protocolCalls.push([command, args]);
          if (command === "lsp_update_file") {
            serverDocuments.set(args.uri, args.text);
            return;
          }
          if (command === "lsp_close_file") {
            serverDocuments.delete(args.uri);
            return;
          }
          if (command === "lsp_open_file") {
            if (serverDocuments.has(args.uri)) duplicateDidOpen += 1;
            serverDocuments.set(args.uri, args.text);
            return;
          }
          if (command === "lsp_update_file_incremental") return;
          throw new Error(`unexpected invoke: ${command}`);
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const controller = createLspHarness(state, doc);
    doc.setCell(1, 0, "NEW");
    state.lint.engine = "vector-lsp";

    await controller.syncOpenDocs();

    const updates = protocolCalls.filter(([command]) => command === "lsp_update_file");
    const incremental = protocolCalls.filter(([command]) => command === "lsp_update_file_incremental");
    const closes = protocolCalls.filter(([command]) => command === "lsp_close_file");
    const opens = protocolCalls.filter(([command]) => command === "lsp_open_file");
    const fullUpdateStrategy = updates.length === 1 && closes.length === 0 && opens.length === 0
      && updates[0][1].uri === uri && updates[0][1].text === doc.toText();
    const closeOpenStrategy = updates.length === 0 && closes.length === 1 && opens.length === 1
      && closes[0][1].uri === uri && opens[0][1].uri === uri
      && opens[0][1].text === doc.toText()
      && protocolCalls.indexOf(closes[0]) < protocolCalls.indexOf(opens[0]);

    assert.deepEqual({
      duplicateDidOpen,
      incrementalUpdates: incremental.length,
      validFullResyncStrategy: fullUpdateStrategy || closeOpenStrategy,
      finalServerText: serverDocuments.get(uri)
    }, {
      duplicateDidOpen: 0,
      incrementalUpdates: 0,
      validFullResyncStrategy: true,
      finalServerText: doc.toText()
    });
  } finally {
    resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

async function runSaveAsScenario({ initialPath, selectedPath }) {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText(initialPath ? "old.txt" : "Untitled.txt", "id\nNEW", {
    path: initialPath,
    dirty: true
  });
  const initialUri = docToUri(doc);
  const initialDocument = {
    path: doc.path,
    name: doc.name,
    dirty: doc.dirty,
    lsp: lspStateSnapshot(doc)
  };
  if (initialUri) {
    resetLspDocumentState(doc, { version: 5 });
    Object.assign(lspDocumentState(doc), {
      opened: true,
      openedUri: initialUri,
      openedVersion: 5,
      ready: true,
      diagnosticsReady: true,
      hoverReady: true
    });
    initialDocument.lsp = lspStateSnapshot(doc);
  }
  const state = createState(doc, "vector-lsp");
  const calls = [];
  const openStateSnapshots = [];
  const errors = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          if (command === "save_file_dialog") return selectedPath;
          if (command === "write_text_file_chunk_safe") {
            return args.last ? {
              path: args.path,
              name: args.path.split(/[/\\]/).at(-1),
              encoding: args.encoding
            } : null;
          }
          if (command === "lsp_close_file") return;
          if (command === "lsp_get_diagnostics_batch") return args.requests.map(() => []);
          if (command === "lsp_open_file") {
            openStateSnapshots.push(lspStateSnapshot(doc));
            return;
          }
          throw new Error(`unexpected invoke: ${command}`);
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const lspController = createLspHarness(state, doc);
    const documentController = createDocumentController({
      state,
      els: {
        host: { focus() {} },
        closeDialog: { classList: { add() {}, remove() {} } },
        closeDialogText: { textContent: "" },
        fileInput: { click() {} }
      },
      grid: {
        commitEdit() {},
        draw() {},
        setDocument() {}
      },
      emptyDoc: TableDocument.fromText("empty.txt", ""),
      activeDoc: () => doc,
      saveSelectionState() {},
      applyFreezeToDoc() {},
      renderChrome() {},
      showError: (error) => errors.push(String(error?.message ?? error)),
      reportWindowCloseFailure() {},
      lspOpenDoc: lspController.openDoc,
      reportLspOpenFailure: lspController.reportOpenFailure,
      lspCloseDoc: lspController.closeDoc,
      reportLspCloseFailure: lspController.reportCloseFailure,
      lspRebindSavedDoc: lspController.rebindSavedDoc,
      lspStartWorkspace: lspController.startWorkspace,
      scheduleHoverPrewarm: lspController.scheduleHoverPrewarm,
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

    const saved = await documentController.saveAs();
    for (let turn = 0; turn < 3; turn += 1) await Promise.resolve();
    const finalDocument = {
      path: doc.path,
      name: doc.name,
      dirty: doc.dirty,
      lsp: lspStateSnapshot(doc)
    };
    return {
      saved,
      initialUri,
      finalUri: docToUri(doc),
      initialDocument,
      finalDocument,
      commands: calls.map(([command]) => command),
      closedUris: calls.filter(([command]) => command === "lsp_close_file").map(([, args]) => args.uri),
      opened: calls.filter(([command]) => command === "lsp_open_file").map(([, args]) => ({ uri: args.uri, text: args.text })),
      openStateSnapshots,
      errors
    };
  } finally {
    resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

test("V-TXT-06 Save As closes old URI, resets state, opens new full text, and leaves cancel untouched", async () => {
  const existing = await runSaveAsScenario({
    initialPath: "E:\\old.txt",
    selectedPath: "E:\\new.txt"
  });
  const firstSave = await runSaveAsScenario({
    initialPath: "",
    selectedPath: "E:\\first.txt"
  });
  const canceled = await runSaveAsScenario({
    initialPath: "E:\\old.txt",
    selectedPath: null
  });

  assert.deepEqual({
    existing: {
      saved: existing.saved,
      commands: existing.commands,
      closedUris: existing.closedUris,
      opened: existing.opened,
      openStateSnapshots: existing.openStateSnapshots,
      finalLsp: existing.finalDocument.lsp,
      errors: existing.errors
    },
    firstSave: {
      saved: firstSave.saved,
      commands: firstSave.commands,
      closedUris: firstSave.closedUris,
      opened: firstSave.opened,
      openStateSnapshots: firstSave.openStateSnapshots,
      finalLsp: firstSave.finalDocument.lsp,
      errors: firstSave.errors
    },
    canceled: {
      saved: canceled.saved,
      commands: canceled.commands,
      documentUnchanged: canceled.finalDocument.path === canceled.initialDocument.path
        && canceled.finalDocument.name === canceled.initialDocument.name
        && canceled.finalDocument.dirty === canceled.initialDocument.dirty
        && JSON.stringify(canceled.finalDocument.lsp) === JSON.stringify(canceled.initialDocument.lsp),
      errors: canceled.errors
    }
  }, {
    existing: {
      saved: true,
      commands: [
        "save_file_dialog",
        "write_text_file_chunk_safe",
        "lsp_close_file",
        "lsp_get_diagnostics_batch",
        "lsp_open_file"
      ],
      closedUris: [existing.initialUri],
      opened: [{ uri: existing.finalUri, text: "id\nNEW" }],
      openStateSnapshots: [{ version: 1, ready: false, opened: false, openedUri: null, openedVersion: null }],
      finalLsp: { version: 1, ready: false, opened: true, openedUri: existing.finalUri, openedVersion: 1 },
      errors: []
    },
    firstSave: {
      saved: true,
      commands: ["save_file_dialog", "write_text_file_chunk_safe", "lsp_open_file"],
      closedUris: [],
      opened: [{ uri: firstSave.finalUri, text: "id\nNEW" }],
      openStateSnapshots: [{ version: 1, ready: false, opened: false, openedUri: null, openedVersion: null }],
      finalLsp: { version: 1, ready: false, opened: true, openedUri: firstSave.finalUri, openedVersion: 1 },
      errors: []
    },
    canceled: {
      saved: false,
      commands: ["save_file_dialog"],
      documentUnchanged: true,
      errors: []
    }
  });
});

test("V-TXT-07 workspace session policy distinguishes start, restart, and canonical sync", () => {
  assert.equal(lspWorkspaceSessionPolicy({
    started: false,
    activeWorkspacePath: "",
    requestedWorkspacePath: "E:\\Data"
  }).action, "start");
  assert.equal(lspWorkspaceSessionPolicy({
    started: true,
    activeWorkspacePath: "E:\\A",
    requestedWorkspacePath: "E:\\B"
  }).action, "restart");
  assert.equal(lspWorkspaceSessionPolicy({
    started: true,
    activeWorkspacePath: "E:\\DATA\\",
    requestedWorkspacePath: "e:/data"
  }).action, "sync");
});

test("V-TXT-07 different workspace restarts while same workspace reuses bindings and cached diagnostics", async () => {
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          if (command === "lsp_start") return;
          if (command === "lsp_get_diagnostics_batch") {
            return args.requests.map(() => [{ row: 0, col: 0, severity: "warning", message: "cached" }]);
          }
          throw new Error(`unexpected invoke: ${command}`);
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const restartState = createState(null, "vector-lsp");
    restartState.docs = [];
    restartState.lsp = {
      started: true,
      workspacePath: "E:\\A",
      workspaceKey: "e:/a",
      generation: 1,
      openFileCount: 0
    };
    const restartController = createLspHarness(restartState, null);
    await restartController.startWorkspace("E:\\B");
    assert.deepEqual(calls.splice(0), [["lsp_start", { workspacePath: "E:\\B", generation: 2 }]]);
    assert.equal(restartState.lsp.workspacePath, "E:\\B");
    assert.equal(restartState.lsp.openFileCount, 0);

    const doc = TableDocument.fromText("items.txt", "id\n1", { path: "E:\\A\\items.txt" });
    const sameState = createState(doc, "vector-lsp");
    sameState.lsp = {
      started: true,
      workspacePath: "E:\\A",
      workspaceKey: "e:/a",
      generation: 2,
      openFileCount: 1
    };
    resetLspDocumentState(doc, { version: 1 });
    Object.assign(lspDocumentState(doc), {
      opened: true,
      openedUri: docToUri(doc),
      openedVersion: 1,
      syncedRevision: tableFileState(doc).revision,
      ready: true,
      diagnosticsReady: true,
      hoverReady: true
    });
    const sameController = createLspHarness(sameState, doc);
    await sameController.startWorkspace("e:/a/");

    assert.deepEqual(calls.map(([command]) => command), ["lsp_get_diagnostics_batch"]);
    assert.equal(sameState.lsp.openFileCount, 1);
    assert.equal(sameState.lint.diagnostics.length, 1);
    assert.equal(sameState.lint.diagnostics[0].message, "cached");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("didChange diagnostics for the reserved version survive publish-before-invoke completion", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("items.txt", "id\nOLD", { path: "E:\\Data\\items.txt" });
  const uri = docToUri(doc);
  const state = createState(doc);
  state.lsp = { started: true, generation: 7, openFileCount: 1 };
  const updateGate = deferred();
  const updateStarted = deferred();
  const calls = [];
  resetLspDocumentState(doc, { version: 1 });
  Object.assign(lspDocumentState(doc), {
    opened: true,
    openedUri: uri,
    openedVersion: 1,
    syncedRevision: tableFileState(doc).revision,
    sessionGeneration: 7,
    ready: true,
    diagnosticsReady: true,
    hoverReady: true
  });
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          if (command === "lsp_update_file_incremental") {
            updateStarted.resolve();
            return updateGate.promise;
          }
          if (command === "lsp_get_diagnostics_batch") {
            return [{
              generation: 7,
              uri,
              version: 2,
              sequence: args.requests[0].sequence,
              diagnostics: [{ row: 1, col: 0, severity: "warning", message: "version two" }]
            }];
          }
          throw new Error(`unexpected invoke: ${command}`);
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const controller = createLspHarness(state, doc);
    doc.setCell(1, 0, "NEW");
    const updatePromise = controller.updateDoc(doc, { kind: "replaceRows", rows: [1] });
    await updateStarted.promise;

    await controller.handleDiagnosticsChanged({
      uri,
      generation: 7,
      version: 2,
      sequence: 11
    });

    assert.equal(lspDocumentState(doc).version, 2);
    assert.equal(lspDocumentState(doc).openedVersion, 1);
    assert.deepEqual(state.lint.diagnostics.map((diagnostic) => diagnostic.message), ["version two"]);
    assert.deepEqual(calls.map(([command]) => command), [
      "lsp_update_file_incremental",
      "lsp_get_diagnostics_batch"
    ]);

    updateGate.resolve();
    await updatePromise;
    assert.equal(lspDocumentState(doc).openedVersion, 2);
  } finally {
    updateGate.resolve();
    resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("didOpen immediately shadows cached diagnostics and rejects a stale versionless publish", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("items.txt", "id\nOPEN", { path: "E:\\Data\\items.txt" });
  const uri = docToUri(doc);
  const state = createState(doc);
  state.lsp = { started: true, generation: 8, openFileCount: 0 };
  const openGate = deferred();
  let openPromise;
  let getterCalls = 0;
  resetLspDocumentState(doc, { version: 1 });
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command) => {
          if (command === "lsp_open_file") return openGate.promise;
          if (command === "lsp_get_diagnostics_batch") {
            getterCalls += 1;
            return [[{ row: 0, col: 0, severity: "warning", message: "stale disk" }]];
          }
          throw new Error(`unexpected invoke: ${command}`);
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const controller = createLspHarness(state, doc);
    state.lint.diagnostics = [{
      fileKey: controller.uriToFileKey(uri),
      message: "cached disk",
      severity: "warning"
    }];

    openPromise = controller.openDoc(doc);
    assert.deepEqual(state.lint.diagnostics, []);
    assert.equal(lspDocumentState(doc).opened, false);

    await controller.handleDiagnosticsChanged({ uri, generation: 8, version: null, sequence: 1 });
    assert.equal(getterCalls, 0);
    assert.deepEqual(state.lint.diagnostics, []);

    openGate.resolve();
    await openPromise;
    await controller.handleDiagnosticsChanged({ uri, generation: 8, version: null, sequence: 2 });

    assert.equal(lspDocumentState(doc).opened, true);
    assert.equal(getterCalls, 0);
    assert.deepEqual(state.lint.diagnostics, []);
  } finally {
    openGate.resolve();
    await openPromise?.catch(() => {});
    resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("didClose recovers an early disk-restore publish with a post-close implicit refresh", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("items.txt", "id\nOPEN", { path: "E:\\Data\\items.txt" });
  const uri = docToUri(doc);
  const state = createState(doc);
  state.lsp = { started: true, generation: 10, openFileCount: 1 };
  const closeGate = deferred();
  const closeStarted = deferred();
  const calls = [];
  let closePromise;
  let getterCalls = 0;
  resetLspDocumentState(doc, { version: 1 });
  Object.assign(lspDocumentState(doc), {
    opened: true,
    openedUri: uri,
    openedVersion: 1,
    syncedRevision: tableFileState(doc).revision,
    sessionGeneration: 10,
    ready: true,
    diagnosticsReady: true,
    hoverReady: true
  });
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          if (command === "lsp_close_file") {
            closeStarted.resolve();
            return closeGate.promise;
          }
          if (command === "lsp_get_diagnostics_batch") {
            getterCalls += 1;
            return args.requests.map((request) => ({
              generation: 10,
              uri: request.uri,
              version: null,
              sequence: request.sequence,
              diagnostics: [{ row: 1, col: 0, severity: "warning", message: "restored disk" }]
            }));
          }
          throw new Error(`unexpected invoke: ${command}`);
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const controller = createLspHarness(state, doc);
    state.lint.diagnostics = [{
      fileKey: controller.uriToFileKey(uri),
      message: "open document",
      severity: "warning"
    }];
    closePromise = controller.closeDoc(doc);
    await closeStarted.promise;

    await controller.handleDiagnosticsChanged({
      uri,
      generation: 10,
      version: null,
      sequence: 31
    });
    assert.equal(getterCalls, 0);
    assert.deepEqual(state.lint.diagnostics.map((item) => item.message), ["open document"]);

    closeGate.resolve();
    await closePromise;

    assert.equal(getterCalls, 1);
    assert.deepEqual(calls.map(([command]) => command), [
      "lsp_close_file",
      "lsp_get_diagnostics_batch"
    ]);
    assert.deepEqual(state.lint.diagnostics.map((item) => item.message), ["restored disk"]);
    assert.deepEqual({
      opened: lspDocumentState(doc).opened,
      sessionGeneration: lspDocumentState(doc).sessionGeneration,
      openFileCount: state.lsp.openFileCount
    }, {
      opened: false,
      sessionGeneration: 0,
      openFileCount: 0
    });
  } finally {
    closeGate.resolve();
    await closePromise?.catch(() => {});
    resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("syncOpenDocs stops the old generation after a workspace restart without count pollution", async () => {
  const originalWindow = globalThis.window;
  const first = TableDocument.fromText("first.txt", "id\n1", { path: "E:\\A\\first.txt" });
  const second = TableDocument.fromText("second.txt", "id\n2", { path: "E:\\A\\second.txt" });
  const state = createState(first);
  state.docs = [first, second];
  state.lsp = {
    started: true,
    workspacePath: "E:\\A",
    workspaceKey: "e:/a",
    generation: 1,
    openFileCount: 0
  };
  const oldOpenGate = deferred();
  const oldOpenStarted = deferred();
  const restartGate = deferred();
  const calls = [];
  for (const doc of state.docs) resetLspDocumentState(doc, { version: 1 });
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          if (command === "lsp_start") return restartGate.promise;
          if (command === "lsp_open_file" && args.generation === 1) {
            oldOpenStarted.resolve();
            return oldOpenGate.promise;
          }
          if (command === "lsp_open_file" && args.generation === 2) return;
          if (command === "lsp_get_diagnostics_batch") return [];
          throw new Error(`unexpected invoke: ${command}`);
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const controller = createLspHarness(state, first);
    const oldSync = controller.syncOpenDocs();
    await oldOpenStarted.promise;
    const restart = controller.startWorkspace("E:\\B");
    assert.equal(state.lsp.generation, 2);
    assert.equal(state.lsp.started, false);
    assert.equal(state.lsp.openFileCount, 0);

    oldOpenGate.resolve();
    await oldSync;
    assert.deepEqual(
      calls.filter(([command, args]) => command === "lsp_open_file" && args.generation === 1)
        .map(([, args]) => args.uri),
      [docToUri(first)]
    );
    assert.equal(calls.some(([command]) => command === "lsp_get_diagnostics_batch"), false);
    assert.equal(state.lsp.openFileCount, 0);

    restartGate.resolve();
    await restart;
    assert.equal(state.lsp.generation, 2);
    assert.equal(state.lsp.openFileCount, 2);
    assert.deepEqual(
      calls.filter(([command, args]) => command === "lsp_open_file" && args.generation === 2)
        .map(([, args]) => args.uri),
      [docToUri(first), docToUri(second)]
    );
  } finally {
    oldOpenGate.resolve();
    restartGate.resolve();
    for (const doc of state.docs) resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("stale didOpen completion cannot clear the current generation open promise or readiness", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("items.txt", "id\nOPEN", { path: "E:\\A\\items.txt" });
  const uri = docToUri(doc);
  const state = createState(doc);
  state.lsp = {
    started: true,
    workspacePath: "E:\\A",
    workspaceKey: "e:/a",
    generation: 1,
    openFileCount: 0
  };
  const oldOpenGate = deferred();
  const oldOpenStarted = deferred();
  const currentOpenGate = deferred();
  const currentOpenStarted = deferred();
  let oldOpenPromise;
  let restartPromise;
  resetLspDocumentState(doc, { version: 1 });
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          if (command === "lsp_open_file" && args.generation === 1) {
            oldOpenStarted.resolve();
            return oldOpenGate.promise;
          }
          if (command === "lsp_start" && args.generation === 2) return;
          if (command === "lsp_open_file" && args.generation === 2) {
            currentOpenStarted.resolve();
            return currentOpenGate.promise;
          }
          if (command === "lsp_get_diagnostics_batch") {
            return args.requests.map((request) => ({
              generation: 2,
              uri: request.uri,
              version: 1,
              sequence: request.sequence,
              diagnostics: []
            }));
          }
          throw new Error(`unexpected invoke: ${command}`);
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const controller = createLspHarness(state, doc);
    oldOpenPromise = controller.openDoc(doc);
    await oldOpenStarted.promise;

    restartPromise = controller.startWorkspace("E:\\B");
    await currentOpenStarted.promise;
    const currentOpenPromise = lspDocumentState(doc).openPromise;
    assert.ok(currentOpenPromise);

    await controller.handleDiagnosticsChanged({
      uri,
      generation: 2,
      version: 1,
      sequence: 21
    });
    assert.deepEqual({
      diagnosticsReady: lspDocumentState(doc).diagnosticsReady,
      hoverReady: lspDocumentState(doc).hoverReady,
      openingGeneration: lspDocumentState(doc).openingGeneration,
      ready: lspDocumentState(doc).ready
    }, {
      diagnosticsReady: true,
      hoverReady: true,
      openingGeneration: 2,
      ready: true
    });

    oldOpenGate.resolve();
    await oldOpenPromise;

    assert.strictEqual(lspDocumentState(doc).openPromise, currentOpenPromise);
    assert.deepEqual({
      diagnosticsReady: lspDocumentState(doc).diagnosticsReady,
      hoverReady: lspDocumentState(doc).hoverReady,
      ready: lspDocumentState(doc).ready,
      requiresFullSync: lspDocumentState(doc).requiresFullSync,
      logs: state.lspLogs
    }, {
      diagnosticsReady: true,
      hoverReady: true,
      ready: true,
      requiresFullSync: false,
      logs: []
    });

    currentOpenGate.resolve();
    await restartPromise;
    assert.deepEqual({
      opened: lspDocumentState(doc).opened,
      openPromise: lspDocumentState(doc).openPromise,
      ready: lspDocumentState(doc).ready,
      sessionGeneration: lspDocumentState(doc).sessionGeneration
    }, {
      opened: true,
      openPromise: null,
      ready: true,
      sessionGeneration: 2
    });
  } finally {
    oldOpenGate.resolve();
    currentOpenGate.resolve();
    await Promise.allSettled([oldOpenPromise, restartPromise].filter(Boolean));
    resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("stale didChange rejection cannot overwrite the reopened generation state or error status", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("items.txt", "id\nOLD", { path: "E:\\A\\items.txt" });
  const uri = docToUri(doc);
  const state = createState(doc);
  state.lsp = {
    started: true,
    workspacePath: "E:\\A",
    workspaceKey: "e:/a",
    generation: 1,
    openFileCount: 1
  };
  const oldUpdateGate = deferred();
  const oldUpdateStarted = deferred();
  let staleUpdatePromise;
  resetLspDocumentState(doc, { version: 1 });
  Object.assign(lspDocumentState(doc), {
    opened: true,
    openedUri: uri,
    openedVersion: 1,
    syncedRevision: tableFileState(doc).revision,
    sessionGeneration: 1,
    ready: true,
    diagnosticsReady: true,
    hoverReady: true
  });
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          if (["lsp_update_file", "lsp_update_file_incremental"].includes(command)
            && args.generation === 1) {
            oldUpdateStarted.resolve();
            return oldUpdateGate.promise;
          }
          if (command === "lsp_start" && args.generation === 2) return;
          if (command === "lsp_open_file" && args.generation === 2) return;
          if (command === "lsp_get_diagnostics_batch") {
            return args.requests.map((request) => ({
              generation: 2,
              uri: request.uri,
              version: 1,
              sequence: request.sequence,
              diagnostics: []
            }));
          }
          throw new Error(`unexpected invoke: ${command}`);
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const controller = createLspHarness(state, doc);
    doc.setCell(1, 0, "NEW");
    staleUpdatePromise = controller.updateDoc(doc, { kind: "replaceRows", rows: [1] })
      .catch((error) => controller.handleUpdateError(doc, error, "stale-generation-update"));
    await oldUpdateStarted.promise;

    await controller.startWorkspace("E:\\B");
    await controller.handleDiagnosticsChanged({
      uri,
      generation: 2,
      version: 1,
      sequence: 22
    });
    const reopenedState = {
      opened: lspDocumentState(doc).opened,
      openPromise: lspDocumentState(doc).openPromise,
      ready: lspDocumentState(doc).ready,
      diagnosticsReady: lspDocumentState(doc).diagnosticsReady,
      hoverReady: lspDocumentState(doc).hoverReady,
      requiresFullSync: lspDocumentState(doc).requiresFullSync,
      sessionGeneration: lspDocumentState(doc).sessionGeneration,
      status: state.lint.status,
      logs: [...state.lspLogs]
    };
    assert.deepEqual(reopenedState, {
      opened: true,
      openPromise: null,
      ready: true,
      diagnosticsReady: true,
      hoverReady: true,
      requiresFullSync: false,
      sessionGeneration: 2,
      status: "",
      logs: []
    });

    oldUpdateGate.reject(new Error("stale generation one update"));
    await staleUpdatePromise;

    assert.deepEqual({
      opened: lspDocumentState(doc).opened,
      openPromise: lspDocumentState(doc).openPromise,
      ready: lspDocumentState(doc).ready,
      diagnosticsReady: lspDocumentState(doc).diagnosticsReady,
      hoverReady: lspDocumentState(doc).hoverReady,
      requiresFullSync: lspDocumentState(doc).requiresFullSync,
      sessionGeneration: lspDocumentState(doc).sessionGeneration,
      status: state.lint.status,
      logs: [...state.lspLogs]
    }, reopenedState);
  } finally {
    oldUpdateGate.resolve();
    await Promise.allSettled([staleUpdatePromise].filter(Boolean));
    resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("syncOpenDocs coalesces unchanged documents into one diagnostics batch and one commit", async () => {
  const originalWindow = globalThis.window;
  const docs = ["a", "b", "c"].map((stem) => TableDocument.fromText(
    `${stem}.txt`,
    "id\n1",
    { path: `E:\\Data\\${stem}.txt` }
  ));
  const state = createState(docs[0]);
  state.docs = docs;
  state.lsp = { started: true, generation: 9, openFileCount: docs.length };
  const counters = { batches: 0, commits: 0, diagnosticsRenders: 0, syncRenders: 0 };
  const requests = [];
  for (const doc of docs) {
    resetLspDocumentState(doc, { version: 1 });
    Object.assign(lspDocumentState(doc), {
      opened: true,
      openedUri: docToUri(doc),
      openedVersion: 1,
      syncedRevision: tableFileState(doc).revision,
      sessionGeneration: 9,
      ready: true,
      diagnosticsReady: true,
      hoverReady: true
    });
  }
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          if (command !== "lsp_get_diagnostics_batch") {
            throw new Error(`unexpected invoke: ${command}`);
          }
          counters.batches += 1;
          requests.push(...args.requests);
          return args.requests.map((_request, index) => [{
            row: 1,
            col: 0,
            severity: "warning",
            message: `diagnostic ${index}`
          }]);
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const controller = createLspHarness(state, docs[0], {
      setLintDiagnostics(diagnostics) {
        counters.commits += 1;
        state.lint.diagnostics = diagnostics;
      },
      renderChrome() { counters.syncRenders += 1; },
      renderDiagnosticsChrome() { counters.diagnosticsRenders += 1; }
    });

    await controller.syncOpenDocs();

    assert.deepEqual(counters, {
      batches: 1,
      commits: 1,
      diagnosticsRenders: 1,
      syncRenders: 1
    });
    assert.deepEqual(requests.map((request) => request.uri), docs.map(docToUri));
    assert.equal(state.lint.diagnostics.length, docs.length);
    assert.equal(state.lsp.openFileCount, docs.length);
  } finally {
    for (const doc of docs) resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
