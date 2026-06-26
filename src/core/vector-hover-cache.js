export const HOVER_NO_CONTENT_TTL_MS = 60_000;

export function targetHasImmediateTooltip(target) {
  return Boolean(target?.hasDiagnostics || String(target?.cellValue ?? "").trim());
}

export function makeHoverSemanticCacheKey(target) {
  if (!target) return "";
  const kind = target.targetKind === "diagnostic-cell" ? "cell" : target.targetKind;
  if (kind === "header") {
    return `${target.uri}\u001f${target.documentVersion}\u001fheader\u001f${target.column}\u001f${target.columnName}`;
  }
  return `${target.uri}\u001f${target.documentVersion}\u001f${kind}\u001f${target.columnName}\u001f${target.cellValue}`;
}

export function makeHoverCacheEntry(target, text, { now = Date.now } = {}) {
  const hasContent = Boolean(text);
  return {
    text: hasContent ? text : null,
    hasContent,
    noContent: !hasContent,
    uri: target.uri,
    documentVersion: target.documentVersion,
    semanticKey: makeHoverSemanticCacheKey(target),
    cachedAt: now()
  };
}

export function isHoverCacheEntryUsable(entry, target, { now = Date.now, noContentTtlMs = HOVER_NO_CONTENT_TTL_MS } = {}) {
  if (!entry || entry.uri !== target.uri || entry.documentVersion !== target.documentVersion) return false;
  return !(entry.noContent && now() - entry.cachedAt > noContentTtlMs);
}

export function hoverCacheStoredState(entry) {
  return entry?.noContent ? "no-content-stored" : "stored";
}

export function hoverCacheHitState(entry) {
  return entry?.noContent ? `${entry.cacheSource}-no-content-hit` : `${entry.cacheSource}-hit`;
}
