export function lintPanelActive({ problemsVisible = false, lintEnabled = false } = {}) {
  return Boolean(problemsVisible && lintEnabled);
}

export function lintEnginePanelActive({ problemsVisible = false, lintEnabled = false, engine = "", targetEngine = "" } = {}) {
  return lintPanelActive({ problemsVisible, lintEnabled }) && engine === targetEngine;
}

export function shouldRenderProblemsPanel({ hasProblemsList = false, problemsVisible = false, bottomTab = "" } = {}) {
  return Boolean(hasProblemsList && problemsVisible && bottomTab === "problems");
}

export function lintDiagnosticsStateAfterUpdate({ version = 0 } = {}, diagnostics = []) {
  return { diagnostics, version: version + 1 };
}

export function activeDocumentDiagnostics({ lintActive = false, diagnostics = [], doc = null, diagnosticsForDocument }) {
  return lintActive ? diagnosticsForDocument(diagnostics, doc) : [];
}

export function activeDocumentDiagnosticsByCell({ lintActive = false, diagnostics = [], doc = null, diagnosticsForDocument, groupDiagnosticsByCell }) {
  return lintActive ? groupDiagnosticsByCell(diagnosticsForDocument(diagnostics, doc)) : new Map();
}

export function problemsPanelRenderDecision({ currentKey = "", nextKey = "" } = {}) {
  return currentKey === nextKey ? "cached" : "render";
}

export function problemsPanelRenderEffect(decision) {
  if (decision === "cached") {
    return { updateActiveHighlight: true, perfDetails: { cached: true } };
  }
  if (decision === "render") {
    return { updateActiveHighlight: true, perfDetails: { rendered: true } };
  }
  return { updateActiveHighlight: false, perfDetails: { skipped: true } };
}

export function problemsSelectionChangeEffect() {
  return { updateActiveHighlight: true };
}

export function activeProblemItemState(active) {
  return {
    active: Boolean(active),
    ariaCurrent: active ? "location" : null
  };
}

export function problemsPanelRenderKey({
  engine = "",
  lintEnabled = false,
  lspStarted = false,
  lintStatus = "",
  legacyStatus = "",
  legacyRulesOpen = false,
  legacyProfile = "",
  lintVersion = 0,
  collapsedFiles = []
} = {}) {
  return [
    engine,
    lintEnabled ? "on" : "off",
    lspStarted ? "started" : "stopped",
    lintStatus,
    legacyStatus,
    legacyRulesOpen ? "rules-open" : "rules-closed",
    legacyProfile,
    lintVersion,
    [...collapsedFiles].sort().join("\u001f")
  ].join("\u001e");
}

export function activeDiagnosticIdsForCell({
  diagnostics = [],
  fileKey = "",
  activeCell = null,
  lintActive = false,
  hasOpenDocument = false
} = {}) {
  const ids = new Set();
  if (!lintActive || !hasOpenDocument || !activeCell) return ids;
  for (const diagnostic of diagnostics) {
    if (diagnostic.fileKey !== fileKey) continue;
    if (diagnostic.rowIndex !== activeCell.row || diagnostic.columnIndex !== activeCell.column) continue;
    ids.add(diagnostic.id);
  }
  return ids;
}

export function lintNotificationsVisible({ problemsVisible = false, lintEnabled = false, diagnostics = [] } = {}) {
  return Boolean(problemsVisible && lintEnabled && diagnostics.length > 0);
}

export function lintNotificationCount(state = {}) {
  return lintNotificationsVisible(state) ? state.diagnostics.length : 0;
}

export function problemBadgeCountForFile({ diagnostics = [], fileKey = "", notificationsVisible = false } = {}) {
  if (!notificationsVisible || !fileKey) return 0;
  return diagnostics.filter((diagnostic) => diagnostic.fileKey === fileKey).length;
}

export function diagnosticCounts(diagnostics = []) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of diagnostics) counts[diagnostic.severity] = (counts[diagnostic.severity] ?? 0) + 1;
  return counts;
}

export function groupDiagnosticsByFile(diagnostics = []) {
  const groups = new Map();
  for (const diagnostic of diagnostics) {
    if (!groups.has(diagnostic.fileName)) groups.set(diagnostic.fileName, []);
    groups.get(diagnostic.fileName).push(diagnostic);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function problemsPanelHtml({
  lintEnabled = false,
  vectorEngine = false,
  lspStarted = false,
  diagnostics = [],
  collapsedFiles = [],
  escapeHtml = escapeHtmlValue
} = {}) {
  if (!lintEnabled) return `<div class="empty-problems">Lint is off.</div>`;
  if (vectorEngine && !lspStarted) return `<div class="empty-problems">Open a folder to enable linting.</div>`;
  if (!diagnostics.length) return `<div class="empty-problems">No problems.</div>`;
  const collapsed = collapsedFiles instanceof Set ? collapsedFiles : new Set(collapsedFiles);
  return groupDiagnosticsByFile(diagnostics).map(([fileName, fileDiagnostics]) => `
    <details class="problem-file-group" data-file-name="${escapeHtml(fileName)}"${collapsed.has(fileName) ? "" : " open"}>
      <summary class="problem-file-header">${escapeHtml(fileName)} <span class="problem-file-count">(${fileDiagnostics.length})</span></summary>
      ${fileDiagnostics.map((diagnostic) => `
        <button class="problem-item" data-severity="${escapeHtml(diagnostic.severity)}" data-diagnostic-id="${escapeHtml(diagnostic.id)}"${diagnostic.navigationDisabled ? " disabled aria-disabled=\"true\" title=\"JSON diagnostics are read-only in TXTEditor.\"" : ""}>
          <span class="problem-location">R${diagnostic.rowIndex + 1}:C${diagnostic.columnIndex + 1}</span>
          <span class="problem-message">${escapeHtml(diagnostic.message)}</span>
          ${diagnostic.ruleId ? `<span class="problem-rule">${escapeHtml(diagnostic.ruleId)}</span>` : ""}
          ${diagnostic.profile ? `<span class="problem-rule">${escapeHtml(diagnostic.profile)}</span>` : ""}
        </button>
      `).join("")}
    </details>
  `).join("");
}

export function lintSummaryText({
  lintEnabled = false,
  legacyEngine = false,
  vectorEngine = false,
  lspStarted = false,
  lintStatus = "",
  legacyStatus = "",
  legacyWorkspaceLoadStatus = "",
  legacyProfile = "",
  diagnostics = [],
  counts = null,
  openFileCount = 0
} = {}) {
  if (!lintEnabled) return "Lint off";
  if (legacyEngine) {
    if (legacyStatus) return legacyStatus;
    if (legacyWorkspaceLoadStatus === "failed") return `Workspace index failed - ${legacyProfile}`;
    const summaryCounts = counts ?? diagnosticCounts(diagnostics);
    if (!diagnostics.length) return `No problems - ${legacyProfile}`;
    return `${summaryCounts.error} errors, ${summaryCounts.warning} warnings, ${summaryCounts.info} info - ${legacyProfile}`;
  }
  if (vectorEngine && !lspStarted) return "Open a folder to enable linting";
  if (lintStatus) return lintStatus;
  const summaryCounts = counts ?? diagnosticCounts(diagnostics);
  if (!diagnostics.length) return `No problems (${openFileCount} file${openFileCount === 1 ? "" : "s"} linted)`;
  return `${summaryCounts.error} errors, ${summaryCounts.warning} warnings, ${summaryCounts.info} info (${openFileCount} files)`;
}

export function problemBadgeHtml({ diagnostics = [], fileKey = "", notificationsVisible = false, escapeHtml = escapeHtmlValue } = {}) {
  const count = problemBadgeCountForFile({ diagnostics, fileKey, notificationsVisible });
  return count ? ` <span class="file-problem-badge">${escapeHtml(count)}</span>` : "";
}

function escapeHtmlValue(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
