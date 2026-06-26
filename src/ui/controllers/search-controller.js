import { findInTable } from "../../core/search.js";
import {
  searchShouldIncludeStart,
  searchStateAfterFind,
  searchStateAfterInput,
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

  function findNext() {
    const query = els.searchInput.value;
    const includeStart = searchShouldIncludeStart(query, state.search.lastQuery);
    const found = findInTable(activeDoc(), query, state.selection.focus, { includeStart });
    if (!found) {
      els.searchStatus.textContent = "No results";
      return;
    }
    Object.assign(state.search, searchStateAfterFind(query));
    state.selection.set(found.row, found.column);
    grid.scrollCellIntoView(found.row, found.column);
    grid.draw();
    updateActiveProblemHighlight();
    els.searchStatus.textContent = `R${found.row + 1}:C${found.column + 1}`;
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
