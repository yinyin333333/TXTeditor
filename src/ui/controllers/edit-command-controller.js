import {
  addColumnsCommand,
  addRowsCommand,
  arithmeticRangesCommand,
  arithmeticCommand,
  clearRangesCommand,
  copyRanges,
  insertColumnCommand,
  insertRowCommand,
  pasteTextToRangesCommand
} from "../../core/operations.js";
import {
  readClipboardText,
  writeClipboardText
} from "../app-runtime-utils.js";
import { tText } from "../../core/i18n.js";

export function createEditCommandController({
  state,
  grid,
  activeDoc,
  hasOpenDocument,
  execute,
  saveSelectionState,
  promptNumber,
  showError
}) {
  async function copyRangesToClipboard(doc, ranges) {
    try {
      await writeClipboardText(copyRanges(doc, ranges));
      return true;
    } catch (error) {
      showError(tText("error.clipboardCopy", { error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }

  async function copySelection() {
    if (!hasOpenDocument()) return false;
    const targetDoc = activeDoc();
    const targetRanges = state.selection.ranges.map((range) => ({ ...range }));
    return copyRangesToClipboard(targetDoc, targetRanges);
  }

  async function cutSelection() {
    if (!hasOpenDocument()) return;
    const targetDoc = activeDoc();
    const targetRanges = state.selection.ranges.map((range) => ({ ...range }));
    if (!await copyRangesToClipboard(targetDoc, targetRanges)) return;
    if (activeDoc() !== targetDoc) return;
    execute(clearRangesCommand(targetDoc, targetRanges, "Cut"));
  }

  async function pasteSelection() {
    if (!hasOpenDocument()) return;
    const targetDoc = activeDoc();
    const targetRanges = state.selection.ranges.map((range) => ({ ...range }));
    const targetFocus = { ...state.selection.focus };
    try {
      const text = await readClipboardText();
      if (activeDoc() !== targetDoc) return;
      execute(pasteTextToRangesCommand(targetDoc, targetRanges, targetFocus, text));
    } catch (error) {
      showError(tText("error.clipboardPaste", { error: error instanceof Error ? error.message : String(error) }));
    }
  }

  function selectAll() {
    state.selection.selectAll(activeDoc().rowCount, activeDoc().columnCount);
    saveSelectionState();
    grid.draw();
  }

  async function addRows() {
    const count = await promptNumber({
      title: tText("prompt.addRows"),
      message: tText("prompt.rowsToAdd"),
      defaultValue: 1,
      min: 1
    });
    if (count !== null) execute(addRowsCommand(activeDoc(), count));
  }

  async function insertRows() {
    const count = await promptNumber({
      title: tText("prompt.insertRows"),
      message: tText("prompt.rowsToInsert"),
      defaultValue: 1,
      min: 1
    });
    if (count !== null) execute(insertRowCommand(activeDoc(), state.selection.rect.top, count));
  }

  async function addColumns() {
    const count = await promptNumber({
      title: tText("prompt.addColumns"),
      message: tText("prompt.columnsToAdd"),
      defaultValue: 1,
      min: 1
    });
    if (count !== null) execute(addColumnsCommand(activeDoc(), count));
  }

  async function insertColumns() {
    const count = await promptNumber({
      title: tText("prompt.insertColumns"),
      message: tText("prompt.columnsToInsert"),
      defaultValue: 1,
      min: 1
    });
    if (count !== null) execute(insertColumnCommand(activeDoc(), state.selection.rect.left, count));
  }

  async function math(kind) {
    const operator = { add: "+", subtract: "-", multiply: "*", divide: "/" }[kind];
    const operand = await promptNumber({
      title: tText("prompt.math"),
      message: tText("prompt.applyMath", { operator }),
      defaultValue: "",
      allowFloat: true
    });
    if (operand !== null) execute(state.selection.isMultiRange
      ? arithmeticRangesCommand(activeDoc(), state.selection.ranges, operator, operand)
      : arithmeticCommand(activeDoc(), state.selection.rect, operator, operand));
  }

  return {
    copySelection,
    cutSelection,
    pasteSelection,
    selectAll,
    addRows,
    insertRows,
    addColumns,
    insertColumns,
    math
  };
}
