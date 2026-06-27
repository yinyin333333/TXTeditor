import { renderWorkspaceFileList } from "../workspace-file-list-policy.js";

export function createShellController({
  state,
  els,
  grid,
  activeDoc,
  hasOpenDocument,
  applyFreezeToDoc,
  closeTab,
  openDroppedNativePaths,
  updateGridDiagnostics,
  renderProblemsPanelIfNeeded,
  scrollProblemsToActiveFile,
  docDiagnosticSeverity,
  lintSummaryText,
  problemBadgeForPath,
  lintNotificationCount,
  renderLintControls,
  syncDockLayout,
  syncProblemsHeaderLayout,
  scheduleHoverPrewarm,
  commitActiveCellEditor,
  recordUiPerf,
  perfNow,
  showError,
  lintPathKey,
  escapeHtml,
  documentRef = document
}) {
  const collapsedFileGroups = new Set();

  function renderChrome() {
    const started = perfNow();
    syncDockLayout();
    els.shell.classList.toggle("sidebar-hidden", !state.sidebarVisible);
    els.shell.classList.toggle("problems-open", state.problemsVisible);
    els.sidebar?.classList.toggle("hidden", !state.sidebarVisible);
    els.problemsPanel?.classList.toggle("hidden", !state.problemsVisible);
    for (const btn of documentRef.querySelectorAll("[data-bottom-tab]")) {
      btn.classList.toggle("active", btn.dataset.bottomTab === state.bottomTab);
    }
    if (els.problemsList) els.problemsList.classList.toggle("hidden", state.bottomTab !== "problems");
    if (els.logList) els.logList.classList.toggle("hidden", state.bottomTab !== "log");
    els.emptyState.classList.toggle("hidden", hasOpenDocument());
    updateGridDiagnostics();
    for (const button of documentRef.querySelectorAll("[data-command='show-explorer']")) {
      button.classList.toggle("active", state.sidebarVisible);
      const count = lintNotificationCount();
      if (count) {
        button.dataset.badge = String(count);
        button.title = `Explorer (${count} problems)`;
      } else {
        delete button.dataset.badge;
        button.title = "Explorer";
      }
    }
    for (const button of documentRef.querySelectorAll("[data-command='show-problems']")) {
      button.classList.toggle("active", state.problemsVisible);
      button.textContent = "P";
      button.title = state.lint.diagnostics.length ? `Problems (${state.lint.diagnostics.length})` : "Problems";
    }
    for (const button of documentRef.querySelectorAll("[data-command='toggle-freeze-row']")) {
      button.classList.toggle("active", state.freezeRow);
    }
    for (const button of documentRef.querySelectorAll("[data-command='toggle-freeze-column']")) {
      button.classList.toggle("active", state.freezeColumn);
    }
    for (const button of documentRef.querySelectorAll("[data-command='toggle-colorize']")) {
      button.classList.toggle("active", state.colorizeColumns);
    }
    renderLintControls();
    for (const button of documentRef.querySelectorAll("[data-command='toggle-lint']")) {
      button.classList.toggle("active", state.lint.enabled);
      button.textContent = state.lint.enabled ? "Lint: On" : "Lint: Off";
    }
    for (const button of documentRef.querySelectorAll("[data-command='toggle-theme']")) {
      button.textContent = state.theme === "dark" ? "Light Mode" : "Dark Mode";
      button.classList.remove("active");
    }
    if (els.lintSummary) els.lintSummary.textContent = lintSummaryText();
    syncProblemsHeaderLayout();
    els.tabs.innerHTML = state.docs
      .map((doc, index) => {
        const severity = docDiagnosticSeverity(doc);
        const titleClass = severity ? `tab-title tab-title-${severity}` : "tab-title";
        return `<button class="${index === state.active ? "active" : ""}" data-tab="${index}"><span class="${titleClass}">${escapeHtml(doc.name)}${doc.dirty ? "*" : ""}</span><span class="tab-close" data-close-tab="${index}" title="Close">x</span></button>`;
      })
      .join("");
    const workspaceFiles = renderWorkspaceFileList({
      workspace: state.workspace,
      docs: state.docs,
      collapsedFileGroups,
      pathKey: lintPathKey,
      escapeHtml,
      problemBadgeForPath
    });
    els.fileList.innerHTML = state.docs
      .map((doc, index) => `<button class="${index === state.active ? "active" : ""}" data-tab="${index}">${escapeHtml(doc.name)}${problemBadgeForPath(doc.fileKey || doc.path || doc.name)}</button>`)
      .join("") + (workspaceFiles ? `<div class="separator"></div>${workspaceFiles}` : "");
    renderProblemsPanelIfNeeded();
    for (const button of documentRef.querySelectorAll("[data-tab]")) {
      button.addEventListener("click", (event) => {
        if (event?.target?.closest("[data-close-tab]")) return;
        commitActiveCellEditor?.();
        state.active = Number(button.dataset.tab);
        state.selection.set(0, 0);
        applyFreezeToDoc(activeDoc());
        grid.setDocument(activeDoc());
        updateGridDiagnostics();
        renderChrome();
        scrollProblemsToActiveFile();
        scheduleHoverPrewarm("tab-switch");
      });
    }
    for (const button of documentRef.querySelectorAll("[data-close-tab]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        closeTab(Number(button.dataset.closeTab)).catch(showError);
      });
    }
    for (const button of documentRef.querySelectorAll("[data-open-path]")) {
      button.addEventListener("click", async () => openDroppedNativePaths([button.dataset.openPath]).catch(showError));
    }
    for (const details of els.fileList.querySelectorAll("details[data-file-group]")) {
      details.addEventListener("toggle", () => {
        const group = details.dataset.fileGroup;
        if (details.open) collapsedFileGroups.delete(group);
        else collapsedFileGroups.add(group);
      });
    }
    recordUiPerf("render-chrome", started, { docs: state.docs.length });
  }

  return {
    collapsedFileGroups,
    renderChrome
  };
}
