import assert from "node:assert/strict";
import test from "node:test";

import { redo, undo } from "@codemirror/commands";
import { JsonDocument } from "../src/core/json-document.js";
import { encodeText } from "../src/core/platform/text-codec.js";
import { saveDocumentNative } from "../src/core/platform/file-io.js";
import {
  lspDocumentState,
  resetLspDocumentState
} from "../src/core/lsp-document-state.js";
import { lspOpenFile } from "../src/core/platform/lsp-client.js";
import { docToUri } from "../src/core/lsp-uri-policy.js";
import { updateJsonLspDocument } from "../src/ui/controllers/json-lsp-document-controller.js";
import { createJsonEditorController } from "../src/ui/controllers/json-editor-controller.js";
import { createJsonEditorState } from "../src/ui/codemirror-json-editor-entry.js";

const SEPARATORS = ["\n", "\r\n", "\r"];
const FINAL_NEWLINE_OPTIONS = [false, true];
const BOM_OPTIONS = [false, true];

function jsonText(separator, finalNewline) {
  return [
    "[",
    `  {"id":1}`,
    "]"
  ].join(separator) + (finalNewline ? separator : "");
}

function lspChangesFromTransaction(transaction) {
  const changes = [];
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const startLine = transaction.startState.doc.lineAt(fromA);
    const endLine = transaction.startState.doc.lineAt(toA);
    changes.push({
      range: {
        start: { line: startLine.number - 1, character: fromA - startLine.from },
        end: { line: endLine.number - 1, character: toA - endLine.from }
      },
      text: inserted.toString()
    });
  });
  return changes;
}

function createScenarioModule() {
  let currentView = null;
  const callbacks = new WeakMap();
  return {
    currentView: () => currentView,
    createJsonEditorState({ text, lineSeparator, onChange }) {
      const state = createJsonEditorState({ text, lineSeparator });
      callbacks.set(state, onChange);
      return state;
    },
    createJsonEditorView({ state }) {
      let currentState = state;
      const onChange = callbacks.get(state);
      const view = {
        get state() {
          return currentState;
        },
        dispatch(spec) {
          const transaction = currentState.update(spec);
          currentState = transaction.state;
          callbacks.set(currentState, onChange);
          if (transaction.docChanged) {
            onChange?.(currentState.doc.toString(), currentState, {
              changes: lspChangesFromTransaction(transaction)
            });
          }
        },
        destroy() {},
        focus() {}
      };
      currentView = view;
      return view;
    },
    undoJsonEditor: (view) => Boolean(view && undo(view)),
    redoJsonEditor: (view) => Boolean(view && redo(view))
  };
}

function createTestWindow(calls) {
  return {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push({ command, args });
          if (command === "write_text_file_chunk_safe") {
            return {
              path: args.path,
              name: args.path.split("\\").at(-1)
            };
          }
          return undefined;
        }
      }
    }
  };
}

async function runCase({ separator, finalNewline, hasBom }) {
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = createTestWindow(calls);
  const encoding = hasBom ? "utf-8-bom" : "utf-8";
  const raw = jsonText(separator, finalNewline);
  const edited = raw.replace('"id":1', '"id":2');
  const path = `E:\\mod\\data\\local\\lng\\strings\\matrix-${hasBom}-${separator === "\r\n" ? "crlf" : separator === "\r" ? "cr" : "lf"}.json`;
  const doc = JsonDocument.fromText("matrix.json", raw, { path, encoding });
  const other = JsonDocument.fromText("other.json", raw.replace('"id":1', '"id":9'), {
    path: path.replace("matrix-", "other-"),
    encoding
  });
  const changes = [];
  const moduleApi = createScenarioModule();
  const controller = createJsonEditorController({
    gridHost: { classList: { add() {}, remove() {} } },
    jsonHost: { classList: { add() {}, remove() {} } },
    loadModule: async () => moduleApi,
    onDocumentChanged: (changedDoc, changeMeta) => changes.push({ doc: changedDoc, changeMeta })
  });
  const state = {
    docs: [doc, other],
    workspace: {
      path: "E:\\mod",
      files: [{ path: "E:\\mod\\data\\global\\excel\\skills.txt" }]
    },
    lint: { engine: "vector-lsp", enabled: true },
    lsp: { started: true, generation: 41, readiness: "ready" }
  };
  const uri = docToUri(doc);
  Object.assign(lspDocumentState(doc), {
    opened: true,
    openedUri: uri,
    openedVersion: 1,
    version: 1,
    syncedRevision: doc.revision,
    sessionGeneration: 41
  });

  async function sync(change) {
    await updateJsonLspDocument({
      state,
      doc,
      change,
      isVectorLintEngine: () => true,
      openDoc: async () => {},
      recordLspTraffic: () => {},
      renderChrome: () => {}
    });
  }

  try {
    assert.equal(await lspOpenFile(uri, 1, doc.toText(), 41), undefined);
    assert.equal(await controller.showDocument(doc, { focus: false }), true);
    controller.commitActive();
    assert.equal(doc.toText(), raw);
    assert.equal(doc.lineEnding, separator);
    assert.equal(doc.finalNewline, finalNewline);
    assert.equal(doc.hasBom, hasBom);
    assert.equal(doc.dirty, false);

    let view = moduleApi.currentView();
    const idOffset = view.state.doc.toString().indexOf("1");
    view.dispatch({ changes: { from: idOffset, to: idOffset + 1, insert: "2" } });
    assert.equal(doc.toText(), edited);
    assert.equal(doc.dirty, true);
    assert.equal(changes.at(-1).doc, doc);
    await sync(changes.at(-1).changeMeta);

    await controller.showDocument(other, { focus: false });
    assert.equal(other.toText(), raw.replace('"id":1', '"id":9'));
    await controller.showDocument(doc, { focus: false });
    controller.commitActive();
    assert.equal(doc.toText(), edited, "tab switching must retain the edited bytes");

    assert.equal(controller.undo(), true);
    assert.equal(doc.toText(), raw, "undo must restore the exact original separator/final-newline bytes");
    await sync(changes.at(-1).changeMeta);

    assert.equal(controller.redo(), true);
    assert.equal(doc.toText(), edited);
    await sync(changes.at(-1).changeMeta);

    await saveDocumentNative(doc);
    assert.equal(doc.dirty, false);
    assert.equal(doc.toText(), edited);
    const save = calls.find(({ command }) => command === "write_text_file_chunk_safe");
    assert.ok(save, "native save must reach the chunked Tauri command");
    assert.equal(save.args.text, edited);
    assert.equal(save.args.encoding, encoding);
    assert.deepEqual(
      [...encodeText(save.args.text, save.args.encoding)],
      [...encodeText(edited, encoding)],
      "saved UTF-8/BOM bytes must match the document text and encoding"
    );

    assert.equal(controller.undo(), true);
    assert.equal(doc.toText(), raw);
    await sync(changes.at(-1).changeMeta);
    assert.equal(controller.redo(), true);
    assert.equal(doc.toText(), edited);
    await sync(changes.at(-1).changeMeta);

    const open = calls.find(({ command }) => command === "lsp_open_file");
    assert.equal(open.args.text, raw);
    const updates = calls.filter(({ command }) => command.startsWith("lsp_update_file"));
    assert.equal(updates.length, 5, "edit, undo, redo, undo, and redo must each sync once");
    for (const call of calls.filter(({ command }) => command === "lsp_update_file")) {
      assert.equal(call.args.text, doc.toText());
    }
    for (const call of calls.filter(({ command }) => command === "lsp_update_file_incremental")) {
      assert.equal(call.args.uri, uri);
      assert.equal(call.args.generation, 41);
      assert.equal(call.args.changes.length, 1);
    }
  } finally {
    resetLspDocumentState(doc);
    resetLspDocumentState(other);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

for (const separator of SEPARATORS) {
  for (const finalNewline of FINAL_NEWLINE_OPTIONS) {
    for (const hasBom of BOM_OPTIONS) {
      test(`JSON editor preserves ${JSON.stringify(separator)} ${hasBom ? "BOM" : "plain"} ${finalNewline ? "final" : "no-final"} newline through tabs, history, save, and LSP`, async () => {
        await runCase({ separator, finalNewline, hasBom });
      });
    }
  }
}
