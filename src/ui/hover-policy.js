export function isGridHoverAllowed({ hoverSuspended = false, resizing = null, dragging = false } = {}) {
  return !hoverSuspended && !resizing && !dragging;
}

export function isHoverTargetCurrent(hoveredCell, row, column) {
  return hoveredCell?.row === row && hoveredCell?.col === column;
}

export function vectorTooltipShouldOwnCell({ hoverText = "", diagnostics = [], value = "" } = {}) {
  return Boolean(hoverText || diagnostics.length || String(value ?? "").trim().length > 0);
}

export function hoverStateHasActivity({
  hoveredCell = null,
  pendingRow = -1,
  pendingCol = -1,
  hoverDebounceTimer = null,
  legacyPreviewVisible = false,
  vectorTooltipVisible = false
} = {}) {
  return Boolean(
    hoveredCell
    || pendingRow !== -1
    || pendingCol !== -1
    || hoverDebounceTimer !== null
    || legacyPreviewVisible
    || vectorTooltipVisible
  );
}

export function hoverTooltipPresentation({
  hoverAllowed,
  hitKind,
  dragging,
  vectorLspHoverEnabled,
  hoverText = "",
  diagnostics = [],
  value = ""
}) {
  if (!hoverAllowed || hitKind !== "cell" || dragging) return { action: "clear" };
  if (!vectorLspHoverEnabled) return { action: "legacy-disabled" };
  return vectorTooltipShouldOwnCell({ hoverText, diagnostics, value })
    ? { action: "vector-tooltip" }
    : { action: "legacy-fallback" };
}

export function shouldClearHoverForInteraction({
  resizeHandle = false,
  resizing = false,
  scroll = false,
  contextMenu = false,
  documentChanged = false,
  pointerLeave = false
} = {}) {
  return Boolean(resizeHandle || resizing || scroll || contextMenu || documentChanged || pointerLeave);
}

export function hoverRequestPolicy({
  pendingRow,
  pendingCol,
  lastRequestRow,
  lastRequestCol,
  row,
  column
}) {
  const samePendingTarget = pendingRow === row && pendingCol === column;
  const sameRequestedTarget = lastRequestRow === row && lastRequestCol === column;
  return {
    samePendingTarget,
    sameRequestedTarget,
    shouldRequest: !sameRequestedTarget,
    shouldResetRequestedTarget: !samePendingTarget
  };
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

export function vectorTooltipSections({ value = "", hoverText = "", diagnostics = [] } = {}) {
  if (diagnostics.length) {
    return diagnostics.map((diagnostic) => ({
      kind: "diagnostic",
      className: `cell-tooltip-diag cell-tooltip-diag-${diagnostic.severity}`,
      text: diagnosticTooltipText(diagnostic)
    }));
  }
  const tooltip = normalizeVectorLspTooltip(value, hoverText);
  const sections = [];
  if (tooltip.title) sections.push({ kind: "value", className: "cell-tooltip-value", text: tooltip.title });
  if (tooltip.detail) sections.push({ kind: "hover", className: "cell-tooltip-hover", text: tooltip.detail });
  return sections;
}

export function diagnosticTooltipText(diagnostic = {}) {
  const message = String(diagnostic.message ?? "");
  const guidance = diagnosticUserGuidance(diagnostic);
  const guidanceHeading = stringField(diagnostic.data?.localizedGuidanceHeading) || "What to do";
  const trimmedMessage = message.trim();
  const trimmedGuidance = guidance.trim();
  const alreadyIncluded = trimmedGuidance
    && (trimmedMessage === trimmedGuidance || trimmedMessage.endsWith(trimmedGuidance));
  return trimmedGuidance && !alreadyIncluded
    ? `${message}\n\n${guidanceHeading}:\n${guidance}`
    : message;
}

export function diagnosticUserGuidance(diagnostic = {}) {
  const data = diagnostic.data;
  if (!data || typeof data !== "object") return "";
  const localizedGuidance = stringField(data.localizedGuidance);
  if (localizedGuidance) return localizedGuidance;
  if (data.localizedMessage === true) return "";
  const insertText = stringField(data.insertText) || stringField(data.expected);
  if (data.kind === "missing-token" && insertText) return `Insert '${insertText}' at the marked position.`;
  if (data.kind === "unexpected-character") {
    const actual = stringField(data.actual);
    return actual ? `Remove or replace '${actual}' at the marked position.` : "Remove or replace the marked character.";
  }
  if (data.kind === "unexpected-token") return "Remove or replace the marked token.";
  const hint = stringField(data.hint);
  if (hint) return hint;
  return "";
}

export function vectorTooltipPosition({
  clientX,
  clientY,
  rect,
  viewportWidth,
  viewportHeight,
  pad = 8
}) {
  let left = clientX + 14;
  let top = clientY + 14;
  if (left + rect.width > viewportWidth - pad) left = clientX - rect.width - 6;
  if (top + rect.height > viewportHeight - pad) top = clientY - rect.height - 6;
  return { left: `${left}px`, top: `${top}px` };
}

function splitHoverText(hoverText) {
  const lines = String(hoverText ?? "").replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  const title = lines.shift()?.trim() ?? "";
  while (lines.length && lines[0].trim() === "") lines.shift();
  return { title, detail: lines.join("\n").trim() };
}

function stringField(value) {
  return typeof value === "string" && value ? value : "";
}
