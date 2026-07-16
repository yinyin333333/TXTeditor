import { isJsonDocument } from "../../core/document-file-state.js";
import { undoManagerForDocument } from "../../core/document-undo-state.js";

export function createDocumentEditorController({
  grid,
  gridHost,
  jsonEditorController,
  selection,
  applyFreezeToDoc = () => {}
}) {
  function activateDocument(doc, { focus = true } = {}) {
    if (isJsonDocument(doc)) return jsonEditorController.showDocument(doc, { focus });
    jsonEditorController.showTable();
    applyFreezeToDoc(doc);
    grid.setDocument(doc);
    if (focus) gridHost?.focus?.();
    return true;
  }

  function commitDocument(doc) {
    if (isJsonDocument(doc)) jsonEditorController.commitActive();
    else grid.commitEdit();
  }

  function focusDocument(doc) {
    if (isJsonDocument(doc)) jsonEditorController.focusActive();
    else gridHost?.focus?.();
  }

  function saveViewState(doc) {
    if (!doc || isJsonDocument(doc) || typeof selection?.snapshot !== "function") return;
    doc.selectionState = selection.snapshot();
    if (grid.doc === doc) {
      doc.scrollLeft = grid.scrollLeft;
      doc.scrollTop = grid.scrollTop;
    }
  }

  function undoDocument(doc) {
    if (isJsonDocument(doc)) return jsonEditorController.undo(), null;
    return undoManagerForDocument(doc).undo(doc);
  }

  function redoDocument(doc) {
    if (isJsonDocument(doc)) return jsonEditorController.redo(), null;
    return undoManagerForDocument(doc).redo(doc);
  }

  function pushTableCommand(doc, command) {
    undoManagerForDocument(doc).push(command);
  }

  function selectAllDocument(doc, selectTable) {
    return isJsonDocument(doc) ? jsonEditorController.selectAll() : selectTable();
  }

  return {
    activateDocument,
    commitDocument,
    focusDocument,
    pushTableCommand,
    redoDocument,
    saveViewState,
    selectAllDocument,
    undoDocument
  };
}
