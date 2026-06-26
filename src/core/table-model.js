import { markTableContentDirty, resetTableFileState } from "./table-file-state.js";
import { autoFitColumnWidth, initialHeaderColumnWidth } from "./table-sizing.js";
import { resetTableViewState, tableViewState } from "./table-view-state.js";

export class TableDocument {
  constructor(name = "Untitled.txt", rows = [[]], meta = {}) {
    this.rows = rows.length ? rows : [[]];
    resetTableFileState(this, name, meta);
    resetTableViewState(this, meta);
    this.refreshShape();
    if (!meta.columnWidths && meta.autoFitInitialColumns !== false) {
      this.autoFitInitialColumns(meta.initialFitSampleRows ?? 300);
    }
  }

  get hiddenRows() {
    return tableViewState(this).hiddenRows;
  }

  set hiddenRows(value) {
    tableViewState(this).hiddenRows = value instanceof Set ? value : new Set(value ?? []);
  }

  get hiddenColumns() {
    return tableViewState(this).hiddenColumns;
  }

  set hiddenColumns(value) {
    tableViewState(this).hiddenColumns = value instanceof Set ? value : new Set(value ?? []);
  }

  get columnWidths() {
    return tableViewState(this).columnWidths;
  }

  set columnWidths(value) {
    tableViewState(this).columnWidths = Array.isArray(value) ? value : [...(value ?? [])];
  }

  get rowHeights() {
    return tableViewState(this).rowHeights;
  }

  set rowHeights(value) {
    tableViewState(this).rowHeights = Array.isArray(value) ? value : [...(value ?? [])];
  }

  get defaultColumnWidth() {
    return tableViewState(this).defaultColumnWidth;
  }

  set defaultColumnWidth(value) {
    tableViewState(this).defaultColumnWidth = value;
  }

  get defaultRowHeight() {
    return tableViewState(this).defaultRowHeight;
  }

  set defaultRowHeight(value) {
    tableViewState(this).defaultRowHeight = value;
  }

  get hasCustomRowHeights() {
    return tableViewState(this).hasCustomRowHeights;
  }

  set hasCustomRowHeights(value) {
    tableViewState(this).hasCustomRowHeights = Boolean(value);
  }

  get zoom() {
    return tableViewState(this).zoom;
  }

  set zoom(value) {
    tableViewState(this).zoom = value;
  }

  get freezeFirstRow() {
    return tableViewState(this).freezeFirstRow;
  }

  set freezeFirstRow(value) {
    tableViewState(this).freezeFirstRow = Boolean(value);
  }

  get freezeFirstColumn() {
    return tableViewState(this).freezeFirstColumn;
  }

  set freezeFirstColumn(value) {
    tableViewState(this).freezeFirstColumn = Boolean(value);
  }

  get scrollLeft() {
    return tableViewState(this).scrollLeft;
  }

  set scrollLeft(value) {
    tableViewState(this).scrollLeft = value;
  }

  get scrollTop() {
    return tableViewState(this).scrollTop;
  }

  set scrollTop(value) {
    tableViewState(this).scrollTop = value;
  }

  get initialColumnFitApplied() {
    return tableViewState(this).initialColumnFitApplied;
  }

  set initialColumnFitApplied(value) {
    tableViewState(this).initialColumnFitApplied = Boolean(value);
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
    markTableContentDirty(this);
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
    markTableContentDirty(this);
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
    markTableContentDirty(this);
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
    markTableContentDirty(this);
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
    markTableContentDirty(this);
    this.refreshShape();
    return { type: "insert-column", index: at, name };
  }

  deleteColumns(start, count = 1) {
    const at = clamp(start, 0, Math.max(0, this.columnCount - 1));
    const safeCount = Math.min(Math.max(1, count), this.columnCount - at);
    const removed = this.rows.map((row) => row.splice(at, safeCount));
    const removedWidths = this.columnWidths.splice(at, safeCount);
    this.hiddenColumns = shiftSetForDelete(this.hiddenColumns, at, safeCount);
    markTableContentDirty(this);
    this.refreshShape();
    return { type: "delete-columns", index: at, columns: removed, columnWidths: removedWidths };
  }

  restoreRows(index, rows, rowHeights = []) {
    this.rows.splice(index, 0, ...rows.map((row) => [...row]));
    this.rowHeights.splice(index, 0, ...rows.map((_, i) => rowHeights[i] ?? this.defaultRowHeight));
    this.hiddenRows = shiftSetForInsert(this.hiddenRows, index, rows.length);
    markTableContentDirty(this);
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
    markTableContentDirty(this);
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
    markTableContentDirty(this);
  }

  setColumnsHidden(columns, hidden) {
    for (const column of columns) {
      if (hidden) this.hiddenColumns.add(column);
      else this.hiddenColumns.delete(column);
    }
    markTableContentDirty(this);
  }

  setColumnWidth(column, width) {
    this.columnWidths[column] = clamp(Math.round(width), 36, 2000);
    markTableContentDirty(this);
  }

  setRowHeight(row, height) {
    this.rowHeights[row] = clamp(Math.round(height), 18, 240);
    this.hasCustomRowHeights = true;
    markTableContentDirty(this);
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
    this.columnWidths[column] = autoFitColumnWidth(this.rows, column, sampleLimit);
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
