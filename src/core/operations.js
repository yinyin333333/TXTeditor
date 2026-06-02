import { clamp } from "./table-model.js";
import { makeCellCommand, makeCustomCommand } from "./undo.js";

export function rectCells(rect) {
  const cells = [];
  for (let row = rect.top; row <= rect.bottom; row++) {
    for (let column = rect.left; column <= rect.right; column++) cells.push({ row, column });
  }
  return cells;
}

export function copyRange(doc, rect) {
  const lines = [];
  for (let row = rect.top; row <= rect.bottom; row++) {
    const values = [];
    for (let column = rect.left; column <= rect.right; column++) values.push(doc.getCell(row, column));
    lines.push(values.join("\t"));
  }
  return lines.join("\n");
}

export function pasteTextCommand(doc, start, text) {
  const rows = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((line) => line.split("\t"));
  const edits = [];
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < rows[row].length; column++) {
      edits.push({ row: start.row + row, column: start.column + column, value: rows[row][column] });
    }
  }
  return makeCellCommand("Paste Range", doc, edits);
}

export function clearRangeCommand(doc, rect, label = "Clear Cell(s)") {
  return makeCellCommand(label, doc, rectCells(rect).map(({ row, column }) => ({ row, column, value: "" })));
}

export function fillRangeCommand(doc, rect, value) {
  return makeCellCommand("Fill Selected Cells", doc, rectCells(rect).map(({ row, column }) => ({ row, column, value })));
}

export function fillSelectionCommand(doc, rect) {
  return fillRangeCommand(doc, rect, doc.getCell(rect.top, rect.left));
}

export function incrementFillCommand(doc, rect) {
  const seed = String(doc.getCell(rect.top, rect.left)).trim();
  if (seed === "") return makeCellCommand("Increment Fill", doc, []);
  const nextValue = incrementValueFactory(seed);
  const edits = [];
  let index = 0;
  for (let row = rect.top; row <= rect.bottom; row++) {
    for (let column = rect.left; column <= rect.right; column++) {
      edits.push({ row, column, value: nextValue(index) });
      index++;
    }
  }
  return makeCellCommand("Increment Fill", doc, edits);
}

export function arithmeticCommand(doc, rect, operator, operand) {
  const amount = Number(operand);
  if (!Number.isFinite(amount)) return makeCellCommand("Math", doc, []);
  const edits = [];
  for (const { row, column } of rectCells(rect)) {
    const current = Number(doc.getCell(row, column));
    if (!Number.isFinite(current)) continue;
    let next = current;
    if (operator === "+") next = current + amount;
    if (operator === "-") next = current - amount;
    if (operator === "*") next = current * amount;
    if (operator === "/" && amount !== 0) next = current / amount;
    edits.push({ row, column, value: String(Number.isInteger(next) ? next : Number(next.toFixed(8))) });
  }
  return makeCellCommand(`Math ${operator} ${amount}`, doc, edits);
}

export function insertRowCommand(doc, index, values = []) {
  const at = clamp(index, 0, doc.rowCount);
  let inserted = null;
  return makeCustomCommand("Insert Row", {
    redo(target) {
      inserted = target.insertRow(at, values);
    },
    undo(target) {
      target.removeRows(at, inserted?.values ? 1 : 1);
    }
  });
}

export function addRowsCommand(doc, count = 1) {
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  const at = doc.rowCount;
  return makeCustomCommand(`Add ${safeCount} Row(s)`, {
    redo(target) {
      for (let i = 0; i < safeCount; i++) target.insertRow(at + i);
    },
    undo(target) {
      target.removeRows(at, safeCount);
    }
  });
}

export function deleteRowsCommand(doc, index, count = 1) {
  const at = clamp(index, 0, Math.max(0, doc.rowCount - 1));
  let deleted = null;
  return makeCustomCommand("Delete Row", {
    redo(target) {
      deleted = target.deleteRows(at, count);
    },
    undo(target) {
      target.restoreRows(at, deleted.rows, deleted.rowHeights);
    }
  });
}

export function insertColumnCommand(doc, index, name = "new_column") {
  const at = clamp(index, 0, doc.columnCount);
  return makeCustomCommand("Insert Column", {
    redo(target) {
      target.insertColumn(at, name === "new_column" ? `Column${at + 1}` : name);
    },
    undo(target) {
      target.removeColumns(at, 1);
    }
  });
}

export function addColumnsCommand(doc, count = 1) {
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  const at = doc.columnCount;
  return makeCustomCommand(`Add ${safeCount} Column(s)`, {
    redo(target) {
      for (let i = 0; i < safeCount; i++) target.insertColumn(at + i, `Column${at + i + 1}`);
    },
    undo(target) {
      target.removeColumns(at, safeCount);
    }
  });
}

export function deleteColumnsCommand(doc, index, count = 1) {
  const at = clamp(index, 0, Math.max(0, doc.columnCount - 1));
  let deleted = null;
  return makeCustomCommand("Delete Column", {
    redo(target) {
      deleted = target.deleteColumns(at, count);
    },
    undo(target) {
      target.restoreColumns(at, deleted.columns, deleted.columnWidths);
    }
  });
}

export function hiddenRowsCommand(rows, hidden) {
  return makeCustomCommand(hidden ? "Hide Row" : "Unhide Row(s)", {
    redo(target) {
      target.setRowsHidden(rows, hidden);
    },
    undo(target) {
      target.setRowsHidden(rows, !hidden);
    }
  });
}

export function hiddenColumnsCommand(columns, hidden) {
  return makeCustomCommand(hidden ? "Hide Column" : "Unhide Column(s)", {
    redo(target) {
      target.setColumnsHidden(columns, hidden);
    },
    undo(target) {
      target.setColumnsHidden(columns, !hidden);
    }
  });
}

export function resizeColumnCommand(column, before, after) {
  return makeCustomCommand("Resize Column", {
    empty: before === after,
    redo(target) {
      target.setColumnWidth(column, after);
    },
    undo(target) {
      target.setColumnWidth(column, before);
    }
  });
}

export function resizeRowCommand(row, before, after) {
  return makeCustomCommand("Resize Row", {
    empty: before === after,
    redo(target) {
      target.setRowHeight(row, after);
    },
    undo(target) {
      target.setRowHeight(row, before);
    }
  });
}

function incrementValueFactory(seed) {
  const number = Number(seed);
  if (Number.isFinite(number)) {
    return (index) => formatNumber(number + index);
  }
  const match = seed.match(/^(.*?)(\d+)$/);
  if (match) {
    const [, prefix, digits] = match;
    const start = Number(digits);
    const width = digits.length;
    return (index) => `${prefix}${String(start + index).padStart(width, "0")}`;
  }
  return (index) => `${seed}${index + 1}`;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)));
}
