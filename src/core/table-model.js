export class TableDocument {
  constructor(name = "Untitled.txt", rows = [[]], meta = {}) {
    this.name = name;
    this.path = meta.path ?? "";
    this.handle = meta.handle ?? null;
    this.rows = rows.length ? rows : [[]];
    this.lineEnding = meta.lineEnding ?? "\n";
    this.finalNewline = meta.finalNewline ?? false;
    this.encoding = meta.encoding ?? "utf-8";
    this.dirty = meta.dirty ?? false;
    this.hiddenRows = new Set(meta.hiddenRows ?? []);
    this.hiddenColumns = new Set(meta.hiddenColumns ?? []);
    this.columnWidths = meta.columnWidths ? [...meta.columnWidths] : [];
    this.rowHeights = meta.rowHeights ? [...meta.rowHeights] : [];
    this.defaultColumnWidth = meta.defaultColumnWidth ?? 120;
    this.defaultRowHeight = meta.defaultRowHeight ?? 26;
    this.hasCustomRowHeights = meta.hasCustomRowHeights ?? false;
    this.zoom = meta.zoom ?? 1;
    this.freezeFirstRow = meta.freezeFirstRow ?? false;
    this.freezeFirstColumn = meta.freezeFirstColumn ?? false;
    this.refreshShape();
    if (!meta.columnWidths && meta.autoFitInitialColumns !== false) {
      this.autoFitInitialColumns(meta.initialFitSampleRows ?? 300);
    }
  }

  static fromText(name, text, meta = {}) {
    const crlf = (text.match(/\r\n/g) ?? []).length;
    const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
    const lineEnding = crlf >= lf && crlf > 0 ? "\r\n" : "\n";
    const finalNewline = text.endsWith("\n") || text.endsWith("\r");
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n");
    if (finalNewline) lines.pop();
    const rows = lines.map((line) => line.split("\t"));
    return new TableDocument(name, rows, { ...meta, lineEnding, finalNewline });
  }

  refreshShape() {
    this.rowCount = this.rows.length;
    this.columnCount = this.rows.reduce((max, row) => Math.max(max, row.length), 1);
    while (this.columnWidths.length < this.columnCount) {
      const col = this.columnWidths.length;
      this.columnWidths.push(initialHeaderColumnWidth(this.getCell(0, col)));
    }
    if (this.columnWidths.length > this.columnCount) this.columnWidths.length = this.columnCount;
    while (this.rowHeights.length < this.rowCount) this.rowHeights.push(this.defaultRowHeight);
    if (this.rowHeights.length > this.rowCount) this.rowHeights.length = this.rowCount;
  }

  get headers() {
    return this.rows[0] ?? [];
  }

  getCell(row, column) {
    return this.rows[row]?.[column] ?? "";
  }

  setCell(row, column, value) {
    this.ensureCell(row, column);
    this.rows[row][column] = String(value);
    this.dirty = true;
    this.refreshShape();
  }

  ensureCell(row, column) {
    while (this.rows.length <= row) this.rows.push([]);
    while (this.rows[row].length <= column) this.rows[row].push("");
  }

  applyCellChanges(changes, direction = "after") {
    for (const change of changes) {
      this.ensureCell(change.row, change.column);
      this.rows[change.row][change.column] = change[direction];
    }
    this.dirty = true;
    this.refreshShape();
  }

  applyCells(changes, direction = "after") {
    this.applyCellChanges(changes, direction);
  }

  insertRow(index, values = []) {
    const at = clamp(index, 0, this.rows.length);
    const row = Array.from({ length: Math.max(this.columnCount, values.length) }, (_, i) => values[i] ?? "");
    this.rows.splice(at, 0, row);
    this.rowHeights.splice(at, 0, this.defaultRowHeight);
    this.hiddenRows = shiftSetForInsert(this.hiddenRows, at, 1);
    this.dirty = true;
    this.refreshShape();
    return { type: "insert-row", index: at, values: row };
  }

  deleteRows(start, count = 1) {
    const at = clamp(start, 0, Math.max(0, this.rows.length - 1));
    const safeCount = Math.min(Math.max(1, count), this.rows.length - at);
    const removed = this.rows.splice(at, safeCount);
    const removedHeights = this.rowHeights.splice(at, safeCount);
    this.hiddenRows = shiftSetForDelete(this.hiddenRows, at, safeCount);
    if (!this.rows.length) this.rows.push([]);
    this.dirty = true;
    this.refreshShape();
    return { type: "delete-rows", index: at, rows: removed, rowHeights: removedHeights };
  }

  insertColumn(index, name = "") {
    const at = clamp(index, 0, this.columnCount);
    for (let row = 0; row < this.rows.length; row++) {
      this.rows[row].splice(at, 0, row === 0 ? name : "");
    }
    this.columnWidths.splice(at, 0, 120);
    this.hiddenColumns = shiftSetForInsert(this.hiddenColumns, at, 1);
    this.dirty = true;
    this.refreshShape();
    return { type: "insert-column", index: at, name };
  }

  deleteColumns(start, count = 1) {
    const at = clamp(start, 0, Math.max(0, this.columnCount - 1));
    const safeCount = Math.min(Math.max(1, count), this.columnCount - at);
    const removed = this.rows.map((row) => row.splice(at, safeCount));
    const removedWidths = this.columnWidths.splice(at, safeCount);
    this.hiddenColumns = shiftSetForDelete(this.hiddenColumns, at, safeCount);
    this.dirty = true;
    this.refreshShape();
    return { type: "delete-columns", index: at, columns: removed, columnWidths: removedWidths };
  }

  restoreRows(index, rows, rowHeights = []) {
    this.rows.splice(index, 0, ...rows.map((row) => [...row]));
    this.rowHeights.splice(index, 0, ...rows.map((_, i) => rowHeights[i] ?? this.defaultRowHeight));
    this.hiddenRows = shiftSetForInsert(this.hiddenRows, index, rows.length);
    this.dirty = true;
    this.refreshShape();
  }

  removeRows(index, count) {
    return this.deleteRows(index, count);
  }

  restoreColumns(index, columns, widths = []) {
    for (let row = 0; row < this.rows.length; row++) {
      this.rows[row].splice(index, 0, ...(columns[row] ?? []).map((value) => value ?? ""));
    }
    this.columnWidths.splice(index, 0, ...columns[0].map((_, i) => widths[i] ?? this.defaultColumnWidth));
    this.hiddenColumns = shiftSetForInsert(this.hiddenColumns, index, columns[0]?.length ?? 0);
    this.dirty = true;
    this.refreshShape();
  }

  removeColumns(index, count) {
    return this.deleteColumns(index, count);
  }

  setRowsHidden(rows, hidden) {
    for (const row of rows) {
      if (hidden) this.hiddenRows.add(row);
      else this.hiddenRows.delete(row);
    }
    this.dirty = true;
  }

  setColumnsHidden(columns, hidden) {
    for (const column of columns) {
      if (hidden) this.hiddenColumns.add(column);
      else this.hiddenColumns.delete(column);
    }
    this.dirty = true;
  }

  setColumnWidth(column, width) {
    this.columnWidths[column] = clamp(Math.round(width), 36, 2000);
    this.dirty = true;
  }

  setRowHeight(row, height) {
    this.rowHeights[row] = clamp(Math.round(height), 18, 240);
    this.hasCustomRowHeights = true;
    this.dirty = true;
  }

  resetRowHeights() {
    const changed = this.hasCustomRowHeights || this.rowHeights.some((height) => height !== this.defaultRowHeight);
    this.rowHeights = Array.from({ length: this.rowCount }, () => this.defaultRowHeight);
    this.hasCustomRowHeights = false;
    return changed;
  }

  setFreeze(mode) {
    this.freezeFirstRow = mode === "row" || mode === "both";
    this.freezeFirstColumn = mode === "column" || mode === "both";
  }

  toText() {
    const body = this.rows.map((row) => row.join("\t")).join(this.lineEnding);
    return this.finalNewline ? body + this.lineEnding : body;
  }

  autoFitColumn(column, sampleLimit = 300) {
    let width = 72;
    const last = Math.min(this.rows.length, sampleLimit);
    for (let row = 0; row < last; row++) {
      width = Math.max(width, 28 + this.getCell(row, column).length * 8);
    }
    this.columnWidths[column] = Math.min(420, width);
  }

  autoFitRow(row) {
    this.rowHeights[row] = this.defaultRowHeight;
    this.hasCustomRowHeights = true;
  }

  autoFitInitialColumns(sampleLimit = 300) {
    for (let column = 0; column < this.columnCount; column++) {
      this.columnWidths[column] = initialHeaderColumnWidth(this.getCell(0, column));
    }
  }
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shiftSetForInsert(set, index, count) {
  const shifted = new Set();
  for (const value of set) shifted.add(value >= index ? value + count : value);
  return shifted;
}

function shiftSetForDelete(set, index, count) {
  const shifted = new Set();
  for (const value of set) {
    if (value < index) shifted.add(value);
    else if (value >= index + count) shifted.add(value - count);
  }
  return shifted;
}

function initialHeaderColumnWidth(header) {
  return clamp(Math.ceil(estimateTextWidth(header) + 24), 56, 420);
}

function estimateTextWidth(value) {
  let width = 0;
  for (const char of String(value)) {
    if (char === "\t") width += 16;
    else if (char === " " || char === "." || char === "," || char === "'" || char === "`") width += 4;
    else if (/[A-Z0-9_@#%&]/.test(char)) width += 8;
    else if (char.charCodeAt(0) > 0x7f) width += 12;
    else width += 7;
  }
  return width;
}
