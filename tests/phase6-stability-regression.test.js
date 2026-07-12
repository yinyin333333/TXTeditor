import assert from "node:assert/strict";
import test from "node:test";
import { openNativePathsBulk } from "../src/core/io.js";
import { LARGE_FILE_THRESHOLDS } from "../src/core/large-file-policy.js";
import { createDefaultLintSettings } from "../src/core/lint-engine.js";
import { TableDocument } from "../src/core/table-model.js";
import { createLegacyLintController } from "../src/ui/controllers/legacy-lint-controller.js";

function installDelayedParseWorkers() {
  const originalWorker = globalThis.Worker;
  const waiting = [];
  let active = 0;
  let maxActive = 0;

  class DelayedParseWorker {
    constructor() {
      this.message = null;
      this.terminated = false;
      active += 1;
      maxActive = Math.max(maxActive, active);
    }

    postMessage(message) {
      this.message = message;
      waiting.push(this);
    }

    terminate() {
      if (this.terminated) return;
      this.terminated = true;
      active -= 1;
    }

    complete() {
      const text = String(this.message?.text ?? "");
      this.onmessage?.({
        data: {
          id: this.message?.id,
          parsed: {
            rows: text.split("\n").map((line) => line.split("\t")),
            lineEnding: "\n",
            finalNewline: false
          },
          encoding: this.message?.encoding,
          fileSizeBytes: this.message?.fileSizeBytes
        }
      });
    }
  }

  globalThis.Worker = DelayedParseWorker;
  return {
    active: () => active,
    maxActive: () => maxActive,
    restore() {
      if (originalWorker === undefined) delete globalThis.Worker;
      else globalThis.Worker = originalWorker;
    },
    waiting
  };
}

function largeNativePayloads(count) {
  return Array.from({ length: count }, (_, index) => ({
    Ok: {
      path: `E:\\Workspace\\large-${index}.txt`,
      name: `large-${index}.txt`,
      text: `id\n${index}`,
      encoding: "utf-8",
      size_bytes: LARGE_FILE_THRESHOLDS.fileSizeBytes
    }
  }));
}

async function drainDelayedWorkers(task, workers) {
  let value;
  let error;
  let settled = false;
  task.then(
    (result) => {
      value = result;
      settled = true;
    },
    (reason) => {
      error = reason;
      settled = true;
    }
  );

  for (let attempt = 0; attempt < 100 && !settled; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    const batch = workers.waiting.splice(0).reverse();
    for (const worker of batch) worker.complete();
  }

  assert.equal(settled, true, "delayed parse work did not settle");
  if (error) throw error;
  return value;
}

test("V-TXT-13 bounds concurrent Legacy large-file parse workers without reordering results", async () => {
  const workerHarness = installDelayedParseWorkers();
  const payloads = largeNativePayloads(6);
  const paths = payloads.map((entry) => entry.Ok.path);

  try {
    const loading = openNativePathsBulk(paths, TableDocument, async (command, args) => {
      assert.equal(command, "read_text_files");
      return args.paths.map((path) => payloads[paths.indexOf(path)]);
    });
    const results = await drainDelayedWorkers(loading, workerHarness);

    assert.deepEqual(results.map((result) => result.path), paths);
    assert.deepEqual(results.map((result) => result.doc.toText()), payloads.map((entry) => entry.Ok.text));
    assert.equal(workerHarness.active(), 0);
    assert.ok(
      workerHarness.maxActive() <= 2,
      `Legacy bulk parse created ${workerHarness.maxActive()} simultaneous workers; expected at most 2`
    );
  } finally {
    workerHarness.restore();
  }
});

test("V-TXT-13 ignores delayed worker results after a Legacy lint cancellation", async () => {
  const originalWindow = globalThis.window;
  const workerHarness = installDelayedParseWorkers();
  const payloads = largeNativePayloads(3);
  const events = [];
  const diagnosticsWrites = [];
  const state = {
    docs: [],
    workspace: {
      path: "E:\\Workspace",
      files: payloads.map((entry) => ({
        path: entry.Ok.path,
        name: entry.Ok.name,
        size: entry.Ok.size_bytes,
        modifiedMs: 1
      }))
    },
    lint: {
      legacy: {
        settings: createDefaultLintSettings(),
        timer: 0,
        pendingRun: null,
        version: 0,
        running: false,
        status: "",
        lastRunAt: 0,
        workspaceDocs: [],
        workspaceLoad: { status: "not-started", files: [], error: "", signature: "" },
        workspaceIndexCache: { signature: "", profile: "", index: null }
      }
    }
  };
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          assert.equal(command, "read_text_files");
          return args.paths.map((path) => payloads.find((entry) => entry.Ok.path === path));
        }
      }
    }
  };

  try {
    const controller = createLegacyLintController({
      state,
      renderChrome: () => {},
      setLintDiagnostics: (diagnostics) => diagnosticsWrites.push(diagnostics),
      updateGridDiagnostics: () => {},
      legacyLintDisplayActive: () => true,
      docHasDiagnostics: () => false,
      recordLintEngineEvent: (name) => events.push(name),
      perfNow: () => Date.now(),
      elapsedMs: (started) => Date.now() - started,
      lintDocKey: (doc) => doc.path
    });

    controller.scheduleFull("cancellation-regression", 0);
    for (let attempt = 0; attempt < 20 && workerHarness.waiting.length < 2; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(workerHarness.waiting.length, 2);

    controller.cancelJobs();
    const delayed = workerHarness.waiting.splice(0);
    for (const worker of delayed) worker.complete();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(state.lint.legacy.workspaceDocs, []);
    assert.deepEqual(diagnosticsWrites, []);
    assert.equal(events.includes("legacy-lint-finish"), false);
    assert.equal(workerHarness.active(), 0);
  } finally {
    controllerCleanup(state);
    workerHarness.restore();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

function controllerCleanup(state) {
  clearTimeout(state.lint.legacy.timer);
  state.lint.legacy.timer = 0;
}
