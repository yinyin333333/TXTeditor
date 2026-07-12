export class UndoManager {
  constructor(limit = 1000) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  push(command) {
    if (!command || command.isEmpty) return;
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(doc) {
    const command = this.undoStack.pop();
    if (!command) return null;
    command.undo(doc);
    this.redoStack.push(command);
    return command;
  }

  redo(doc) {
    const command = this.redoStack.pop();
    if (!command) return null;
    command.redo(doc);
    this.undoStack.push(command);
    return command;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}

export function makeCellCommand(label, doc, edits) {
  const beforeShape = captureCellShape(doc);
  const changes = [];
  for (const edit of edits) {
    const before = doc.getCell(edit.row, edit.column);
    const after = String(edit.value);
    if (before !== after) {
      changes.push({ row: edit.row, column: edit.column, before, after });
    }
  }
  const rows = [...new Set(changes.map((change) => change.row))];
  const afterSerializedColumnCount = beforeShape.serializedColumnCount == null
    ? null
    : Math.max(beforeShape.serializedColumnCount, ...changes.map((change) => change.column + 1));
  const undoLspChange = changes.some((change) => change.row >= beforeShape.rowCount)
    ? { kind: "full", reason: "undo-restores-row-count" }
    : { kind: "replaceRows", rows };
  return {
    label,
    changes,
    contentChanged: true,
    lspChange: { kind: "replaceRows", rows },
    undoLspChange,
    timestamp: Date.now(),
    get isEmpty() {
      return changes.length === 0;
    },
    undo(target) {
      target.applyCells(changes, "before");
      restoreCellShape(target, beforeShape);
    },
    redo(target) {
      target.serializedColumnCount = afterSerializedColumnCount;
      target.applyCells(changes, "after");
    }
  };
}

function captureCellShape(doc) {
  return {
    rowCount: doc.rows.length,
    rowLengths: doc.rows.map((row) => row.length),
    serializedColumnCount: doc.serializedColumnCount
  };
}

function restoreCellShape(doc, shape) {
  doc.rows.length = shape.rowCount;
  for (let row = 0; row < shape.rowLengths.length; row++) {
    doc.rows[row].length = shape.rowLengths[row];
  }
  doc.serializedColumnCount = shape.serializedColumnCount;
  doc.refreshShape();
}

export function makeCustomCommand(label, { redo, undo, empty = false, ...metadata }) {
  return {
    label,
    ...metadata,
    timestamp: Date.now(),
    get isEmpty() {
      return empty;
    },
    redo,
    undo
  };
}
