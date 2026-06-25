import { clamp } from "../core/table-model.js";
import { boundedTableExtent, classifyGridHit, classifyPanePoint, classifyResizeHandle, columnColorIndex } from "./grid-geometry.js";

const BASE_ROW_HEIGHT = 26;
const BASE_ROW_HEADER_MIN = 38;
const OVERSCAN_ROWS = 12;
const OVERSCAN_COLUMNS_PX = 900;
const FIT_PADDING = 24;
export const VECTOR_LSP_HOVER_DELAY_MS = 0;
const GRID_COLORS = {
  background: "#1e1e1e",
  rowOdd: "#1f1f1f",
  rowEven: "#222426",
  header: "#2a2d2e",
  firstColumn: "#252b33",
  firstColumnFrozen: "#303d4b",
  firstColumnText: "#e0e6ed",
  firstColumnBorder: "#4f5c6a",
  activeHeader: "#315f8f",
  activeHeaderText: "#ffffff",
  activeRowHeaderHighlight: "rgba(255, 255, 255, .28)",
  activeRowHeaderShadow: "rgba(4, 16, 28, .42)",
  activeRowHeaderSheen: "rgba(255, 255, 255, .08)",
  frozen: "#252a31",
  frozenHeader: "#30343b",
  grid: "#3a3d41",
  gridFrozen: "#505863",
  rowHeader: "#252526",
  rowHeaderFrozen: "#30343b",
  selection: "#264f78",
  selectionFrozen: "#2d5d86",
  active: "#3794ff",
  columnTextA: "#9cdcfe",
  columnTextB: "#b5cea8",
  columnTextC: "#d7ba7d",
  columnTextD: "#c586c0",
  columnTextE: "#4ec9b0",
  rowText: "#aeb4bb",
  text: "#d4d4d4",
  textSelected: "#ffffff",
  textEmpty: "#6f747b",
  textHeader: "#d8d8d8",
  frozenDivider: "#6a7b90",
  frozenEdgeHighlight: "rgba(255, 255, 255, .22)",
  frozenEdgeShadow: "rgba(18, 31, 45, .24)",
  frozenEdgeAmbient: "rgba(18, 31, 45, .10)"
};
const GRID_CSS_VARS = {
  background: "--grid-bg",
  rowOdd: "--grid-row-odd",
  rowEven: "--grid-row-even",
  header: "--grid-header-bg",
  firstColumn: "--grid-first-column-bg",
  firstColumnFrozen: "--grid-first-column-frozen-bg",
  firstColumnText: "--grid-first-column-text",
  firstColumnBorder: "--grid-first-column-border",
  activeHeader: "--grid-active-header-bg",
  activeHeaderText: "--grid-active-header-text",
  activeRowHeaderHighlight: "--grid-active-row-header-highlight",
  activeRowHeaderShadow: "--grid-active-row-header-shadow",
  activeRowHeaderSheen: "--grid-active-row-header-sheen",
  frozen: "--grid-frozen-bg",
  frozenHeader: "--grid-frozen-header-bg",
  grid: "--grid-line",
  gridFrozen: "--grid-line-frozen",
  rowHeader: "--grid-row-header-bg",
  rowHeaderFrozen: "--grid-row-header-frozen-bg",
  selection: "--grid-selection",
  selectionFrozen: "--grid-selection-frozen",
  active: "--grid-active",
  columnTextA: "--columnTextA",
  columnTextB: "--columnTextB",
  columnTextC: "--columnTextC",
  columnTextD: "--columnTextD",
  columnTextE: "--columnTextE",
  rowText: "--grid-row-text",
  text: "--grid-text",
  textSelected: "--grid-text-selected",
  textEmpty: "--grid-text-empty",
  textHeader: "--grid-header-text",
  frozenDivider: "--grid-frozen-divider",
  frozenEdgeHighlight: "--grid-frozen-edge-highlight",
  frozenEdgeShadow: "--grid-frozen-edge-shadow",
  frozenEdgeAmbient: "--grid-frozen-edge-ambient"
};

export class CanvasGrid {
  constructor({ host, canvas, frozenCanvas, scrollSurface, editor, doc, selection, onEdit, onStatus, onContextMenu, onResizeCommand, onAutoFitColumn, onHoverRequest, onHoverInvalidated, onViewportChanged, onSelectionChanged }) {
    this.host = host;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.frozenCanvas = frozenCanvas;
    this.frozenCtx = frozenCanvas.getContext("2d");
    this.scrollSurface = scrollSurface;
    this.editor = editor;
    this.doc = doc;
    this.selection = selection;
    this.onEdit = onEdit;
    this.onStatus = onStatus;
    this.onContextMenu = onContextMenu;
    this.onResizeCommand = onResizeCommand;
    this.onAutoFitColumn = onAutoFitColumn;
    this.onHoverRequest = onHoverRequest;
    this.onHoverInvalidated = onHoverInvalidated;
    this.onViewportChanged = onViewportChanged;
    this.onSelectionChanged = onSelectionChanged;
    this._lspHoverByCell = new Map();
    this._hoveredCell = null;
    this._lastTooltipX = 0;
    this._lastTooltipY = 0;
    this._hoverDebounceTimer = null;
    this._pendingHoverRow = -1;
    this._pendingHoverCol = -1;
    this._pendingHoverPointerAt = 0;
    this._pendingHoverDelayAt = 0;
    this._lastHoverRequestRow = -1;
    this._lastHoverRequestCol = -1;
    this.gridFontFamily = "Consolas, 'Cascadia Mono', monospace";
    this.deviceScale = window.devicePixelRatio || 1;
    this.dragging = false;
    this.resizing = null;
    this.resizeGuide = null;
    this.hoverPreview = createFirstColumnHoverPreview();
    this.hoverCell = null;
    this.editing = false;
    this.editMode = null;
    this.colorizeColumns = false;
    this.vectorLspHoverEnabled = true;
    this.hoverSuspended = false;
    this.diagnosticsByCell = new Map();
    this.raf = 0;
    this.renderStats = {
      frames: 0,
      totalMs: 0,
      lastMs: 0,
      droppedFrames: 0,
      visibleRows: [0, 0],
      visibleColumns: [0, 0],
      reason: "init"
    };
    window.__txteditorGridDiagnostics = this.renderStats;
    this.bind();
    this.layout();
  }

  get zoom() {
    return this.doc.zoom ?? 1;
  }

  get rowHeight() {
    return Math.round(BASE_ROW_HEIGHT * this.zoom);
  }

  get headerHeight() {
    return 0;
  }

  get rowHeaderWidth() {
    const digits = Math.max(2, String(Math.max(1, this.doc.rowCount)).length);
    return Math.round(Math.max(BASE_ROW_HEADER_MIN, 16 + digits * 7) * this.zoom);
  }

  get scrollLeft() {
    return Math.round(this.host.scrollLeft);
  }

  get scrollTop() {
    return Math.round(this.host.scrollTop);
  }

  font(weight = 400) {
    return `${weight} ${Math.max(10, Math.round(12 * this.zoom))}px ${this.gridFontFamily}`;
  }

  setDocument(doc) {
    if (this._tooltip) this.clearHoverState();
    else this.hideFirstColumnHoverPreview();
    this.doc = doc;
    this._lspHoverByCell.clear();
    this._hoveredCell = null;
    this.selection.set(0, 0);
    this.host.scrollLeft = Math.max(0, doc.scrollLeft ?? 0);
    this.host.scrollTop = Math.max(0, doc.scrollTop ?? 0);
    this.layout();
  }

  setFontFamily(fontFamily) {
    this.gridFontFamily = fontFamily || "Consolas, 'Cascadia Mono', monospace";
    document.documentElement.style.setProperty("--grid-font", this.gridFontFamily);
    this.layout();
  }

  setColorizeColumns(enabled) {
    this.colorizeColumns = Boolean(enabled);
    this.draw();
  }

  setVectorLspHoverEnabled(enabled) {
    this.vectorLspHoverEnabled = Boolean(enabled);
    if (!this.vectorLspHoverEnabled) this.clearLspHovers();
    this.requestRender("vector-lsp-hover");
  }

  setHoverSuspended(suspended) {
    this.hoverSuspended = Boolean(suspended);
    if (this.hoverSuspended) this.clearHoverState();
  }

  isHoverAllowed() {
    return !this.hoverSuspended && !this.resizing && !this.dragging;
  }

  clearHoverState() {
    const hadHover = this._hoveredCell
      || this._pendingHoverRow !== -1
      || this._pendingHoverCol !== -1
      || this._hoverDebounceTimer !== null
      || !this.hoverPreview.classList.contains("hidden")
      || this._tooltip.style.display !== "none";
    this.hideFirstColumnHoverPreview();
    this.clearLspHovers();
    this._hoveredCell = null;
    this._pendingHoverRow = -1;
    this._pendingHoverCol = -1;
    this._pendingHoverPointerAt = 0;
    this._pendingHoverDelayAt = 0;
    this._lastHoverRequestRow = -1;
    this._lastHoverRequestCol = -1;
    if (this._hoverDebounceTimer !== null) {
      clearTimeout(this._hoverDebounceTimer);
      this._hoverDebounceTimer = null;
    }
    if (hadHover) this.onHoverInvalidated?.();
  }

  clearLspHovers() {
    this._lspHoverByCell.clear();
    this.hideVectorTooltip();
  }

  hideVectorTooltip() {
    this._tooltip.style.display = "none";
    this._tooltip.textContent = "";
  }

  setDiagnostics(diagnosticsByCell) {
    this.diagnosticsByCell = diagnosticsByCell instanceof Map ? diagnosticsByCell : new Map();
    this.draw();
  }

  notifySelectionChanged(reason = "selection") {
    this.onSelectionChanged?.({
      reason,
      focus: { ...this.selection.focus },
      editingCell: this.editingCell()
    });
  }

  bind() {
    new ResizeObserver(() => this.layout()).observe(this.host);
    this.host.addEventListener("scroll", () => {
      if (this.doc) {
        this.doc.scrollLeft = this.scrollLeft;
        this.doc.scrollTop = this.scrollTop;
      }
      this.clearHoverState();
      this.requestRender("scroll");
      this.onViewportChanged?.("scroll");
    });
    this._tooltip = document.createElement("div");
    this._tooltip.className = "cell-tooltip";
    document.body.appendChild(this._tooltip);
    this.host.addEventListener("mousedown", (event) => this.onMouseDown(event));
    this.host.addEventListener("mousemove", (event) => this.onMouseMove(event));
    this.host.addEventListener("mouseleave", (event) => this.onMouseLeave(event));
    this.host.addEventListener("pointerleave", (event) => this.onMouseLeave(event));
    this.host.addEventListener("contextmenu", (event) => this.onContext(event));
    this.host.addEventListener("dblclick", (event) => this.onDblClick(event));
    this.host.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.host.addEventListener("wheel", (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      this.setZoom(this.doc.zoom + (event.deltaY < 0 ? 0.1 : -0.1));
    }, { passive: false });
    window.addEventListener("mouseup", () => this.onMouseUp());
    this.editor.addEventListener("keydown", (event) => this.onEditorKeyDown(event));
    this.editor.addEventListener("blur", () => this.commitEdit());
    for (const eventName of ["pointerdown", "mousedown", "mousemove", "mouseup", "click", "dblclick", "selectstart"]) {
      this.editor.addEventListener(eventName, (event) => event.stopPropagation());
    }
  }

  layout() {
    this.hideFirstColumnHoverPreview();
    const rect = this.host.getBoundingClientRect();
    this.syncTheme();
    this.layoutCanvas(this.canvas, this.ctx, rect);
    this.layoutCanvas(this.frozenCanvas, this.frozenCtx, rect);
    this.positionCanvases(rect);
    this.scrollSurface.style.width = `${this.rowHeaderWidth + this.frozenColumnWidth() + this.scrollableColumnWidth()}px`;
    this.scrollSurface.style.height = `${this.headerHeight + this.frozenRowHeight() + this.scrollableRowsHeight()}px`;
    this.draw();
  }

  syncTheme() {
    const style = getComputedStyle(document.documentElement);
    for (const [key, variable] of Object.entries(GRID_CSS_VARS)) {
      const value = style.getPropertyValue(variable).trim();
      if (value) GRID_COLORS[key] = value;
    }
  }

  layoutCanvas(canvas, ctx, rect) {
    canvas.width = Math.max(1, Math.floor(rect.width * this.deviceScale));
    canvas.height = Math.max(1, Math.floor(rect.height * this.deviceScale));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(this.deviceScale, 0, 0, this.deviceScale, 0, 0);
  }

  positionCanvases(rect = this.host.getBoundingClientRect()) {
    this.canvas.style.left = `${rect.left}px`;
    this.canvas.style.top = `${rect.top}px`;
    this.frozenCanvas.style.left = `${rect.left}px`;
    this.frozenCanvas.style.top = `${rect.top}px`;
  }

  scaledColumnWidth(column) {
    return Math.round((this.doc.columnWidths[column] ?? this.doc.defaultColumnWidth) * this.zoom);
  }

  scaledRowHeight(row) {
    return Math.round((this.doc.rowHeights[row] ?? this.doc.defaultRowHeight) * this.zoom);
  }

  frozenColumnWidth() {
    return this.doc.freezeFirstColumn && this.doc.columnCount > 0 && !this.doc.hiddenColumns.has(0) ? this.scaledColumnWidth(0) : 0;
  }

  frozenRowHeight() {
    return this.doc.freezeFirstRow && this.doc.rowCount > 0 && !this.doc.hiddenRows.has(0) ? this.scaledRowHeight(0) : 0;
  }

  scrollStartColumn() {
    return this.doc.freezeFirstColumn ? 1 : 0;
  }

  scrollStartRow() {
    return this.doc.freezeFirstRow ? 1 : 0;
  }

  scrollableColumnWidth() {
    let width = 0;
    for (let col = this.scrollStartColumn(); col < this.doc.columnCount; col++) {
      if (!this.doc.hiddenColumns.has(col)) width += this.scaledColumnWidth(col);
    }
    return width;
  }

  scrollableRowsHeight() {
    if (this.doc.hiddenRows.size === 0 && !this.doc.hasCustomRowHeights) {
      const start = this.scrollStartRow();
      return Math.max(0, this.doc.rowCount - start) * this.rowHeight;
    }
    let height = 0;
    for (let row = this.scrollStartRow(); row < this.doc.rowCount; row++) {
      if (!this.doc.hiddenRows.has(row)) height += this.scaledRowHeight(row);
    }
    return height;
  }

  visibleTableHeight() {
    return boundedTableExtent({
      fixedExtent: this.headerHeight + this.frozenRowHeight(),
      scrollableExtent: this.scrollableRowsHeight(),
      scrollOffset: this.scrollTop,
      viewportExtent: this.host.clientHeight
    });
  }

  visibleTableWidth() {
    return boundedTableExtent({
      fixedExtent: this.rowHeaderWidth + this.frozenColumnWidth(),
      scrollableExtent: this.scrollableColumnWidth(),
      scrollOffset: this.scrollLeft,
      viewportExtent: this.host.clientWidth
    });
  }

  columnContentLeft(column) {
    let x = 0;
    for (let col = this.scrollStartColumn(); col < column; col++) {
      if (!this.doc.hiddenColumns.has(col)) x += this.scaledColumnWidth(col);
    }
    return x;
  }

  rowContentTop(row) {
    if (this.doc.hiddenRows.size === 0 && !this.doc.hasCustomRowHeights) {
      return Math.max(0, row - this.scrollStartRow()) * this.rowHeight;
    }
    let y = 0;
    for (let r = this.scrollStartRow(); r < row; r++) {
      if (!this.doc.hiddenRows.has(r)) y += this.scaledRowHeight(r);
    }
    return y;
  }

  columnAtContent(x) {
    let left = 0;
    for (let col = this.scrollStartColumn(); col < this.doc.columnCount; col++) {
      if (this.doc.hiddenColumns.has(col)) continue;
      const width = this.scaledColumnWidth(col);
      if (x >= left && x < left + width) return col;
      left += width;
    }
    return Math.max(0, this.doc.columnCount - 1);
  }

  rowAtContent(y) {
    if (this.doc.hiddenRows.size === 0 && !this.doc.hasCustomRowHeights) {
      return clamp(this.scrollStartRow() + Math.floor(y / this.rowHeight), 0, this.doc.rowCount - 1);
    }
    let top = 0;
    for (let row = this.scrollStartRow(); row < this.doc.rowCount; row++) {
      if (this.doc.hiddenRows.has(row)) continue;
      const height = this.scaledRowHeight(row);
      if (y >= top && y < top + height) return row;
      top += height;
    }
    return Math.max(0, this.doc.rowCount - 1);
  }

  visibleColumns() {
    const columns = [];
    let left = this.rowHeaderWidth + this.frozenColumnWidth() - this.scrollLeft;
    const rightLimit = this.host.clientWidth + OVERSCAN_COLUMNS_PX;
    for (let col = this.scrollStartColumn(); col < this.doc.columnCount; col++) {
      if (this.doc.hiddenColumns.has(col)) continue;
      const width = this.scaledColumnWidth(col);
      if (left + width >= this.rowHeaderWidth + this.frozenColumnWidth() - OVERSCAN_COLUMNS_PX && left <= rightLimit) {
        columns.push({ column: col, left, width });
      }
      left += width;
      if (left > rightLimit) break;
    }
    return columns;
  }

  visibleRows() {
    const rows = [];
    const topLimit = this.headerHeight + this.frozenRowHeight();
    const bottomLimit = this.host.clientHeight + this.rowHeight * OVERSCAN_ROWS;
    if (this.doc.hiddenRows.size === 0 && !this.doc.hasCustomRowHeights) {
      const start = this.scrollStartRow();
      const first = Math.max(start, start + Math.floor(this.scrollTop / this.rowHeight) - OVERSCAN_ROWS);
      const visibleCount = Math.ceil(this.host.clientHeight / this.rowHeight) + OVERSCAN_ROWS * 2 + 2;
      for (let row = first; row < Math.min(this.doc.rowCount, first + visibleCount); row++) {
        rows.push({
          row,
          top: topLimit + (row - start) * this.rowHeight - this.scrollTop,
          height: this.scaledRowHeight(row)
        });
      }
      return rows;
    }
    let top = topLimit - this.scrollTop;
    for (let row = this.scrollStartRow(); row < this.doc.rowCount; row++) {
      if (this.doc.hiddenRows.has(row)) continue;
      const height = this.scaledRowHeight(row);
      if (top + height >= topLimit - this.rowHeight * OVERSCAN_ROWS && top <= bottomLimit) rows.push({ row, top, height });
      top += height;
      if (top > bottomLimit) break;
    }
    return rows;
  }

  visibleRowIndexes() {
    return this.visibleRows().map(({ row }) => row);
  }

  visibleColumnIndexes() {
    return this.visibleColumns().map(({ column }) => column);
  }

  requestRender(reason = "change") {
    this.renderStats.reason = reason;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw(reason);
    });
  }

  draw(reason = "direct") {
    const started = performance.now();
    const ctx = this.ctx;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    this.positionCanvases();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = GRID_COLORS.background;
    ctx.fillRect(0, 0, width, height);
    const columns = this.visibleColumns();
    const rows = this.visibleRows();
    this.drawRows(rows, columns);
    this.drawFrozenLayer(columns, rows);
    this.drawResizeGuide();
    this.updateRenderStats(started, rows, columns, reason);
    this.onStatus?.(this.statusText());
  }

  updateRenderStats(started, rows, columns, reason) {
    const elapsed = performance.now() - started;
    this.renderStats.frames += 1;
    this.renderStats.totalMs += elapsed;
    this.renderStats.lastMs = Math.round(elapsed * 100) / 100;
    this.renderStats.reason = reason;
    this.renderStats.visibleRows = rows.length ? [rows[0].row, rows[rows.length - 1].row] : [0, 0];
    this.renderStats.visibleColumns = columns.length ? [columns[0].column, columns[columns.length - 1].column] : [0, 0];
    if (elapsed > 16.7) this.renderStats.droppedFrames += 1;
  }

  drawRows(rows, columns) {
    const left = this.rowHeaderWidth + this.frozenColumnWidth();
    const top = this.frozenRowHeight();
    this.withClip(left, top, this.host.clientWidth - left, this.host.clientHeight - top, () => {
      for (const row of rows) {
        for (const col of columns) this.drawCell(row.row, col.column, col.left, row.top, col.width, row.height);
      }
    });
    this.withClip(0, top, this.rowHeaderWidth, this.host.clientHeight - top, () => {
      for (const row of rows) this.drawRowHeader(row.row, row.top, row.height);
    });
  }

  drawFrozenLayer(columns, rows) {
    const previous = this.ctx;
    this.ctx = this.frozenCtx;
    this.frozenCtx.clearRect(0, 0, this.host.clientWidth, this.host.clientHeight);
    this.drawFrozenPanes(columns, rows);
    this.ctx = previous;
  }

  drawFrozenPanes(columns, rows) {
    const frozenColWidth = this.frozenColumnWidth();
    const frozenRowHeight = this.frozenRowHeight();
    if (this.doc.freezeFirstColumn && frozenColWidth) {
      this.withClip(this.rowHeaderWidth, frozenRowHeight, frozenColWidth, this.host.clientHeight - frozenRowHeight, () => {
        for (const row of rows) this.drawCell(row.row, 0, this.rowHeaderWidth, row.top, frozenColWidth, row.height, { frozenColumn: true });
      });
    }
    if (this.doc.freezeFirstRow && frozenRowHeight) {
      const y = this.headerHeight;
      this.withClip(this.rowHeaderWidth + frozenColWidth, 0, this.host.clientWidth - this.rowHeaderWidth - frozenColWidth, frozenRowHeight, () => {
        for (const col of columns) this.drawCell(0, col.column, col.left, y, col.width, frozenRowHeight, { frozenRow: true });
      });
      this.withClip(0, 0, this.rowHeaderWidth, frozenRowHeight, () => {
        this.drawRowHeader(0, y, frozenRowHeight, { frozenRow: true });
      });
      if (this.doc.freezeFirstColumn && frozenColWidth) {
        this.drawCell(0, 0, this.rowHeaderWidth, y, frozenColWidth, frozenRowHeight, { frozenRow: true, frozenColumn: true });
      }
    }
    this.drawFrozenDividers(frozenColWidth, frozenRowHeight);
  }

  drawRowHeader(row, y, height, options = {}) {
    const selected = this.selection.hasFullRow(row, this.doc.columnCount);
    const activeHeader = this.selection.focus.row === row;
    this.ctx.fillStyle = selected ? GRID_COLORS.selection : activeHeader ? GRID_COLORS.activeHeader : options.frozenRow ? GRID_COLORS.rowHeaderFrozen : GRID_COLORS.rowHeader;
    this.ctx.fillRect(0, y, this.rowHeaderWidth, height);
    this.ctx.strokeStyle = GRID_COLORS.grid;
    this.ctx.strokeRect(0, y, this.rowHeaderWidth, height);
    if (activeHeader) this.drawActiveRowHeaderChrome(y, height);
    this.ctx.fillStyle = selected ? GRID_COLORS.textSelected : activeHeader ? GRID_COLORS.activeHeaderText : GRID_COLORS.rowText;
    this.ctx.font = this.font(400);
    const label = String(row + 1);
    const x = Math.max(6, this.rowHeaderWidth - this.ctx.measureText(label).width - 8);
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(label, x, y + height / 2);
  }

  drawActiveRowHeaderChrome(y, height) {
    if (height <= 2 || this.rowHeaderWidth <= 2) return;
    const ctx = this.ctx;
    const right = this.rowHeaderWidth - 1.5;
    const bottom = y + height - 1.5;
    ctx.save();
    ctx.fillStyle = GRID_COLORS.activeRowHeaderSheen;
    ctx.fillRect(2, y + 2, Math.max(0, this.rowHeaderWidth - 4), Math.max(1, Math.floor(height * .35)));
    ctx.strokeStyle = GRID_COLORS.activeRowHeaderHighlight;
    ctx.beginPath();
    ctx.moveTo(1.5, bottom - 1);
    ctx.lineTo(1.5, y + 1.5);
    ctx.lineTo(right - 1, y + 1.5);
    ctx.stroke();
    ctx.strokeStyle = GRID_COLORS.activeRowHeaderShadow;
    ctx.beginPath();
    ctx.moveTo(1.5, bottom);
    ctx.lineTo(right, bottom);
    ctx.lineTo(right, y + 1.5);
    ctx.stroke();
    ctx.restore();
  }

  drawCell(row, column, x, y, width, height, options = {}) {
    const editing = this.editingCell();
    const editingThisCell = editing?.row === row && editing?.column === column;
    const selected = !editingThisCell && this.selection.contains(row, column);
    const active = !editingThisCell && this.selection.focus.row === row && this.selection.focus.column === column;
    const ctx = this.ctx;
    const firstColumnLabel = column === 0 && row > 0;
    ctx.font = this.font(row === 0 || firstColumnLabel ? 600 : 400);
    const frozen = options.frozenRow || options.frozenColumn;
    const activeColumnHeader = !editingThisCell && row === 0 && this.selection.focus.column === column;
    const baseBackground = activeColumnHeader && !selected ? GRID_COLORS.activeHeader : cellBackground(row, selected, frozen, firstColumnLabel);
    ctx.fillStyle = baseBackground;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = frozen ? GRID_COLORS.gridFrozen : GRID_COLORS.grid;
    ctx.strokeRect(x, y, width, height);
    if (firstColumnLabel && !selected) {
      ctx.strokeStyle = GRID_COLORS.firstColumnBorder;
      ctx.beginPath();
      ctx.moveTo(x + width - .5, y);
      ctx.lineTo(x + width - .5, y + height);
      ctx.stroke();
    }
    const value = this.doc.getCell(row, column);
    if (shouldDrawCellText(row, column, editing)) {
      ctx.fillStyle = activeColumnHeader && !selected ? GRID_COLORS.activeHeaderText : cellTextColor(row, column, value, selected, this.colorizeColumns, firstColumnLabel);
      ctx.textBaseline = "middle";
      this.fillText(value, x + 8, y + height / 2, width - 12);
    }
    this.drawDiagnosticMarker(row, column, x, y, width, height);
    if (active) {
      ctx.strokeStyle = GRID_COLORS.active;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
      ctx.lineWidth = 1;
    }
  }

  drawDiagnosticMarker(row, column, x, y, width, height) {
    const diagnostics = this.diagnosticsByCell.get(`${row}:${column}`);
    if (!diagnostics?.length) return;
    const severity = diagnostics.some((item) => item.severity === "error") ? "error"
      : diagnostics.some((item) => item.severity === "warning") ? "warning"
        : "info";
    const colors = { error: "#f14c4c", warning: "#cca700", info: "#3794ff" };
    const ctx = this.ctx;
    const size = Math.min(10, Math.max(6, Math.round(Math.min(width, height) * 0.34)));
    ctx.fillStyle = colors[severity] ?? colors.warning;
    ctx.beginPath();
    ctx.moveTo(x + width - size - 1, y + height - 1);
    ctx.lineTo(x + width - 1, y + height - 1);
    ctx.lineTo(x + width - 1, y + height - size - 1);
    ctx.closePath();
    ctx.fill();
  }

  drawFrozenDividers(frozenColWidth, frozenRowHeight) {
    const ctx = this.ctx;
    const tableHeight = this.visibleTableHeight();
    const tableWidth = this.visibleTableWidth();
    ctx.save();
    if (frozenRowHeight) {
      this.drawFrozenBorderRect(0, 0, tableWidth, Math.min(frozenRowHeight, tableHeight));
    }
    if (frozenColWidth) {
      this.drawFrozenBorderRect(this.rowHeaderWidth, 0, frozenColWidth, tableHeight);
    }
    if (frozenColWidth && frozenRowHeight) {
      this.drawFrozenBorderRect(this.rowHeaderWidth, 0, frozenColWidth, frozenRowHeight);
    }
    if (frozenColWidth) {
      const x = this.rowHeaderWidth + frozenColWidth;
      this.drawFrozenVerticalEdge(x, tableHeight);
    }
    if (frozenRowHeight) {
      const y = frozenRowHeight;
      this.drawFrozenHorizontalEdge(y, tableWidth);
    }
    ctx.restore();
  }

  drawFrozenVerticalEdge(x, height) {
    if (height <= 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = GRID_COLORS.frozenEdgeHighlight;
    ctx.fillRect(x - 2, 0, 1, height);
    ctx.fillStyle = GRID_COLORS.frozenEdgeShadow;
    ctx.fillRect(x - 1, 0, 1, height);
    ctx.fillStyle = GRID_COLORS.frozenEdgeAmbient;
    ctx.fillRect(x, 0, 3, height);
  }

  drawFrozenHorizontalEdge(y, width) {
    if (width <= 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = GRID_COLORS.frozenEdgeHighlight;
    ctx.fillRect(0, y - 2, width, 1);
    ctx.fillStyle = GRID_COLORS.frozenEdgeShadow;
    ctx.fillRect(0, y - 1, width, 1);
    ctx.fillStyle = GRID_COLORS.frozenEdgeAmbient;
    ctx.fillRect(0, y, width, 3);
  }

  drawFrozenBorderRect(x, y, width, height) {
    if (width <= 0 || height <= 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = GRID_COLORS.frozenEdgeAmbient;
    ctx.strokeRect(x + .5, y + .5, width - 1, height - 1);
    ctx.restore();
  }

  withClip(x, y, width, height, draw) {
    if (width <= 0 || height <= 0) return;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x, y, width, height);
    this.ctx.clip();
    draw();
    this.ctx.restore();
  }

  drawResizeGuide() {
    if (!this.resizeGuide) return;
    this.ctx.strokeStyle = GRID_COLORS.active;
    this.ctx.setLineDash([4, 4]);
    this.ctx.beginPath();
    if (this.resizeGuide.kind === "column") {
      this.ctx.moveTo(this.resizeGuide.x, 0);
      this.ctx.lineTo(this.resizeGuide.x, this.host.clientHeight);
    } else {
      this.ctx.moveTo(0, this.resizeGuide.y);
      this.ctx.lineTo(this.host.clientWidth, this.resizeGuide.y);
    }
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  fillText(text, x, y, maxWidth) {
    const value = String(text);
    if (this.ctx.measureText(value).width <= maxWidth) {
      this.ctx.fillText(value, x, y);
      return;
    }
    let clipped = value;
    while (clipped.length > 1 && this.ctx.measureText(`${clipped}...`).width > maxWidth) clipped = clipped.slice(0, -1);
    this.ctx.fillText(`${clipped}...`, x, y);
  }

  hitTest(event) {
    const rect = this.host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return this.hitTestPoint(x, y);
  }

  hitTestPoint(x, y) {
    if (x < 0 || y < 0 || x > this.visibleTableWidth() || y > this.visibleTableHeight()) {
      return { kind: "empty", x, y };
    }
    const frozenColWidth = this.frozenColumnWidth();
    const frozenRowHeight = this.frozenRowHeight();
    const pane = classifyPanePoint({
      x,
      y,
      rowHeaderWidth: this.rowHeaderWidth,
      headerHeight: this.headerHeight,
      frozenColumnWidth: frozenColWidth,
      frozenRowHeight
    });
    const column = this.columnFromScreenX(x);
    const row = this.rowFromScreenY(y);
    return classifyGridHit({ pane, row, column, x, y });
  }

  columnFromScreenX(x) {
    if (this.doc.freezeFirstColumn && x >= this.rowHeaderWidth && x < this.rowHeaderWidth + this.frozenColumnWidth()) return 0;
    const contentX = x - this.rowHeaderWidth - this.frozenColumnWidth() + this.scrollLeft;
    return clamp(this.columnAtContent(contentX), 0, this.doc.columnCount - 1);
  }

  rowFromScreenY(y) {
    if (this.doc.freezeFirstRow && y >= this.headerHeight && y < this.headerHeight + this.frozenRowHeight()) return 0;
    const contentY = y - this.headerHeight - this.frozenRowHeight() + this.scrollTop;
    return clamp(this.rowAtContent(contentY), 0, this.doc.rowCount - 1);
  }

  resizeHit(hit) {
    const columnRight = this.screenXForColumn(hit.column) + this.scaledColumnWidth(hit.column);
    const rowBottom = this.screenYForRow(hit.row) + this.scaledRowHeight(hit.row);
    return classifyResizeHandle({ hit, columnRight, rowBottom, zoom: this.zoom });
  }

  screenXForColumn(column) {
    if (this.doc.freezeFirstColumn && column === 0) return this.rowHeaderWidth;
    return this.rowHeaderWidth + this.frozenColumnWidth() + this.columnContentLeft(column) - this.scrollLeft;
  }

  screenYForRow(row) {
    if (this.doc.freezeFirstRow && row === 0) return this.headerHeight;
    return this.headerHeight + this.frozenRowHeight() + this.rowContentTop(row) - this.scrollTop;
  }
  
  onMouseLeave(event) {
    this.clearHoverState();
  }

  onMouseDown(event) {
    if (event.button !== 0) return;
    if (this.isScrollbarEvent(event)) return;
    this.hideFirstColumnHoverPreview();
    this.host.focus();
    const hit = this.hitTest(event);
    const resize = this.resizeHit(hit);
    if (resize) {
      this.clearHoverState();
      const before = resize.kind === "column" ? this.doc.columnWidths[resize.index] : this.doc.rowHeights[resize.index];
      this.resizing = { ...resize, startX: hit.x, startY: hit.y, before, current: before };
      this.resizeGuide = resize.kind === "column" ? { kind: "column", x: hit.x } : { kind: "row", y: hit.y };
      return;
    }
    const toggle = event.ctrlKey || event.metaKey;
    this.applyHitSelection(hit, event.shiftKey, toggle);
    this.dragging = hit.kind === "cell" && !toggle;
    if (this.dragging) this.clearHoverState();
    this.draw();
    this.notifySelectionChanged("pointer-selection");
  }

  isScrollbarEvent(event) {
    const rect = this.host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const onVertical = this.host.scrollHeight > this.host.clientHeight && x >= this.host.clientWidth;
    const onHorizontal = this.host.scrollWidth > this.host.clientWidth && y >= this.host.clientHeight;
    return onVertical || onHorizontal || x < 0 || y < 0;
  }

  onMouseMove(event) {
    const hit = this.hitTest(event);
    if (this.resizing) {
      this.clearHoverState();
      if (this.resizing.kind === "column") {
        const next = Math.max(36, this.resizing.before + (hit.x - this.resizing.startX) / this.zoom);
        this.doc.columnWidths[this.resizing.index] = next;
        this.resizeGuide = { kind: "column", x: hit.x };
      } else {
        const next = Math.max(18, this.resizing.before + (hit.y - this.resizing.startY) / this.zoom);
        this.doc.rowHeights[this.resizing.index] = next;
        this.doc.hasCustomRowHeights = true;
        this.resizeGuide = { kind: "row", y: hit.y };
      }
      this.resizing.current = this.resizing.kind === "column" ? this.doc.columnWidths[this.resizing.index] : this.doc.rowHeights[this.resizing.index];
      this.layout();
      return;
    }
    const resize = this.resizeHit(hit);
    this.host.style.cursor = resize?.kind === "column" ? "col-resize" : resize?.kind === "row" ? "row-resize" : "default";
    if (resize) {
      this.clearHoverState();
      return;
    }
    if (this.dragging && hit.kind === "cell") {
      this.clearHoverState();
      this.selection.extend(hit.row, hit.column);
      this.draw();
      this.notifySelectionChanged("drag-selection");
      return;
    }
    if (!this.resizing) this._updateTooltip(event, hit);
  }

  onMouseUp() {
    if (this.resizing) {
      this.onResizeCommand?.(this.resizing);
    }
    this.dragging = false;
    this.resizing = null;
    this.resizeGuide = null;
    this.draw();
  }

  onDblClick(event) {
    const hit = this.hitTest(event);
    const resize = this.resizeHit(hit);
    if (resize?.kind === "column") {
      this.onAutoFitColumn?.(resize.index);
      return;
    }
    this.startEdit(null, false, "explicit");
  }

  _updateTooltip(event, hit) {
    if (!this.isHoverAllowed() || hit.kind !== "cell" || this.dragging) {
      this._hoveredCell = null;
      this.clearHoverState();
      return;
    }
    const value = this.doc.getCell(hit.row, hit.column);
    if (!this.vectorLspHoverEnabled) {
      this._hoveredCell = null;
      this.clearLspHovers();
      this.showLegacyHoverPreview(hit, event, value);
      return;
    }
    this._hoveredCell = { row: hit.row, col: hit.column };
    this._lastTooltipX = event.clientX;
    this._lastTooltipY = event.clientY;
    const key = `${hit.row}:${hit.column}`;
    const diags = this.diagnosticsByCell.get(key) ?? [];
    const hoverText = this._lspHoverByCell.get(key) ?? null;
    const hasLocalValue = String(value ?? "").trim().length > 0;
    if (hoverText || diags.length || hasLocalValue) {
      this.hideFirstColumnHoverPreview();
      this._renderTooltip(hit.row, hit.column, event.clientX, event.clientY);
    } else {
      this.hideVectorTooltip();
      this.showLegacyHoverPreview(hit, event, value);
    }
    this._scheduleHoverRequest(hit.row, hit.column);
  }

  _scheduleHoverRequest(row, col) {
    if (!this.isHoverAllowed()) return;
    if (!this.vectorLspHoverEnabled) return;
    const samePendingTarget = this._pendingHoverRow === row && this._pendingHoverCol === col;
    const sameRequestedTarget = this._lastHoverRequestRow === row && this._lastHoverRequestCol === col;
    if (sameRequestedTarget) return;
    const now = performance.now();
    if (this._hoverDebounceTimer !== null) clearTimeout(this._hoverDebounceTimer);
    if (!samePendingTarget) {
      this._pendingHoverPointerAt = now;
      this._lastHoverRequestRow = -1;
      this._lastHoverRequestCol = -1;
    }
    this._pendingHoverRow = row;
    this._pendingHoverCol = col;
    this._pendingHoverDelayAt = now;
    if (!this.isHoverAllowed()) return;
    if (this._hoveredCell?.row !== this._pendingHoverRow || this._hoveredCell?.col !== this._pendingHoverCol) return;
    this._lastHoverRequestRow = this._pendingHoverRow;
    this._lastHoverRequestCol = this._pendingHoverCol;
    this.onHoverRequest?.(this._pendingHoverRow, this._pendingHoverCol, {
      pointerEnterAt: this._pendingHoverPointerAt,
      delayScheduledAt: this._pendingHoverDelayAt,
      requestQueuedAt: performance.now()
    });
  }

  _renderTooltip(row, col, clientX, clientY) {
    const value = this.doc.getCell(row, col);
    const diags = this.diagnosticsByCell.get(`${row}:${col}`) ?? [];
    const hoverText = this._lspHoverByCell.get(`${row}:${col}`) ?? null;
    const tooltip = normalizeVectorLspTooltip(value, hoverText);
    if (!tooltip.title && !tooltip.detail && !diags.length) {
      this._tooltip.style.display = "none";
      return;
    }
    this._tooltip.textContent = "";
    if (tooltip.title) {
      const div = document.createElement("div");
      div.className = "cell-tooltip-value";
      div.textContent = tooltip.title;
      this._tooltip.appendChild(div);
    }
    if (tooltip.detail) {
      const div = document.createElement("div");
      div.className = "cell-tooltip-hover";
      div.textContent = tooltip.detail;
      this._tooltip.appendChild(div);
    }
    for (const d of diags) {
      const div = document.createElement("div");
      div.className = `cell-tooltip-diag cell-tooltip-diag-${d.severity}`;
      div.textContent = d.message;
      this._tooltip.appendChild(div);
    }
    this._tooltip.style.display = "block";
    const pad = 8;
    this._tooltip.style.left = `${clientX + 14}px`;
    this._tooltip.style.top = `${clientY + 14}px`;
    const rect = this._tooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth - pad) this._tooltip.style.left = `${clientX - rect.width - 6}px`;
    if (rect.bottom > window.innerHeight - pad) this._tooltip.style.top = `${clientY - rect.height - 6}px`;
  }

  setLspHover(row, col, text) {
    if (!this.isHoverAllowed()) return;
    if (this._hoveredCell?.row !== row || this._hoveredCell?.col !== col) return;
    const key = `${row}:${col}`;
    if (text) this._lspHoverByCell.set(key, text);
    else this._lspHoverByCell.delete(key);
    const diags = this.diagnosticsByCell.get(key) ?? [];
    const hasLocalValue = String(this.doc.getCell(row, col) ?? "").trim().length > 0;
    if (text || diags.length || hasLocalValue) {
      this.hideFirstColumnHoverPreview();
      this._renderTooltip(row, col, this._lastTooltipX, this._lastTooltipY);
    } else {
      this.hideVectorTooltip();
      this.showLegacyHoverPreview({ kind: "cell", row, column: col }, { clientX: this._lastTooltipX, clientY: this._lastTooltipY }, this.doc.getCell(row, col));
    }
  }

  onContext(event) {
    event.preventDefault();
    this.clearHoverState();
    this.host.focus();
    const hit = this.hitTest(event);
    if (hit.kind === "empty") {
      this.draw();
      this.onContextMenu?.({ x: event.clientX, y: event.clientY, hit });
      return;
    }
    if (hit.kind === "cell" && !this.selection.contains(hit.row, hit.column)) this.selection.set(hit.row, hit.column);
    if (hit.kind === "row-header" && !this.selection.hasFullRow(hit.row, this.doc.columnCount)) this.selectRow(hit.row);
    if (hit.kind === "column-header" && !this.selection.hasFullColumn(hit.column, this.doc.rowCount)) this.selectColumn(hit.column);
    if (hit.kind === "corner") this.selection.selectAll(this.doc.rowCount, this.doc.columnCount);
    this.draw();
    this.notifySelectionChanged("context-selection");
    this.onContextMenu?.({ x: event.clientX, y: event.clientY, hit });
  }

  updateFirstColumnHoverPreview(hit, event) {
    if (!this.isHoverAllowed()) {
      this.hideFirstColumnHoverPreview();
      return;
    }
    const value = hit.kind === "cell" ? this.doc.getCell(hit.row, hit.column) : "";
    if (!shouldShowFirstColumnHover(hit, value)) {
      this.hideFirstColumnHoverPreview();
      return;
    }
    this.hoverCell = { row: hit.row, column: hit.column };
    this.hoverPreview.textContent = String(value);
    this.hoverPreview.dataset.row = String(hit.row);
    this.hoverPreview.dataset.column = String(hit.column);
    this.hoverPreview.classList.remove("hidden");

    const gap = 12;
    let left = event.clientX + gap;
    let top = event.clientY + gap;
    const box = this.hoverPreview.getBoundingClientRect();
    if (left + box.width > window.innerWidth - 8) left = Math.max(8, event.clientX - box.width - gap);
    if (top + box.height > window.innerHeight - 8) top = Math.max(8, event.clientY - box.height - gap);
    this.hoverPreview.style.left = `${left}px`;
    this.hoverPreview.style.top = `${top}px`;
  }

  showLegacyHoverPreview(hit, event, value) {
    this.hideVectorTooltip();
    if (shouldShowFirstColumnHover(hit, value)) {
      this.updateFirstColumnHoverPreview(hit, event);
    } else {
      this.hideFirstColumnHoverPreview();
    }
  }

  hideFirstColumnHoverPreview() {
    if (!this.hoverPreview) return;
    this.hoverPreview.classList.add("hidden");
    this.hoverPreview.textContent = "";
    delete this.hoverPreview.dataset.row;
    delete this.hoverPreview.dataset.column;
    this.hoverCell = null;
  }

  applyHitSelection(hit, extend, toggle = false) {
    if (hit.kind === "empty") return;
    if (hit.kind === "row-header") return this.selectRow(hit.row, extend, toggle);
    if (hit.kind === "column-header") return this.selectColumn(hit.column, extend, toggle);
    if (hit.kind === "corner") return this.selection.selectAll(this.doc.rowCount, this.doc.columnCount);
    if (toggle) return this.selection.toggleCell(hit.row, hit.column);
    if (extend) this.selection.extend(hit.row, hit.column);
    else this.selection.set(hit.row, hit.column);
  }

  selectRow(row, extend = false, toggle = false) {
    if (toggle) return this.selection.toggleRow(row, this.doc.columnCount);
    if (extend) return this.selection.extendRows(row, this.doc.columnCount);
    this.selection.setRow(row, this.doc.columnCount);
  }

  selectColumn(column, extend = false, toggle = false) {
    if (toggle) return this.selection.toggleColumn(column, this.doc.rowCount);
    if (extend) return this.selection.extendColumns(column, this.doc.rowCount);
    this.selection.setColumn(column, this.doc.rowCount);
  }

  isFullRowSelection() {
    return this.selection.ranges.some((rect) => rect.left === 0 && rect.right >= this.doc.columnCount - 1);
  }

  isFullColumnSelection() {
    return this.selection.ranges.some((rect) => rect.top === 0 && rect.bottom >= this.doc.rowCount - 1);
  }

  onKeyDown(event) {
    if (event.target === this.editor || this.editing) return;
    const key = event.key;
    if (event.ctrlKey && key === "=") return this.zoomByKey(event, 0.1);
    if (event.ctrlKey && (key === "+" || key === "Add")) return this.zoomByKey(event, 0.1);
    if (event.ctrlKey && (key === "-" || key === "Subtract")) return this.zoomByKey(event, -0.1);
    if (event.ctrlKey && key === "0") return this.zoomReset(event);
    if (event.ctrlKey && key.toLowerCase() === "a") {
      this.selection.selectAll(this.doc.rowCount, this.doc.columnCount);
      event.preventDefault();
      this.draw();
      return;
    }
    if (key === "Enter" || key === "F2") {
      event.preventDefault();
      this.startEdit(null, false, "explicit");
      return;
    }
    if (isPrintableEditKey(event)) {
      event.preventDefault();
      this.startEdit(event.key, true, "quick");
      return;
    }
    let { row, column } = this.selection.focus;
    if (key === "Tab") column += event.shiftKey ? -1 : 1;
    else if (key === "ArrowDown") row = event.ctrlKey ? this.jumpRow(row, 1) : row + 1;
    else if (key === "ArrowUp") row = event.ctrlKey ? this.jumpRow(row, -1) : row - 1;
    else if (key === "ArrowRight") column = event.ctrlKey ? this.jumpColumn(column, 1) : column + 1;
    else if (key === "ArrowLeft") column = event.ctrlKey ? this.jumpColumn(column, -1) : column - 1;
    else return;
    row = clamp(row, 0, this.doc.rowCount - 1);
    column = clamp(column, 0, this.doc.columnCount - 1);
    if (event.shiftKey && key !== "Tab") this.selection.extend(row, column);
    else this.selection.set(row, column);
    this.scrollCellIntoView(row, column);
    event.preventDefault();
    this.draw();
    this.notifySelectionChanged("keyboard-selection");
  }

  jumpRow(row, direction) {
    const column = this.selection.focus.column;
    const startFilled = this.doc.getCell(row, column) !== "";
    let next = row;
    while (next + direction >= 0 && next + direction < this.doc.rowCount) {
      next += direction;
      const filled = this.doc.getCell(next, column) !== "";
      if (filled !== startFilled) return next;
    }
    return next;
  }

  jumpColumn(column, direction) {
    const row = this.selection.focus.row;
    const startFilled = this.doc.getCell(row, column) !== "";
    let next = column;
    while (next + direction >= 0 && next + direction < this.doc.columnCount) {
      next += direction;
      const filled = this.doc.getCell(row, next) !== "";
      if (filled !== startFilled) return next;
    }
    return next;
  }

  zoomByKey(event, delta) {
    event.preventDefault();
    this.setZoom(this.doc.zoom + delta);
  }

  zoomReset(event) {
    event.preventDefault();
    this.setZoom(1);
  }

  setZoom(value) {
    this.doc.zoom = clamp(Math.round(value * 10) / 10, 0.1, 8);
    this.layout();
  }

  onEditorKeyDown(event) {
    if (this.editMode === "quick" && isArrowNavigationKey(event.key)) {
      event.preventDefault();
      const { rowDelta, columnDelta } = arrowNavigationDelta(event.key);
      this.commitEdit();
      this.moveSelectionBy(rowDelta, columnDelta);
      this.host.focus();
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const rowDelta = event.key === "Enter" ? (event.shiftKey ? -1 : 1) : 0;
      const columnDelta = event.key === "Tab" ? (event.shiftKey ? -1 : 1) : 0;
      this.commitEdit();
      this.moveSelectionBy(rowDelta, columnDelta);
      this.host.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.cancelEdit();
      this.host.focus();
    }
  }

  startEdit(initialText = null, replace = false, mode = replace ? "quick" : "explicit") {
    if (this.editing && replace) return;
    const { row, column } = this.selection.focus;
    const box = this.cellBox(row, column);
    const hostBox = this.host.getBoundingClientRect();
    this.editor.value = replace ? initialText : this.doc.getCell(row, column);
    this.editor.style.left = `${hostBox.left + box.left + 1}px`;
    this.editor.style.top = `${hostBox.top + box.top + 1}px`;
    this.editor.style.width = `${box.width - 2}px`;
    this.editor.style.height = `${box.height - 2}px`;
    this.editor.style.fontSize = `${Math.max(10, Math.round(12 * this.zoom))}px`;
    this.editor.dataset.row = String(row);
    this.editor.dataset.column = String(column);
    this.styleEditorForCell(row, column);
    this.editor.classList.add("active");
    this.editing = true;
    this.editMode = mode;
    this.draw();
    this.notifySelectionChanged("edit-start");
    this.editor.focus();
    this.editor.selectionStart = this.editor.value.length;
    this.editor.selectionEnd = this.editor.value.length;
  }

  commitEdit() {
    if (!this.editing || !this.editor.classList.contains("active")) return;
    const row = Number(this.editor.dataset.row);
    const column = Number(this.editor.dataset.column);
    this.editing = false;
    this.editMode = null;
    this.editor.classList.remove("active");
    this.onEdit?.([{ row, column, value: this.editor.value }], "Edit Cell");
    this.draw();
    this.notifySelectionChanged("edit-commit");
  }

  cancelEdit() {
    this.editing = false;
    this.editMode = null;
    this.editor.classList.remove("active");
    this.draw();
    this.notifySelectionChanged("edit-cancel");
  }

  moveSelectionBy(rowDelta, columnDelta) {
    const { row, column } = movedCell(this.selection.focus, rowDelta, columnDelta, this.doc.rowCount, this.doc.columnCount);
    this.selection.set(row, column);
    this.scrollCellIntoView(row, column);
    this.draw();
    this.notifySelectionChanged("keyboard-selection");
  }

  editingCell() {
    if (!this.editing) return null;
    const row = Number(this.editor.dataset.row);
    const column = Number(this.editor.dataset.column);
    if (!Number.isFinite(row) || !Number.isFinite(column)) return null;
    return { row, column };
  }

  styleEditorForCell(row, column) {
    const frozen = (this.doc.freezeFirstRow && row === 0) || (this.doc.freezeFirstColumn && column === 0);
    const firstColumnLabel = column === 0 && row > 0;
    const unselectedBackground = cellBackground(row, false, frozen, firstColumnLabel);
    this.editor.style.backgroundColor = unselectedBackground;
    this.editor.style.color = cellTextColor(row, column, this.doc.getCell(row, column), false, this.colorizeColumns, firstColumnLabel);
    this.editor.style.fontFamily = this.gridFontFamily;
    this.editor.style.fontWeight = row === 0 || firstColumnLabel ? "600" : "400";
  }

  async measureColumnFitWidth(column, { yieldEvery = 10000 } = {}) {
    let width = 72 * this.zoom;
    for (let row = 0; row < this.doc.rowCount; row++) {
      this.ctx.font = this.font(row === 0 ? 600 : 400);
      width = Math.max(width, this.ctx.measureText(this.doc.getCell(row, column)).width + FIT_PADDING * this.zoom);
      if (yieldEvery > 0 && row > 0 && row % yieldEvery === 0) await yieldToBrowser();
    }
    return clamp(Math.ceil(width / this.zoom), 36, 2000);
  }

  autoFitInitialColumns({ min = 56, max = 420, padding = 24 } = {}) {
    if (!this.doc?.columnCount) return;
    for (let column = 0; column < this.doc.columnCount; column++) {
      this.ctx.font = this.font(600);
      const width = this.ctx.measureText(this.doc.getCell(0, column)).width + padding * this.zoom;
      this.doc.columnWidths[column] = clamp(Math.ceil(width / this.zoom), min, max);
    }
  }

  cellBox(row, column) {
    return {
      left: this.screenXForColumn(column),
      top: this.screenYForRow(row),
      width: this.scaledColumnWidth(column),
      height: this.scaledRowHeight(row)
    };
  }

  scrollCellIntoView(row, column) {
    if (!(this.doc.freezeFirstColumn && column === 0)) {
      const left = this.columnContentLeft(column);
      const width = this.scaledColumnWidth(column);
      const visibleLeft = this.host.scrollLeft;
      const visibleRight = this.host.scrollLeft + this.host.clientWidth - this.rowHeaderWidth - this.frozenColumnWidth();
      if (left < visibleLeft) this.host.scrollLeft = left;
      else if (left + width > visibleRight) this.host.scrollLeft = left + width - (this.host.clientWidth - this.rowHeaderWidth - this.frozenColumnWidth()) + 16;
    }
    if (!(this.doc.freezeFirstRow && row === 0)) {
      const top = this.rowContentTop(row);
      const height = this.scaledRowHeight(row);
      const viewport = this.host.clientHeight - this.headerHeight - this.frozenRowHeight();
      if (top < this.host.scrollTop) this.host.scrollTop = top;
      else if (top + height > this.host.scrollTop + viewport) this.host.scrollTop = top + height - viewport + 16;
    }
  }

  scrollCellToCenter(row, column) {
    if (!(this.doc.freezeFirstColumn && column === 0)) {
      const viewport = Math.max(0, this.host.clientWidth - this.rowHeaderWidth - this.frozenColumnWidth());
      this.host.scrollLeft = centeredScrollOffset({
        itemStart: this.columnContentLeft(column),
        itemSize: this.scaledColumnWidth(column),
        viewportSize: viewport,
        maxScroll: this.scrollableColumnWidth() - viewport
      });
    }
    if (!(this.doc.freezeFirstRow && row === 0)) {
      const viewport = Math.max(0, this.host.clientHeight - this.headerHeight - this.frozenRowHeight());
      this.host.scrollTop = centeredScrollOffset({
        itemStart: this.rowContentTop(row),
        itemSize: this.scaledRowHeight(row),
        viewportSize: viewport,
        maxScroll: this.scrollableRowsHeight() - viewport
      });
    }
  }

  statusText() {
    const r = this.selection.rect;
    return `${this.doc.name} | ${this.doc.rowCount.toLocaleString()} rows x ${this.doc.columnCount.toLocaleString()} columns | R${this.selection.focus.row + 1}:C${this.selection.focus.column + 1} | Selection ${r.bottom - r.top + 1}x${r.right - r.left + 1} | ${this.doc.dirty ? "Modified" : "Saved"} | ${this.doc.encoding} | ${Math.round(this.doc.zoom * 100)}%`;
  }
}

export function shouldDrawCellText(row, column, editingCell) {
  return !editingCell || editingCell.row !== row || editingCell.column !== column;
}

export function shouldShowFirstColumnHover(hit, value) {
  return hit?.kind === "cell" && hit.row > 0 && hit.column === 0 && String(value ?? "") !== "";
}

export function normalizeVectorLspTooltip(value, hoverText) {
  const title = String(value ?? "").trim();
  const rawHover = String(hoverText ?? "").trim();
  if (!rawHover) return { title, detail: "" };
  if (!title) return splitHoverText(rawHover);
  const lines = rawHover.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  if (lines.length && lines[0].trim() === title) {
    lines.shift();
    while (lines.length && lines[0].trim() === "") lines.shift();
  }
  return { title, detail: lines.join("\n").trim() };
}

export function movedCell(focus, rowDelta, columnDelta, rowCount, columnCount) {
  return {
    row: clamp(focus.row + rowDelta, 0, Math.max(0, rowCount - 1)),
    column: clamp(focus.column + columnDelta, 0, Math.max(0, columnCount - 1))
  };
}

export function centeredScrollOffset({ itemStart, itemSize, viewportSize, maxScroll }) {
  const viewport = Math.max(0, Number(viewportSize) || 0);
  const max = Math.max(0, Number(maxScroll) || 0);
  return clamp(Math.round(itemStart + itemSize / 2 - viewport / 2), 0, max);
}

function splitHoverText(hoverText) {
  const lines = hoverText.replace(/\r\n?/g, "\n").split("\n");
  const title = lines.shift()?.trim() ?? "";
  while (lines.length && lines[0].trim() === "") lines.shift();
  return { title, detail: lines.join("\n").trim() };
}

function createFirstColumnHoverPreview() {
  const preview = document.createElement("div");
  preview.className = "first-column-hover-preview hidden";
  preview.setAttribute("role", "tooltip");
  document.body.append(preview);
  return preview;
}

function isArrowNavigationKey(key) {
  return key === "ArrowDown" || key === "ArrowUp" || key === "ArrowRight" || key === "ArrowLeft";
}

function arrowNavigationDelta(key) {
  if (key === "ArrowDown") return { rowDelta: 1, columnDelta: 0 };
  if (key === "ArrowUp") return { rowDelta: -1, columnDelta: 0 };
  if (key === "ArrowRight") return { rowDelta: 0, columnDelta: 1 };
  if (key === "ArrowLeft") return { rowDelta: 0, columnDelta: -1 };
  return { rowDelta: 0, columnDelta: 0 };
}

function cellBackground(row, selected, frozen, firstColumnLabel) {
  if (selected) return frozen ? GRID_COLORS.selectionFrozen : GRID_COLORS.selection;
  if (frozen) return row === 0 ? GRID_COLORS.frozenHeader : firstColumnLabel ? GRID_COLORS.firstColumnFrozen : GRID_COLORS.frozen;
  if (row === 0) return GRID_COLORS.header;
  if (firstColumnLabel) return GRID_COLORS.firstColumn;
  return row % 2 ? GRID_COLORS.rowOdd : GRID_COLORS.rowEven;
}

function cellTextColor(row, column, value, selected, colorizeColumns, firstColumnLabel = false) {
  if (selected) return GRID_COLORS.textSelected;
  if (row === 0) return GRID_COLORS.textHeader;
  const text = String(value).trim();
  if (text === "") return GRID_COLORS.textEmpty;
  if (firstColumnLabel) return GRID_COLORS.firstColumnText;
  if (colorizeColumns) {
    return [
      GRID_COLORS.columnTextA,
      GRID_COLORS.columnTextB,
      GRID_COLORS.columnTextC,
      GRID_COLORS.columnTextD,
      GRID_COLORS.columnTextE
    ][columnColorIndex(column, 5)];
  }
  return GRID_COLORS.text;
}


function isPrintableEditKey(event) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
