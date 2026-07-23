import { documentRevision, isJsonDocument } from "../../core/document-file-state.js";
import {
  SEARCH_DIRECTION_BACKWARD,
  SEARCH_DIRECTION_FORWARD,
  SEARCH_SCOPE_ALL,
  findAllInTableAsync,
  findAllInTextAsync,
  findInTable,
  findInText,
  normalizeSearchScope,
  replaceAllInTable,
  replaceNextInTable,
  searchSnippet,
  textLineColumn,
  textLineStarts
} from "../../core/search.js";
import {
  clampSearchModalPosition,
  searchScrollOptionsForScope,
  searchShouldIncludeStart,
  searchStatusText,
  searchStateAfterFind,
  searchStateAfterInput,
  searchTargetForResult,
  shouldCloseSearchKey,
  shouldSubmitSearchKey
} from "../search-policy.js";
import { tText } from "../../core/i18n.js";

const FIND_ALL_RESULT_LIMIT = 2000;

export function createSearchController({
  state,
  els,
  grid,
  activeDoc,
  updateActiveProblemHighlight,
  saveSelectionState = () => {},
  applyEdits = () => {},
  jsonSearch = null,
  selectTableMatch = () => {},
  escapeHtml = defaultEscapeHtml,
  focusActiveEditor = () => els.host.focus()
}) {
  const searchModalCandidate = els.searchPanel.querySelector?.(".search-modal");
  const searchModal = searchModalCandidate?.classList
    && typeof searchModalCandidate.getBoundingClientRect === "function"
    ? searchModalCandidate
    : null;
  const searchDragHandle = searchModal?.querySelector?.("[data-search-drag-handle]") ?? null;
  let searchDrag = null;
  let findAllGeneration = 0;
  let findAllState = null;
  let findAllPendingSnapshot = null;
  let activeResultIndex = -1;

  function viewportSize() {
    return {
      viewportWidth: Number(globalThis.window?.innerWidth)
        || Number(globalThis.document?.documentElement?.clientWidth)
        || 0,
      viewportHeight: Number(globalThis.window?.innerHeight)
        || Number(globalThis.document?.documentElement?.clientHeight)
        || 0
    };
  }

  function setSearchModalPosition(left, top) {
    if (!searchModal) return;
    const rect = searchModal.getBoundingClientRect();
    const next = clampSearchModalPosition({
      left,
      top,
      width: rect.width,
      height: rect.height,
      ...viewportSize()
    });
    searchModal.classList.add("search-modal-positioned");
    searchModal.style.left = `${Math.round(next.left)}px`;
    searchModal.style.top = `${Math.round(next.top)}px`;
  }

  function clampSearchModalToViewport() {
    if (els.searchPanel.classList.contains("hidden")) return;
    if (!searchModal?.classList.contains("search-modal-positioned")) return;
    const rect = searchModal.getBoundingClientRect();
    setSearchModalPosition(rect.left, rect.top);
  }

  function beginSearchDrag(event) {
    if (!searchModal || event.button !== 0 || event.isPrimary === false || isInteractiveDragTarget(event.target)) return;
    const rect = searchModal.getBoundingClientRect();
    searchDrag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    setSearchModalPosition(rect.left, rect.top);
    searchModal.classList.add("search-modal-dragging");
    event.preventDefault();
    if (Number.isFinite(event.pointerId)) event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveSearchDrag(event) {
    if (!searchDrag || event.pointerId !== searchDrag.pointerId) return;
    event.preventDefault();
    setSearchModalPosition(
      event.clientX - searchDrag.offsetX,
      event.clientY - searchDrag.offsetY
    );
  }

  function endSearchDrag(event) {
    if (!searchDrag || event.pointerId !== searchDrag.pointerId) return;
    if (Number.isFinite(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
    searchDrag = null;
    searchModal?.classList.remove("search-modal-dragging");
  }

  function showSearch() {
    const doc = activeDoc();
    setReplaceMode(false);
    setJsonSearchMode(isJsonDocument(doc));
    Object.assign(state.search, searchStateAfterInput());
    els.searchPanel.classList.remove("hidden");
    clampSearchModalToViewport();
    els.searchInput.focus();
    els.searchInput.select();
  }

  function showReplace() {
    if (isJsonDocument(activeDoc())) return jsonSearch?.openReplace?.();
    setJsonSearchMode(false);
    setReplaceMode(true);
    Object.assign(state.search, searchStateAfterInput());
    els.searchPanel.classList.remove("hidden");
    clampSearchModalToViewport();
    els.searchInput.focus();
    els.searchInput.select();
  }

  function setJsonSearchMode(enabled) {
    setElementHidden(els.searchScope, enabled);
    if (els.searchInput) {
      els.searchInput.placeholder = tText(enabled ? "search.placeholderJson" : "search.placeholder");
    }
  }

  function setReplaceMode(enabled) {
    if (els.searchTitle) els.searchTitle.textContent = enabled ? tText("search.findReplace") : tText("search.title");
    setElementHidden(els.searchReplaceRow, !enabled);
    setElementHidden(els.searchReplaceActions, !enabled);
  }

  function closeSearch() {
    searchDrag = null;
    searchModal?.classList.remove("search-modal-dragging");
    findAllGeneration += 1;
    findAllPendingSnapshot = null;
    els.searchPanel.classList.add("hidden");
    focusActiveEditor();
  }

  function selectedSearchScope() {
    return normalizeSearchScope(
      els.searchPanel.querySelector("input[name='searchScope']:checked")?.value
    );
  }

  function matchCaseEnabled() {
    return Boolean(els.searchMatchCase?.checked);
  }

  function find(direction = SEARCH_DIRECTION_FORWARD) {
    return isJsonDocument(activeDoc()) ? findInJson(direction) : findInTableDocument(direction);
  }

  function findInTableDocument(direction) {
    const query = els.searchInput.value;
    const scope = selectedSearchScope();
    const includeStart = searchShouldIncludeStart(query, scope, state.search.lastQuery, state.search.lastScope);
    const focus = state.selection.focus;
    const found = findInTable(activeDoc(), query, focus, {
      direction,
      includeStart,
      matchCase: matchCaseEnabled(),
      scope
    });
    if (!found) {
      els.searchStatus.textContent = tText("search.noResults");
      return null;
    }
    const target = searchTargetForResult(scope, found, focus);
    Object.assign(state.search, searchStateAfterFind(query, scope));
    state.selection.set(target.row, target.column);
    saveSelectionState();
    grid.notifySelectionChanged?.("search-result");
    grid.scrollCellToCenter(target.row, target.column, searchScrollOptionsForScope(scope));
    grid.draw();
    updateActiveProblemHighlight();
    els.searchStatus.textContent = searchStatusText(scope, found, target);
    return found;
  }

  function findInJson(direction) {
    const query = els.searchInput.value;
    const snapshot = jsonSearch?.searchSnapshot?.();
    if (!snapshot || !query) {
      els.searchStatus.textContent = tText("search.noResults");
      return null;
    }
    const scope = SEARCH_SCOPE_ALL;
    const includeStart = searchShouldIncludeStart(query, scope, state.search.lastQuery, state.search.lastScope);
    const startOffset = direction === SEARCH_DIRECTION_BACKWARD
      ? (includeStart ? snapshot.from : snapshot.from - 1)
      : (includeStart ? snapshot.from : snapshot.to);
    const found = findInText(snapshot.text, query, startOffset, {
      direction,
      matchCase: matchCaseEnabled()
    });
    if (!found) {
      els.searchStatus.textContent = tText("search.noResults");
      return null;
    }
    Object.assign(state.search, searchStateAfterFind(query, scope));
    jsonSearch?.selectSearchRange?.(found);
    const location = textLineColumn(textLineStarts(snapshot.text), found.start);
    els.searchStatus.textContent = tText("search.jsonResultLocation", location);
    return found;
  }

  function findNext() {
    return find(SEARCH_DIRECTION_FORWARD);
  }

  function findPrevious() {
    return find(SEARCH_DIRECTION_BACKWARD);
  }

  async function findAll() {
    const doc = activeDoc();
    const query = String(els.searchInput.value ?? "");
    if (!query) {
      clearFindAllResults();
      els.searchStatus.textContent = tText("search.noResults");
      return 0;
    }

    const generation = ++findAllGeneration;
    const kind = isJsonDocument(doc) ? "json" : "table";
    const scope = kind === "json" ? SEARCH_SCOPE_ALL : selectedSearchScope();
    const matchCase = matchCaseEnabled();
    const snapshot = {
      doc,
      revision: documentRevision(doc),
      kind,
      query,
      scope,
      matchCase
    };
    findAllState = null;
    findAllPendingSnapshot = snapshot;
    activeResultIndex = -1;
    setElementHidden(els.searchResultsSummary, false);
    setElementHidden(els.searchResults, true);
    if (els.searchResultsSummary) {
      els.searchResultsSummary.classList?.remove("stale");
      els.searchResultsSummary.textContent = tText("search.searching");
    }
    if (els.searchStatus) els.searchStatus.textContent = "";

    let collected;
    let results;
    if (kind === "json") {
      const editorSnapshot = jsonSearch?.searchSnapshot?.();
      if (!editorSnapshot) {
        clearFindAllResults();
        els.searchStatus.textContent = tText("search.noResults");
        return 0;
      }
      const starts = textLineStarts(editorSnapshot.text);
      collected = await findAllInTextAsync(editorSnapshot.text, query, {
        matchCase,
        maxResults: FIND_ALL_RESULT_LIMIT,
        shouldContinue: () => generation === findAllGeneration
      });
      results = collected.matches.map((match) => ({
        ...match,
        location: textLineColumn(starts, match.start),
        snippet: searchSnippet(editorSnapshot.text, match.start, match.end)
      }));
    } else {
      collected = await findAllInTableAsync(doc, query, {
        matchCase,
        maxResults: FIND_ALL_RESULT_LIMIT,
        scope,
        shouldContinue: () => generation === findAllGeneration
      });
      results = collected.matches.map((match) => ({
        ...match,
        snippet: searchSnippet(match.value, match.start, match.end)
      }));
    }

    if (collected.canceled || generation !== findAllGeneration) return 0;
    findAllPendingSnapshot = null;
    findAllState = {
      snapshot,
      results,
      totalMatches: collected.totalMatches,
      truncated: collected.truncated,
      stale: false
    };
    renderFindAllResults();
    return collected.totalMatches;
  }

  function renderFindAllResults() {
    if (!findAllState) return clearFindAllResults();
    const { results, totalMatches, truncated, snapshot } = findAllState;
    const summary = truncated
      ? tText("search.resultCountLimited", { shown: results.length, count: totalMatches })
      : tText("search.resultCount", { count: totalMatches });
    if (els.searchResultsSummary) {
      els.searchResultsSummary.textContent = summary;
      els.searchResultsSummary.classList?.remove("stale");
      els.searchResultsSummary.removeAttribute?.("aria-disabled");
    }
    setElementHidden(els.searchResultsSummary, false);
    if (!results.length) {
      setElementHidden(els.searchResults, true);
      els.searchStatus.textContent = tText("search.noResults");
      clampSearchModalToViewport();
      return;
    }

    if (els.searchResults) {
      els.searchResults.innerHTML = results.map((result, index) => resultMarkup(snapshot, result, index)).join("");
      els.searchResults.classList?.remove("stale");
      els.searchResults.removeAttribute?.("aria-disabled");
      els.searchResults.removeAttribute?.("aria-activedescendant");
    }
    setElementHidden(els.searchResults, false);
    clampSearchModalToViewport();
  }

  function resultMarkup(snapshot, result, index) {
    const documentName = escapeHtml(snapshot.doc?.name || snapshot.doc?.path || "");
    let location;
    if (snapshot.kind === "json") {
      location = tText("search.jsonResultLocation", result.location);
    } else {
      const header = String(snapshot.doc.getCell(0, result.column) || `C${result.column + 1}`);
      location = tText("search.tableResultLocation", { row: result.row + 1, column: header });
    }
    return `<div id="searchResult-${index}" class="search-result-item" role="option" aria-selected="false" data-search-result-index="${index}" tabindex="-1"><span class="search-result-file">${documentName}</span><span class="search-result-location">${escapeHtml(location)}</span><span class="search-result-snippet">${escapeHtml(result.snippet)}</span></div>`;
  }

  function clearFindAllResults() {
    findAllState = null;
    findAllPendingSnapshot = null;
    activeResultIndex = -1;
    if (els.searchResults) {
      els.searchResults.innerHTML = "";
      els.searchResults.removeAttribute?.("aria-activedescendant");
      els.searchResults.classList?.remove("stale");
    }
    if (els.searchResultsSummary) {
      els.searchResultsSummary.textContent = "";
      els.searchResultsSummary.classList?.remove("stale");
    }
    setElementHidden(els.searchResults, true);
    setElementHidden(els.searchResultsSummary, true);
  }

  function currentConditionsMatch(snapshot) {
    const doc = activeDoc();
    if (!snapshot || doc !== snapshot.doc || documentRevision(doc) !== snapshot.revision) return false;
    if (String(els.searchInput.value ?? "") !== snapshot.query) return false;
    if (matchCaseEnabled() !== snapshot.matchCase) return false;
    const scope = isJsonDocument(doc) ? SEARCH_SCOPE_ALL : selectedSearchScope();
    return scope === snapshot.scope && (isJsonDocument(doc) ? "json" : "table") === snapshot.kind;
  }

  function invalidateFindAllResults(doc = null) {
    findAllGeneration += 1;
    const pendingMatches = findAllPendingSnapshot && (!doc || findAllPendingSnapshot.doc === doc);
    if (pendingMatches) findAllPendingSnapshot = null;
    const completedMatches = findAllState && (!doc || findAllState.snapshot.doc === doc);
    if (!completedMatches && !pendingMatches) return;
    if (completedMatches) findAllState.stale = true;
    activeResultIndex = -1;
    if (els.searchResultsSummary) {
      els.searchResultsSummary.textContent = tText("search.resultsStale");
      els.searchResultsSummary.classList?.add("stale");
      els.searchResultsSummary.setAttribute?.("aria-disabled", "true");
    }
    if (els.searchResults) {
      els.searchResults.classList?.add("stale");
      els.searchResults.setAttribute?.("aria-disabled", "true");
      els.searchResults.removeAttribute?.("aria-activedescendant");
    }
  }

  function navigateToResult(index) {
    const numericIndex = Number(index);
    const result = findAllState?.results?.[numericIndex];
    if (!result || findAllState.stale || !currentConditionsMatch(findAllState.snapshot)) {
      invalidateFindAllResults();
      return false;
    }
    activeResultIndex = numericIndex;
    syncActiveResult(false);
    if (findAllState.snapshot.kind === "json") {
      return Boolean(jsonSearch?.selectSearchRange?.(result));
    }
    state.selection.set(result.row, result.column);
    saveSelectionState();
    grid.notifySelectionChanged?.("search-all-result");
    grid.scrollCellToCenter(result.row, result.column);
    grid.draw();
    updateActiveProblemHighlight();
    selectTableMatch(result.start, result.end);
    return true;
  }

  function setActiveResult(index, focus = false) {
    const count = findAllState?.results?.length ?? 0;
    if (!count || findAllState?.stale) return false;
    activeResultIndex = ((Number(index) % count) + count) % count;
    syncActiveResult(focus);
    return true;
  }

  function syncActiveResult(focus) {
    const items = els.searchResults?.querySelectorAll?.("[data-search-result-index]") ?? [];
    for (const item of items) {
      const active = Number(item.dataset?.searchResultIndex) === activeResultIndex;
      item.classList?.toggle?.("active", active);
      item.setAttribute?.("aria-selected", active ? "true" : "false");
      if (active) {
        els.searchResults?.setAttribute?.("aria-activedescendant", item.id);
        if (focus) item.focus?.();
      }
    }
  }

  function handleResultKeydown(event) {
    if (shouldCloseSearchKey(event.key)) {
      event.preventDefault();
      closeSearch();
      return;
    }
    const count = findAllState?.results?.length ?? 0;
    if (!count || findAllState?.stale) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResult(activeResultIndex < 0 ? 0 : activeResultIndex + 1, true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResult(activeResultIndex < 0 ? count - 1 : activeResultIndex - 1, true);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveResult(0, true);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveResult(count - 1, true);
    } else if (event.key === "Enter" && activeResultIndex >= 0) {
      event.preventDefault();
      navigateToResult(activeResultIndex);
    }
  }

  function replaceNext() {
    if (isJsonDocument(activeDoc())) return jsonSearch?.openReplace?.();
    const query = els.searchInput.value;
    const scope = selectedSearchScope();
    const focus = state.selection.focus;
    const result = replaceNextInTable(activeDoc(), query, els.searchReplaceInput?.value ?? "", focus, {
      matchCase: matchCaseEnabled(),
      scope
    });
    if (!result.found || !result.replacementCount) {
      els.searchStatus.textContent = tText("search.noResults");
      return false;
    }
    applyEdits(result.edits, "Replace");
    invalidateFindAllResults(activeDoc());
    const target = searchTargetForResult(scope, result.found, focus);
    Object.assign(state.search, searchStateAfterFind(query, scope));
    state.selection.set(target.row, target.column);
    saveSelectionState();
    grid.notifySelectionChanged?.("search-result");
    grid.scrollCellToCenter(target.row, target.column, searchScrollOptionsForScope(scope));
    grid.draw();
    updateActiveProblemHighlight();
    els.searchStatus.textContent = tText("search.replacedOne", { location: searchStatusText(scope, result.found, target) });
    return true;
  }

  function replaceAll() {
    if (isJsonDocument(activeDoc())) return jsonSearch?.openReplace?.();
    const query = els.searchInput.value;
    const scope = selectedSearchScope();
    const result = replaceAllInTable(activeDoc(), query, els.searchReplaceInput?.value ?? "", {
      matchCase: matchCaseEnabled(),
      scope
    });
    if (!result.replacementCount) {
      els.searchStatus.textContent = tText("search.noResults");
      return 0;
    }
    applyEdits(result.edits, "Replace All");
    invalidateFindAllResults(activeDoc());
    Object.assign(state.search, searchStateAfterInput());
    saveSelectionState();
    grid.draw();
    updateActiveProblemHighlight();
    const cells = result.edits.length;
    els.searchStatus.textContent = tText("search.replacedMany", { matches: result.replacementCount, matchWord: tText(result.replacementCount === 1 ? "search.match" : "search.matches"), cells, cellWord: tText(cells === 1 ? "search.cell" : "search.cells") });
    return result.replacementCount;
  }

  function submitSearch(event) {
    if (!shouldSubmitSearchKey(event.key)) return false;
    event.preventDefault();
    if (event.shiftKey) findPrevious();
    else findNext();
    return true;
  }

  function resetSearchConditions() {
    Object.assign(state.search, searchStateAfterInput());
    invalidateFindAllResults();
  }

  function wireEvents() {
    els.searchInput.addEventListener("keydown", (event) => {
      submitSearch(event);
      if (shouldCloseSearchKey(event.key)) {
        event.preventDefault();
        closeSearch();
      }
    });
    els.searchInput.addEventListener("input", resetSearchConditions);
    els.searchReplaceInput?.addEventListener("keydown", (event) => {
      if (shouldSubmitSearchKey(event.key)) {
        event.preventDefault();
        replaceNext();
      }
      if (shouldCloseSearchKey(event.key)) {
        event.preventDefault();
        closeSearch();
      }
    });
    els.searchPanel.querySelectorAll("input[name='searchScope']").forEach((input) => {
      input.addEventListener("keydown", submitSearch);
      input.addEventListener("change", resetSearchConditions);
    });
    els.searchMatchCase?.addEventListener("keydown", submitSearch);
    els.searchMatchCase?.addEventListener("change", resetSearchConditions);
    els.searchResults?.addEventListener("keydown", handleResultKeydown);
    els.searchPanel.addEventListener("click", (event) => {
      const resultItem = event.target?.closest?.("[data-search-result-index]");
      if (resultItem) navigateToResult(resultItem.dataset.searchResultIndex);
      if (event.target?.closest?.("[data-search-previous]")) findPrevious();
      if (event.target?.closest?.("[data-search-find-all]")) void findAll();
      if (event.target?.closest?.("[data-search-replace]")) replaceNext();
      if (event.target?.closest?.("[data-search-replace-all]")) replaceAll();
      if (event.target === els.searchPanel || event.target?.closest?.("[data-search-close]")) closeSearch();
    });
    els.searchPanel.addEventListener("wheel", (event) => {
      if (event.ctrlKey || event.target?.closest?.(".search-results")) return;
      event.preventDefault();
      grid.scrollByWheel(event);
    }, { passive: false });
    searchDragHandle?.addEventListener("pointerdown", beginSearchDrag);
    searchDragHandle?.addEventListener("pointermove", moveSearchDrag);
    searchDragHandle?.addEventListener("pointerup", endSearchDrag);
    searchDragHandle?.addEventListener("pointercancel", endSearchDrag);
    globalThis.window?.addEventListener?.("resize", clampSearchModalToViewport);
  }

  return {
    closeSearch,
    findAll,
    findNext,
    findPrevious,
    invalidateFindAllResults,
    navigateToResult,
    notifyDocumentActivated: () => invalidateFindAllResults(),
    notifyDocumentChanged: (doc) => invalidateFindAllResults(doc),
    replaceAll,
    replaceNext,
    showReplace,
    showSearch,
    wireEvents
  };
}

function isInteractiveDragTarget(target) {
  return Boolean(target?.closest?.("input, button, select, textarea, a, [contenteditable='true']"));
}

function setElementHidden(element, hidden) {
  if (!element?.classList) return;
  if (hidden) element.classList.add("hidden");
  else element.classList.remove("hidden");
}

function defaultEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
