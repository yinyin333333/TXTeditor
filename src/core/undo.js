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
  const rowSnapshots = captureCellRows(doc, rows);
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
      restoreCellShape(target, beforeShape, rowSnapshots);
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
    columnCount: doc.columnCount,
    serializedColumnCount: doc.serializedColumnCount
  };
}

function captureCellRows(doc, rows) {
  return new Map(rows
    .filter((row) => row >= 0 && row < doc.rows.length)
    .map((row) => [row, doc.rows[row].slice()]));
}

function restoreCellShape(doc, shape, rowSnapshots = new Map()) {
  const shapeChanged = doc.rows.length !== shape.rowCount || doc.columnCount !== shape.columnCount;
  doc.rows.length = shape.rowCount;
  for (const [row, before] of rowSnapshots) {
    const targetRow = doc.rows[row];
    if (!targetRow) continue;
    targetRow.length = before.length;
    for (let column = 0; column < before.length; column++) {
      if (column in before) targetRow[column] = before[column];
      else delete targetRow[column];
    }
  }
  doc.serializedColumnCount = shape.serializedColumnCount;
  if (shapeChanged) doc.refreshShape();
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
