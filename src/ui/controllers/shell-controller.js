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
  saveSelectionState = () => {},
  recordUiPerf,
  perfNow,
  showError,
  lintPathKey,
  escapeHtml,
  documentRef = document
}) {
  const collapsedFileGroups = new Set();
  let explorerSearchActiveIndex = 0;

  function renderChrome() {
    const started = perfNow();
    bindExplorerFilter();
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
      .map((doc, index) => `<button class="${index === state.active ? "active" : ""}" data-tab="${index}">${escapeHtml(doc.name)}${problemBadgeForPath(doc.path || doc.name)}</button>`)
      .join("") + (workspaceFiles ? `<div class="separator"></div>${workspaceFiles}` : "");
    renderProblemsPanelIfNeeded();
    for (const button of documentRef.querySelectorAll("[data-tab]")) {
      button.addEventListener("click", (event) => {
        if (event?.target?.closest("[data-close-tab]")) return;
        selectTab(Number(button.dataset.tab));
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
    renderExplorerSearchResults();
    recordUiPerf("render-chrome", started, { docs: state.docs.length });
  }

  function selectTab(index) {
    saveSelectionState();
    state.active = index;
    applyFreezeToDoc(activeDoc());
    grid.setDocument(activeDoc());
    updateGridDiagnostics();
    renderChrome();
    scrollProblemsToActiveFile();
    scheduleHoverPrewarm("tab-switch");
  }

  function bindExplorerFilter() {
    if (!els.explorerFilter || els.explorerFilter.dataset.bound) return;
    els.explorerFilter.dataset.bound = "true";
    els.explorerFilter.addEventListener("input", () => {
      explorerSearchActiveIndex = 0;
      renderExplorerSearchResults();
    });
    els.explorerFilter.addEventListener("keydown", (event) => {
      const results = explorerSearchResults();
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!results.length) return;
        event.preventDefault();
        explorerSearchActiveIndex = (explorerSearchActiveIndex + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length;
        renderExplorerSearchResults(results);
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      openExplorerSearchResult(results[explorerSearchActiveIndex] ?? results[0]);
    });
    els.explorerSearchResults?.addEventListener("mousedown", (event) => event.preventDefault());
    els.explorerSearchResults?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-explorer-search-index]");
      if (!button) return;
      openExplorerSearchResult(explorerSearchResults()[Number(button.dataset.explorerSearchIndex)]);
    });
  }

  function renderExplorerSearchResults(results = explorerSearchResults()) {
    if (!els.explorerSearchResults) return;
    if (!normalizedExplorerQuery(els.explorerFilter?.value) || !results.length) {
      els.explorerSearchResults.classList.add("hidden");
      els.explorerSearchResults.innerHTML = "";
      return;
    }
    explorerSearchActiveIndex = Math.min(explorerSearchActiveIndex, results.length - 1);
    els.explorerSearchResults.classList.remove("hidden");
    els.explorerSearchResults.innerHTML = results.map((result, index) => (
      `<button class="${index === explorerSearchActiveIndex ? "active" : ""}" data-explorer-search-index="${index}" type="button" role="option">${escapeHtml(result.name)}</button>`
    )).join("");
  }

  function openExplorerSearchResult(result) {
    if (!result) return;
    els.explorerFilter.value = "";
    renderExplorerSearchResults([]);
    if (result.index != null) return selectTab(result.index);
    openDroppedNativePaths([result.path]).catch(showError);
  }

  function explorerSearchResults() {
    const query = normalizedExplorerQuery(els.explorerFilter?.value);
    if (!query) return [];
    const openKeys = new Set(state.docs.map((doc) => lintPathKey(doc.path || "")));
    const candidates = [
      ...state.docs.map((doc, index) => ({ index, name: doc.name })),
      ...(state.workspace?.files ?? [])
        .filter((file) => !openKeys.has(lintPathKey(file.path || "")))
        .map((file) => ({ path: file.path, name: file.name }))
    ];
    return candidates
      .map((candidate) => ({ ...candidate, score: explorerMatchScore(candidate.name, query) }))
      .filter((candidate) => candidate.score >= 0)
      .sort((a, b) => a.score - b.score);
  }

  function explorerMatchScore(name, query) {
    const fileName = normalizedExplorerQuery(name);
    const stem = fileName.replace(/\.[^.]+$/, "");
    if (fileName === query || stem === query) return 0;
    if (fileName.startsWith(query) || stem.startsWith(query)) return 1;
    return fileName.includes(query) ? 2 : -1;
  }

  function normalizedExplorerQuery(value) {
    return String(value || "").trim().toLowerCase();
  }

  return {
    collapsedFileGroups,
    renderChrome
  };
}
