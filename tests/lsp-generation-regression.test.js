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

function createController(state, { errors = [], reserveLspGeneration } = {}) {
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
    reserveLspGeneration: reserveLspGeneration
      ?? (async () => (Number(state.lsp.generation) || 0) + 1),
    lspHoverRequest: async () => null
  });
}

async function assertReloadReplacesNativeSession(initialGeneration) {
  const originalWindow = globalThis.window;
  const state = createState();
  const listeners = new Map();
  const stopped = [];
  const native = {
    latest: initialGeneration,
    active: initialGeneration,
    starting: new Set([initialGeneration])
  };
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          if (command === "lsp_start") {
            assert.equal(args.generation, native.latest);
            native.active = args.generation;
            return { generation: args.generation, workspacePath: args.workspacePath, installed: true };
          }
          if (command === "lsp_stop") {
            stopped.push(args.generation);
            if (native.active <= args.generation) native.active = null;
            for (const generation of native.starting) {
              if (generation <= args.generation) native.starting.delete(generation);
            }
            native.latest = Math.max(native.latest, args.generation + 1);
            return 1;
          }
          throw new Error(`unexpected invoke: ${command}`);
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
    const controller = createController(state, {
      reserveLspGeneration: async () => {
        const generation = ++native.latest;
        if (native.active < generation) native.active = null;
        for (const candidate of native.starting) {
          if (candidate < generation) native.starting.delete(candidate);
        }
        return generation;
      }
    });
    controller.startListeners();
    await waitFor(() => listeners.has("lsp-stopped"));

    await controller.startWorkspace("E:\\RestoredWorkspace");
    const ownedGeneration = initialGeneration + 1;
    assert.deepEqual({
      generation: state.lsp.generation,
      started: state.lsp.started,
      workspacePath: state.lsp.workspacePath,
      nativeActive: native.active,
      oldStartingSessions: native.starting.size
    }, {
      generation: ownedGeneration,
      started: true,
      workspacePath: "E:\\RestoredWorkspace",
      nativeActive: ownedGeneration,
      oldStartingSessions: 0
    });

    await listeners.get("lsp-stopped")({
      payload: { generation: initialGeneration, reason: "stale reload event" }
    });
    assert.equal(state.lsp.started, true);
    assert.equal(state.lsp.generation, ownedGeneration);

    await controller.stopSession("lint-disabled");
    assert.deepEqual(stopped, [ownedGeneration]);
    assert.equal(native.active, null);
    assert.equal(state.lsp.started, false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

test("WebView reload replaces an active native generation 1 and Lint Off stops the owned session", async () => {
  await assertReloadReplacesNativeSession(1);
});

test("WebView reload advances beyond a native generation greater than 1", async () => {
  await assertReloadReplacesNativeSession(5);
});

test("startup claim rejects orphan generation events and Lint Off stops the claimed generation", async () => {
  const originalWindow = globalThis.window;
  const state = createState();
  const listeners = new Map();
  const stops = [];
  const native = { latest: 5, active: 5, starting: true, watcherActive: true };
  globalThis.window = {
    __TAURI__: {
      core: { invoke: async (command, args) => {
        assert.equal(command, "lsp_stop");
        stops.push(args.generation);
        if (native.active <= args.generation) native.active = null;
        native.latest = Math.max(native.latest, args.generation + 1);
        return 1;
      } },
      event: { listen: async (event, callback) => {
        listeners.set(event, callback);
        return () => listeners.delete(event);
      } }
    }
  };

  try {
    const controller = createController(state, { reserveLspGeneration: async () => {
      native.latest += 1;
      native.active = null;
      native.starting = false;
      native.watcherActive = false;
      return native.latest;
    } });
    controller.startListeners();
    await waitFor(() => listeners.has("lsp-stopped"));
    assert.equal(await controller.claimSession(), 6);
    assert.deepEqual(native, { latest: 6, active: null, starting: false, watcherActive: false });

    await listeners.get("lsp-stopped")({ payload: { generation: 5, reason: "stale" } });
    assert.equal(state.lsp.generation, 6);
    assert.equal(state.lint.status, "");

    await controller.stopSession("lint-disabled");
    assert.deepEqual(stops, [6]);
    assert.equal(state.lsp.started, false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

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

test("current unversioned diagnostics for an unopened mod JSON URI reach Problems without opening a document", async () => {
  const originalWindow = globalThis.window;
  const txt = TableDocument.fromText("skills.txt", "id\n1", {
    path: "E:\\Mod\\data\\global\\excel\\skills.txt",
    dirty: false
  });
  const jsonUri = "file:///E:/Mod/data/local/lng/strings/skills.json";
  const state = createState([txt]);
  Object.assign(state.lsp, {
    started: true,
    workspacePath: "E:\\Mod\\data\\global\\excel",
    workspaceKey: "e:/mod/data/global/excel",
    generation: 7,
    readiness: "ready"
  });
  const calls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push([command, args]);
          assert.equal(command, "lsp_get_diagnostics_batch");
          return [{
            generation: 7,
            uri: jsonUri,
            version: null,
            sequence: 31,
            diagnostics: [{
              row: 3,
              col: 0,
              severity: "warning",
              message: "Duplicate string id",
              code: "Json/DuplicateIds"
            }]
          }];
        }
      },
      event: { listen: async () => () => {} }
    }
  };

  try {
    const controller = createController(state);
    await controller.handleDiagnosticsChanged({
      uri: jsonUri,
      generation: 7,
      version: null,
      sequence: 31
    });

    assert.equal(calls.length, 1);
    assert.equal(state.docs.length, 1);
    assert.equal(state.docs[0], txt);
    assert.deepEqual(state.lint.diagnostics.map((diagnostic) => ({
      fileName: diagnostic.fileName,
      message: diagnostic.message,
      ruleId: diagnostic.ruleId,
      navigationDisabled: diagnostic.navigationDisabled
    })), [{
      fileName: "skills.json",
      message: "Duplicate string id",
      ruleId: "Json/DuplicateIds",
      navigationDisabled: true
    }]);
  } finally {
    resetLspDocumentState(txt);
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
