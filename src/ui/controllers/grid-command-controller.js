import { clamp } from "../../core/table-model.js";
import { makeCustomCommand } from "../../core/undo.js";
import {
  cloneColumnsCommand,
  cloneRowsCommand,
  hiddenColumnsCommand,
  hiddenRowsCommand,
  resizeColumnCommand,
  resizeRowCommand
} from "../../core/operations.js";
import { indexRange } from "../row-operation-policy.js";
import { persistFreezeState } from "../freeze-state-policy.js";
import { tText } from "../../core/i18n.js";

export function createGridCommandController({
  state,
  grid,
  activeDoc,
  hasOpenDocument,
  execute,
  saveSelectionState,
  renderChrome,
  showError,
  promptNumber = async () => null,
  applyFreezeToDoc,
  rowsForContextOperation,
  columnsFromSelection,
  storage = globalThis.localStorage
}) {
  function toggleFreeze(kind) {
    if (!hasOpenDocument()) return;
    if (kind === "row") state.freezeRow = !state.freezeRow;
    if (kind === "column") state.freezeColumn = !state.freezeColumn;
    persistFreezeState(state, storage);
    applyFreezeToDoc(activeDoc());
    grid.layout();
    renderChrome();
  }

  function unhideAll() {
    const doc = activeDoc();
    const rows = doc.hiddenRows;
    const columns = doc.hiddenColumns;
    if (!rows.size && !columns.size) return;
    const commands = [
      rows.size ? hiddenRowsCommand(rows, false) : null,
      columns.size ? hiddenColumnsCommand(columns, false) : null
    ].filter(Boolean);
    const command = makeCustomCommand("Unhide All", {
      redo(target) {
        for (const item of commands) item.redo(target);
      },
      undo(target) {
        for (let i = commands.length - 1; i >= 0; i--) commands[i].undo(target);
      },
      contentChanged: false,
      lspChange: { kind: "none" }
    });
    execute(command);
  }

  function zoomBy(delta) {
    if (!hasOpenDocument()) return;
    grid.setZoom(activeDoc().zoom + delta);
    renderChrome();
  }

  function zoomReset() {
    if (!hasOpenDocument()) return;
    grid.setZoom(1);
    renderChrome();
  }

  function resetRowHeights() {
    if (!hasOpenDocument()) return;
    activeDoc().resetRowHeights();
    grid.layout();
    renderChrome();
  }

  async function goToRow() {
    if (!hasOpenDocument()) return;
    const doc = activeDoc();
    const rowNumber = await promptNumber({
      title: tText("prompt.goToRow"),
      message: tText("prompt.rowNumber", { max: doc.rowCount }),
      defaultValue: Math.min(doc.rowCount, state.selection.focus.row + 1),
      min: 1,
      max: doc.rowCount
    });
    if (rowNumber === null) return;
    const row = rowNumber - 1;
    const column = clamp(state.selection.focus.column, 0, Math.max(0, doc.columnCount - 1));
    state.selection.set(row, column);
    saveSelectionState(doc);
    grid.scrollCellToCenter(row, column);
    grid.draw();
    renderChrome();
  }

  function resizeFit(useSelection) {
    const doc = activeDoc();
    const columns = useSelection ? columnsFromSelection() : indexRange(0, doc.columnCount - 1);
    return autoFitColumns(columns);
  }

  async function autoFitColumns(columns) {
    const doc = activeDoc();
    const targets = [...new Set(columns)].filter((column) => column >= 0 && column < doc.columnCount && !doc.hiddenColumns.has(column));
    if (!targets.length) return;
    for (let i = 0; i < targets.length; i++) {
      doc.setColumnWidth(targets[i], await grid.measureColumnFitWidth(targets[i]));
      if (i % 16 === 15) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    grid.layout();
    renderChrome();
  }

  function cloneRows() {
    const doc = activeDoc();
    const rows = rowsForContextOperation().filter((row) => row > 0 && row < doc.rowCount);
    if (!rows.length) return showError(tText("error.cloneRows"));
    execute(cloneRowsCommand(doc, rows, doc.rowCount));
  }

  function cloneColumns() {
    const doc = activeDoc();
    const columns = columnsFromSelection().filter((column) => column >= 0 && column < doc.columnCount);
    if (!columns.length) return showError(tText("error.cloneColumns"));
    execute(cloneColumnsCommand(doc, columns, doc.columnCount));
  }

  function commitResize(resize) {
    if (!resize || resize.before === resize.current) return;
    const command = resize.kind === "column"
      ? resizeColumnCommand(resize.index, resize.before, resize.current)
      : resizeRowCommand(resize.index, resize.before, resize.current);
    execute(command);
  }

  return {
    toggleFreeze,
    unhideAll,
    zoomBy,
    zoomReset,
    resetRowHeights,
    goToRow,
    resizeFit,
    autoFitColumns,
    cloneRows,
    cloneColumns,
    commitResize
  };
}
