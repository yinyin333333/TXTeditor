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
  return {
    action: changedRows?.length ? "update-incremental" : "update-full",
    changedRowCount: changedRows?.length ?? 0
  };
}

export function lspHoverReady({ vectorHoverEnabled, lspStarted, uri, docState }) {
  return Boolean(vectorHoverEnabled && lspStarted && uri && docState.opened && docState.hoverReady);
}

export function lspChangedRowsToIncrementalChanges(doc, changedRows) {
  return changedRows.map((row) => ({
    range: { start: { line: row, character: 0 }, end: { line: row, character: 0xFFFFFF } },
    text: doc.rows[row]?.join("\t") ?? ""
  }));
}
