import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  LINT_ENGINE_LEGACY,
  LINT_ENGINE_VECTOR
} from "../src/core/lint-controller-policy.js";
import { mapLspDiagnosticToDisplay } from "../src/ui/controllers/lsp-controller.js";
import { createLspDiagnosticsEventController } from "../src/ui/controllers/lsp-diagnostics-event-controller.js";
import {
  diagnosticCounts,
  groupDiagnosticsByFile,
  lintDiagnosticsStateAfterUpdate,
  problemBadgeCountForFile
} from "../src/ui/problems-policy.js";

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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(condition(), true);
}

function diagnosticUri(index) {
  return `file:///workspace/file-${String(index).padStart(3, "0")}.txt`;
}

function rawDiagnostics(uriIndex, count, revision = 1) {
  return Array.from({ length: count }, (_, index) => ({
    row: index,
    col: index % 8,
    startCharacter: index % 17,
    endCharacter: index % 17 + 1,
    cellStartCharacter: 0,
    cellEndCharacter: 32,
    severity: ["error", "warning", "info"][index % 3],
    message: `revision-${revision}:uri-${uriIndex}:diagnostic-${index}`,
    code: `R${revision}-${index % 5}`,
    data: { revision, uriIndex, index }
  }));
}

function createBurstHarness({ generation = 7, getter, initialDiagnostics = [] } = {}) {
  const originalWindow = globalThis.window;
  const counters = {
    commits: 0,
    getters: 0,
    gridRedraws: 0,
    gridUpdates: 0,
    problemsRebuilds: 0,
    renders: 0,
    rulerUpdates: 0
  };
  const state = {
    docs: [],
    lint: {
      diagnostics: [...initialDiagnostics],
      enabled: true,
      engine: LINT_ENGINE_VECTOR,
      version: 0
    },
    lsp: {
      generation,
      started: true
    }
  };
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          assert.equal(command, "lsp_get_diagnostics_batch");
          counters.getters += 1;
          return Promise.all(args.requests.map((request) => getter(request)));
        }
      }
    }
  };

  const updateGridDiagnostics = ({ redraw = true, updateRuler = true } = {}) => {
    counters.gridUpdates += 1;
    if (redraw) counters.gridRedraws += 1;
    if (updateRuler) counters.rulerUpdates += 1;
  };
  const renderChrome = () => {
    counters.renders += 1;
    updateGridDiagnostics();
    counters.problemsRebuilds += 1;
  };
  const controller = createLspDiagnosticsEventController({
    state,
    activeDoc: () => null,
    isVectorLintEngine: () => state.lint.engine === LINT_ENGINE_VECTOR,
    uriToFileKey: (uri) => uri,
    mapDiagnosticToDisplay: mapLspDiagnosticToDisplay,
    recordLintEngineEvent: () => {},
    recordLspTraffic: () => {},
    recordLspReadiness: () => {},
    appendLspLog: () => {},
    setLintDiagnostics: (diagnostics, { preserveVersion = false } = {}) => {
      state.lint.diagnostics = diagnostics;
      if (!preserveVersion) {
        state.lint.version = lintDiagnosticsStateAfterUpdate(state.lint, diagnostics).version;
      }
      counters.commits += 1;
    },
    updateGridDiagnostics,
    renderChrome,
    markDocHoverReady: () => {},
    scheduleHoverPrewarm: () => {},
    sessionAcceptsEvents: (eventGeneration) => state.lsp.started
      && eventGeneration === state.lsp.generation
  });

  return {
    controller,
    counters,
    restore() {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
    state
  };
}

test("unchanged versioned diagnostics update metadata without redrawing diagnostics UI", async (context) => {
  const uri = diagnosticUri(0);
  const raw = rawDiagnostics(0, 3);
  const initialDiagnostics = raw.map((diagnostic, index) => mapLspDiagnosticToDisplay(diagnostic, {
    uri,
    fileKey: uri,
    fileName: "file-000.txt",
    filePath: "/workspace/file-000.txt",
    index
  }));
  const harness = createBurstHarness({ getter: async () => raw, initialDiagnostics });
  context.after(() => harness.restore());

  await harness.controller.handleDiagnosticsChanged({ uri, generation: 7, version: 1, sequence: 1 });

  assert.equal(harness.state.lint.version, 0);
  assert.equal(harness.counters.commits, 1);
  assert.equal(harness.counters.renders, 0);
  assert.equal(harness.counters.problemsRebuilds, 0);
  assert.equal(harness.counters.gridUpdates, 1);
  assert.equal(harness.counters.gridRedraws, 0);
  assert.equal(harness.counters.rulerUpdates, 0);
});

function canonicalRaw(uri, diagnostic) {
  return {
    code: diagnostic.code == null ? "" : String(diagnostic.code),
    data: diagnostic.data ?? null,
    message: diagnostic.message ?? "",
    range: {
      end: { character: diagnostic.endCharacter ?? null, line: diagnostic.row ?? 0 },
      start: { character: diagnostic.startCharacter ?? null, line: diagnostic.row ?? 0 }
    },
    severity: diagnostic.severity ?? "warning",
    uri
  };
}

function canonicalDisplay(diagnostic) {
  return {
    code: diagnostic.code == null ? "" : String(diagnostic.code),
    data: diagnostic.data ?? null,
    message: diagnostic.message ?? "",
    range: {
      end: { character: diagnostic.endCharacter ?? null, line: diagnostic.rowIndex ?? 0 },
      start: { character: diagnostic.startCharacter ?? null, line: diagnostic.rowIndex ?? 0 }
    },
    severity: diagnostic.severity ?? "warning",
    uri: diagnostic.fileKey
  };
}

function diagnosticFingerprint(items) {
  const canonical = items
    .map((item) => JSON.stringify(item))
    .sort();
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function counterSummary(counters) {
  return {
    getters: counters.getters,
    commits: counters.commits,
    grid: counters.gridRedraws,
    ruler: counters.rulerUpdates,
    renders: counters.renders,
    problems: counters.problemsRebuilds
  };
}

test("Burst A preserves 10,000-diagnostic fingerprint and commits one UI batch", async (context) => {
  const snapshots = new Map();
  const expected = [];
  for (let uriIndex = 0; uriIndex < 100; uriIndex += 1) {
    const uri = diagnosticUri(uriIndex);
    const diagnostics = rawDiagnostics(uriIndex, 100);
    snapshots.set(uri, diagnostics);
    expected.push(...diagnostics.map((diagnostic) => canonicalRaw(uri, diagnostic)));
  }
  const harness = createBurstHarness({ getter: ({ uri }) => snapshots.get(uri) });

  try {
    await Promise.all([...snapshots.keys()].map((uri, index) => (
      harness.controller.handleDiagnosticsChanged({
        generation: harness.state.lsp.generation,
        sequence: index + 1,
        uri
      })
    )));
    const summary = counterSummary(harness.counters);
    context.diagnostic(`Burst A baseline counters: ${JSON.stringify(summary)}`);

    assert.equal(harness.state.lint.diagnostics.length, 10_000);
    assert.equal(
      diagnosticFingerprint(harness.state.lint.diagnostics.map(canonicalDisplay)),
      diagnosticFingerprint(expected)
    );
    assert.deepEqual(diagnosticCounts(harness.state.lint.diagnostics), {
      error: 3400,
      warning: 3300,
      info: 3300
    });
    assert.equal(groupDiagnosticsByFile(harness.state.lint.diagnostics).length, 100);
    for (const uri of snapshots.keys()) {
      assert.equal(problemBadgeCountForFile({
        diagnostics: harness.state.lint.diagnostics,
        fileKey: uri,
        notificationsVisible: true
      }), 100);
    }
    assert.deepEqual(summary, {
      getters: 1,
      commits: 1,
      grid: 1,
      ruler: 1,
      renders: 1,
      problems: 1
    });
  } finally {
    harness.restore();
  }
});

test("Burst B coalesces same-URI snapshots while one getter is in flight", async (context) => {
  const uri = diagnosticUri(0);
  const gates = new Map();
  const harness = createBurstHarness({
    getter: ({ sequence }) => {
      const gate = deferred();
      gates.set(sequence, gate);
      return gate.promise;
    }
  });

  try {
    const pending = [harness.controller.handleDiagnosticsChanged({
      generation: harness.state.lsp.generation,
      sequence: 1,
      uri
    })];
    await waitFor(() => gates.has(1));
    for (const sequence of [2, 3]) {
      pending.push(harness.controller.handleDiagnosticsChanged({
        generation: harness.state.lsp.generation,
        sequence,
        uri
      }));
    }
    assert.deepEqual([...gates.keys()], [1]);
    gates.get(1).resolve(rawDiagnostics(0, 1, 1));
    await waitFor(() => gates.has(3));
    assert.equal(gates.has(2), false);
    gates.get(3).resolve(rawDiagnostics(0, 3, 3));
    await Promise.all(pending);

    const summary = counterSummary(harness.counters);
    context.diagnostic(`Burst B baseline counters: ${JSON.stringify(summary)}`);
    assert.deepEqual(
      harness.state.lint.diagnostics.map((diagnostic) => diagnostic.data.revision),
      [3, 3, 3]
    );
    assert.equal(harness.counters.getters, 2);
    assert.equal(harness.counters.commits, 1);
  } finally {
    harness.restore();
  }
});

test("Burst C empty publish removes the file from diagnostics, badge, and Problems groups", async (context) => {
  const uri = diagnosticUri(0);
  const snapshots = new Map([
    [1, rawDiagnostics(0, 100, 1)],
    [2, []]
  ]);
  const harness = createBurstHarness({ getter: ({ sequence }) => snapshots.get(sequence) });

  try {
    await harness.controller.handleDiagnosticsChanged({
      generation: harness.state.lsp.generation,
      sequence: 1,
      uri
    });
    assert.equal(harness.state.lint.diagnostics.length, 100);
    await harness.controller.handleDiagnosticsChanged({
      generation: harness.state.lsp.generation,
      sequence: 2,
      uri
    });

    const summary = counterSummary(harness.counters);
    context.diagnostic(`Burst C baseline counters: ${JSON.stringify(summary)}`);
    assert.deepEqual(harness.state.lint.diagnostics, []);
    assert.equal(problemBadgeCountForFile({
      diagnostics: harness.state.lint.diagnostics,
      fileKey: uri,
      notificationsVisible: true
    }), 0);
    assert.deepEqual(groupDiagnosticsByFile(harness.state.lint.diagnostics), []);
  } finally {
    harness.restore();
  }
});

test("Burst D discards a delayed workspace-A getter after session B starts", async (context) => {
  const uriA = diagnosticUri(0);
  const existingB = {
    ...mapLspDiagnosticToDisplay(rawDiagnostics(1, 1, 2)[0], {
      uri: diagnosticUri(1),
      fileKey: diagnosticUri(1),
      fileName: "file-001.txt",
      filePath: "/workspace/file-001.txt"
    }),
    id: "session-b-existing"
  };
  const gate = deferred();
  const harness = createBurstHarness({
    generation: 10,
    getter: () => gate.promise,
    initialDiagnostics: [existingB]
  });

  try {
    const pendingA = harness.controller.handleDiagnosticsChanged({
      generation: 10,
      sequence: 1,
      uri: uriA
    });
    await waitFor(() => harness.counters.getters === 1);
    harness.state.lsp.generation = 11;
    harness.controller.clearPending();
    gate.resolve(rawDiagnostics(0, 10, 1));
    await pendingA;

    const summary = counterSummary(harness.counters);
    context.diagnostic(`Burst D baseline counters: ${JSON.stringify(summary)}`);
    assert.deepEqual(harness.state.lint.diagnostics, [existingB]);
    assert.equal(harness.counters.commits, 0);
  } finally {
    harness.restore();
  }
});

test("Burst E discards a pending Vector getter after switching to Legacy", async (context) => {
  const uri = diagnosticUri(0);
  const gate = deferred();
  const legacyDiagnostic = {
    code: "LEGACY",
    data: null,
    fileKey: "legacy-file",
    fileName: "legacy.txt",
    id: "legacy-diagnostic",
    message: "keep legacy",
    rowIndex: 1,
    columnIndex: 0,
    severity: "warning"
  };
  const harness = createBurstHarness({ getter: () => gate.promise });

  try {
    const pendingVector = harness.controller.handleDiagnosticsChanged({
      generation: harness.state.lsp.generation,
      sequence: 1,
      uri
    });
    await waitFor(() => harness.counters.getters === 1);
    harness.state.lint.engine = LINT_ENGINE_LEGACY;
    harness.state.lint.diagnostics = [legacyDiagnostic];
    gate.resolve(rawDiagnostics(0, 10, 1));
    await pendingVector;

    const summary = counterSummary(harness.counters);
    context.diagnostic(`Burst E baseline counters: ${JSON.stringify(summary)}`);
    assert.deepEqual(harness.state.lint.diagnostics, [legacyDiagnostic]);
    assert.equal(harness.counters.commits, 0);
  } finally {
    harness.restore();
  }
});
