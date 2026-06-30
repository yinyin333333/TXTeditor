import { clamp } from "../core/table-model.js";
import { arrowNavigationDelta, editorBoxStyle, editorCellState, editorKeyAction, keyboardEditStartAction } from "./edit-policy.js";
import { boundedTableExtent, classifyGridHit, classifyPanePoint, classifyResizeHandle } from "./grid-geometry.js";
import { GridMetrics } from "./grid-metrics.js";
import { cellBackground, cellTextColor, createGridRenderStats, initialColumnFitWidth, syncGridThemeFromStyle } from "./grid-render-policy.js";
import { applyColumnSelection, applyRowSelection, applySelectionForHit, hasFullColumnRange, hasFullRowRange, keyboardSelectionTarget } from "./grid-selection-policy.js";
import { applyGridScrollBounds, applyResizeDragState, centeredCellScrollState, centeredScrollOffset as centeredScrollOffsetPolicy, edgeCellScrollState } from "./grid-viewport-policy.js";
import { drawGrid, drawGridActiveRowHeaderChrome, drawGridCell, drawGridDiagnosticMarker, drawGridRowHeader, fillGridText } from "./grid/grid-renderer.js";
import {
  isGridHoverAllowed,
  shouldClearHoverForInteraction,
} from "./hover-policy.js";
import {
  bindHoverExitEvents, clearGridHoverState, clearGridLspHovers, createFirstColumnHoverPreview,
  hideFirstColumnHoverPreview as hideGridFirstColumnHoverPreview, hideGridVectorTooltip,
  normalizeVectorLspTooltip as normalizeVectorLspTooltipPolicy, renderGridTooltip,
  scheduleGridHoverRequest, setGridLspHover, shouldShowFirstColumnHover,
  showLegacyHoverPreview as showGridLegacyHoverPreview,
  updateFirstColumnHoverPreview as updateGridFirstColumnHoverPreview, updateGridTooltip
} from "./grid/grid-hover.js";

const BASE_ROW_HEIGHT = 26;
const BASE_ROW_HEADER_MIN = 38;
const OVERSCAN_ROWS = 12;
const OVERSCAN_COLUMNS_PX = 900;
const FIT_PADDING = 16;
export const VECTOR_LSP_HOVER_DELAY_MS = 0;
export { gridColor } from "./grid-render-policy.js";

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
    this.metrics = new GridMetrics();
    this.raf = 0;
    this.renderStats = createGridRenderStats();
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
    return Math.round(24 * this.zoom);
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
    const scrollLeft = Math.max(0, doc.scrollLeft ?? 0);
    const scrollTop = Math.max(0, doc.scrollTop ?? 0);
    if (this._tooltip && shouldClearHoverForInteraction({ documentChanged: true })) this.clearHoverState();
    else this.hideFirstColumnHoverPreview();
    this.doc = doc;
    this._lspHoverByCell.clear();
    this._hoveredCell = null;
    typeof this.selection.restore === "function" ? this.selection.restore(doc.selectionState, doc.rowCount, doc.columnCount) : this.selection.set(0, 0);
    this.layout();
    this.host.scrollLeft = scrollLeft;
    this.host.scrollTop = scrollTop;
    doc.scrollLeft = this.scrollLeft;
    doc.scrollTop = this.scrollTop;
    this.draw();
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
    return isGridHoverAllowed({
      hoverSuspended: this.hoverSuspended,
      resizing: this.resizing,
      dragging: this.dragging
    });
  }

  clearHoverState() { return clearGridHoverState(this); }
  clearLspHovers() { return clearGridLspHovers(this); }
  hideVectorTooltip() { return hideGridVectorTooltip(this); }

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
      applyGridScrollState({
        doc: this.doc,
        scrollLeft: this.scrollLeft,
        scrollTop: this.scrollTop,
        clearHoverState: () => this.clearHoverState(),
        requestRender: (reason) => this.requestRender(reason),
        onViewportChanged: this.onViewportChanged
      });
    });
    this._tooltip = document.createElement("div");
    this._tooltip.className = "cell-tooltip";
    document.body.appendChild(this._tooltip);
    this.host.addEventListener("mousedown", (event) => this.onMouseDown(event));
    this.host.addEventListener("mousemove", (event) => this.onMouseMove(event));
    bindHoverExitEvents(this.host, (event) => this.onMouseLeave(event));
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
    const [frozenColumnWidth, frozenRowHeight, scrollableColumnWidth, scrollableRowsHeight] = [this.frozenColumnWidth(), this.frozenRowHeight(), this.scrollableColumnWidth(), this.scrollableRowsHeight()];
    this.scrollSurface.style.width = `${this.rowHeaderWidth + frozenColumnWidth + scrollableColumnWidth}px`;
    this.scrollSurface.style.height = `${this.headerHeight + frozenRowHeight + scrollableRowsHeight}px`;
    applyGridScrollBounds({ host: this.host, doc: this.doc, rowHeaderWidth: this.rowHeaderWidth, headerHeight: this.headerHeight, frozenColumnWidth, frozenRowHeight, scrollableColumnWidth, scrollableRowsHeight });
    this.draw();
  }

  syncTheme() {
    const style = getComputedStyle(document.documentElement);
    syncGridThemeFromStyle(style);
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

  gridMetrics() {
    if (!this.metrics) this.metrics = new GridMetrics();
    const scrollStartRow = typeof this.scrollStartRow === "function" ? this.scrollStartRow() : CanvasGrid.prototype.scrollStartRow.call(this);
    const scrollStartColumn = typeof this.scrollStartColumn === "function" ? this.scrollStartColumn() : CanvasGrid.prototype.scrollStartColumn.call(this);
    const zoom = Number.isFinite(Number(this.zoom)) ? Number(this.zoom) : 1;
    this.metrics.updateRows({ doc: this.doc, zoom, scrollStartRow });
    this.metrics.updateColumns({ doc: this.doc, zoom, scrollStartColumn });
    return this.metrics;
  }

  scrollableColumnWidth() {
    return CanvasGrid.prototype.gridMetrics.call(this).scrollableColumnWidth();
  }

  scrollableRowsHeight() {
    return CanvasGrid.prototype.gridMetrics.call(this).scrollableRowsHeight();
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
    return CanvasGrid.prototype.gridMetrics.call(this).columnContentLeft(column);
  }

  rowContentTop(row) {
    return CanvasGrid.prototype.gridMetrics.call(this).rowContentTop(row);
  }

  columnAtContent(x) {
    return CanvasGrid.prototype.gridMetrics.call(this).columnAtContent(x);
  }

  rowAtContent(y) {
    return CanvasGrid.prototype.gridMetrics.call(this).rowAtContent(y);
  }

  visibleColumns() {
    return CanvasGrid.prototype.gridMetrics.call(this).visibleColumns({
      scrollLeft: this.scrollLeft,
      viewportWidth: this.host.clientWidth,
      fixedLeft: this.rowHeaderWidth + this.frozenColumnWidth(),
      overscanPx: OVERSCAN_COLUMNS_PX
    });
  }

  visibleRows() {
    return CanvasGrid.prototype.gridMetrics.call(this).visibleRows({
      scrollTop: this.scrollTop,
      viewportHeight: this.host.clientHeight,
      fixedTop: this.headerHeight + this.frozenRowHeight(),
      overscanPx: this.rowHeight * OVERSCAN_ROWS
    });
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
    drawGrid(this, reason);
  }

  drawRowHeader(row, y, height, options = {}) {
    return drawGridRowHeader(this, row, y, height, options);
  }

  drawActiveRowHeaderChrome(y, height) {
    return drawGridActiveRowHeaderChrome(this, y, height);
  }

  drawCell(row, column, x, y, width, height, options = {}) {
    return drawGridCell(this, row, column, x, y, width, height, options);
  }

  drawDiagnosticMarker(row, column, x, y, width, height) {
    return drawGridDiagnosticMarker(this, row, column, x, y, width, height);
  }

  fillText(text, x, y, maxWidth) {
    return fillGridText(this, text, x, y, maxWidth);
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
    if (!hit || hit.kind === "empty") return null;
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
    if (shouldClearHoverForInteraction({ pointerLeave: true })) this.clearHoverState();
  }

  onMouseDown(event) {
    if (event.button !== 0) return;
    if (this.isScrollbarEvent(event)) return;
    this.hideFirstColumnHoverPreview();
    this.host.focus();
    const hit = this.hitTest(event);
    const resize = this.resizeHit(hit);
    if (resize) {
      if (shouldClearHoverForInteraction({ resizeHandle: true })) this.clearHoverState();
      const before = resize.kind === "column" ? this.doc.columnWidths[resize.index] : this.doc.rowHeights[resize.index];
      this.resizing = { ...resize, startX: hit.x, startY: hit.y, before, current: before, zoom: this.zoom };
      this.resizeGuide = resize.kind === "column" ? { kind: "column", x: hit.x } : { kind: "row", y: hit.y };
      return;
    }
    const toggle = event.ctrlKey || event.metaKey;
    this.applyHitSelection(hit, event.shiftKey, toggle);
    this.dragging = !toggle && (hit.kind === "cell" || hit.kind === "column-header") ? hit.kind : false;
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
      if (shouldClearHoverForInteraction({ resizing: true })) this.clearHoverState();
      const next = applyResizeDragState({ doc: this.doc, resizing: this.resizing, hit });
      this.resizeGuide = next.guide;
      this.resizing.current = next.value;
      this.layout();
      return;
    }
    const resize = this.resizeHit(hit);
    this.host.style.cursor = resize?.kind === "column" ? "col-resize" : resize?.kind === "row" ? "row-resize" : "default";
    if (resize) {
      this.clearHoverState();
      return;
    }
    if (this.dragging === "cell" && hit.kind === "cell") {
      this.clearHoverState();
      this.selection.extend(hit.row, hit.column);
      this.draw();
      this.notifySelectionChanged("drag-selection");
      return;
    }
    if (this.dragging === "column-header" && hit.kind === "column-header") {
      this.clearHoverState();
      this.selection.extendColumns(hit.column, this.doc.rowCount);
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
    if (hit.kind !== "cell") return;
    this.startEdit(null, false, "explicit");
  }

  _updateTooltip(event, hit) { return updateGridTooltip(this, event, hit); }

  _scheduleHoverRequest(row, col) { return scheduleGridHoverRequest(this, row, col); }

  _renderTooltip(row, col, clientX, clientY) { return renderGridTooltip(this, row, col, clientX, clientY); }

  setLspHover(row, col, text) { return setGridLspHover(this, row, col, text); }

  onContext(event) {
    event.preventDefault();
    if (shouldClearHoverForInteraction({ contextMenu: true })) this.clearHoverState();
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

  updateFirstColumnHoverPreview(hit, event) { return updateGridFirstColumnHoverPreview(this, hit, event); }

  showLegacyHoverPreview(hit, event, value) { return showGridLegacyHoverPreview(this, hit, event, value); }

  hideFirstColumnHoverPreview() { return hideGridFirstColumnHoverPreview(this); }

  applyHitSelection(hit, extend, toggle = false) {
    return applySelectionForHit(this.selection, hit, {
      rowCount: this.doc.rowCount,
      columnCount: this.doc.columnCount,
      extend,
      toggle
    });
  }

  selectRow(row, extend = false, toggle = false) {
    return applyRowSelection(this.selection, row, this.doc.columnCount, { extend, toggle });
  }

  selectColumn(column, extend = false, toggle = false) {
    return applyColumnSelection(this.selection, column, this.doc.rowCount, { extend, toggle });
  }

  isFullRowSelection() {
    return hasFullRowRange(this.selection.ranges, this.doc.columnCount);
  }

  isFullColumnSelection() {
    return hasFullColumnRange(this.selection.ranges, this.doc.rowCount);
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
    const editStart = keyboardEditStartAction(event);
    if (editStart.action === "start-edit") {
      event.preventDefault();
      this.startEdit(editStart.initialText, editStart.replace, editStart.mode);
      return;
    }
    const target = keyboardSelectionTarget({
      key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      focus: this.selection.focus,
      rowCount: this.doc.rowCount,
      columnCount: this.doc.columnCount,
      jumpRow: (row, direction) => this.jumpRow(row, direction),
      jumpColumn: (column, direction) => this.jumpColumn(column, direction)
    });
    if (!target) return;
    if (target.extend) this.selection.extend(target.row, target.column);
    else this.selection.set(target.row, target.column);
    this.scrollCellIntoView(target.row, target.column);
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
    const keyAction = editorKeyAction({ key: event.key, shiftKey: event.shiftKey, editMode: this.editMode });
    if (keyAction.action === "commit-move") {
      event.preventDefault();
      this.commitEdit();
      this.moveSelectionBy(keyAction.rowDelta, keyAction.columnDelta);
      this.host.focus();
    } else if (keyAction.action === "cancel") {
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
    const boxStyle = editorBoxStyle({ hostBox, cellBox: box, zoom: this.zoom });
    this.editor.value = replace ? initialText : this.doc.getCell(row, column);
    Object.assign(this.editor.style, boxStyle);
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
    const cellState = editorCellState({
      row,
      column,
      freezeFirstRow: this.doc.freezeFirstRow,
      freezeFirstColumn: this.doc.freezeFirstColumn
    });
    const { frozen, firstColumnLabel } = cellState;
    const unselectedBackground = cellBackground(row, false, frozen, firstColumnLabel);
    this.editor.style.backgroundColor = unselectedBackground;
    this.editor.style.color = cellTextColor(row, column, this.doc.getCell(row, column), false, this.colorizeColumns, firstColumnLabel);
    this.editor.style.fontFamily = this.gridFontFamily;
    this.editor.style.fontWeight = cellState.fontWeight;
  }

  async measureColumnFitWidth(column, { yieldEvery = 10000 } = {}) {
    let width = 72 * this.zoom;
    for (let row = 0; row < this.doc.rowCount; row++) {
      this.ctx.font = this.font(row === 0 || (column === 0 && row > 0) ? 600 : 400);
      width = Math.max(width, this.ctx.measureText(this.doc.getCell(row, column)).width + FIT_PADDING * this.zoom);
      if (yieldEvery > 0 && row > 0 && row % yieldEvery === 0) await yieldToBrowser();
    }
    return clamp(Math.ceil(width / this.zoom), 36, 2000);
  }

  autoFitInitialColumns({ min = 56, max = 420, padding = 24 } = {}) {
    if (!this.doc?.columnCount) return;
    for (let column = 0; column < this.doc.columnCount; column++) {
      this.ctx.font = this.font(600);
      this.doc.columnWidths[column] = initialColumnFitWidth({
        measuredHeaderWidth: this.ctx.measureText(this.doc.getCell(0, column)).width,
        zoom: this.zoom,
        min,
        max,
        padding
      });
    }
    this.doc.markViewChanged?.();
  }

  cellBox(row, column) {
    return {
      left: this.screenXForColumn(column),
      top: this.screenYForRow(row),
      width: this.scaledColumnWidth(column),
      height: this.scaledRowHeight(row)
    };
  }

  scrollCellIntoView(row, column, options = {}) {
    const scrollState = edgeCellScrollState({
      row,
      column,
      freezeFirstRow: this.doc.freezeFirstRow,
      freezeFirstColumn: this.doc.freezeFirstColumn,
      columnContentLeft: this.columnContentLeft(column),
      rowContentTop: this.rowContentTop(row),
      columnWidth: this.scaledColumnWidth(column),
      rowHeight: this.scaledRowHeight(row),
      viewportLeft: this.host.scrollLeft,
      viewportTop: this.host.scrollTop,
      viewportWidth: this.host.clientWidth - this.rowHeaderWidth - this.frozenColumnWidth(),
      viewportHeight: this.host.clientHeight - this.headerHeight - this.frozenRowHeight()
    });
    if ("scrollLeft" in scrollState && !options.preserveScrollLeft) this.host.scrollLeft = scrollState.scrollLeft;
    if ("scrollTop" in scrollState && !options.preserveScrollTop) this.host.scrollTop = scrollState.scrollTop;
  }

  scrollCellToCenter(row, column) {
    const scrollState = centeredCellScrollState({
      row,
      column,
      freezeFirstRow: this.doc.freezeFirstRow,
      freezeFirstColumn: this.doc.freezeFirstColumn,
      columnContentLeft: this.columnContentLeft(column),
      rowContentTop: this.rowContentTop(row),
      columnWidth: this.scaledColumnWidth(column),
      rowHeight: this.scaledRowHeight(row),
      viewportWidth: this.host.clientWidth - this.rowHeaderWidth - this.frozenColumnWidth(),
      viewportHeight: this.host.clientHeight - this.headerHeight - this.frozenRowHeight(),
      scrollableWidth: this.scrollableColumnWidth(),
      scrollableHeight: this.scrollableRowsHeight()
    });
    if ("scrollLeft" in scrollState) this.host.scrollLeft = scrollState.scrollLeft;
    if ("scrollTop" in scrollState) this.host.scrollTop = scrollState.scrollTop;
  }

  statusText() {
    const r = this.selection.rect;
    return `${this.doc.name} | ${this.doc.rowCount.toLocaleString()} rows x ${this.doc.columnCount.toLocaleString()} columns | R${this.selection.focus.row + 1}:C${this.selection.focus.column + 1} | Selection ${r.bottom - r.top + 1}x${r.right - r.left + 1} | ${this.doc.dirty ? "Modified" : "Saved"} | ${this.doc.encoding} | ${Math.round(this.doc.zoom * 100)}%`;
  }
}

export function shouldDrawCellText(row, column, editingCell) {
  return !editingCell || editingCell.row !== row || editingCell.column !== column;
}

export function normalizeVectorLspTooltip(value, hoverText) {
  return normalizeVectorLspTooltipPolicy(value, hoverText);
}

export function movedCell(focus, rowDelta, columnDelta, rowCount, columnCount) {
  return {
    row: clamp(focus.row + rowDelta, 0, Math.max(0, rowCount - 1)),
    column: clamp(focus.column + columnDelta, 0, Math.max(0, columnCount - 1))
  };
}

export function centeredScrollOffset({ itemStart, itemSize, viewportSize, maxScroll }) {
  return centeredScrollOffsetPolicy({ itemStart, itemSize, viewportSize, maxScroll });
}

export function applyGridScrollState({ doc, scrollLeft, scrollTop, clearHoverState, requestRender, onViewportChanged }) {
  if (doc) {
    doc.scrollLeft = scrollLeft;
    doc.scrollTop = scrollTop;
  }
  if (shouldClearHoverForInteraction({ scroll: true })) clearHoverState?.();
  requestRender?.("scroll");
  onViewportChanged?.("scroll");
}

export { bindHoverExitEvents, createFirstColumnHoverPreview, shouldShowFirstColumnHover };
function yieldToBrowser() { return new Promise((resolve) => setTimeout(resolve, 0)); }
