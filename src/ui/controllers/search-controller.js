import { findInTable, normalizeSearchScope } from "../../core/search.js";
import {
  searchScrollOptionsForScope,
  searchShouldIncludeStart,
  searchStatusText,
  searchStateAfterFind,
  searchStateAfterInput,
  searchTargetForResult,
  shouldCloseSearchKey,
  shouldSubmitSearchKey
} from "../search-policy.js";

export function createSearchController({ state, els, grid, activeDoc, updateActiveProblemHighlight }) {
  function showSearch() {
    els.searchPanel.classList.remove("hidden");
    els.searchInput.focus();
    els.searchInput.select();
  }

  function closeSearch() {
    els.searchPanel.classList.add("hidden");
    els.host.focus();
  }

  function selectedSearchScope() {
    return normalizeSearchScope(
      els.searchPanel.querySelector("input[name='searchScope']:checked")?.value
    );
  }

  function findNext() {
    const query = els.searchInput.value;
    const scope = selectedSearchScope();
    const includeStart = searchShouldIncludeStart(query, scope, state.search.lastQuery, state.search.lastScope);
    const focus = state.selection.focus;
    const found = findInTable(activeDoc(), query, focus, { includeStart, scope });
    if (!found) {
      els.searchStatus.textContent = "No results";
      return;
    }
    const target = searchTargetForResult(scope, found, focus);
    Object.assign(state.search, searchStateAfterFind(query, scope));
    state.selection.set(target.row, target.column);
    grid.scrollCellIntoView(target.row, target.column, searchScrollOptionsForScope(scope));
    grid.draw();
    updateActiveProblemHighlight();
    els.searchStatus.textContent = searchStatusText(scope, found, target);
  }

  function wireEvents() {
    els.searchInput.addEventListener("keydown", (event) => {
      if (shouldSubmitSearchKey(event.key)) {
        event.preventDefault();
        findNext();
      }
      if (shouldCloseSearchKey(event.key)) {
        event.preventDefault();
        closeSearch();
      }
    });
    els.searchInput.addEventListener("input", () => {
      Object.assign(state.search, searchStateAfterInput());
    });
    els.searchPanel.querySelectorAll("input[name='searchScope']").forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (!shouldSubmitSearchKey(event.key)) return;
        event.preventDefault();
        findNext();
      });
      input.addEventListener("change", () => {
        Object.assign(state.search, searchStateAfterInput());
      });
    });
    els.searchPanel.addEventListener("click", (event) => {
      if (event.target === els.searchPanel || event.target.closest("[data-search-close]")) closeSearch();
    });
  }

  return {
    closeSearch,
    findNext,
    showSearch,
    wireEvents
  };
}
