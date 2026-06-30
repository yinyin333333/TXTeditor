import {
  canRunCommandWithoutDocument,
  commandActionForId,
  commandLabelsForEnvironment,
  createCommandRunners
} from "../command-registry.js";
import {
  clearRangeCommand,
  clearRangesCommand,
  deleteColumnsCommand,
  deleteRowsCommand,
  fillSelectedCellsCommand,
  hiddenColumnsCommand,
  hiddenRowsCommand,
  incrementFillSelectedCellsCommand,
  insertColumnCommand,
  insertRowCommand
} from "../../core/operations.js";

export function createCommandController({
  isDevelopmentMode,
  state,
  activeDoc,
  hasOpenDocument,
  execute,
  rowsFromSelection,
  rowsForRowOperation = rowsFromSelection,
  columnsFromSelection,
  columnsForColumnOperation = columnsFromSelection,
  showError,
  handlers
}) {
  const commandLabels = commandLabelsForEnvironment({ isDevelopmentMode });
  const commands = createCommandRunners(commandLabels, runCommand);

  function runCommand(id) {
    if (!hasOpenDocument() && !canRunCommandWithoutDocument(id)) return showError("Open a file before using that command.");
    const doc = activeDoc();
    const rect = state.selection.rect;
    const action = commandActionForId(id);
    if (action.type === "handler") return runCommandHandler(action.name);
    if (action.type === "fixture") return handlers.loadFixture(action.size);
    if (action.type === "execute") return executeCommandAction(action.name, doc, rect);
    if (action.type === "math") return handlers.math(action.kind);
    if (action.type === "freeze") return handlers.toggleFreeze(action.kind);
    if (action.type === "zoom") return handlers.zoomBy(action.delta);
    if (action.type === "zoom-reset") return handlers.zoomReset();
    if (action.type === "resize") return handlers.resizeFit(action.useSelection);
  }

  function runCommandHandler(name) {
    const handler = handlers[name];
    return handler?.();
  }

  function executeCommandAction(name, doc, rect) {
    if (name === "clearSelection") return execute(clearRangesCommand(doc, state.selection.ranges));
    if (name === "insertRow") return execute(insertRowCommand(doc, rect.top));
    if (name === "deleteRow") return execute(deleteRowsCommand(doc, rect.top, rect.bottom - rect.top + 1));
    if (name === "clearRow") return execute(clearRangeCommand(doc, { top: rect.top, bottom: rect.bottom, left: 0, right: doc.columnCount - 1 }, "Clear Row"));
    if (name === "hideRow") return execute(hiddenRowsCommand(rowsForRowOperation(), true));
    if (name === "unhideRows") return execute(hiddenRowsCommand(doc.hiddenRows, false));
    if (name === "insertColumn") return execute(insertColumnCommand(doc, rect.left));
    if (name === "deleteColumn") return execute(deleteColumnsCommand(doc, rect.left, rect.right - rect.left + 1));
    if (name === "clearColumn") return execute(clearRangeCommand(doc, { top: 0, bottom: doc.rowCount - 1, left: rect.left, right: rect.right }, "Clear Column"));
    if (name === "hideColumn") return execute(hiddenColumnsCommand(columnsForColumnOperation(), true));
    if (name === "unhideColumns") return execute(hiddenColumnsCommand(doc.hiddenColumns, false));
    if (name === "fill") return execute(fillSelectedCellsCommand(doc, state.selection.ranges, state.selection.anchor));
    if (name === "incrementFill") return execute(incrementFillSelectedCellsCommand(doc, state.selection.ranges, state.selection.anchor));
  }

  return {
    commandLabels,
    commands,
    runCommand
  };
}
