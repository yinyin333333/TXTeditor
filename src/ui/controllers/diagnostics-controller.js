import { TableDocument, clamp } from "../../core/table-model.js";
import { isTauriRuntime, openNativePaths } from "../../core/io.js";
import { diagnosticsForDocument, groupDiagnosticsByCell } from "../../core/lint-engine.js";
import {
  LINT_ENGINE_LEGACY,
  LINT_ENGINE_VECTOR
} from "../../core/lint-controller-policy.js";
import { finishDiagnosticNavigation } from "../diagnostic-navigation.js";
import {
  activeDiagnosticIdsForCell,
  activeDocumentDiagnostics,
  activeDocumentDiagnosticsByCell,
  activeProblemItemState,
  lintSummaryText as buildLintSummaryText,
  lintEnginePanelActive,
  lintDiagnosticsStateAfterUpdate,
  lintNotificationCount as countLintNotifications,
  lintNotificationsVisible as areLintNotificationsVisible,
  lintPanelActive,
  problemBadgeHtml,
  problemsPanelHtml,
  problemsPanelRenderDecision,
  problemsPanelRenderEffect,
  problemsPanelRenderKey as buildProblemsPanelRenderKey,
  problemsSelectionChangeEffect,
  shouldRenderProblemsPanel
} from "../problems-policy.js";

export function createDiagnosticsController({
  state,
  els,
  grid,
  activeDoc,
  hasOpenDocument,
  addDocument,
  renderChrome,
  recordUiPerf,
  showError,
  lintDocKey,
  lintPathKey,
  escapeHtml,
  saveSelectionState = () => {},
  storage = localStorage
}) {
  const collapsedProblemFiles = new Set();

  function currentGrid() {
    return typeof grid === "function" ? grid() : grid;
  }

  function lintActive() {
    return lintPanelActive({
      problemsVisible: state.problemsVisible,
      lintEnabled: state.lint.enabled
    });
  }

  function vectorLintDisplayActive() {
    return lintEnginePanelActive({
      problemsVisible: state.problemsVisible,
      lintEnabled: state.lint.enabled,
      engine: state.lint.engine,
      targetEngine: LINT_ENGINE_VECTOR
    });
  }

  function legacyLintDisplayActive() {
    return lintEnginePanelActive({
      problemsVisible: state.problemsVisible,
      lintEnabled: state.lint.enabled,
      engine: state.lint.engine,
      targetEngine: LINT_ENGINE_LEGACY
    });
  }

  function setLintDiagnostics(diagnostics) {
    const next = lintDiagnosticsStateAfterUpdate(state.lint, diagnostics);
    state.lint.diagnostics = next.diagnostics;
    state.lint.version = next.version;
  }

  function updateGridDiagnostics() {
    const started = perfNow();
    const diagnosticsByCell = activeDocumentDiagnosticsByCell({
      lintActive: lintActive(),
      diagnostics: state.lint.diagnostics,
      doc: activeDoc(),
      diagnosticsForDocument,
      groupDiagnosticsByCell
    });
    currentGrid().setDiagnostics(diagnosticsByCell);
    updateOverviewRuler();
    recordUiPerf("update-grid-diagnostics", started, { cellMarkers: diagnosticsByCell.size });
  }

  function updateOverviewRuler() {
    const started = perfNow();
    const ruler = els.overviewRuler;
    if (!ruler) {
      recordUiPerf("update-overview-ruler", started, { skipped: true });
      return;
    }
    const hostRect = els.host.getBoundingClientRect();
    ruler.style.top = `${hostRect.top}px`;
    ruler.style.height = `${hostRect.height}px`;
    ruler.style.right = "0px";
    const doc = activeDoc();
    const diags = activeDocumentDiagnostics({
      lintActive: lintActive(),
      diagnostics: state.lint.diagnostics,
      doc,
      diagnosticsForDocument
    });
    const rowCount = doc.rowCount;
    if (!diags.length || !rowCount) {
      ruler.innerHTML = "";
      recordUiPerf("update-overview-ruler", started, { marks: 0 });
      return;
    }
    const seenRows = new Map();
    for (const diag of diags) {
      const existing = seenRows.get(diag.rowIndex);
      if (!existing || severityOrder(diag.severity) > severityOrder(existing)) {
        seenRows.set(diag.rowIndex, diag.severity);
      }
    }
    ruler.innerHTML = [...seenRows.entries()].map(([row, severity]) => {
      const pct = (row + 0.5) / rowCount * 100;
      return `<div class="ruler-mark ruler-mark-${severity}" style="top:${pct}%"></div>`;
    }).join("");
    recordUiPerf("update-overview-ruler", started, { marks: seenRows.size });
  }

  function docDiagnosticSeverity(_doc) {
    return null;
  }

  function scrollProblemsToActiveFile() {
    if (!state.problemsVisible || !els.problemsList) return;
    const doc = activeDoc();
    if (!doc?.name) return;
    const target = els.problemsList.querySelector(`details[data-file-name="${CSS.escape(doc.name)}"]`);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function docHasDiagnostics(doc) {
    return diagnosticsForDocument(state.lint.diagnostics, doc).length > 0;
  }

  async function goToDiagnostic(id) {
    const diagnostic = state.lint.diagnostics.find((item) => item.id === id);
    if (!diagnostic) return;
    let index = state.docs.findIndex((doc) => lintDocKey(doc) === diagnostic.fileKey);
    if (index < 0 && state.lint.engine === LINT_ENGINE_LEGACY) {
      const workspaceDoc = state.lint.legacy.workspaceDocs.find((doc) => lintDocKey(doc) === diagnostic.fileKey);
      if (workspaceDoc) {
        await addDocument(workspaceDoc);
        index = state.active;
      }
    }
    if (index < 0 && diagnostic.filePath && isTauriRuntime()) {
      const [doc] = await openNativePaths([diagnostic.filePath], TableDocument);
      if (doc) {
        await addDocument(doc);
        index = state.active;
      }
    }
    if (index >= 0) state.active = index;
    const gridRef = currentGrid();
    gridRef.setDocument(activeDoc());
    state.selection.set(
      clamp(diagnostic.rowIndex, 0, Math.max(0, activeDoc().rowCount - 1)),
      clamp(diagnostic.columnIndex, 0, Math.max(0, activeDoc().columnCount - 1))
    );
    saveSelectionState();
    finishDiagnosticNavigation({
      state,
      grid: gridRef,
      storage,
      renderChrome,
      updateGridDiagnostics,
      updateActiveProblemHighlight,
      host: els.host
    });
  }

  function renderProblemsPanelIfNeeded() {
    const started = perfNow();
    if (!shouldRenderProblemsPanel({
      hasProblemsList: Boolean(els.problemsList),
      problemsVisible: state.problemsVisible,
      bottomTab: state.bottomTab
    })) {
      recordUiPerf("render-problems-panel", started, { skipped: true });
      return;
    }
    const key = problemsPanelRenderKey();
    const decision = problemsPanelRenderDecision({ currentKey: els.problemsList.dataset.renderKey, nextKey: key });
    if (decision === "cached") {
      const effect = problemsPanelRenderEffect(decision);
      if (effect.updateActiveHighlight) updateActiveProblemHighlight();
      recordUiPerf("render-problems-panel", started, effect.perfDetails);
      return;
    }
    els.problemsList.innerHTML = renderProblemsPanel();
    els.problemsList.dataset.renderKey = key;
    for (const details of els.problemsList.querySelectorAll("details[data-file-name]")) {
      details.addEventListener("toggle", () => {
        const fn = details.dataset.fileName;
        if (details.open) collapsedProblemFiles.delete(fn);
        else collapsedProblemFiles.add(fn);
      });
    }
    for (const button of els.problemsList.querySelectorAll("[data-diagnostic-id]")) {
      button.addEventListener("click", async () => goToDiagnostic(button.dataset.diagnosticId).catch(showError));
    }
    const effect = problemsPanelRenderEffect(decision);
    if (effect.updateActiveHighlight) updateActiveProblemHighlight();
    recordUiPerf("render-problems-panel", started, effect.perfDetails);
  }

  function updateActiveProblemHighlight({ scroll = false } = {}) {
    if (!els.problemsList) return;
    const activeIds = activeProblemDiagnosticIds();
    let activeButton = null;
    for (const button of els.problemsList.querySelectorAll("[data-diagnostic-id]")) {
      const itemState = activeProblemItemState(activeIds.has(button.dataset.diagnosticId));
      button.classList.toggle("problem-item-active-cell", itemState.active);
      if (itemState.ariaCurrent) button.setAttribute("aria-current", itemState.ariaCurrent);
      else button.removeAttribute("aria-current");
      if (itemState.active && !activeButton) activeButton = button;
    }
    if (scroll && activeButton) activeButton.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }

  function lintSummaryText() {
    return buildLintSummaryText({
      lintEnabled: state.lint.enabled,
      legacyEngine: state.lint.engine === LINT_ENGINE_LEGACY,
      vectorEngine: state.lint.engine === LINT_ENGINE_VECTOR,
      lspStarted: state.lsp.started,
      lintStatus: state.lint.status,
      legacyStatus: state.lint.legacy.status,
      legacyWorkspaceLoadStatus: state.lint.legacy.workspaceLoad.status,
      legacyProfile: state.lint.legacy.settings.profile,
      diagnostics: state.lint.diagnostics,
      openFileCount: state.lsp.openFileCount ?? 0
    });
  }

  function problemBadgeForPath(path) {
    if (!path) return "";
    return problemBadgeHtml({
      diagnostics: state.lint.diagnostics,
      fileKey: lintPathKey(path),
      notificationsVisible: lintNotificationsVisible(),
      escapeHtml
    });
  }

  function lintNotificationsVisible() {
    return areLintNotificationsVisible({
      problemsVisible: state.problemsVisible,
      lintEnabled: state.lint.enabled,
      diagnostics: state.lint.diagnostics
    });
  }

  function lintNotificationCount() {
    return countLintNotifications({
      problemsVisible: state.problemsVisible,
      lintEnabled: state.lint.enabled,
      diagnostics: state.lint.diagnostics
    });
  }

  function handleSelectionChanged() {
    if (problemsSelectionChangeEffect().updateActiveHighlight) updateActiveProblemHighlight();
  }

  function activeProblemDiagnosticIds() {
    const activeCell = currentGrid().editingCell?.() ?? state.selection.focus;
    return activeDiagnosticIdsForCell({
      diagnostics: state.lint.diagnostics,
      fileKey: lintDocKey(activeDoc()),
      activeCell,
      lintActive: lintActive(),
      hasOpenDocument: hasOpenDocument()
    });
  }

  function problemsPanelRenderKey() {
    return buildProblemsPanelRenderKey({
      engine: state.lint.engine,
      lintEnabled: state.lint.enabled,
      lspStarted: state.lsp.started,
      lintStatus: state.lint.status,
      legacyStatus: state.lint.legacy.status,
      legacyRulesOpen: state.lint.legacy.rulesOpen,
      legacyProfile: state.lint.legacy.settings.profile,
      lintVersion: state.lint.version,
      collapsedFiles: collapsedProblemFiles
    });
  }

  function renderProblemsPanel() {
    return problemsPanelHtml({
      lintEnabled: state.lint.enabled,
      vectorEngine: state.lint.engine === LINT_ENGINE_VECTOR,
      lspStarted: state.lsp.started,
      diagnostics: state.lint.diagnostics,
      collapsedFiles: collapsedProblemFiles,
      escapeHtml
    });
  }

  function severityOrder(severity) {
    return severity === "error" ? 2 : severity === "warning" ? 1 : 0;
  }

  function perfNow() {
    return typeof performance === "undefined" ? 0 : performance.now();
  }

  return {
    docDiagnosticSeverity,
    docHasDiagnostics,
    goToDiagnostic,
    handleSelectionChanged,
    legacyLintDisplayActive,
    lintActive,
    lintNotificationCount,
    lintNotificationsVisible,
    lintSummaryText,
    problemBadgeForPath,
    renderProblemsPanelIfNeeded,
    scrollProblemsToActiveFile,
    setLintDiagnostics,
    updateActiveProblemHighlight,
    updateGridDiagnostics,
    updateOverviewRuler,
    vectorLintDisplayActive
  };
}
