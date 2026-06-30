export function lspOpenDocumentPolicy({ vectorEngine, lspStarted, uri, docState, version }) {
  if (!vectorEngine) return { action: "skip-legacy", event: "vector-open-skipped-legacy" };
  if (!lspStarted) return { action: "skip-not-started" };
  if (!uri) return { action: "skip-no-uri" };
  if (docState.opened && docState.openedUri === uri && docState.openedVersion === version) {
    return { action: "already-open" };
  }
  if (docState.openPromise) return { action: "reuse-open-promise", promise: docState.openPromise };
  return { action: "open" };
}

export function lspUpdateDocumentPolicy({ vectorEngine, lspStarted, uri, changedRows }) {
  if (!vectorEngine) return { action: "skip-legacy", event: "vector-update-skipped-legacy" };
  if (!lspStarted) return { action: "skip-not-started" };
  if (!uri) return { action: "skip-no-uri" };
  const change = normalizeLspDocumentChange(changedRows);
  if (change.kind === "none") return { action: "skip-no-change", changedRowCount: 0, change };
  if (change.kind === "replaceRows") {
    return {
      action: change.rows.length ? "update-incremental" : "update-full",
      changedRowCount: change.rows.length,
      change
    };
  }
  if (change.kind !== "full") {
    return {
      action: "update-full-deferred",
      changedRowCount: 0,
      change,
      reason: change.kind
    };
  }
  return {
    action: "update-full",
    changedRowCount: 0,
    change
  };
}

export function normalizeLspDocumentChange(change) {
  if (change?.kind === "replaceRows") return change;
  if (change?.kind) return change;
  return { kind: "full", reason: "unspecified" };
}

export function lspHoverReady({ vectorHoverEnabled, lspStarted, uri, docState }) {
  return Boolean(vectorHoverEnabled && lspStarted && uri && docState.opened && docState.hoverReady);
}

export function lspChangedRowsToIncrementalChanges(doc, changedRows) {
  const rows = normalizeLspDocumentChange(changedRows).rows ?? [];
  return rows.map((row) => ({
    range: { start: { line: row, character: 0 }, end: { line: row, character: 0xFFFFFF } },
    text: doc.rows[row]?.join("\t") ?? ""
  }));
}
