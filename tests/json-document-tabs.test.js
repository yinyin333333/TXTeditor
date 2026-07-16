import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JsonDocument, lspRangeToJsonOffsets } from "../src/core/json-document.js";
import {
  canNavigateLocalizationJsonDiagnostic,
  isEditableLocalizationJsonPath,
  isLocalizationJsonPathInCurrentMode,
  jsonPrimaryDataRoots,
  localizationJsonDataRoot
} from "../src/core/json-document-policy.js";
import { documentTextSnapshot, markDocumentSaved } from "../src/core/document-file-state.js";
import { loadJsonEditorModule, resetJsonEditorModuleLoaderForTests } from "../src/ui/json-editor-module-loader.js";
import { createJsonEditorController } from "../src/ui/controllers/json-editor-controller.js";
import { createDocumentController } from "../src/ui/controllers/document-controller.js";
import { mapLspDiagnosticToDisplay } from "../src/ui/lsp-diagnostic-display-policy.js";
import { docToUri } from "../src/core/lsp-uri-policy.js";

function classList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach((item) => values.add(item)),
    remove: (...items) => items.forEach((item) => values.delete(item)),
    contains: (item) => values.has(item)
  };
}

test("localization JSON scope is direct, physical, and anchored by primary Excel TXT", () => {
  const state = {
    docs: [],
    workspace: {
      path: "/mods/example",
      files: [{ path: "/mods/example/data/global/excel/skills.txt" }]
    },
    lsp: {
      started: true,
      generation: 7,
      workspacePath: "/mods/example",
      contextMode: "workspace",
      includeSubfolders: true
    }
  };
  const allowed = "/mods/example/data/local/lng/strings/item-names.json";
  assert.equal(localizationJsonDataRoot(allowed), "/mods/example/data");
  assert.equal(isEditableLocalizationJsonPath(allowed), true);
  assert.deepEqual([...jsonPrimaryDataRoots(state)], ["/mods/example/data"]);
  assert.equal(isLocalizationJsonPathInCurrentMode(allowed, state), true);
  assert.equal(isLocalizationJsonPathInCurrentMode(
    "/mods/example/data/local/lng/strings/metadata/ignored.json", state
  ), false);
  assert.equal(isLocalizationJsonPathInCurrentMode(
    "/mods/example/data/global/ui/layouts/panel.json", state
  ), false);
  assert.equal(isLocalizationJsonPathInCurrentMode(
    "/mods/other/data/local/lng/strings/item-names.json", state
  ), false);
  const explicitOnly = JsonDocument.fromText("item-names.json", "[]", {
    path: allowed,
    dirty: false
  });
  const explicitOnlyState = {
    docs: [explicitOnly],
    workspace: null,
    lsp: { ...state.lsp }
  };
  assert.equal(isLocalizationJsonPathInCurrentMode(allowed, explicitOnlyState), true);
  assert.equal(isLocalizationJsonPathInCurrentMode(allowed, explicitOnlyState, {
    allowOpenDocumentFallback: false
  }), false);
  assert.equal(canNavigateLocalizationJsonDiagnostic({
    diagnostic: { filePath: allowed, generation: 7, sourceExists: true },
    state,
    editorReady: true,
    desktop: true
  }), true);
  assert.equal(canNavigateLocalizationJsonDiagnostic({
    diagnostic: { filePath: allowed, generation: 6, sourceExists: true },
    state,
    editorReady: true,
    desktop: true
  }), false);
});

test("JsonDocument preserves raw BOM/newline/final-newline text and save revisions", () => {
  const raw = "\u{feff}[\r\n  {\"Key\":\"Value\"}\r\n]\r\n";
  const doc = JsonDocument.fromText("strings.json", raw, {
    path: "/mod/data/local/lng/strings/strings.json",
    encoding: "utf-8-bom"
  });
  assert.equal(doc.toText(), raw);
  assert.equal(doc.lineEnding, "\r\n");
  assert.equal(doc.finalNewline, true);
  assert.equal(doc.hasBom, true);
  doc.applyEditorText(`${raw} `);
  const first = documentTextSnapshot(doc);
  doc.applyEditorText(`${raw}  `);
  markDocumentSaved(doc, first.revision, first);
  assert.equal(doc.dirty, true, "an older completed save must not clear a newer edit");
  const latest = documentTextSnapshot(doc);
  markDocumentSaved(doc, latest.revision, latest);
  assert.equal(doc.dirty, false);
});

test("LSP UTF-16 ranges map to CodeMirror offsets across BOM, CRLF, and emoji", () => {
  const text = "\u{feff}[\r\n\"🙂A\"\r\n]\r\n";
  const emoji = text.indexOf("🙂");
  assert.deepEqual(lspRangeToJsonOffsets(text, {
    start: { line: 1, character: 1 },
    end: { line: 1, character: 3 }
  }), { start: emoji, end: emoji + 2 });
  assert.deepEqual(lspRangeToJsonOffsets(text, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 }
  }), { start: 1, end: 2 });
});

test("clean external changes reload while Keep preserves a dirty buffer", () => {
  const doc = JsonDocument.fromText("a.json", "[]", { path: "/mod/data/local/lng/strings/a.json" });
  doc.reloadFromDisk("[1]\r\n", { encoding: "utf-8" });
  assert.equal(doc.text, "[1]\r\n");
  assert.equal(doc.dirty, false);
  doc.applyEditorText("[2]\r\n");
  doc.noteExternalChange({ text: "[3]\r\n", encoding: "utf-8" });
  doc.keepLocalAfterExternalChange();
  assert.equal(doc.text, "[2]\r\n");
  assert.equal(doc.dirty, true);
  assert.equal(doc.externalChange, null);
});

test("atomic-save delete events re-read the replacement without an external conflict", async () => {
  const originalWindow = globalThis.window;
  const path = "E:\\mod\\data\\local\\lng\\strings\\skills.json";
  const doc = JsonDocument.fromText("skills.json", "[0]", { path });
  doc.applyEditorText("[1]");
  const written = documentTextSnapshot(doc);
  doc.beginWrite(written);
  doc.applyEditorText("[2]");
  doc.markSaved(written.revision, written);
  let conflicts = 0;
  const noteExternalChange = doc.noteExternalChange.bind(doc);
  doc.noteExternalChange = (payload) => {
    conflicts += 1;
    noteExternalChange(payload);
  };
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command) => {
          assert.equal(command, "read_text_files");
          return [{ Ok: { path, name: "skills.json", text: "[1]", encoding: "utf-8" } }];
        }
      }
    }
  };
  const state = {
    docs: [doc],
    active: 0,
    lint: { engine: "vector-lsp" },
    lsp: { generation: 9 }
  };
  const controller = createDocumentController({
    state,
    els: {},
    grid: { draw() {}, setDocument() {} },
    emptyDoc: JsonDocument.fromText("empty.json", ""),
    activeDoc: () => doc,
    saveSelectionState() {},
    applyFreezeToDoc() {},
    renderChrome() {},
    showError(error) { throw error; },
    reportWindowCloseFailure() {},
    lspOpenDoc: async () => {},
    reportLspOpenFailure() {},
    lspCloseDoc: async () => {},
    reportLspCloseFailure() {},
    lspStartWorkspace: async () => {},
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

  try {
    await controller.handleWatchedFilesChanged({
      generation: 9,
      changes: [{ uri: docToUri(doc), type: 3 }]
    });
    assert.equal(conflicts, 0);
    assert.equal(doc.text, "[2]");
    assert.equal(doc.dirty, true);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("clean external JSON reload resynchronizes the live LSP buffer", async () => {
  const originalWindow = globalThis.window;
  const doc = JsonDocument.fromText("skills.json", "[0]", {
    path: "E:\\mod\\data\\local\\lng\\strings\\skills.json",
    encoding: "utf-8",
    dirty: false
  });
  const state = {
    docs: [doc],
    active: 0,
    lint: { engine: "vector-lsp" },
    lsp: { generation: 10 },
    workspace: null
  };
  const updates = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command) => {
          assert.equal(command, "read_text_files");
          return [{
            Ok: {
              name: "skills.json",
              path: doc.path,
              text: "[1]",
              encoding: "utf-8",
              sizeBytes: 3
            }
          }];
        }
      }
    }
  };

  try {
    const controller = createDocumentController({
      state,
      els: {},
      grid: {},
      emptyDoc: JsonDocument.fromText("empty.json", ""),
      activeDoc: () => doc,
      saveSelectionState() {},
      applyFreezeToDoc() {},
      renderChrome() {},
      showError(error) { throw error; },
      reportWindowCloseFailure() {},
      lspOpenDoc: async () => {},
      lspUpdateDoc: async (candidate, change) => updates.push({ candidate, change }),
      handleLspUpdateError(_candidate, error) { throw error; },
      reportLspOpenFailure() {},
      lspCloseDoc: async () => {},
      reportLspCloseFailure() {},
      lspStartWorkspace: async () => {},
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

    await controller.handleWatchedFilesChanged({
      generation: 10,
      changes: [{ uri: docToUri(doc), type: 2 }]
    });

    assert.equal(doc.text, "[1]");
    assert.equal(doc.dirty, false);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].candidate, doc);
    assert.deepEqual(updates[0].change, { kind: "json", changes: [] });
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Keep suppresses duplicate watched-file conflicts until the disk identity changes", async () => {
  const originalWindow = globalThis.window;
  const path = "E:\\mod\\data\\local\\lng\\strings\\skills.json";
  const doc = JsonDocument.fromText("skills.json", "[0]", {
    path,
    encoding: "utf-8"
  });
  doc.applyEditorText("[local]");
  let externalText = "[disk]";
  let externalEncoding = "utf-8";
  let conflicts = 0;
  const noteExternalChange = doc.noteExternalChange.bind(doc);
  doc.noteExternalChange = (payload) => {
    conflicts += 1;
    noteExternalChange(payload);
  };
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command) => {
          assert.equal(command, "read_text_files");
          return [{
            Ok: {
              path,
              name: "skills.json",
              text: externalText,
              encoding: externalEncoding
            }
          }];
        }
      }
    }
  };
  const state = {
    docs: [doc],
    active: 0,
    lint: { engine: "vector-lsp" },
    lsp: { generation: 12 }
  };
  const controller = createDocumentController({
    state,
    els: {},
    grid: {},
    emptyDoc: JsonDocument.fromText("empty.json", ""),
    activeDoc: () => doc,
    saveSelectionState() {},
    applyFreezeToDoc() {},
    renderChrome() {},
    showError(error) { throw error; },
    reportWindowCloseFailure() {},
    lspOpenDoc: async () => {},
    reportLspOpenFailure() {},
    lspCloseDoc: async () => {},
    reportLspCloseFailure() {},
    lspStartWorkspace: async () => {},
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

  try {
    const changed = { generation: 12, changes: [{ uri: docToUri(doc), type: 2 }] };
    await controller.handleWatchedFilesChanged(changed);
    await controller.handleWatchedFilesChanged(changed);
    assert.equal(conflicts, 1, "the same observed disk payload must not prompt twice");

    externalEncoding = "utf-16le";
    await controller.handleWatchedFilesChanged(changed);
    assert.equal(conflicts, 2, "an encoding-only disk change is a new conflict");
    assert.equal(doc.text, "[local]");
    assert.equal(doc.dirty, true);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("queued external JSON changes prompt once and deleted observations survive duplicate events", async () => {
  const originalWindow = globalThis.window;
  const path = "E:\\mod\\data\\local\\lng\\strings\\skills.json";
  const doc = JsonDocument.fromText("skills.json", "[0]", {
    path,
    encoding: "utf-8"
  });
  doc.applyEditorText("[local]");

  let dialogShows = 0;
  const dialogClasses = new Set(["hidden"]);
  const externalChangeDialog = {
    classList: {
      add(...items) { items.forEach((item) => dialogClasses.add(item)); },
      remove(...items) {
        if (items.includes("hidden")) dialogShows += 1;
        items.forEach((item) => dialogClasses.delete(item));
      },
      contains(item) { return dialogClasses.has(item); }
    }
  };
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command) => {
          assert.equal(command, "read_text_files");
          return [{
            Ok: {
              path,
              name: "skills.json",
              text: "[disk]",
              encoding: "utf-8"
            }
          }];
        }
      }
    }
  };
  const state = {
    docs: [doc],
    active: 0,
    lint: { engine: "vector-lsp" },
    lsp: { generation: 13 }
  };
  const controller = createDocumentController({
    state,
    els: {
      externalChangeDialog,
      externalChangeDialogText: { textContent: "" }
    },
    grid: {},
    emptyDoc: JsonDocument.fromText("empty.json", ""),
    activeDoc: () => doc,
    saveSelectionState() {},
    applyFreezeToDoc() {},
    renderChrome() {},
    showError(error) { throw error; },
    reportWindowCloseFailure() {},
    lspOpenDoc: async () => {},
    reportLspOpenFailure() {},
    lspCloseDoc: async () => {},
    reportLspCloseFailure() {},
    lspStartWorkspace: async () => {},
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
  const changed = { generation: 13, changes: [{ uri: docToUri(doc), type: 2 }] };
  const keep = () => controller.handleExternalChangeDialogClick({
    target: {
      closest: () => ({ dataset: { externalChangeChoice: "keep" } })
    }
  });

  try {
    const first = controller.handleWatchedFilesChanged(changed);
    while (dialogShows === 0) await new Promise((resolve) => setImmediate(resolve));
    const second = controller.handleWatchedFilesChanged(changed);
    await new Promise((resolve) => setImmediate(resolve));
    await keep();

    // A broken queue implementation opens the same dialog again. Resolve that
    // fallback so the test fails by assertion instead of hanging indefinitely.
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (dialogShows > 1) await keep();
    await Promise.all([first, second]);
    assert.equal(dialogShows, 1);

    doc.keepLocalAfterExternalChange({
      path,
      deleted: true,
      text: null,
      encoding: "utf-8"
    });
    assert.equal(doc.matchesObservedDiskState({ exists: false }), true);
    assert.equal(doc.matchesObservedDiskState({
      exists: true,
      text: "[disk]",
      encoding: "utf-8"
    }), false, "recreating the file must be observable even with previously seen text");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("CodeMirror module loading is lazy and cached", async () => {
  resetJsonEditorModuleLoaderForTests();
  let calls = 0;
  const importer = async () => ({ marker: ++calls });
  const first = await loadJsonEditorModule(importer);
  const second = await loadJsonEditorModule(importer);
  assert.equal(first, second);
  assert.equal(calls, 1);
  resetJsonEditorModuleLoaderForTests();
});

test("JSON editor controller retains state and navigates an exact diagnostic range", async () => {
  const gridHost = { classList: classList() };
  const jsonHost = { classList: classList() };
  let selected = null;
  let cleared = 0;
  let measured = 0;
  const fakeModule = {
    createJsonEditorState({ text }) {
      return { doc: { length: text.length, toString: () => text } };
    },
    createJsonEditorView({ state }) {
      return {
        state,
        destroy() {},
        focus() {}
      };
    },
    selectAndReveal(_view, range) { selected = range; },
    clearDiagnosticHighlight() { cleared += 1; },
    refreshJsonEditorAppearance() { measured += 1; },
    undoJsonEditor() { return true; },
    redoJsonEditor() { return true; },
    openJsonSearch() { return true; },
    findNextJson() { return true; },
    findPreviousJson() { return true; },
    selectAllJson() { return true; }
  };
  const controller = createJsonEditorController({
    gridHost,
    jsonHost,
    loadModule: async () => fakeModule
  });
  const doc = JsonDocument.fromText("a.json", "[\n  {\"Key\":\"🙂A\"}\n]", {
    path: "/mod/data/local/lng/strings/a.json"
  });
  await controller.navigateToDiagnostic(doc, {
    id: "json-problem-1",
    rowIndex: 1,
    endRowIndex: 1,
    startCharacter: 9,
    endCharacter: 13
  });
  const start = doc.text.indexOf("\"🙂A\"");
  assert.deepEqual(selected, { start, end: start + 4 });
  assert.equal(doc.activeDiagnosticId, "json-problem-1");
  controller.reconcileDiagnosticHighlight([{
    id: "json-problem-1",
    filePath: doc.path
  }]);
  assert.equal(cleared, 0, "ordinary editor selection changes must not clear the problem highlight");
  controller.refreshAppearance();
  assert.equal(measured, 1);
  controller.reconcileDiagnosticHighlight([]);
  assert.equal(cleared, 1);
  assert.equal(doc.activeDiagnosticId, null);
  assert.equal(gridHost.classList.contains("hidden"), true);
  controller.showTable();
  assert.equal(jsonHost.classList.contains("hidden"), true);
});

test("unopened JSON Problems use LSP character columns and policy navigation", () => {
  const diagnostic = mapLspDiagnosticToDisplay({
    row: 8,
    endRow: 8,
    col: 0,
    startCharacter: 12,
    endCharacter: 18,
    severity: "warning",
    message: "Duplicate string id",
    code: "Json/DuplicateIds"
  }, {
    uri: "file:///mod/data/local/lng/strings/skills.json",
    fileKey: "/mod/data/local/lng/strings/skills.json",
    fileName: "skills.json",
    filePath: "/mod/data/local/lng/strings/skills.json",
    generation: 11,
    sequence: 4,
    sourceExists: true,
    jsonNavigationEnabled: true
  });
  assert.equal(diagnostic.columnIndex, 12);
  assert.equal(diagnostic.locationLabel, "Row 9, Col 13");
  assert.equal(diagnostic.navigationDisabled, false);
  assert.equal(diagnostic.documentKind, "json");
  assert.equal(diagnostic.generation, 11);
  assert.equal(diagnostic.sequence, 4);
});

test("CodeMirror is pinned, generated, ignored, and absent from the initial HTML module graph", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const [name, version] of Object.entries({
    "@codemirror/state": "6.7.1",
    "@codemirror/view": "6.43.6",
    "@codemirror/lang-json": "6.0.2",
    "@codemirror/commands": "6.10.4",
    "@codemirror/search": "6.7.1",
    "@codemirror/language": "6.12.4",
    "@codemirror/lint": "6.9.7",
    "@lezer/highlight": "1.2.3"
  })) assert.equal(pkg.dependencies[name], version);
  assert.equal(pkg.devDependencies.esbuild, "0.28.1");
  assert.match(readFileSync(new URL("../.gitignore", import.meta.url), "utf8"), /\/generated\//);
  assert.doesNotMatch(
    readFileSync(new URL("../index.html", import.meta.url), "utf8"),
    /codemirror-json-editor\.js/
  );
  const editorSource = readFileSync(
    new URL("../src/ui/codemirror-json-editor-entry.js", import.meta.url),
    "utf8"
  );
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(editorSource, /HighlightStyle\.define/);
  assert.match(editorSource, /StateField\.define/);
  assert.match(editorSource, /cm-diagnostic-focus/);
  assert.match(styles, /\.json-editor-host[\s\S]*font-family:\s*var\(--grid-font\)\s*!important/);
});
