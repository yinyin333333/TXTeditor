export function makeVectorHoverTarget({ uri, fileName, row, column, columnName = "", cellValue = "", documentVersion = 0, hasDiagnostics = false }) {
  const targetKind = hasDiagnostics ? "diagnostic-cell" : row === 0 ? "header" : column === 0 ? "leftmost" : "cell";
  const safeColumnName = columnName ?? "";
  const safeCellValue = cellValue ?? "";
  const safeVersion = Number.isFinite(documentVersion) ? documentVersion : 0;
  const matchKey = `${uri}\u001f${targetKind}\u001f${row}\u001f${column}\u001f${safeColumnName}\u001f${safeCellValue}`;
  return {
    key: `${uri}\u001f${safeVersion}\u001f${targetKind}\u001f${row}\u001f${column}\u001f${safeColumnName}\u001f${safeCellValue}`,
    matchKey,
    targetKind,
    targetType: targetKind,
    uri,
    fileName,
    row,
    column,
    columnName: safeColumnName,
    cellValue: safeCellValue,
    cellValuePreview: safeCellValue.slice(0, 120),
    documentVersion: safeVersion,
    hasDiagnostics: Boolean(hasDiagnostics)
  };
}

export function shouldAcceptVectorHoverResult({
  target,
  generation,
  currentTargetKey,
  currentGeneration,
  vectorHoverEnabled,
  contextMenuOpen
}) {
  if (!vectorHoverEnabled) return { accepted: false, reason: "hover-disabled" };
  if (contextMenuOpen) return { accepted: false, reason: "context-menu-open" };
  const acceptableKeys = [target?.matchKey, target?.key].filter(Boolean);
  if (!target || !acceptableKeys.includes(currentTargetKey)) return { accepted: false, reason: "target-changed" };
  if (generation !== currentGeneration) return { accepted: false, reason: "generation-changed" };
  return { accepted: true, reason: "" };
}

export function startVectorHoverSample(target, {
  now,
  vectorHoverEnabled,
  cached = false,
  lspReady = false,
  pointerEnterAt = null,
  delayScheduledAt = null,
  requestQueuedAt = null,
  prewarmQueueLength = 0,
  wasPrewarm = false,
  wasUserInitiated = true
}) {
  const at = now();
  const enterAt = Number.isFinite(pointerEnterAt) ? pointerEnterAt : at;
  const scheduledAt = Number.isFinite(delayScheduledAt) ? delayScheduledAt : at;
  return {
    targetKind: target.targetKind,
    targetType: target.targetKind,
    fileName: target.fileName,
    row: target.row,
    column: target.column,
    columnName: target.columnName,
    cellValue: target.cellValue,
    cellValuePreview: target.cellValuePreview ?? target.cellValue?.slice?.(0, 120) ?? "",
    documentVersion: target.documentVersion,
    vectorHoverEnabled: Boolean(vectorHoverEnabled),
    cached: Boolean(cached),
    cacheState: cached ? "hit" : "miss",
    lspReady: Boolean(lspReady),
    lspReadyAtRequest: Boolean(lspReady),
    retryCount: 0,
    pointerStillOnTarget: false,
    pointerEnterAt: enterAt,
    delayScheduledAt: scheduledAt,
    requestQueuedAt,
    requestSentAt: null,
    scheduledAt,
    timestamp: enterAt,
    requestedAt: null,
    requestDispatchAt: null,
    responseAt: cached ? at : null,
    lspResponseAt: cached ? at : null,
    lspRequestMs: null,
    lspResponseMs: null,
    renderedAt: null,
    tooltipRenderedAt: null,
    tooltipClearedAt: null,
    totalMs: null,
    lspMs: null,
    renderMs: null,
    contentReturned: false,
    noContent: false,
    accepted: false,
    discarded: false,
    discardReason: null,
    canceled: false,
    cancelReason: "",
    prewarmQueueLength,
    wasPrewarm: Boolean(wasPrewarm),
    wasUserInitiated: Boolean(wasUserInitiated)
  };
}

export function markVectorHoverRequested(sample, now) {
  const at = now();
  sample.requestedAt = at;
  sample.requestSentAt = at;
  sample.requestDispatchAt = at;
  sample.lspReady = true;
  sample.lspReadyAtRequest = true;
  return sample;
}

export function markVectorHoverRetry(sample) {
  sample.retryCount = (sample.retryCount ?? 0) + 1;
  return sample;
}

export function finishVectorHoverSample(sample, {
  now,
  contentReturned,
  rendered,
  pointerStillOnTarget = false
}) {
  if (!sample || sample.canceled) return sample;
  const at = now();
  sample.responseAt ??= at;
  sample.lspResponseAt = sample.responseAt;
  sample.renderedAt = rendered ? at : null;
  sample.tooltipRenderedAt = rendered ? at : null;
  sample.contentReturned = Boolean(contentReturned);
  sample.noContent = !sample.contentReturned;
  sample.pointerStillOnTarget = Boolean(pointerStillOnTarget);
  sample.accepted = true;
  sample.discarded = false;
  sample.discardReason = null;
  sample.totalMs = Math.round((at - sample.scheduledAt) * 100) / 100;
  sample.lspMs = sample.requestedAt == null ? 0 : Math.round((sample.responseAt - sample.requestedAt) * 100) / 100;
  sample.lspRequestMs = sample.queueWaitMs ?? (sample.requestedAt == null || sample.requestQueuedAt == null ? 0 : Math.round((sample.requestedAt - sample.requestQueuedAt) * 100) / 100);
  sample.lspResponseMs = sample.lspMs;
  sample.renderMs = rendered ? Math.round((sample.renderedAt - sample.responseAt) * 100) / 100 : null;
  return sample;
}

export function cancelVectorHoverSample(sample, reason, now) {
  if (!sample || sample.canceled || sample.renderedAt != null) return sample;
  const at = now();
  sample.canceled = true;
  sample.accepted = false;
  sample.discarded = true;
  sample.discardReason = reason;
  sample.cancelReason = reason;
  sample.tooltipClearedAt = at;
  sample.totalMs = Math.round((at - sample.scheduledAt) * 100) / 100;
  return sample;
}
