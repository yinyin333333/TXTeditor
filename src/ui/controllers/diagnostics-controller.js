import { TableDocument, clamp } from "../../core/table-model.js";
import { isTauriRuntime, openNativePaths } from "../../core/io.js";
import { tText } from "../../core/i18n.js";
import { writeClipboardText } from "../app-runtime-utils.js";
import {
  DIAGNOSTIC_COPY_FULL,
  DIAGNOSTIC_COPY_MESSAGE,
  diagnosticCopyText,
  isDiagnosticCopyShortcut
} from "../diagnostic-copy-policy.js";
import { isJsonDocument, isTableDocument } from "../../core/document-file-state.js";
import { groupDiagnosticsByCell } from "../../core/lint-engine.js";
import {
  LINT_ENGINE_LEGACY,
  LINT_ENGINE_VECTOR
} from "../../core/lint-controller-policy.js";
import { finishDiagnosticNavigation } from "../diagnostic-navigation.js";
import {
  activeDiagnosticIdsForCell,
  activeProblemItemState,
  lintSummaryText as buildLintSummaryText,
  lintEnginePanelActive,
  lintDiagnosticsStateAfterUpdate,
  lintNotificationCount as countLintNotifications,
  lintNotificationsVisible as areLintNotificationsVisible,
  lintPanelActive,
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
  activateDocument = async (doc) => (typeof grid === "function" ? grid() : grid).setDocument(doc),
  openJsonDocumentPath = async () => null,
  navigateJsonDiagnostic = async () => false,
  focusActiveEditor = () => els.host?.focus?.(),
  renderChrome,
  recordUiPerf,
  showError,
  lintDocKey,
  lintPathKey,
  escapeHtml,
  showDiagnosticContextMenu = () => {},
  saveSelectionState = () => {},
  storage = localStorage
}) {
  const collapsedProblemFiles = new Set();
  let indexedSource = null;
  let diagnosticIndex = null;

  function rebuildDiagnosticIndex() {
    const byFile = new Map();
    const countByFile = new Map();
    const highestSeverityByFile = new Map();
    const counts = { error: 0, warning: 0, info: 0 };
    for (const diagnostic of state.lint.diagnostics) {
      if (!byFile.has(diagnostic.fileKey)) byFile.set(diagnostic.fileKey, []);
      byFile.get(diagnostic.fileKey).push(diagnostic);
      countByFile.set(diagnostic.fileKey, (countByFile.get(diagnostic.fileKey) ?? 0) + 1);
      counts[diagnostic.severity] = (counts[diagnostic.severity] ?? 0) + 1;
      const current = highestSeverityByFile.get(diagnostic.fileKey);
      if (!current || severityOrder(diagnostic.severity) > severityOrder(current)) {
        highestSeverityByFile.set(diagnostic.fileKey, diagnostic.severity);
      }
    }
    indexedSource = state.lint.diagnostics;
    diagnosticIndex = { byFile, countByFile, highestSeverityByFile, counts };
    return diagnosticIndex;
  }

  function currentDiagnosticIndex() {
    return indexedSource === state.lint.diagnostics && diagnosticIndex
      ? diagnosticIndex
      : rebuildDiagnosticIndex();
  }

  function diagnosticsForDoc(doc) {
    return currentDiagnosticIndex().byFile.get(lintDocKey(doc)) ?? [];
  }

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

  function setLintDiagnostics(diagnostics, { preserveVersion = false } = {}) {
    if (preserveVersion) {
      state.lint.diagnostics = diagnostics;
      rebuildDiagnosticIndex();
      return;
    }
    const next = lintDiagnosticsStateAfterUpdate(state.lint, diagnostics);
    state.lint.diagnostics = next.diagnostics;
    state.lint.version = next.version;
    rebuildDiagnosticIndex();
  }

  function updateGridDiagnostics({ redraw = true, updateRuler = true } = {}) {
    const started = perfNow();
    const doc = activeDoc();
    const diagnosticsByCell = lintActive() && isTableDocument(doc)
      ? groupDiagnosticsByCell(diagnosticsForDoc(doc))
      : new Map();
    currentGrid().setDiagnostics(diagnosticsByCell, { redraw });
    if (updateRuler) updateOverviewRuler();
    recordUiPerf("update-grid-diagnostics", started, {
      cellMarkers: diagnosticsByCell.size,
      redraw,
      updateRuler
    });
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
    if (isJsonDocument(doc)) {
      ruler.innerHTML = "";
      recordUiPerf("update-overview-ruler", started, { marks: 0, json: true });
      return;
    }
    const diags = lintActive() ? diagnosticsForDoc(doc) : [];
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
    const target = els.problemsList.querySelector(`details[data-file-key="${CSS.escape(lintDocKey(doc))}"]`);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function docHasDiagnostics(doc) {
    return diagnosticsForDoc(doc).length > 0;
  }

  function diagnosticById(id) {
    return state.lint.diagnostics.find((item) => item.id === id) ?? null;
  }

  async function copyDiagnostic(id, mode = DIAGNOSTIC_COPY_FULL) {
    const diagnostic = diagnosticById(id);
    if (!diagnostic) return false;
    try {
      await writeClipboardText(diagnosticCopyText(diagnostic, mode));
      return true;
    } catch (error) {
      showError(tText("error.clipboardCopy", {
        error: error instanceof Error ? error.message : String(error)
      }));
      return false;
    }
  }

  function openDiagnosticContextMenu(event, button) {
    const id = button?.dataset?.diagnosticId;
    if (!id || !diagnosticById(id)) return;
    event.preventDefault();
    button.focus?.();
    showDiagnosticContextMenu({
      x: event.clientX,
      y: event.clientY,
      onCopyMessage: () => copyDiagnostic(id, DIAGNOSTIC_COPY_MESSAGE),
      onCopyFull: () => copyDiagnostic(id, DIAGNOSTIC_COPY_FULL)
    });
  }

  function handleDiagnosticKeydown(event, button) {
    if (!isDiagnosticCopyShortcut(event)) return;
    const id = button?.dataset?.diagnosticId;
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    copyDiagnostic(id, DIAGNOSTIC_COPY_FULL).catch(showError);
  }

  async function goToDiagnostic(id) {
    const diagnostic = diagnosticById(id);
    if (!diagnostic || diagnostic.navigationDisabled) return;
    if (diagnostic.documentKind === "json") {
      const doc = await openJsonDocumentPath(diagnostic.filePath, { requireCurrentMode: true, focus: false });
      if (!doc) return;
      state.active = state.docs.indexOf(doc);
      await activateDocument(doc, { focus: false });
      await navigateJsonDiagnostic(doc, diagnostic);
      state.problemsVisible = true;
      renderChrome();
      updateGridDiagnostics();
      updateActiveProblemHighlight();
      focusActiveEditor();
      return;
    }
    let index = state.docs.findIndex((doc) => lintDocKey(doc) === diagnostic.fileKey);
    if (index < 0 && state.lint.engine === LINT_ENGINE_LEGACY) {
      const workspaceDoc = state.lint.legacy.workspaceDocs.find((doc) => lintDocKey(doc) === diagnostic.fileKey);
      if (workspaceDoc) {
        await addDocument(workspaceDoc, { scrollProblems: false });
        index = state.active;
      }
    }
    if (index < 0 && diagnostic.filePath && isTauriRuntime()) {
      const [doc] = await openNativePaths([diagnostic.filePath], TableDocument);
      if (doc) {
        await addDocument(doc, { scrollProblems: false });
        index = state.active;
      }
    }
    if (index >= 0) state.active = index;
    await activateDocument(activeDoc(), { focus: false });
    const gridRef = currentGrid();
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
    for (const details of els.problemsList.querySelectorAll("details[data-file-key]")) {
      details.addEventListener("toggle", () => {
        const fileKey = details.dataset.fileKey;
        if (details.open) collapsedProblemFiles.delete(fileKey);
        else collapsedProblemFiles.add(fileKey);
      });
    }
    for (const button of els.problemsList.querySelectorAll("[data-diagnostic-id]")) {
      button.addEventListener("click", async () => goToDiagnostic(button.dataset.diagnosticId).catch(showError));
      button.addEventListener("contextmenu", (event) => openDiagnosticContextMenu(event, button));
      button.addEventListener("keydown", (event) => handleDiagnosticKeydown(event, button));
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
      counts: currentDiagnosticIndex().counts,
      openFileCount: state.lsp.openFileCount ?? 0
    });
  }

  function problemBadgeForPath(path) {
    if (!path) return "";
    const count = problemBadgeCountForPath(path);
    return count ? ` <span class="file-problem-badge">${escapeHtml(count)}</span>` : "";
  }

  function problemBadgeCountForPath(path) {
    if (!path || !lintNotificationsVisible()) return 0;
    return currentDiagnosticIndex().countByFile.get(lintPathKey(path)) ?? 0;
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
    if (isJsonDocument(activeDoc())) {
      const id = activeDoc()?.activeDiagnosticId;
      return id && diagnosticsForDoc(activeDoc()).some((diagnostic) => diagnostic.id === id)
        ? new Set([id])
        : new Set();
    }
    const activeCell = currentGrid().editingCell?.() ?? state.selection.focus;
    return activeDiagnosticIdsForCell({
      diagnostics: diagnosticsForDoc(activeDoc()),
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
    copyDiagnostic,
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
    problemBadgeCountForPath,
    renderProblemsPanelIfNeeded,
    scrollProblemsToActiveFile,
    setLintDiagnostics,
    updateActiveProblemHighlight,
    updateGridDiagnostics,
    updateOverviewRuler,
    vectorLintDisplayActive
  };
}
