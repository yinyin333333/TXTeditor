import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readClipboardText, writeClipboardText } from "../src/ui/app-runtime-utils.js";
import { CanvasGrid } from "../src/ui/canvas-grid.js";
import { createEditCommandController } from "../src/ui/controllers/edit-command-controller.js";

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

test("desktop clipboard uses the Tauri plugin instead of permission-gated Web Clipboard APIs", async () => {
  const calls = [];
  const restoreWindow = replaceGlobal("window", {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push({ command, args });
          return command.endsWith("read_text") ? "from desktop" : undefined;
        }
      }
    }
  });
  const restoreNavigator = replaceGlobal("navigator", {
    clipboard: {
      readText: async () => { throw new Error("web clipboard must not be used"); },
      writeText: async () => { throw new Error("web clipboard must not be used"); }
    }
  });

  try {
    await writeClipboardText("selected cells");
    assert.equal(await readClipboardText(), "from desktop");
    assert.deepEqual(calls, [
      { command: "plugin:clipboard-manager|write_text", args: { text: "selected cells" } },
      { command: "plugin:clipboard-manager|read_text", args: undefined }
    ]);
  } finally {
    restoreNavigator();
    restoreWindow();
  }
});

test("browser clipboard retains the Web Clipboard fallback", async () => {
  let written = "";
  const restoreWindow = replaceGlobal("window", {});
  const restoreNavigator = replaceGlobal("navigator", {
    clipboard: {
      writeText: async (value) => { written = value; },
      readText: async () => "from browser"
    }
  });

  try {
    await writeClipboardText(42);
    assert.equal(written, "42");
    assert.equal(await readClipboardText(), "from browser");
  } finally {
    restoreNavigator();
    restoreWindow();
  }
});

test("desktop build registers clipboard text permissions and the plugin", () => {
  const cargo = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
  const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const capability = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));

  assert.match(cargo, /tauri-plugin-clipboard-manager = "2"/);
  assert.match(rust, /\.plugin\(tauri_plugin_clipboard_manager::init\(\)\)/);
  assert.ok(capability.permissions.includes("clipboard-manager:allow-read-text"));
  assert.ok(capability.permissions.includes("clipboard-manager:allow-write-text"));
});

function editableDocument() {
  const doc = {
    rows: [["frozen-row", "frozen-row-value"], ["normal-row", "normal-value"]],
    freezeFirstRow: true,
    freezeFirstColumn: true,
    serializedColumnCount: 2,
    get rowCount() { return this.rows.length; },
    get columnCount() { return this.rows[0].length; },
    getCell(row, column) { return this.rows[row]?.[column] ?? ""; },
    setCell(row, column, value) { this.rows[row][column] = String(value); },
    applyCells(changes, key) {
      for (const change of changes) this.setCell(change.row, change.column, change[key]);
    },
    refreshShape() {}
  };
  return doc;
}

test("copy, paste, and cut use the same command path for frozen and normal cells", async () => {
  let clipboardText = "";
  const restoreWindow = replaceGlobal("window", {
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          if (command.endsWith("write_text")) clipboardText = args.text;
          if (command.endsWith("read_text")) return "pasted";
          return undefined;
        }
      }
    }
  });

  try {
    for (const cell of [
      { row: 0, column: 1, initial: "frozen-row-value" },
      { row: 1, column: 1, initial: "normal-value" }
    ]) {
      const doc = editableDocument();
      const range = { top: cell.row, left: cell.column, bottom: cell.row, right: cell.column };
      const state = { selection: { ranges: [range], focus: { row: cell.row, column: cell.column } } };
      const controller = createEditCommandController({
        state,
        grid: { draw() {} },
        activeDoc: () => doc,
        hasOpenDocument: () => true,
        execute(command) { command.redo(doc); },
        saveSelectionState() {},
        promptNumber: async () => null,
        showError(error) { throw new Error(String(error)); }
      });

      await controller.copySelection();
      assert.equal(clipboardText, cell.initial);
      await controller.pasteSelection();
      assert.equal(doc.getCell(cell.row, cell.column), "pasted");
      await controller.cutSelection();
      assert.equal(clipboardText, "pasted");
      assert.equal(doc.getCell(cell.row, cell.column), "");
    }
  } finally {
    restoreWindow();
  }
});

function tokenList() {
  const values = new Set();
  return {
    add: (value) => values.add(value),
    remove: (value) => values.delete(value),
    contains: (value) => values.has(value)
  };
}

test("direct cell editing starts and commits identically in frozen and normal cells", () => {
  for (const cell of [
    { row: 0, column: 1, value: "frozen-row-value" },
    { row: 1, column: 1, value: "normal-value" }
  ]) {
    const commits = [];
    const editor = {
      value: "",
      style: {},
      dataset: {},
      classList: tokenList(),
      focus() {}
    };
    const grid = {
      editing: false,
      editMode: null,
      selection: { focus: { row: cell.row, column: cell.column } },
      doc: {
        freezeFirstRow: true,
        freezeFirstColumn: true,
        getCell: (row, column) => row === cell.row && column === cell.column ? cell.value : ""
      },
      host: { getBoundingClientRect: () => ({ left: 10, top: 20 }) },
      zoom: 1,
      editor,
      cellBox: () => ({ left: 30, top: 40, width: 100, height: 26 }),
      styleEditorForCell() {},
      draw() {},
      notifySelectionChanged() {},
      onEdit(edits, label) { commits.push({ edits, label }); }
    };

    CanvasGrid.prototype.startEdit.call(grid);
    assert.equal(grid.editing, true);
    assert.equal(editor.classList.contains("active"), true);
    assert.equal(editor.value, cell.value);
    editor.value = `${cell.value}-edited`;
    CanvasGrid.prototype.commitEdit.call(grid);
    assert.equal(grid.editing, false);
    assert.deepEqual(commits, [{
      edits: [{ row: cell.row, column: cell.column, value: `${cell.value}-edited` }],
      label: "Edit Cell"
    }]);
  }
});
