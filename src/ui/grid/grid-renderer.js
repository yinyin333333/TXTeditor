import {
  GRID_COLORS,
  activeRowHeaderChromeSteps,
  cellBackground,
  cellTextColor,
  centeredTextY,
  columnHeaderRenderState,
  diagnosticMarkerState,
  frozenHorizontalEdgeRects,
  frozenVerticalEdgeRects,
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
  const top = grid.frozenRowHeight();
  withClip(grid, left, top, grid.host.clientWidth - left, grid.host.clientHeight - top, () => {
    for (const row of rows) {
      for (const col of columns) drawCell(grid, row.row, col.column, col.left, row.top, col.width, row.height);
    }
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
  if (grid.doc.freezeFirstColumn && frozenColWidth) {
    withClip(grid, grid.rowHeaderWidth, frozenRowHeight, frozenColWidth, grid.host.clientHeight - frozenRowHeight, () => {
      for (const row of rows) drawCell(grid, row.row, 0, grid.rowHeaderWidth, row.top, frozenColWidth, row.height, { frozenColumn: true });
    });
  }
  if (grid.doc.freezeFirstRow && frozenRowHeight) {
    const y = grid.headerHeight;
    withClip(grid, grid.rowHeaderWidth + frozenColWidth, 0, grid.host.clientWidth - grid.rowHeaderWidth - frozenColWidth, frozenRowHeight, () => {
      for (const col of columns) drawCell(grid, 0, col.column, col.left, y, col.width, frozenRowHeight, { frozenRow: true });
    });
    withClip(grid, 0, 0, grid.rowHeaderWidth, frozenRowHeight, () => {
      drawRowHeader(grid, 0, y, frozenRowHeight, { frozenRow: true });
    });
    if (grid.doc.freezeFirstColumn && frozenColWidth) {
      drawCell(grid, 0, 0, grid.rowHeaderWidth, y, frozenColWidth, frozenRowHeight, { frozenRow: true, frozenColumn: true });
    }
  }
  drawFrozenDividers(grid, frozenColWidth, frozenRowHeight);
}

function drawRowHeader(grid, row, y, height, options = {}) {
  const selected = grid.selection.hasFullRow(row, grid.doc.columnCount);
  const { activeHeader } = rowHeaderRenderState(grid.selection, row);
  grid.ctx.fillStyle = selected ? GRID_COLORS.selection : activeHeader ? GRID_COLORS.activeHeader : options.frozenRow ? GRID_COLORS.rowHeaderFrozen : GRID_COLORS.rowHeader;
  grid.ctx.fillRect(0, y, grid.rowHeaderWidth, height);
  grid.ctx.strokeStyle = GRID_COLORS.grid;
  grid.ctx.strokeRect(0, y, grid.rowHeaderWidth, height);
  if (activeHeader) {
    if (typeof grid.drawActiveRowHeaderChrome === "function") grid.drawActiveRowHeaderChrome(y, height);
    else drawActiveRowHeaderChrome(grid, y, height);
  }
  grid.ctx.fillStyle = selected ? GRID_COLORS.textSelected : activeHeader ? GRID_COLORS.activeHeaderText : GRID_COLORS.rowText;
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
  ctx.strokeStyle = frozen ? GRID_COLORS.gridFrozen : GRID_COLORS.grid;
  ctx.strokeRect(x, y, width, height);
  if (firstColumnLabel && !selected) {
    ctx.strokeStyle = GRID_COLORS.firstColumnBorder;
    ctx.beginPath();
    ctx.moveTo(x + width - .5, y);
    ctx.lineTo(x + width - .5, y + height);
    ctx.stroke();
  }
  const value = grid.doc.getCell(row, column);
  if (shouldDrawCellText(row, column, editing)) {
    ctx.fillStyle = activeColumnHeader && !selected ? GRID_COLORS.activeHeaderText : cellTextColor(row, column, value, selected, grid.colorizeColumns, firstColumnLabel);
    ctx.textBaseline = "middle";
    if (typeof grid.fillText === "function") grid.fillText(value, x + 8, centeredTextY(y, height), width - 12);
    else fillText(grid, value, x + 8, centeredTextY(y, height), width - 12);
  }
  if (typeof grid.drawDiagnosticMarker === "function") grid.drawDiagnosticMarker(row, column, x, y, width, height);
  else drawDiagnosticMarker(grid, row, column, x, y, width, height);
  if (active) {
    ctx.strokeStyle = GRID_COLORS.active;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
    ctx.lineWidth = 1;
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

function drawFrozenDividers(grid, frozenColWidth, frozenRowHeight) {
  const ctx = grid.ctx;
  const tableHeight = grid.visibleTableHeight();
  const tableWidth = grid.visibleTableWidth();
  ctx.save();
  if (frozenRowHeight) {
    drawFrozenBorderRect(grid, 0, 0, tableWidth, Math.min(frozenRowHeight, tableHeight));
  }
  if (frozenColWidth) {
    drawFrozenBorderRect(grid, grid.rowHeaderWidth, 0, frozenColWidth, tableHeight);
  }
  if (frozenColWidth && frozenRowHeight) {
    drawFrozenBorderRect(grid, grid.rowHeaderWidth, 0, frozenColWidth, frozenRowHeight);
  }
  if (frozenColWidth) {
    const x = grid.rowHeaderWidth + frozenColWidth;
    drawFrozenVerticalEdge(grid, x, tableHeight);
  }
  if (frozenRowHeight) {
    const y = frozenRowHeight;
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
  const value = String(text);
  if (grid.ctx.measureText(value).width <= maxWidth) {
    grid.ctx.fillText(value, x, y);
    return;
  }
  let clipped = value;
  while (clipped.length > 1 && grid.ctx.measureText(`${clipped}...`).width > maxWidth) clipped = clipped.slice(0, -1);
  grid.ctx.fillText(`${clipped}...`, x, y);
}

export function fillGridText(grid, text, x, y, maxWidth) {
  return fillText(grid, text, x, y, maxWidth);
}

export function shouldDrawCellText(row, column, editingCell) {
  return !editingCell || editingCell.row !== row || editingCell.column !== column;
}
