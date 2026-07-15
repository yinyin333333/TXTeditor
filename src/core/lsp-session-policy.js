import { lspSiblingParentPath } from "./lsp-uri-policy.js";

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

export function lspWorkspaceSessionPolicy({
  started,
  activeWorkspacePath,
  requestedWorkspacePath,
  activeContextMode = "workspace",
  requestedContextMode = "workspace",
  activeReferenceRootPath = "",
  requestedReferenceRootPath = "",
  activeIncludeSubfolders = true,
  requestedIncludeSubfolders = true,
  forceRestart = false
}) {
  const activeKey = lspWorkspaceKey(activeWorkspacePath);
  const requestedKey = lspWorkspaceKey(requestedWorkspacePath);
  const activeMode = lspContextMode(activeContextMode);
  const requestedMode = lspContextMode(requestedContextMode);
  const activeReferenceRootKey = lspWorkspaceKey(activeReferenceRootPath);
  const requestedReferenceRootKey = lspWorkspaceKey(requestedReferenceRootPath);
  if (!started) return { action: "start", activeKey, requestedKey };
  if (forceRestart || activeKey !== requestedKey || activeMode !== requestedMode
    || activeReferenceRootKey !== requestedReferenceRootKey
    || Boolean(activeIncludeSubfolders) !== Boolean(requestedIncludeSubfolders)) {
    return { action: "restart", activeKey, requestedKey };
  }
  return { action: "sync", activeKey, requestedKey };
}

export function lspContextMode(value) {
  return value === "sibling" ? "sibling" : "workspace";
}

export function lspDocumentMatchesSessionScope({
  documentPath,
  hasUri = true,
  workspacePath,
  contextMode,
  referenceRootPath = "",
  includeSubfolders = true
}) {
  if (!hasUri) return false;
  if (lspContextMode(contextMode) !== "sibling") {
    const documentKey = lspWorkspaceKey(documentPath);
    const workspaceKey = lspWorkspaceKey(workspacePath);
    if (!workspaceKey) return Boolean(documentKey);
    if (!lspPathWithin(documentKey, workspaceKey)) return false;
    if (includeSubfolders) return true;
    return lspWorkspaceKey(lspSiblingParentPath(documentPath)) === workspaceKey;
  }
  const documentParentKey = lspWorkspaceKey(lspSiblingParentPath(documentPath));
  const sameSiblingParent = documentParentKey === lspWorkspaceKey(workspacePath);
  const documentKey = lspWorkspaceKey(documentPath);
  const referenceKey = lspWorkspaceKey(referenceRootPath);
  const inReferenceScope = includeSubfolders
    ? lspPathWithin(documentKey, referenceKey)
    : Boolean(referenceKey && documentParentKey === referenceKey);
  return sameSiblingParent || inReferenceScope;
}

function lspPathWithin(pathKey, rootKey) {
  if (!pathKey || !rootKey) return false;
  return pathKey === rootKey || pathKey.startsWith(rootKey.endsWith("/") ? rootKey : `${rootKey}/`);
}

export function lspWorkspaceKey(pathValue) {
  let normalized = String(pathValue || "").trim().replace(/\\/g, "/");
  const unc = normalized.startsWith("//");
  if (unc) normalized = normalized.slice(2);
  normalized = normalized.replace(/\/{2,}/g, "/");
  if (normalized.endsWith("/") && !/^[a-zA-Z]:\/$/.test(normalized) && normalized !== "/") {
    normalized = normalized.slice(0, -1);
  }
  return `${unc ? "//" : ""}${normalized}`.toLowerCase();
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
    text: typeof doc.toRowText === "function"
      ? doc.toRowText(row)
      : doc.rows[row]?.join("\t") ?? ""
  }));
}
