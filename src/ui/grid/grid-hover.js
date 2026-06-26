import {
  hoverRequestPolicy,
  hoverStateHasActivity,
  hoverTooltipPresentation,
  isHoverTargetCurrent,
  normalizeVectorLspTooltip,
  shouldClearHoverForInteraction,
  vectorTooltipPosition,
  vectorTooltipSections,
  vectorTooltipShouldOwnCell
} from "../hover-policy.js";

export { normalizeVectorLspTooltip };

export function clearGridHoverState(grid) {
  const hadHover = hoverStateHasActivity({
    hoveredCell: grid._hoveredCell,
    pendingRow: grid._pendingHoverRow,
    pendingCol: grid._pendingHoverCol,
    hoverDebounceTimer: grid._hoverDebounceTimer,
    legacyPreviewVisible: !grid.hoverPreview.classList.contains("hidden"),
    vectorTooltipVisible: grid._tooltip.style.display !== "none"
  });
  grid.hideFirstColumnHoverPreview();
  grid.clearLspHovers();
  grid._hoveredCell = null;
  grid._pendingHoverRow = -1;
  grid._pendingHoverCol = -1;
  grid._pendingHoverPointerAt = 0;
  grid._pendingHoverDelayAt = 0;
  grid._lastHoverRequestRow = -1;
  grid._lastHoverRequestCol = -1;
  if (grid._hoverDebounceTimer !== null) {
    clearTimeout(grid._hoverDebounceTimer);
    grid._hoverDebounceTimer = null;
  }
  if (hadHover) grid.onHoverInvalidated?.();
}

export function clearGridLspHovers(grid) {
  grid._lspHoverByCell.clear();
  grid.hideVectorTooltip();
}

export function hideGridVectorTooltip(grid) {
  grid._tooltip.style.display = "none";
  grid._tooltip.textContent = "";
}

export function updateGridTooltip(grid, event, hit) {
  const value = hit.kind === "cell" ? grid.doc.getCell(hit.row, hit.column) : "";
  const key = hit.kind === "cell" ? `${hit.row}:${hit.column}` : "";
  const diags = grid.diagnosticsByCell.get(key) ?? [];
  const hoverText = grid._lspHoverByCell.get(key) ?? null;
  const presentation = hoverTooltipPresentation({
    hoverAllowed: grid.isHoverAllowed(),
    hitKind: hit.kind,
    dragging: grid.dragging,
    vectorLspHoverEnabled: grid.vectorLspHoverEnabled,
    hoverText,
    diagnostics: diags,
    value
  });
  if (presentation.action === "clear") {
    grid._hoveredCell = null;
    grid.clearHoverState();
    return;
  }
  if (presentation.action === "legacy-disabled") {
    grid._hoveredCell = null;
    grid.clearLspHovers();
    grid.showLegacyHoverPreview(hit, event, value);
    return;
  }
  grid._hoveredCell = { row: hit.row, col: hit.column };
  grid._lastTooltipX = event.clientX;
  grid._lastTooltipY = event.clientY;
  if (presentation.action === "vector-tooltip") {
    grid.hideFirstColumnHoverPreview();
    grid._renderTooltip(hit.row, hit.column, event.clientX, event.clientY);
  } else {
    grid.hideVectorTooltip();
    grid.showLegacyHoverPreview(hit, event, value);
  }
  grid._scheduleHoverRequest(hit.row, hit.column);
}

export function scheduleGridHoverRequest(grid, row, col) {
  if (!grid.isHoverAllowed()) return;
  if (!grid.vectorLspHoverEnabled) return;
  const policy = hoverRequestPolicy({
    pendingRow: grid._pendingHoverRow,
    pendingCol: grid._pendingHoverCol,
    lastRequestRow: grid._lastHoverRequestRow,
    lastRequestCol: grid._lastHoverRequestCol,
    row,
    column: col
  });
  if (!policy.shouldRequest) return;
  const now = performance.now();
  if (grid._hoverDebounceTimer !== null) clearTimeout(grid._hoverDebounceTimer);
  if (policy.shouldResetRequestedTarget) {
    grid._pendingHoverPointerAt = now;
    grid._lastHoverRequestRow = -1;
    grid._lastHoverRequestCol = -1;
  }
  grid._pendingHoverRow = row;
  grid._pendingHoverCol = col;
  grid._pendingHoverDelayAt = now;
  if (!grid.isHoverAllowed()) return;
  if (grid._hoveredCell?.row !== grid._pendingHoverRow || grid._hoveredCell?.col !== grid._pendingHoverCol) return;
  grid._lastHoverRequestRow = grid._pendingHoverRow;
  grid._lastHoverRequestCol = grid._pendingHoverCol;
  grid.onHoverRequest?.(grid._pendingHoverRow, grid._pendingHoverCol, {
    pointerEnterAt: grid._pendingHoverPointerAt,
    delayScheduledAt: grid._pendingHoverDelayAt,
    requestQueuedAt: performance.now()
  });
}

export function renderGridTooltip(grid, row, col, clientX, clientY) {
  const value = grid.doc.getCell(row, col);
  const diags = grid.diagnosticsByCell.get(`${row}:${col}`) ?? [];
  const hoverText = grid._lspHoverByCell.get(`${row}:${col}`) ?? null;
  const sections = vectorTooltipSections({ value, hoverText, diagnostics: diags });
  if (!sections.length) {
    grid._tooltip.style.display = "none";
    return;
  }
  grid._tooltip.textContent = "";
  for (const section of sections) {
    const div = document.createElement("div");
    div.className = section.className;
    div.textContent = section.text;
    grid._tooltip.appendChild(div);
  }
  grid._tooltip.style.display = "block";
  grid._tooltip.style.left = `${clientX + 14}px`;
  grid._tooltip.style.top = `${clientY + 14}px`;
  const rect = grid._tooltip.getBoundingClientRect();
  const position = vectorTooltipPosition({
    clientX,
    clientY,
    rect,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  });
  grid._tooltip.style.left = position.left;
  grid._tooltip.style.top = position.top;
}

export function setGridLspHover(grid, row, col, text) {
  if (!grid.isHoverAllowed()) return;
  if (!isHoverTargetCurrent(grid._hoveredCell, row, col)) return;
  const key = `${row}:${col}`;
  if (text) grid._lspHoverByCell.set(key, text);
  else grid._lspHoverByCell.delete(key);
  const diags = grid.diagnosticsByCell.get(key) ?? [];
  const value = grid.doc.getCell(row, col);
  if (vectorTooltipShouldOwnCell({ hoverText: text, diagnostics: diags, value })) {
    grid.hideFirstColumnHoverPreview();
    grid._renderTooltip(row, col, grid._lastTooltipX, grid._lastTooltipY);
  } else {
    grid.hideVectorTooltip();
    grid.showLegacyHoverPreview({ kind: "cell", row, column: col }, { clientX: grid._lastTooltipX, clientY: grid._lastTooltipY }, value);
  }
}

export function updateFirstColumnHoverPreview(grid, hit, event) {
  if (!grid.isHoverAllowed()) {
    grid.hideFirstColumnHoverPreview();
    return;
  }
  const value = hit.kind === "cell" ? grid.doc.getCell(hit.row, hit.column) : "";
  if (!shouldShowFirstColumnHover(hit, value)) {
    grid.hideFirstColumnHoverPreview();
    return;
  }
  grid.hoverCell = { row: hit.row, column: hit.column };
  grid.hoverPreview.textContent = String(value);
  grid.hoverPreview.dataset.row = String(hit.row);
  grid.hoverPreview.dataset.column = String(hit.column);
  grid.hoverPreview.classList.remove("hidden");

  const gap = 12;
  let left = event.clientX + gap;
  let top = event.clientY + gap;
  const box = grid.hoverPreview.getBoundingClientRect();
  if (left + box.width > window.innerWidth - 8) left = Math.max(8, event.clientX - box.width - gap);
  if (top + box.height > window.innerHeight - 8) top = Math.max(8, event.clientY - box.height - gap);
  grid.hoverPreview.style.left = `${left}px`;
  grid.hoverPreview.style.top = `${top}px`;
}

export function showLegacyHoverPreview(grid, hit, event, value) {
  grid.hideVectorTooltip();
  if (shouldShowFirstColumnHover(hit, value)) {
    grid.updateFirstColumnHoverPreview(hit, event);
  } else {
    grid.hideFirstColumnHoverPreview();
  }
}

export function hideFirstColumnHoverPreview(grid) {
  if (!grid.hoverPreview) return;
  grid.hoverPreview.classList.add("hidden");
  grid.hoverPreview.textContent = "";
  delete grid.hoverPreview.dataset.row;
  delete grid.hoverPreview.dataset.column;
  grid.hoverCell = null;
}

export function shouldShowFirstColumnHover(hit, value) {
  return hit?.kind === "cell" && hit.row > 0 && hit.column === 0 && String(value ?? "") !== "";
}

export function bindHoverExitEvents(host, onLeave) {
  host.addEventListener("mouseleave", onLeave);
  host.addEventListener("pointerleave", onLeave);
}

export function createFirstColumnHoverPreview(ownerDocument = document) {
  const preview = ownerDocument.createElement("div");
  preview.className = "first-column-hover-preview hidden";
  preview.setAttribute("role", "tooltip");
  ownerDocument.body.append(preview);
  return preview;
}

export function clearHoverForScroll({ shouldClear = shouldClearHoverForInteraction, clearHoverState }) {
  if (shouldClear({ scroll: true })) clearHoverState?.();
}
