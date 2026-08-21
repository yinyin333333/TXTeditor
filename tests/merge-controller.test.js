import test from "node:test";
import assert from "node:assert/strict";
import { TableDocument } from "../src/core/table-model.js";
import { SelectionModel } from "../src/core/selection.js";
import { mergeFileChanges } from "../src/core/merge-engine.js";
import { analyzeFileMerge } from "../src/core/merge-workspace.js";
import { createMergeController } from "../src/ui/controllers/merge-controller.js";

function createHarness({ kind = "file", config = {}, workspace = null, docs = [], inputTexts = {}, folderEntries = null, referenceFiles = null, writeOutput = null, renderChrome = null, els = {}, documentRef } = {}) {
  const emptyDoc = TableDocument.fromText("empty.txt", "");
  const state = {
    activity: "merge",
    sidebarVisible: true,
    problemsVisible: false,
    bottomTab: "problems",
    freezeRow: false,
    freezeColumn: false,
    selection: new SelectionModel(),
    workspace,
    docs,
    config,
    merge: {
      kind,
      gameVersion: "3.3",
      gameVersionTouched: false,
      aPath: kind === "file" ? "/mods/a/skills.txt" : "/mods/a",
      bPath: kind === "file" ? "/mods/b/skills.txt" : "/mods/b",
      outputPath: kind === "file" ? "/result/skills.txt" : "/result/merged",
      includeSubfolders: true,
      stage: "setup",
      status: "",
      statusError: false,
      session: null,
      previewDoc: null,
      previewFileId: null,
      selectedConflictId: null,
      selectedChangeId: null,
      statusFilter: "changed",
      aSnapshot: null,
      bSnapshot: null,
      savedOutputPath: "",
      busy: false
    }
  };
  const payloadByPath = new Map([
    ["/mods/a/skills.txt", { name: "skills.txt", path: "/mods/a/skills.txt", text: inputTexts.a ?? "skill\tA\tB\nx\t1\t0\n", encoding: "utf-8" }],
    ["/mods/b/skills.txt", { name: "skills.txt", path: "/mods/b/skills.txt", text: inputTexts.b ?? "skill\tA\tB\nx\t0\t2\n", encoding: "utf-8" }]
  ]);
  const folderFiles = folderEntries ?? [{ name: "skills.txt", relativePath: "skills.txt" }];
  const folderPayloadByPath = new Map();
  for (const root of ["/mods/a", "/mods/b"]) {
    const side = root.endsWith("/a") ? "a" : "b";
    for (const file of folderFiles) {
      const relativePath = file.relativePath || file.name;
      const path = `${root}/${relativePath}`;
      folderPayloadByPath.set(path, {
        name: file.name || relativePath.split("/").pop(),
        path,
        text: file[`${side}Text`] ?? file.text ?? "skill\tA\tB\nx\t0\t0\n",
        encoding: "utf-8"
      });
    }
  }
  const writes = [];
  const renderedStates = [];
  const openedWorkspaces = [];
  const activated = [];
  let commits = 0;
  const io = {
    isTauriRuntime: () => true,
    loadLintReferenceDataset: async () => ({
      gameVersion: "3.3",
      canonicalSha256: "verified-test-digest",
      files: referenceFiles ?? [{ name: "skills.txt", text: "skill\tA\tB\nx\t0\t0\n", encoding: "utf-8", bytes: 20 }]
    }),
    listWorkspaceNative: async (root) => ({
      files: folderFiles.map((file) => ({
        ...file,
        name: file.name || file.relativePath,
        path: `${root}/${file.relativePath || file.name}`,
        relativePath: file.relativePath || file.name
      }))
    }),
    readTextFilesNative: async (paths) => paths.map((path) => ({
      payload: kind === "folder" ? folderPayloadByPath.get(path) : payloadByPath.get(path)
    })),
    writeMergeOutputNative: async (payload) => {
      writes.push(payload);
      if (writeOutput) return writeOutput(payload);
      return { path: payload.outputPath, fileCount: payload.files.length };
    }
  };
  const documentController = {
    openDroppedNativePaths: async () => {},
    openWorkspacePath: async (path) => { openedWorkspaces.push(path); },
    saveFile: async () => true
  };
  const elements = { ...renderElements(), ...els };
  elements.mergeDirtyDialog.classList.add("hidden");
  elements.mergeOverwriteDialog.classList.add("hidden");
  const controller = createMergeController({
    state,
    els: elements,
    grid: { scrollCellToCenter() {}, draw() {} },
    emptyDoc,
    regularActiveDoc: () => emptyDoc,
    commitActiveEditor: () => { commits += 1; },
    activateDocument: async (doc) => { activated.push(doc); },
    renderChrome: renderChrome ?? (() => {
      renderedStates.push({ stage: state.merge.stage, status: state.merge.status, statusError: state.merge.statusError });
    }),
    showError: (error) => { throw error; },
    documentController,
    documentRef,
    io
  });
  return { controller, state, writes, openedWorkspaces, activated, commits: () => commits, io, els: elements, renderedStates };
}

function renderElement() {
  const classes = new Set();
  const listeners = new Map();
  return {
    value: "",
    checked: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    title: "",
    dataset: {},
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
    },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
      contains(name) { return classes.has(name); }
    }
  };
}

function renderElements() {
  return Object.fromEntries([
    "mergeView",
    "mergeGameVersion",
    "mergeKind",
    "mergeAPath",
    "mergeBPath",
    "mergeOutputPath",
    "mergeIncludeSubfolders",
    "mergeIncludeSubfoldersRow",
    "mergeStageBadge",
    "mergeStatus",
    "mergeAnalyzeButton",
    "mergeSetup",
    "mergeSourceSummary",
    "mergeSummary",
    "mergeReviewActions",
    "mergeFileToolbar",
    "mergeFileFilter",
    "mergeStatusFilter",
    "mergeFileList",
    "mergeSaveButton",
    "mergeValidateButton",
    "mergeSchemaAckRow",
    "mergeSchemaAck",
    "mergeConflictCount",
    "mergeConflictsList",
    "mergeConflictDetails",
    "mergeDirtyDialog",
    "mergeDirtyDialogText",
    "mergeOverwriteDialog",
    "mergeOverwriteDialogText"
  ].map((key) => [key, renderElement()]));
}

function overwriteChoiceEvent(choice) {
  return {
    type: "click",
    target: {
      closest(selector) {
        return selector === "[data-merge-overwrite-choice]"
          ? { dataset: { mergeOverwriteChoice: choice } }
          : null;
      }
    }
  };
}

test("merge controller analyzes in memory and saves without a browser confirmation gate", async () => {
  const harness = createHarness();
  await harness.controller.analyze();
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.state.merge.session.stage, "review");
  assert.deepEqual(harness.state.merge.previewDoc.rows[1], ["x", "1", "2"]);
  assert.equal(harness.state.merge.statusFilter, "changed");
  assert.equal(harness.state.merge.previewFileId, "skills.txt");

  const saved = await harness.controller.saveResult();
  assert.equal(saved, true);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].overwrite, false);
  assert.equal(harness.writes[0].files[0].text, "skill\tA\tB\nx\t1\t2\n");
  assert.deepEqual(harness.writes[0].protectedPaths, ["/mods/a/skills.txt", "/mods/b/skills.txt"]);
  assert.equal(harness.state.merge.stage, "saved");
  assert.ok(harness.renderedStates.some(({ stage, status }) => stage === "saving" && status === "Saving"));
  assert.ok(harness.renderedStates.some(({ stage, status }) => stage === "saved" && /Saved 1 Result file/.test(status)));
});

test("conflict details render the projected Result for non-cell conflicts", () => {
  const els = renderElements();
  const harness = createHarness({
    els,
    documentRef: { activeElement: null, querySelectorAll: () => [] }
  });
  const session = analyzeFileMerge({
    baseFile: { name: "skills.txt", relativePath: "skills.txt", text: "skill\tvalue\nx\t0\ny\t0\n" },
    aFile: { name: "skills.txt", relativePath: "skills.txt", text: "skill\tvalue\ny\t0\n" },
    bFile: { name: "skills.txt", relativePath: "skills.txt", text: "skill\tvalue\nx\t9\ny\t0\n" },
    outputPath: "/result/skills.txt"
  });
  const [file] = session.files;
  const projected = mergeFileChanges(file).find((change) => change.kind === "conflict");
  assert.equal(file.conflicts[0].target.type, "row");
  assert.equal(projected.result.value, "9");

  harness.state.merge.session = session;
  harness.state.merge.previewFileId = file.id;
  harness.state.merge.selectedChangeId = projected.id;
  harness.controller.render();

  assert.match(els.mergeConflictDetails.innerHTML, /value = 9/);
  assert.doesNotMatch(els.mergeConflictDetails.innerHTML, /<missing>/);
});

test("merge review hides setup, selects the first unresolved conflict, and exposes direct A/B choices", async () => {
  const els = renderElements();
  const harness = createHarness({
    inputTexts: {
      a: "skill\tA\tB\nx\t1\t1\n",
      b: "skill\tA\tB\nx\t0\t2\n"
    },
    els,
    documentRef: { activeElement: null, querySelectorAll: () => [] }
  });
  await harness.controller.analyze();

  const [file] = harness.state.merge.session.files;
  const projectedConflict = mergeFileChanges(file).find((change) => change.kind === "conflict");
  assert.ok(projectedConflict);
  assert.equal(projectedConflict.columnLabel, "B");
  assert.equal(harness.state.merge.selectedChangeId, projectedConflict.id);
  assert.equal(harness.state.merge.selectedConflictId, projectedConflict.conflictId);

  harness.controller.render();
  assert.equal(els.mergeSetup.classList.contains("hidden"), true);
  assert.equal(els.mergeSourceSummary.classList.contains("hidden"), false);
  assert.equal(els.mergeSummary.classList.contains("hidden"), false);
  assert.equal(els.mergeFileToolbar.classList.contains("hidden"), true);
  assert.equal(els.mergeReviewActions.classList.contains("hidden"), false);
  assert.match(els.mergeSummary.innerHTML, /Conflict resolution is the next step/);
  assert.match(els.mergeConflictDetails.innerHTML, /merge-conflict-callout/);
  assert.match(els.mergeConflictDetails.innerHTML, /data-merge-choice="a"[^>]*>Use A value/);
  assert.match(els.mergeConflictDetails.innerHTML, /data-merge-choice="b"[^>]*>Use B value/);
  assert.match(els.mergeConflictDetails.innerHTML, /Other choices/);
  assert.match(els.mergeConflictDetails.innerHTML, /Skip for now/);
});

test("merge review selects the first unresolved conflict file when automatic changes come first", async () => {
  const harness = createHarness({
    kind: "folder",
    referenceFiles: [
      { name: "auto.txt", text: "id\tvalue\nx\t0\n", encoding: "utf-8", bytes: 16 },
      { name: "conflict.txt", text: "id\tvalue\nx\t0\n", encoding: "utf-8", bytes: 16 }
    ],
    folderEntries: [
      {
        name: "auto.txt",
        relativePath: "auto.txt",
        aText: "id\tvalue\nx\t1\n",
        bText: "id\tvalue\nx\t0\n"
      },
      {
        name: "conflict.txt",
        relativePath: "conflict.txt",
        aText: "id\tvalue\nx\t1\n",
        bText: "id\tvalue\nx\t2\n"
      }
    ]
  });

  await harness.controller.analyze();

  const conflictFile = harness.state.merge.session.files.find((file) => file.relativePath === "conflict.txt");
  const projectedConflict = mergeFileChanges(conflictFile).find((change) => change.kind === "conflict" && !change.resolution);
  assert.ok(projectedConflict);
  assert.equal(harness.state.merge.previewFileId, conflictFile.id);
  assert.equal(harness.state.merge.session.selectedFileId, conflictFile.id);
  assert.equal(harness.state.merge.selectedConflictId, projectedConflict.conflictId);
  assert.equal(harness.state.merge.selectedChangeId, projectedConflict.id);
});

test("automatic change details explain the decision without rendering Base", async () => {
  const els = renderElements();
  const harness = createHarness({
    inputTexts: {
      a: "skill\tA\tB\nx\t1\t1\n",
      b: "skill\tA\tB\nx\t0\t2\n"
    },
    els,
    documentRef: { activeElement: null, querySelectorAll: () => [] }
  });
  await harness.controller.analyze();
  const [file] = harness.state.merge.session.files;
  const automatic = mergeFileChanges(file).find((change) => change.kind === "cell" && change.source === "a");
  assert.ok(automatic);
  harness.state.merge.selectedChangeId = automatic.id;
  harness.controller.render();

  assert.match(els.mergeConflictDetails.innerHTML, /A changed; B is unchanged\. A was applied automatically\. No action is needed\./);
  assert.match(els.mergeConflictDetails.innerHTML, /A · Changed/);
  assert.match(els.mergeConflictDetails.innerHTML, /B · Unchanged/);
  assert.match(els.mergeConflictDetails.innerHTML, /Result · Automatic/);
  assert.equal((els.mergeConflictDetails.innerHTML.match(/class="merge-conflict-value"/g) ?? []).length, 3);
  assert.doesNotMatch(els.mergeConflictDetails.innerHTML, /merge-change-basis|automatic-decision|\bBase\b/);
  assert.doesNotMatch(els.mergeConflictDetails.innerHTML, /No action is required; the automatic result is ready/);
});

test("whole-file automatic details use concise semantic cards instead of raw table contents", () => {
  const els = renderElements();
  const harness = createHarness({
    els,
    documentRef: { activeElement: null, querySelectorAll: () => [] }
  });
  const session = analyzeFileMerge({
    baseFile: { name: "unknown.txt", relativePath: "unknown.txt", text: "left\tright\nx\t0\n" },
    aFile: { name: "unknown.txt", relativePath: "unknown.txt", text: "left\tright\nx\t1\n" },
    bFile: { name: "unknown.txt", relativePath: "unknown.txt", text: "left\tright\nx\t0\n" },
    outputPath: "/result/unknown.txt"
  });
  const [file] = session.files;
  const change = mergeFileChanges(file).find((candidate) => candidate.kind === "file");
  assert.ok(change);
  harness.state.merge.session = session;
  harness.state.merge.previewFileId = file.id;
  harness.state.merge.selectedChangeId = change.id;
  harness.controller.render();

  assert.match(els.mergeConflictDetails.innerHTML, /Whole-file change/);
  assert.match(els.mergeConflictDetails.innerHTML, /complete A file is used for Result/);
  assert.match(els.mergeConflictDetails.innerHTML, /A file selected/);
  assert.doesNotMatch(els.mergeConflictDetails.innerHTML, /left|right|x\t1|x\t0/);
  assert.doesNotMatch(els.mergeConflictDetails.innerHTML, /\bBase\b/);
  assert.equal((els.mergeConflictDetails.innerHTML.match(/class="merge-conflict-value"/g) ?? []).length, 3);
});

test("existing output opens an in-app overwrite modal and Cancel does not retry", async () => {
  const harness = createHarness({
    writeOutput: async (payload) => {
      if (!payload.overwrite) throw new Error("MERGE_OUTPUT_EXISTS");
      throw new Error("overwrite should not run");
    }
  });
  await harness.controller.analyze();
  harness.controller.wireEvents();
  const savePromise = harness.controller.saveResult();
  for (let turn = 0; turn < 8 && harness.els.mergeOverwriteDialog.classList.contains("hidden"); turn += 1) {
    await Promise.resolve();
  }
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.writes[0].overwrite, false);
  assert.equal(harness.els.mergeOverwriteDialog.classList.contains("hidden"), false);

  harness.els.mergeOverwriteDialog.dispatchEvent(overwriteChoiceEvent("cancel"));
  assert.equal(await savePromise, false);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.state.merge.stage, "review");
  assert.equal(harness.state.merge.status, "Existing output was not replaced.");
  assert.equal(harness.els.mergeOverwriteDialog.classList.contains("hidden"), true);
});

test("existing output Replace retries with overwrite and reaches saved state", async () => {
  const harness = createHarness({
    writeOutput: async (payload) => {
      if (!payload.overwrite) throw new Error("MERGE_OUTPUT_EXISTS");
      return { path: payload.outputPath, fileCount: payload.files.length };
    }
  });
  await harness.controller.analyze();
  harness.controller.wireEvents();
  const savePromise = harness.controller.saveResult();
  for (let turn = 0; turn < 8 && harness.els.mergeOverwriteDialog.classList.contains("hidden"); turn += 1) {
    await Promise.resolve();
  }
  harness.els.mergeOverwriteDialog.dispatchEvent(overwriteChoiceEvent("replace"));

  assert.equal(await savePromise, true);
  assert.equal(harness.writes.length, 2);
  assert.equal(harness.writes[1].overwrite, true);
  assert.equal(harness.state.merge.stage, "saved");
  assert.equal(harness.els.mergeOverwriteDialog.classList.contains("hidden"), true);
});

test("write errors remain visible during review", async () => {
  const harness = createHarness({
    writeOutput: async () => { throw new Error("disk is full"); }
  });
  await harness.controller.analyze();
  await assert.rejects(() => harness.controller.saveResult(), /disk is full/i);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.state.merge.stage, "review");
  assert.equal(harness.state.merge.statusError, true);
  assert.match(harness.state.merge.status, /disk is full/i);
});

test("folder output may not contain either input folder", async () => {
  const harness = createHarness({ kind: "folder" });
  harness.state.merge.aPath = "/result/mod-a";
  harness.state.merge.bPath = "/result/mod-b";
  harness.state.merge.outputPath = "/result";
  await assert.rejects(() => harness.controller.analyze(), /cannot contain A or B/i);
  assert.equal(harness.writes.length, 0);
});

test("saved folder Result opens as a workspace for diagnostics", async () => {
  const harness = createHarness({ kind: "folder" });
  harness.state.merge.savedOutputPath = "/result/merged";
  await harness.controller.validateSavedResult();
  assert.deepEqual(harness.openedWorkspaces, ["/result/merged"]);
  assert.equal(harness.state.activity, "explorer");
});

test("configured game version sync respects explicit selection and freezes the analyzed Base version", async () => {
  const harness = createHarness({ config: { gameVersion: "3.2" } });
  assert.equal(harness.controller.syncConfiguredVersion(), "3.2");

  harness.state.merge.gameVersion = "2.4";
  harness.state.merge.gameVersionTouched = true;
  harness.state.config.gameVersion = "3.1";
  assert.equal(harness.controller.syncConfiguredVersion(), "2.4");

  harness.controller.resetSession();
  assert.equal(harness.state.merge.gameVersion, "3.1");
  assert.equal(harness.state.merge.gameVersionTouched, false);

  harness.state.config.gameVersion = "3.3";
  harness.state.merge.aPath = "/mods/a/skills.txt";
  harness.state.merge.bPath = "/mods/b/skills.txt";
  harness.state.merge.outputPath = "/result/skills.txt";
  harness.controller.syncConfiguredVersion();
  await harness.controller.analyze();
  harness.state.config.gameVersion = "2.4";
  assert.equal(harness.controller.syncConfiguredVersion(), "3.3");
  assert.equal(harness.state.merge.session.gameVersion, "3.3");
});

test("folder merge aborts before prefilling when an open workspace table is dirty", async () => {
  const dirtyDoc = TableDocument.fromText("skills.txt", "skill\tA\n", {
    path: "/mods/a/skills.txt",
    dirty: true
  });
  const harness = createHarness({
    kind: "folder",
    workspace: { path: "/mods/a" },
    docs: [dirtyDoc]
  });
  const originalPath = harness.state.merge.aPath;
  await assert.rejects(() => harness.controller.mergeWithFolder(), /save|discard/i);
  assert.equal(harness.commits(), 1);
  assert.equal(harness.state.merge.aPath, originalPath);
});

test("folder sessions with no changed files cannot save or write output", async () => {
  const harness = createHarness({ kind: "folder" });
  await harness.controller.analyze();
  assert.equal(harness.state.merge.session.summary.outputFiles, 0);
  await assert.rejects(() => harness.controller.saveResult(), /No changed files are selected for output/i);
  assert.equal(harness.writes.length, 0);
});

test("Change inputs preserves setup values while discarding only the analysis session", async () => {
  const harness = createHarness();
  await harness.controller.analyze();
  const preserved = {
    aPath: harness.state.merge.aPath,
    bPath: harness.state.merge.bPath,
    outputPath: harness.state.merge.outputPath,
    gameVersion: harness.state.merge.gameVersion,
    includeSubfolders: harness.state.merge.includeSubfolders,
    kind: harness.state.merge.kind
  };
  assert.ok(harness.state.merge.session);
  assert.equal(harness.controller.changeInputs(), true);
  assert.equal(harness.state.merge.session, null);
  assert.deepEqual({
    aPath: harness.state.merge.aPath,
    bPath: harness.state.merge.bPath,
    outputPath: harness.state.merge.outputPath,
    gameVersion: harness.state.merge.gameVersion,
    includeSubfolders: harness.state.merge.includeSubfolders,
    kind: harness.state.merge.kind
  }, preserved);
  assert.equal(harness.state.merge.previewDoc, null);
});
