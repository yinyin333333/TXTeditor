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
  columnsFromSelection,
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
    if (name === "insertRow") return execute(insertRowCommand(doc, Math.max(1, rect.top)));
    if (name === "deleteRow") return runBodyRowCommand(rect, (bodyRect) => execute(deleteRowsCommand(doc, bodyRect.top, bodyRect.bottom - bodyRect.top + 1)), "Header row cannot be deleted.");
    if (name === "clearRow") return runBodyRowCommand(rect, (bodyRect) => execute(clearRangeCommand(doc, { top: bodyRect.top, bottom: bodyRect.bottom, left: 0, right: doc.columnCount - 1 }, "Clear Row")), "Header row cannot be cleared as a row.");
    if (name === "hideRow") return runBodyRowsCommand(rowsFromSelection(), (rows) => execute(hiddenRowsCommand(rows, true)), "Header row cannot be hidden.");
    if (name === "unhideRows") return execute(hiddenRowsCommand([...doc.hiddenRows], false));
    if (name === "insertColumn") return execute(insertColumnCommand(doc, rect.left));
    if (name === "deleteColumn") return execute(deleteColumnsCommand(doc, rect.left, rect.right - rect.left + 1));
    if (name === "clearColumn") return execute(clearRangeCommand(doc, { top: 0, bottom: doc.rowCount - 1, left: rect.left, right: rect.right }, "Clear Column"));
    if (name === "hideColumn") return execute(hiddenColumnsCommand(columnsFromSelection(), true));
    if (name === "unhideColumns") return execute(hiddenColumnsCommand([...doc.hiddenColumns], false));
    if (name === "fill") return execute(fillSelectedCellsCommand(doc, state.selection.ranges, state.selection.anchor));
    if (name === "incrementFill") return execute(incrementFillSelectedCellsCommand(doc, state.selection.ranges, state.selection.anchor));
  }

  function runBodyRowCommand(rect, run, error) {
    const bodyRect = { ...rect, top: Math.max(1, rect.top) };
    if (bodyRect.top > bodyRect.bottom) return showError(error);
    return run(bodyRect);
  }

  function runBodyRowsCommand(rows, run, error) {
    const targets = rows.filter((row) => row > 0);
    if (!targets.length) return showError(error);
    return run(targets);
  }

  return {
    commandLabels,
    commands,
    runCommand
  };
}
