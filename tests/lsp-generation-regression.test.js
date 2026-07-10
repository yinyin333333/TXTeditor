import assert from "node:assert/strict";
import test from "node:test";

import { LINT_ENGINE_VECTOR } from "../src/core/lint-controller-policy.js";
import {
  lspDocumentState,
  resetLspDocumentState
} from "../src/core/lsp-document-state.js";
import { docToUri } from "../src/core/lsp-uri-policy.js";
import { TableDocument } from "../src/core/table-model.js";
import { createLspController } from "../src/ui/controllers/lsp-controller.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(condition) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(condition(), true);
}

function createState(docs = []) {
  return {
    docs,
    active: docs.length ? 0 : -1,
    lint: {
      enabled: true,
      engine: LINT_ENGINE_VECTOR,
      version: 1,
      status: "",
      diagnostics: []
    },
    lsp: {
      started: false,
      workspacePath: "",
      workspaceKey: "",
      generation: 0,
      readiness: "stopped",
      openFileCount: 0
    },
    lspLogs: [],
    bottomTab: "problems",
    contextMenuOpen: false
  };
}

function createController(state, { errors = [] } = {}) {
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
    showError: (error) => errors.push(String(error?.message ?? error)),
    setLintDiagnostics(diagnostics) { state.lint.diagnostics = diagnostics; },
    updateGridDiagnostics() {},
    renderChrome() {},
    addDocument: async () => {},
    applyFreezeToDoc() {},
    updateActiveProblemHighlight() {},
    lintPathKey: (pathValue) => String(pathValue ?? "").replace(/\\/g, "/").toLowerCase(),
    lspHoverRequest: async () => null
  });
}

test("latest start request B owns frontend state when B completes before A", async () => {
  const originalWindow = globalThis.window;
  const state = createState();
  const starts = new Map();
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          assert.equal(command, "lsp_start");
          const gate = deferred();
          starts.set(args.workspacePath, gate);
          return gate.promise;
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const controller = createController(state);
    const startA = controller.startWorkspace("E:\\A");
    await waitFor(() => starts.has("E:\\A"));
    const startB = controller.startWorkspace("E:\\B");
    await waitFor(() => starts.has("E:\\B"));

    starts.get("E:\\B").resolve();
    await startB;
    starts.get("E:\\A").resolve();
    await Promise.allSettled([startA]);

    assert.deepEqual({
      workspacePath: state.lsp.workspacePath,
      workspaceKey: state.lsp.workspaceKey,
      generation: state.lsp.generation,
      started: state.lsp.started,
      readiness: state.lsp.readiness,
      status: state.lint.status
    }, {
      workspacePath: "E:\\B",
      workspaceKey: "e:/b",
      generation: 2,
      started: true,
      readiness: "indexing",
      status: ""
    });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("diagnostics event and getter result are discarded when their generation is stale", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("skills.txt", "id\nNEW", { path: "E:\\B\\skills.txt", dirty: false });
  const uri = docToUri(doc);
  const state = createState([doc]);
  state.lsp.started = true;
  state.lsp.workspacePath = "E:\\B";
  state.lsp.workspaceKey = "e:/b";
  state.lsp.generation = 2;
  state.lsp.readiness = "ready";
  const getterGate = deferred();
  const deferredGetterStarted = deferred();
  let getterCalls = 0;
  let deferGetter = false;
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          assert.equal(command, "lsp_get_diagnostics_batch");
          getterCalls += 1;
          if (deferGetter) {
            deferredGetterStarted.resolve();
            return getterGate.promise.then((diagnostics) => args.requests.map(() => diagnostics));
          }
          return args.requests.map(() => [{ row: 1, col: 0, severity: "error", message: "STALE_EVENT", code: "stale" }]);
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const controller = createController(state);
    await controller.handleDiagnosticsChanged(uri, { generation: 1 });

    deferGetter = true;
    const pendingCurrentEvent = controller.handleDiagnosticsChanged(uri, { generation: 2 });
    await deferredGetterStarted.promise;
    state.lsp.generation = 3;
    getterGate.resolve([{ row: 1, col: 0, severity: "error", message: "STALE_GETTER", code: "stale" }]);
    await pendingCurrentEvent;

    assert.deepEqual({
      getterCalls,
      messages: state.lint.diagnostics.map((diagnostic) => diagnostic.message)
    }, {
      getterCalls: 1,
      messages: []
    });
  } finally {
    resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("stopped event resets only the matching generation and ignores stale EOF", async () => {
  const originalWindow = globalThis.window;
  const doc = TableDocument.fromText("skills.txt", "id\nNEW", { path: "E:\\B\\skills.txt", dirty: false });
  const uri = docToUri(doc);
  const state = createState([doc]);
  Object.assign(state.lsp, {
    started: true,
    workspacePath: "E:\\B",
    workspaceKey: "e:/b",
    generation: 2,
    readiness: "ready",
    openFileCount: 1
  });
  resetLspDocumentState(doc, { version: 4 });
  Object.assign(lspDocumentState(doc), {
    ready: true,
    opened: true,
    openedUri: uri,
    openedVersion: 4,
    sessionGeneration: 2
  });
  const listeners = new Map();
  const errors = [];
  globalThis.window = {
    __TAURI__: {
      core: { invoke: async () => undefined },
      event: {
        listen: async (event, callback) => {
          listeners.set(event, callback);
          return () => listeners.delete(event);
        },
        TauriEvent: {}
      }
    }
  };

  try {
    const controller = createController(state, { errors });
    controller.startListeners();
    await waitFor(() => listeners.has("lsp-diagnostics-changed") && listeners.has("lsp-log"));
    const beforeStale = {
      frontend: { ...state.lsp },
      document: {
        ready: lspDocumentState(doc).ready,
        opened: lspDocumentState(doc).opened,
        openedUri: lspDocumentState(doc).openedUri,
        openedVersion: lspDocumentState(doc).openedVersion,
        sessionGeneration: lspDocumentState(doc).sessionGeneration
      }
    };

    await listeners.get("lsp-stopped")?.({ payload: { generation: 1, reason: "eof" } });
    const afterStale = {
      frontend: { ...state.lsp },
      document: {
        ready: lspDocumentState(doc).ready,
        opened: lspDocumentState(doc).opened,
        openedUri: lspDocumentState(doc).openedUri,
        openedVersion: lspDocumentState(doc).openedVersion,
        sessionGeneration: lspDocumentState(doc).sessionGeneration
      }
    };
    await listeners.get("lsp-stopped")?.({ payload: { generation: 2, reason: "eof" } });

    assert.deepEqual({
      stoppedListenerInstalled: listeners.has("lsp-stopped"),
      staleEventPreservedState: JSON.stringify(afterStale) === JSON.stringify(beforeStale),
      frontend: {
        started: state.lsp.started,
        readiness: state.lsp.readiness,
        openFileCount: state.lsp.openFileCount
      },
      document: {
        ready: lspDocumentState(doc).ready,
        opened: lspDocumentState(doc).opened,
        openedUri: lspDocumentState(doc).openedUri,
        openedVersion: lspDocumentState(doc).openedVersion
      },
      errors
    }, {
      stoppedListenerInstalled: true,
      staleEventPreservedState: true,
      frontend: { started: false, readiness: "stopped", openFileCount: 0 },
      document: { ready: false, opened: false, openedUri: null, openedVersion: null },
      errors: []
    });
  } finally {
    resetLspDocumentState(doc);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("EOF during startup cannot be overwritten by the late start result", async () => {
  const originalWindow = globalThis.window;
  const state = createState();
  const startGate = deferred();
  const listeners = new Map();
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command) => {
          assert.equal(command, "lsp_start");
          return startGate.promise;
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

  try {
    const controller = createController(state);
    controller.startListeners();
    await waitFor(() => listeners.has("lsp-stopped"));
    const starting = controller.startWorkspace("E:\\A");
    await waitFor(() => state.lsp.generation === 1 && state.lsp.readiness === "starting");
    await listeners.get("lsp-stopped")({ payload: { generation: 1, reason: "eof" } });
    startGate.resolve({ generation: 1, workspacePath: "E:\\A", installed: true });
    await starting;

    assert.deepEqual({
      started: state.lsp.started,
      readiness: state.lsp.readiness,
      openFileCount: state.lsp.openFileCount
    }, { started: false, readiness: "stopped", openFileCount: 0 });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
