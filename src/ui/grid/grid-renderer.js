import {
  GRID_COLORS,
  activeRowHeaderChromeSteps,
  cellBackground,
  cellGridLineColor,
  cellTextRenderPlan,
  cellTextColor,
  centeredTextY,
  columnHeaderRenderState,
  columnIndexLabel,
  columnIndexRenderState,
  diagnosticTextOverlayPlan,
  diagnosticMarkerState,
  frozenHorizontalEdgeRects,
  frozenVerticalEdgeRects,
  indexHandleChromeSteps,
  indexHandleRenderState,
  rowHeaderRenderState,
  updateGridRenderStats
} from "../grid-render-policy.js";

export function drawGrid(grid, reason = "direct") {
  const started = performance.now();
  const ctx = grid.ctx;
  const width = grid.host.clientWidth;
  const height = grid.host.clientHeight;
  grid.positionCanvases();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = GRID_COLORS.background;
  ctx.fillRect(0, 0, width, height);
  const columns = grid.visibleColumns();
  const rows = grid.visibleRows();
  drawColumnHeaders(grid, columns);
  drawRows(grid, rows, columns);
  drawFrozenLayer(grid, columns, rows);
  drawResizeGuide(grid);
  updateRenderStats(grid, started, rows, columns, reason);
  grid.onStatus?.(grid.statusText());
}

function updateRenderStats(grid, started, rows, columns, reason) {
  const elapsed = performance.now() - started;
  updateGridRenderStats(grid.renderStats, { elapsed, rows, columns, reason });
}

function drawRows(grid, rows, columns) {
  const left = grid.rowHeaderWidth + grid.frozenColumnWidth();
  const top = grid.headerHeight + grid.frozenRowHeight();
  withClip(grid, left, top, grid.host.clientWidth - left, grid.host.clientHeight - top, () => {
    drawGridCellLayer(grid, rows, columns);
  });
  withClip(grid, 0, top, grid.rowHeaderWidth, grid.host.clientHeight - top, () => {
    for (const row of rows) drawRowHeader(grid, row.row, row.top, row.height);
  });
}

function drawFrozenLayer(grid, columns, rows) {
  const previous = grid.ctx;
  grid.ctx = grid.frozenCtx;
  grid.frozenCtx.clearRect(0, 0, grid.host.clientWidth, grid.host.clientHeight);
  drawFrozenPanes(grid, columns, rows);
  grid.ctx = previous;
}

function drawFrozenPanes(grid, columns, rows) {
  const frozenColWidth = grid.frozenColumnWidth();
  const frozenRowHeight = grid.frozenRowHeight();
  const headerHeight = grid.headerHeight;
  if (grid.doc.freezeFirstColumn && frozenColWidth && headerHeight) {
    drawColumnHeader(grid, 0, grid.rowHeaderWidth, frozenColWidth, { frozenColumn: true });
  }
  if (grid.doc.freezeFirstColumn && frozenColWidth) {
    const top = headerHeight + frozenRowHeight;
    withClip(grid, grid.rowHeaderWidth, top, frozenColWidth, grid.host.clientHeight - top, () => {
      drawGridCellLayer(grid, rows, [{
        column: 0,
        left: grid.rowHeaderWidth,
        width: frozenColWidth
      }], { frozenColumn: true });
    });
  }
  if (grid.doc.freezeFirstRow && frozenRowHeight) {
    const y = headerHeight;
    withClip(grid, grid.rowHeaderWidth + frozenColWidth, y, grid.host.clientWidth - grid.rowHeaderWidth - frozenColWidth, frozenRowHeight, () => {
      drawGridCellLayer(grid, [{
        row: 0,
        top: y,
        height: frozenRowHeight
      }], columns, { frozenRow: true });
    });
    withClip(grid, 0, y, grid.rowHeaderWidth, frozenRowHeight, () => {
      drawRowHeader(grid, 0, y, frozenRowHeight, { frozenRow: true });
    });
    if (grid.doc.freezeFirstColumn && frozenColWidth) {
      drawCell(grid, 0, 0, grid.rowHeaderWidth, y, frozenColWidth, frozenRowHeight, { frozenRow: true, frozenColumn: true });
    }
  }
  drawFrozenDividers(grid, frozenColWidth, frozenRowHeight);
}

function drawColumnHeaders(grid, columns) {
  const height = grid.headerHeight;
  if (!height) return;
  drawCornerHeader(grid);
  const left = grid.rowHeaderWidth + grid.frozenColumnWidth();
  withClip(grid, left, 0, grid.host.clientWidth - left, height, () => {
    for (const col of columns) drawColumnHeader(grid, col.column, col.left, col.width);
  });
}

function drawCornerHeader(grid) {
  const height = grid.headerHeight;
  if (!height) return;
  const selected = grid.selection.hasFullRow(0, grid.doc.columnCount) && grid.selection.hasFullColumn(0, grid.doc.rowCount);
  const state = indexHandleRenderState({ selected });
  grid.ctx.fillStyle = GRID_COLORS[state.fill];
  grid.ctx.fillRect(0, 0, grid.rowHeaderWidth, height);
  grid.ctx.strokeStyle = GRID_COLORS[state.stroke];
  grid.ctx.strokeRect(0, 0, grid.rowHeaderWidth, height);
  drawChromeSteps(grid, indexHandleChromeSteps({ x: 0, y: 0, width: grid.rowHeaderWidth, height, pressed: state.pressed }));
}

export function drawGridCornerHeader(grid) {
  return drawCornerHeader(grid);
}

function drawColumnHeader(grid, column, x, width, options = {}) {
  const height = grid.headerHeight;
  if (!height) return;
  const frozen = Boolean(options.frozenColumn);
  const { selected, activeHeader } = columnIndexRenderState({
    selection: grid.selection,
    column,
    rowCount: grid.doc.rowCount
  });
  const state = indexHandleRenderState({ selected, active: activeHeader, frozen });
  grid.ctx.fillStyle = GRID_COLORS[state.fill];
  grid.ctx.fillRect(x, 0, width, height);
  grid.ctx.strokeStyle = GRID_COLORS[state.stroke];
  grid.ctx.strokeRect(x, 0, width, height);
  drawChromeSteps(grid, indexHandleChromeSteps({ x, y: 0, width, height, pressed: state.pressed }));
  grid.ctx.fillStyle = GRID_COLORS[state.text];
  grid.ctx.font = grid.font(400);
  grid.ctx.textBaseline = "middle";
  const label = columnIndexLabel(column);
  const labelWidth = grid.ctx.measureText(label).width;
  grid.ctx.fillText(label, Math.max(x + 4, x + (width - labelWidth) / 2), centeredTextY(0, height));
}

export function drawGridColumnHeader(grid, column, x, width, options = {}) {
  return drawColumnHeader(grid, column, x, width, options);
}

function drawRowHeader(grid, row, y, height, options = {}) {
  const selected = grid.selection.hasFullRow(row, grid.doc.columnCount);
  const { activeHeader } = rowHeaderRenderState(grid.selection, row);
  const state = indexHandleRenderState({ selected, active: activeHeader, frozen: options.frozenRow });
  grid.ctx.fillStyle = GRID_COLORS[state.fill];
  grid.ctx.fillRect(0, y, grid.rowHeaderWidth, height);
  grid.ctx.strokeStyle = GRID_COLORS[state.stroke];
  grid.ctx.strokeRect(0, y, grid.rowHeaderWidth, height);
  drawChromeSteps(grid, indexHandleChromeSteps({ x: 0, y, width: grid.rowHeaderWidth, height, pressed: state.pressed }));
  grid.ctx.fillStyle = GRID_COLORS[state.text];
  grid.ctx.font = grid.font(400);
  const label = String(row + 1);
  const x = Math.max(6, grid.rowHeaderWidth - grid.ctx.measureText(label).width - 8);
  grid.ctx.textBaseline = "middle";
  grid.ctx.fillText(label, x, centeredTextY(y, height));
}

export function drawGridRowHeader(grid, row, y, height, options = {}) {
  return drawRowHeader(grid, row, y, height, options);
}

function drawActiveRowHeaderChrome(grid, y, height) {
  const steps = activeRowHeaderChromeSteps({ rowHeaderWidth: grid.rowHeaderWidth, y, height });
  drawChromeSteps(grid, steps);
}

function drawChromeSteps(grid, steps) {
  if (!steps.length) return;
  const ctx = grid.ctx;
  ctx.save();
  for (const step of steps) {
    if (step.kind === "fillRect") {
      ctx.fillStyle = GRID_COLORS[step.color];
      ctx.fillRect(step.x, step.y, step.width, step.height);
    } else if (step.kind === "strokePath") {
      ctx.strokeStyle = GRID_COLORS[step.color];
      ctx.beginPath();
      step.points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawGridActiveRowHeaderChrome(grid, y, height) {
  return drawActiveRowHeaderChrome(grid, y, height);
}

function drawActiveCellBorder(grid, x, y, width, height) {
  const ctx = grid.ctx;
  ctx.strokeStyle = GRID_COLORS.active;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
  ctx.lineWidth = 1;
}

function drawCell(grid, row, column, x, y, width, height, options = {}) {
  const editing = grid.editingCell();
  const editingThisCell = editing?.row === row && editing?.column === column;
  const selected = !editingThisCell && grid.selection.contains(row, column);
  const active = !editingThisCell && grid.selection.focus.row === row && grid.selection.focus.column === column;
  const ctx = grid.ctx;
  const firstColumnLabel = column === 0 && row > 0;
  ctx.font = grid.font(row === 0 || firstColumnLabel ? 600 : 400);
  const frozen = options.frozenRow || options.frozenColumn;
  const { activeColumnHeader } = columnHeaderRenderState({ selection: grid.selection, row, column, editingThisCell });
  const baseBackground = activeColumnHeader && !selected ? GRID_COLORS.activeHeader : cellBackground(row, selected, frozen, firstColumnLabel);
  ctx.fillStyle = baseBackground;
  ctx.fillRect(x, y, width, height);
  const gridLine = cellGridLineColor({ selected, frozen });
  ctx.strokeStyle = gridLine;
  ctx.strokeRect(x, y, width, height);
  if (firstColumnLabel && !selected) {
    ctx.strokeStyle = GRID_COLORS.firstColumnBorder;
    ctx.beginPath();
    ctx.moveTo(x + width - .5, y);
    ctx.lineTo(x + width - .5, y + height);
    ctx.stroke();
  }
  const value = typeof grid.cellDisplayValue === "function"
    ? grid.cellDisplayValue(row, column)
    : grid.doc.getCell(row, column);
  if (shouldDrawCellText(row, column, editing)) {
    ctx.fillStyle = activeColumnHeader && !selected ? GRID_COLORS.activeHeaderText : cellTextColor(row, column, value, selected, grid.colorizeColumns, firstColumnLabel);
    ctx.textBaseline = "middle";
    if (typeof grid.fillText === "function") grid.fillText(value, x + 8, centeredTextY(y, height), width - 12);
    else fillText(grid, value, x + 8, centeredTextY(y, height), width - 12);
  }
  drawDiagnosticTextOverlay(grid, row, column, value, x, y, width, height, { active });
  if (typeof grid.drawDiagnosticMarker === "function") grid.drawDiagnosticMarker(row, column, x, y, width, height);
  else drawDiagnosticMarker(grid, row, column, x, y, width, height);
  if (active) drawActiveCellBorder(grid, x, y, width, height);
}

function redrawSelectedCellSeparator(grid, row, column, x, y, width, height, options = {}) {
  const editing = grid.editingCell();
  if (editing?.row === row && editing?.column === column) return null;
  if (!grid.selection.contains(row, column)) return null;
  const active = grid.selection.focus.row === row && grid.selection.focus.column === column;
  const frozen = options.frozenRow || options.frozenColumn;
  grid.ctx.strokeStyle = cellGridLineColor({ selected: true, frozen });
  grid.ctx.strokeRect(x, y, width, height);
  if (typeof grid.drawDiagnosticMarker === "function") {
    grid.drawDiagnosticMarker(row, column, x, y, width, height);
  } else {
    drawDiagnosticMarker(grid, row, column, x, y, width, height);
  }
  return active ? { x, y, width, height } : null;
}

export function drawGridCellLayer(grid, rows, columns, options = {}) {
  for (const row of rows) {
    for (const column of columns) {
      drawCell(grid, row.row, column.column, column.left, row.top, column.width, row.height, options);
    }
  }
  let activeCell = null;
  for (const row of rows) {
    for (const column of columns) {
      activeCell = redrawSelectedCellSeparator(
        grid,
        row.row,
        column.column,
        column.left,
        row.top,
        column.width,
        row.height,
        options
      ) ?? activeCell;
    }
  }
  if (activeCell) {
    drawActiveCellBorder(grid, activeCell.x, activeCell.y, activeCell.width, activeCell.height);
  }
}

export function drawGridCell(grid, row, column, x, y, width, height, options = {}) {
  return drawCell(grid, row, column, x, y, width, height, options);
}

function drawDiagnosticMarker(grid, row, column, x, y, width, height) {
  const diagnostics = grid.diagnosticsByCell.get(`${row}:${column}`);
  const marker = diagnosticMarkerState(diagnostics, { x, y, width, height });
  if (!marker) return;
  const ctx = grid.ctx;
  ctx.fillStyle = marker.color;
  ctx.beginPath();
  ctx.moveTo(...marker.points[0]);
  ctx.lineTo(...marker.points[1]);
  ctx.lineTo(...marker.points[2]);
  ctx.closePath();
  ctx.fill();
}

export function drawGridDiagnosticMarker(grid, row, column, x, y, width, height) {
  return drawDiagnosticMarker(grid, row, column, x, y, width, height);
}

function drawDiagnosticTextOverlay(grid, row, column, value, x, y, width, height, { active = false } = {}) {
  const diagnostics = grid.diagnosticsByCell?.get(`${row}:${column}`) ?? [];
  const hovered = grid._hoveredCell?.row === row && grid._hoveredCell?.col === column;
  const currentProblem = active;
  const plan = diagnosticTextOverlayPlan({
    diagnostics,
    value,
    active,
    hovered,
    currentProblem,
    textX: x + 8,
    cellY: y,
    cellHeight: height,
    maxWidth: width - 12,
    measureText: (text) => grid.ctx.measureText(String(text ?? "")).width
  });
  if (!plan) return;
  const ctx = grid.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 2, y + 2, Math.max(0, width - 4), Math.max(0, height - 4));
  ctx.clip();
  ctx.strokeStyle = GRID_COLORS[plan.color] ?? GRID_COLORS.diagnosticRangeWarning;
  ctx.lineWidth = plan.lineWidth;
  ctx.beginPath();
  if (plan.kind === "insertion") {
    ctx.moveTo(plan.x, plan.top);
    ctx.lineTo(plan.x, plan.bottom);
  } else {
    ctx.moveTo(plan.x, plan.y);
    ctx.lineTo(plan.x + plan.width, plan.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawFrozenDividers(grid, frozenColWidth, frozenRowHeight) {
  const ctx = grid.ctx;
  const tableHeight = grid.visibleTableHeight();
  const tableWidth = grid.visibleTableWidth();
  const headerHeight = grid.headerHeight;
  ctx.save();
  if (headerHeight) {
    drawFrozenBorderRect(grid, 0, 0, tableWidth, Math.min(headerHeight, tableHeight));
  }
  if (frozenRowHeight) {
    drawFrozenBorderRect(grid, 0, headerHeight, tableWidth, Math.min(frozenRowHeight, Math.max(0, tableHeight - headerHeight)));
  }
  if (frozenColWidth) {
    drawFrozenBorderRect(grid, grid.rowHeaderWidth, 0, frozenColWidth, tableHeight);
  }
  if (frozenColWidth && frozenRowHeight) {
    drawFrozenBorderRect(grid, grid.rowHeaderWidth, headerHeight, frozenColWidth, frozenRowHeight);
  }
  if (frozenColWidth) {
    const x = grid.rowHeaderWidth + frozenColWidth;
    drawFrozenVerticalEdge(grid, x, tableHeight);
  }
  if (frozenRowHeight) {
    const y = headerHeight + frozenRowHeight;
    drawFrozenHorizontalEdge(grid, y, tableWidth);
  }
  ctx.restore();
}

function drawFrozenVerticalEdge(grid, x, height) {
  const ctx = grid.ctx;
  for (const rect of frozenVerticalEdgeRects(x, height)) {
    ctx.fillStyle = GRID_COLORS[rect.color];
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
}

function drawFrozenHorizontalEdge(grid, y, width) {
  const ctx = grid.ctx;
  for (const rect of frozenHorizontalEdgeRects(y, width)) {
    ctx.fillStyle = GRID_COLORS[rect.color];
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
}

function drawFrozenBorderRect(grid, x, y, width, height) {
  if (width <= 0 || height <= 0) return;
  const ctx = grid.ctx;
  ctx.save();
  ctx.strokeStyle = GRID_COLORS.frozenEdgeAmbient;
  ctx.strokeRect(x + .5, y + .5, width - 1, height - 1);
  ctx.restore();
}

function withClip(grid, x, y, width, height, draw) {
  if (width <= 0 || height <= 0) return;
  grid.ctx.save();
  grid.ctx.beginPath();
  grid.ctx.rect(x, y, width, height);
  grid.ctx.clip();
  draw();
  grid.ctx.restore();
}

function drawResizeGuide(grid) {
  if (!grid.resizeGuide) return;
  grid.ctx.strokeStyle = GRID_COLORS.active;
  grid.ctx.setLineDash([4, 4]);
  grid.ctx.beginPath();
  if (grid.resizeGuide.kind === "column") {
    grid.ctx.moveTo(grid.resizeGuide.x, 0);
    grid.ctx.lineTo(grid.resizeGuide.x, grid.host.clientHeight);
  } else {
    grid.ctx.moveTo(0, grid.resizeGuide.y);
    grid.ctx.lineTo(grid.host.clientWidth, grid.resizeGuide.y);
  }
  grid.ctx.stroke();
  grid.ctx.setLineDash([]);
}

function fillText(grid, text, x, y, maxWidth) {
  const plan = cellTextRenderPlan({
    text,
    maxWidth,
    measureText: (value) => grid.ctx.measureText(String(value ?? "")).width
  });
  grid.ctx.fillText(plan.text, x, y);
}

export function fillGridText(grid, text, x, y, maxWidth) {
  return fillText(grid, text, x, y, maxWidth);
}

export function shouldDrawCellText(row, column, editingCell) {
  return !editingCell || editingCell.row !== row || editingCell.column !== column;
}
