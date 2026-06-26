import { UndoManager } from "./undo.js";

const documentUndoStates = new WeakMap();

export function undoManagerForDocument(doc) {
  let manager = documentUndoStates.get(doc);
  if (!manager) {
    manager = new UndoManager();
    documentUndoStates.set(doc, manager);
  }
  return manager;
}

export function resetUndoManagerForDocument(doc) {
  const manager = new UndoManager();
  documentUndoStates.set(doc, manager);
  return manager;
}
