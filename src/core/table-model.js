import { largeFileInfo } from "./large-file-policy.js";
import { RangeSet } from "./range-set.js";
import { markTableContentDirty, resetTableFileState, tableFileState } from "./table-file-state.js";
import { parseTableText } from "./table-parser.js";
import { autoFitColumnWidth, initialHeaderColumnWidth } from "./table-sizing.js";
import { markTableViewDirty, resetTableViewState, tableViewState } from "./table-view-state.js";

export class TableDocument {
  constructor(name = "Untitled.txt", rows = [[]], meta = {}) {
    this.rows = rows.length ? rows : [[]];
    Object.defineProperty(this, "serializedColumnCount", {
      configurable: true,
      writable: true,
      value: meta.serializedColumnCount ?? null
    });
    resetTableFileState(this, name, meta);
    resetTableViewState(this, meta);
    this.refreshShape();
    if (!this.largeFileMode && !meta.columnWidths && meta.autoFitInitialColumns !== false) {
      this.autoFitInitialColumns(meta.initialFitSampleRows ?? 300);
    }
  }

  get hiddenRows() {
    return tableViewState(this).hiddenRows;
  }

  set hiddenRows(value) {
    tableViewState(this).hiddenRows = RangeSet.from(value);
    markTableViewDirty(this);
  }

  get hiddenColumns() {
    return tableViewState(this).hiddenColumns;
  }

  set hiddenColumns(value) {
    tableViewState(this).hiddenColumns = RangeSet.from(value);
    markTableViewDirty(this);
  }

  get columnWidths() {
    return tableViewState(this).columnWidths;
  }

  set columnWidths(value) {
    tableViewState(this).columnWidths = Array.isArray(value) ? value : [...(value ?? [])];
    markTableViewDirty(this);
  }

  get rowHeights() {
    return tableViewState(this).rowHeights;
  }

  set rowHeights(value) {
    tableViewState(this).rowHeights = Array.isArray(value) ? value : [...(value ?? [])];
    markTableViewDirty(this);
  }

  get defaultColumnWidth() {
    return tableViewState(this).defaultColumnWidth;
  }

  set defaultColumnWidth(value) {
    tableViewState(this).defaultColumnWidth = value;
    markTableViewDirty(this);
  }

  get defaultRowHeight() {
    return tableViewState(this).defaultRowHeight;
  }

  set defaultRowHeight(value) {
    tableViewState(this).defaultRowHeight = value;
    markTableViewDirty(this);
  }

  get hasCustomRowHeights() {
    return tableViewState(this).hasCustomRowHeights;
  }

  set hasCustomRowHeights(value) {
    tableViewState(this).hasCustomRowHeights = Boolean(value);
    markTableViewDirty(this);
  }

  get zoom() {
    return tableViewState(this).zoom;
  }

  set zoom(value) {
    tableViewState(this).zoom = value;
    markTableViewDirty(this);
  }

  get freezeFirstRow() {
    return tableViewState(this).freezeFirstRow;
  }

  set freezeFirstRow(value) {
    tableViewState(this).freezeFirstRow = Boolean(value);
    markTableViewDirty(this);
  }

  get freezeFirstColumn() {
    return tableViewState(this).freezeFirstColumn;
  }

  set freezeFirstColumn(value) {
    tableViewState(this).freezeFirstColumn = Boolean(value);
    markTableViewDirty(this);
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

  get viewRevision() {
    return tableViewState(this).revision;
  }

  markViewChanged() {
    markTableViewDirty(this);
  }

  get selectionState() {
    return tableViewState(this).selection;
  }

  set selectionState(value) {
    tableViewState(this).selection = value;
  }

  static fromText(name, text, meta = {}) {
    const parsed = parseTableText(text);
    return TableDocument.fromParsed(name, parsed, { ...meta, fileSizeBytes: meta.fileSizeBytes ?? meta.sizeBytes ?? String(text ?? "").length });
  }

  static fromParsed(name, parsed, meta = {}) {
    return new TableDocument(name, parsed.rows, { ...meta, lineEnding: parsed.lineEnding, finalNewline: parsed.finalNewline });
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
    this.refreshLargeFileInfo();
    markTableViewDirty(this);
  }

  refreshLargeFileInfo() {
    const info = largeFileInfo({
      fileSizeBytes: this.fileSizeBytes,
      rowCount: this.rowCount,
      columnCount: this.columnCount
    });
    const state = tableFileState(this);
    state.fileSizeBytes = info.fileSizeBytes;
    state.estimatedCellCount = info.estimatedCellCount;
    state.largeFileMode = info.largeFileMode;
    state.largeFileReasons = info.reasons;
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

  insertRows(index, countOrRows = 1) {
    const at = clamp(index, 0, this.rows.length);
    const rows = normalizeInsertRows(countOrRows, this.columnCount);
    if (!rows.length) return { type: "insert-rows", index: at, rows: [], rowHeights: [] };
    const rowHeights = Array.from({ length: rows.length }, () => this.defaultRowHeight);
    spliceMany(this.rows, at, 0, rows);
    spliceMany(this.rowHeights, at, 0, rowHeights);
    this.hiddenRows = shiftSetForInsert(this.hiddenRows, at, rows.length);
    markTableContentDirty(this);
    this.refreshShape();
    return { type: "insert-rows", index: at, rows, rowHeights };
  }

  insertRow(index, values = []) {
    const inserted = this.insertRows(index, [values]);
    return { type: "insert-row", index: inserted.index, values: inserted.rows[0] ?? [] };
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

  insertColumns(index, namesOrCount = 1, options = {}) {
    const at = clamp(index, 0, this.columnCount);
    const names = normalizeInsertColumnNames(namesOrCount, at);
    const count = names.length;
    if (!count) return { type: "insert-columns", index: at, names: [] };
    const append = at >= this.columnCount;
    const sparseAppend = options.sparseAppend !== false;
    if (append && sparseAppend) {
      const nextColumnCount = this.columnCount + count;
      this.serializedColumnCount = Math.max(this.serializedColumnCount ?? 0, nextColumnCount);
    } else {
      const bodyValues = Array.from({ length: count }, () => "");
      for (let rowIndex = 0; rowIndex < this.rows.length; rowIndex++) {
        spliceMany(this.rows[rowIndex], at, 0, rowIndex === 0 ? names : bodyValues);
      }
    }
    for (let i = 0; i < count; i++) this.rows[0][at + i] = names[i];
    spliceMany(this.columnWidths, at, 0, Array.from({ length: count }, () => 120));
    this.hiddenColumns = shiftSetForInsert(this.hiddenColumns, at, count);
    markTableContentDirty(this);
    this.refreshShape();
    return { type: "insert-columns", index: at, names };
  }

  insertColumn(index, name = "") {
    const inserted = this.insertColumns(index, [name], { sparseAppend: false });
    return { type: "insert-column", index: inserted.index, name: inserted.names[0] ?? name };
  }

  deleteColumns(start, count = 1) {
    const at = clamp(start, 0, Math.max(0, this.columnCount - 1));
    const safeCount = Math.min(Math.max(1, count), this.columnCount - at);
    const removed = this.rows.map((row) => row.splice(at, safeCount));
    const removedWidths = this.columnWidths.splice(at, safeCount);
    this.hiddenColumns = shiftSetForDelete(this.hiddenColumns, at, safeCount);
    markTableContentDirty(this);
    this.refreshShape();
    if (this.serializedColumnCount != null) this.serializedColumnCount = Math.min(this.serializedColumnCount, this.columnCount);
    return { type: "delete-columns", index: at, columns: removed, columnWidths: removedWidths };
  }

  restoreRows(index, rows, rowHeights = []) {
    spliceMany(this.rows, index, 0, rows.map((row) => [...row]));
    spliceMany(this.rowHeights, index, 0, rows.map((_, i) => rowHeights[i] ?? this.defaultRowHeight));
    this.hiddenRows = shiftSetForInsert(this.hiddenRows, index, rows.length);
    markTableContentDirty(this);
    this.refreshShape();
  }

  removeRows(index, count) {
    return this.deleteRows(index, count);
  }

  restoreColumns(index, columns, widths = []) {
    for (let row = 0; row < this.rows.length; row++) {
      spliceMany(this.rows[row], index, 0, (columns[row] ?? []).map((value) => value ?? ""));
    }
    spliceMany(this.columnWidths, index, 0, columns[0].map((_, i) => widths[i] ?? this.defaultColumnWidth));
    this.hiddenColumns = shiftSetForInsert(this.hiddenColumns, index, columns[0]?.length ?? 0);
    markTableContentDirty(this);
    this.refreshShape();
  }

  removeColumns(index, count) {
    return this.deleteColumns(index, count);
  }

  setRowsHidden(rows, hidden) {
    const changed = setHiddenRanges(this.hiddenRows, rows, hidden);
    if (changed) markTableViewDirty(this);
  }

  setColumnsHidden(columns, hidden) {
    const changed = setHiddenRanges(this.hiddenColumns, columns, hidden);
    if (changed) markTableViewDirty(this);
  }

  setColumnWidth(column, width) {
    const next = clamp(Math.round(width), 36, 2000);
    if (this.columnWidths[column] === next) return;
    this.columnWidths[column] = next;
    markTableViewDirty(this);
  }

  setRowHeight(row, height) {
    const next = clamp(Math.round(height), 18, 240);
    const changed = this.rowHeights[row] !== next || !this.hasCustomRowHeights;
    this.rowHeights[row] = next;
    this.hasCustomRowHeights = true;
    if (changed) markTableViewDirty(this);
  }

  resetRowHeights() {
    const changed = this.hasCustomRowHeights || this.rowHeights.some((height) => height !== this.defaultRowHeight);
    this.rowHeights = Array.from({ length: this.rowCount }, () => this.defaultRowHeight);
    this.hasCustomRowHeights = false;
    if (changed) markTableViewDirty(this);
    return changed;
  }

  setFreeze(mode) {
    this.freezeFirstRow = mode === "row" || mode === "both";
    this.freezeFirstColumn = mode === "column" || mode === "both";
  }

  toText() {
    const columnCount = this.serializedColumnCount && this.serializedColumnCount > 0 ? this.serializedColumnCount : null;
    const body = this.rows.map((row) => serializeRow(row, columnCount)).join(this.lineEnding);
    return this.finalNewline ? body + this.lineEnding : body;
  }

  toRowText(rowIndex) {
    const row = this.rows[rowIndex];
    if (!row) return "";
    const columnCount = this.serializedColumnCount && this.serializedColumnCount > 0
      ? this.serializedColumnCount
      : null;
    return serializeRow(row, columnCount);
  }

  *toTextChunks({ chunkRows = 1000 } = {}) {
    yield* serializeTextChunks(this.rows, {
      chunkRows,
      lineEnding: this.lineEnding,
      finalNewline: this.finalNewline,
      serializedColumnCount: this.serializedColumnCount
    });
  }

  snapshotTextChunks({ chunkRows = 1000 } = {}) {
    return serializeTextChunks(this.rows.map((row) => [...row]), {
      chunkRows,
      lineEnding: this.lineEnding,
      finalNewline: this.finalNewline,
      serializedColumnCount: this.serializedColumnCount
    });
  }

  autoFitColumn(column, sampleLimit = 300) {
    this.columnWidths[column] = autoFitColumnWidth(this.rows, column, sampleLimit);
    markTableViewDirty(this);
  }

  autoFitRow(row) {
    this.rowHeights[row] = this.defaultRowHeight;
    this.hasCustomRowHeights = true;
    markTableViewDirty(this);
  }

  autoFitInitialColumns(sampleLimit = 300) {
    for (let column = 0; column < this.columnCount; column++) {
      this.columnWidths[column] = initialHeaderColumnWidth(this.getCell(0, column));
    }
    markTableViewDirty(this);
  }
}

function* serializeTextChunks(rows, {
  chunkRows = 1000,
  lineEnding = "\n",
  finalNewline = false,
  serializedColumnCount = null
} = {}) {
  const safeChunkRows = Math.max(1, Math.floor(Number(chunkRows) || 1000));
  const columnCount = serializedColumnCount && serializedColumnCount > 0
    ? serializedColumnCount
    : null;
  let chunk = "";
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    if (rowIndex > 0) chunk += lineEnding;
    chunk += serializeRow(rows[rowIndex], columnCount);
    if ((rowIndex + 1) % safeChunkRows === 0) {
      yield chunk;
      chunk = "";
    }
  }
  if (finalNewline) chunk += lineEnding;
  if (chunk || !rows.length) yield chunk;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const MAX_SPLICE_ITEMS = 8192;

function spliceMany(array, index, deleteCount, items) {
  const values = Array.from(items);
  if (values.length <= MAX_SPLICE_ITEMS) {
    array.splice(index, deleteCount, ...values);
    return;
  }
  const tail = array.slice(index + deleteCount);
  array.length = index;
  for (let offset = 0; offset < values.length; offset += MAX_SPLICE_ITEMS) {
    array.push(...values.slice(offset, offset + MAX_SPLICE_ITEMS));
  }
  for (let offset = 0; offset < tail.length; offset += MAX_SPLICE_ITEMS) {
    array.push(...tail.slice(offset, offset + MAX_SPLICE_ITEMS));
  }
}

function normalizeInsertRows(countOrRows, columnCount) {
  if (Array.isArray(countOrRows)) {
    return countOrRows.map((row) => normalizeInsertRow(row, columnCount));
  }
  const count = Math.max(0, Math.floor(Number(countOrRows) || 0));
  return Array.from({ length: count }, () => new Array(columnCount));
}

function normalizeInsertRow(row, columnCount) {
  const source = Array.isArray(row) ? row : [];
  return Array.from({ length: Math.max(columnCount, source.length) }, (_, index) => source[index] ?? "");
}

function normalizeInsertColumnNames(namesOrCount, index) {
  if (Array.isArray(namesOrCount)) return namesOrCount.map((name, offset) => name ?? `Column${index + offset + 1}`);
  const count = Math.max(0, Math.floor(Number(namesOrCount) || 0));
  return Array.from({ length: count }, (_, offset) => `Column${index + offset + 1}`);
}

function serializeRow(row, columnCount) {
  if (!columnCount || row.length >= columnCount) return row.join("\t");
  const values = row.slice();
  values.length = columnCount;
  return values.join("\t");
}

function shiftSetForInsert(set, index, count) {
  const source = RangeSet.from(set);
  return source.shiftForInsert(index, count);
}

function shiftSetForDelete(set, index, count) {
  const source = RangeSet.from(set);
  return source.shiftForDelete(index, count);
}

function setHiddenRanges(target, values, hidden) {
  const ranges = RangeSet.from(values).ranges;
  const before = rangeSignature(target);
  for (const [start, end] of ranges) {
    if (hidden) target.addRange(start, end);
    else target.deleteRange(start, end);
  }
  return before !== rangeSignature(target);
}

function rangeSignature(target) {
  return target.ranges?.map(([start, end]) => `${start}:${end}`).join(",") ?? [...target].join(",");
}
