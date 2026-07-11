import assert from "node:assert/strict";
import test from "node:test";

import { TableDocument } from "../src/core/table-model.js";
import { decodeBuffer, encodeText, saveDocumentNative } from "../src/core/io.js";
import { tableFileState } from "../src/core/table-file-state.js";
import { pasteTextCommand } from "../src/core/operations.js";
import { UndoManager } from "../src/core/undo.js";
import { createEditCommandController } from "../src/ui/controllers/edit-command-controller.js";

function serializedShape(doc) {
  const text = doc.toText();
  return {
    text,
    utf8Hex: Buffer.from(text, "utf8").toString("hex"),
    rowCount: doc.rowCount,
    rowLengths: doc.rows.map((row) => row.length),
    columnCount: doc.columnCount,
    serializedColumnCount: doc.serializedColumnCount,
    serializedRowLengths: text.split(/\r\n|\r|\n/).map((row) => row.split("\t").length)
  };
}

function installRejectingClipboard(t, message = "denied") {
  const navigatorObject = globalThis.navigator;
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigatorObject, "clipboard");
  Object.defineProperty(navigatorObject, "clipboard", {
    configurable: true,
    value: {
      async writeText() {
        throw new Error(message);
      }
    }
  });
  t.after(() => {
    if (originalDescriptor) Object.defineProperty(navigatorObject, "clipboard", originalDescriptor);
    else delete navigatorObject.clipboard;
  });
}

test("V-TXT-01 empty clipboard paste is a no-op", () => {
  const doc = TableDocument.fromText("items.txt", "KEEP\nNEXT", { dirty: false });
  const before = serializedShape(doc);
  const command = pasteTextCommand(doc, { row: 0, column: 0 }, "");

  command.redo(doc);

  assert.equal(command.isEmpty, true);
  assert.deepEqual(serializedShape(doc), before);
});

for (const [name, clipboardText] of [["LF", "X\n"], ["CRLF", "X\r\n"]]) {
  test(`V-TXT-01 one trailing ${name} terminator does not clear the following row`, () => {
    const doc = TableDocument.fromText("items.txt", "OLD\nKEEP", { dirty: false });
    const command = pasteTextCommand(doc, { row: 0, column: 0 }, clipboardText);

    command.redo(doc);

    assert.equal(doc.toText(), "X\nKEEP");
    assert.equal(doc.getCell(1, 0), "KEEP");
    assert.equal(doc.rowCount, 2);
  });
}

test("V-TXT-01 CRLF clipboard matrix keeps its exact 2x2 shape", () => {
  const doc = TableDocument.fromText("items.txt", "old-a\told-b\nkeep-a\tkeep-b\nTAIL", { dirty: false });
  const command = pasteTextCommand(doc, { row: 0, column: 0 }, "A\tB\r\nC\tD\r\n");

  command.redo(doc);

  assert.deepEqual(doc.rows, [["A", "B"], ["C", "D"], ["TAIL"]]);
});

test("V-TXT-02 rejected clipboard write leaves Cut fully atomic", async (t) => {
  installRejectingClipboard(t);
  const doc = TableDocument.fromText("items.txt", "KEEP\tOTHER", { dirty: false });
  const undo = new UndoManager();
  const errors = [];
  let executeCalls = 0;
  const before = {
    document: serializedShape(doc),
    dirty: doc.dirty,
    revision: tableFileState(doc).revision,
    undoDepth: undo.undoStack.length,
    redoDepth: undo.redoStack.length
  };
  const controller = createEditCommandController({
    state: {
      selection: {
        ranges: [{ top: 0, left: 0, bottom: 0, right: 0 }]
      }
    },
    grid: {},
    activeDoc: () => doc,
    hasOpenDocument: () => true,
    execute(command) {
      executeCalls += 1;
      command.redo(doc);
      undo.push(command);
    },
    saveSelectionState() {},
    promptNumber: async () => null,
    showError: (message) => errors.push(message)
  });

  await controller.cutSelection();

  assert.deepEqual(errors, ["Clipboard copy failed: denied"]);
  assert.equal(executeCalls, 0);
  assert.deepEqual({
    document: serializedShape(doc),
    dirty: doc.dirty,
    revision: tableFileState(doc).revision,
    undoDepth: undo.undoStack.length,
    redoDepth: undo.redoStack.length
  }, before);
});

test("V-TXT-03 out-of-bounds paste undo restores bytes and ragged table shape repeatedly", () => {
  const doc = TableDocument.fromText("items.txt", "h1\th2\r\nA\tB\r\nRAGGED", { dirty: false });
  const undo = new UndoManager();
  const before = serializedShape(doc);
  const command = pasteTextCommand(doc, { row: 2, column: 1 }, "X\tY\r\nZ\tW");

  command.redo(doc);
  undo.push(command);
  const firstRedo = serializedShape(doc);
  undo.undo(doc);
  const firstUndo = serializedShape(doc);
  undo.redo(doc);
  const secondRedo = serializedShape(doc);
  undo.undo(doc);
  const secondUndo = serializedShape(doc);

  assert.notDeepEqual(firstRedo, before);
  assert.deepEqual(secondRedo, firstRedo);
  assert.deepEqual(firstUndo, before);
  assert.deepEqual(secondUndo, before);
});

test("V-TXT-04 CP1252 special bytes decode correctly and re-encode byte-for-byte", () => {
  const source = Uint8Array.from([0x80, 0x91, 0x92, 0x96, 0xE9]);

  const decoded = decodeBuffer(source);

  assert.equal(decoded.encoding, "windows-1252");
  assert.equal(decoded.text, "€‘’–é");
  assert.deepEqual([...encodeText(decoded.text, decoded.encoding)], [...source]);
});

for (const fixture of [
  {
    name: "UTF-16LE",
    encoding: "utf-16le",
    bytes: [0xFF, 0xFE, 0x41, 0x00, 0x42, 0x00]
  },
  {
    name: "UTF-16BE",
    encoding: "utf-16be",
    bytes: [0xFE, 0xFF, 0x00, 0x41, 0x00, 0x42]
  }
]) {
  test(`V-TXT-04 ${fixture.name} BOM text decodes and re-encodes byte-for-byte`, () => {
    const source = Uint8Array.from(fixture.bytes);

    const decoded = decodeBuffer(source);

    assert.equal(decoded.encoding, fixture.encoding);
    assert.equal(decoded.text, "AB");
    assert.deepEqual([...encodeText(decoded.text, decoded.encoding)], [...source]);
  });
}

test("V-TXT-04 UTF-8 remains the default byte-for-byte codec", () => {
  const source = Uint8Array.from([0x41, 0xC3, 0xA9, 0xE2, 0x82, 0xAC]);

  const decoded = decodeBuffer(source);

  assert.equal(decoded.encoding, "utf-8");
  assert.equal(decoded.text, "Aé€");
  assert.deepEqual([...encodeText(decoded.text)], [...source]);
});

test("V-TXT-04 browser and native CP1252 policy rejects mapped C1 controls", () => {
  assert.throws(
    () => encodeText("\u0080", "windows-1252"),
    /cannot be encoded as Windows-1252/
  );
  assert.deepEqual([...encodeText("\u0081", "windows-1252")], [0x81]);
});

test("V-TXT-04 native chunk save sends document encoding on every write", async () => {
  const originalWindow = globalThis.window;
  const text = Array.from({ length: 2505 }, (_, index) => index === 0 ? "name" : `row-${index}`).join("\n");
  const doc = TableDocument.fromText("items.txt", text, {
    path: "E:\\items.txt",
    dirty: true,
    encoding: "windows-1252"
  });
  const writes = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          assert.equal(command, "write_text_file_chunk_safe");
          writes.push(args);
          return args.last ? { path: args.path, name: "items.txt", encoding: args.encoding } : null;
        }
      }
    }
  };

  try {
    assert.equal(await saveDocumentNative(doc, false), true);
    assert.ok(writes.length > 1);
    assert.equal(writes.every((write) => write.encoding === "windows-1252"), true);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("V-TXT-10 native chunk save serializes one immutable document revision", async () => {
  const originalWindow = globalThis.window;
  const text = Array.from({ length: 2505 }, (_, index) => `row-${index}\tvalue-${index}`).join("\n");
  const doc = TableDocument.fromText("items.txt", text, {
    path: "E:\\items.txt",
    dirty: true,
    encoding: "utf-8"
  });
  const expected = doc.toText();
  const writtenChunks = [];
  let editedDuringSave = false;
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          assert.equal(command, "write_text_file_chunk_safe");
          writtenChunks.push(args.text);
          if (args.first && !editedDuringSave) {
            editedDuringSave = true;
            doc.setCell(2200, 0, "EDITED-DURING-SAVE");
            await new Promise((resolve) => setImmediate(resolve));
          }
          return args.last ? {
            path: args.path,
            name: "items.txt",
            encoding: args.encoding
          } : null;
        }
      }
    }
  };

  try {
    assert.equal(await saveDocumentNative(doc, false), true);
    assert.equal(editedDuringSave, true);
    assert.equal(
      writtenChunks.join(""),
      expected,
      "one save transaction must not mix rows from different document revisions"
    );
    assert.equal(doc.getCell(2200, 0), "EDITED-DURING-SAVE");
    assert.notEqual(doc.toText(), expected);
    assert.equal(doc.dirty, true);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("V-TXT-10 native saves to one target serialize whole chunk transactions", async () => {
  const originalWindow = globalThis.window;
  const targetPath = "E:\\shared.txt";
  const textA = Array.from({ length: 2505 }, (_, index) => `A-${index}\tvalue-A-${index}`).join("\n");
  const textB = Array.from({ length: 2505 }, (_, index) => `B-${index}\tvalue-B-${index}`).join("\n");
  const docA = TableDocument.fromText("a.txt", textA, {
    path: targetPath,
    dirty: true,
    encoding: "utf-8"
  });
  const docB = TableDocument.fromText("b.txt", textB, {
    path: targetPath,
    dirty: true,
    encoding: "utf-8"
  });
  const expectedByTransaction = new Map([
    ["A", docA.toText()],
    ["B", docB.toText()]
  ]);
  const chunksByTransaction = new Map([["A", []], ["B", []]]);
  const activeTransactions = new Set();
  const writeOrder = [];
  let maxActive = 0;
  let targetText = "";
  let releaseFirstA;
  let markFirstAEntered;
  const firstAGate = new Promise((resolve) => { releaseFirstA = resolve; });
  const firstAEntered = new Promise((resolve) => { markFirstAEntered = resolve; });

  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          assert.equal(command, "write_text_file_chunk_safe");
          const transaction = args.text.includes("A-") ? "A" : args.text.includes("B-") ? "B" : null;
          assert.ok(transaction, "each chunk must retain its document identity");
          writeOrder.push(transaction);
          chunksByTransaction.get(transaction).push(args.text);
          if (args.first) activeTransactions.add(transaction);
          maxActive = Math.max(maxActive, activeTransactions.size);

          if (args.first) targetText = args.text;
          else targetText += args.text;

          if (transaction === "A" && args.first) {
            markFirstAEntered();
            await firstAGate;
          }
          if (args.last) activeTransactions.delete(transaction);
          return args.last ? {
            path: args.path,
            name: `${transaction.toLowerCase()}.txt`,
            encoding: args.encoding
          } : null;
        }
      }
    }
  };

  try {
    const savingA = saveDocumentNative(docA, false);
    await firstAEntered;
    const savingB = saveDocumentNative(docB, false);
    for (let turn = 0; turn < 4; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    releaseFirstA();
    assert.deepEqual(await Promise.all([savingA, savingB]), [true, true]);

    const transactionRuns = writeOrder.filter((transaction, index) => transaction !== writeOrder[index - 1]);
    assert.deepEqual({
      maxActive,
      transactionRunCount: transactionRuns.length,
      transactionIds: [...new Set(transactionRuns)].sort(),
      completeTransactionChunks: {
        A: chunksByTransaction.get("A").join("") === expectedByTransaction.get("A"),
        B: chunksByTransaction.get("B").join("") === expectedByTransaction.get("B")
      },
      finalTextMatchesOneDocument:
        targetText === expectedByTransaction.get("A") || targetText === expectedByTransaction.get("B")
    }, {
      maxActive: 1,
      transactionRunCount: 2,
      transactionIds: ["A", "B"],
      completeTransactionChunks: { A: true, B: true },
      finalTextMatchesOneDocument: true
    });
  } finally {
    releaseFirstA();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
