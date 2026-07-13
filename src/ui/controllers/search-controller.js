import { findInTable, normalizeSearchScope } from "../../core/search.js";
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

export function createSearchController({ state, els, grid, activeDoc, updateActiveProblemHighlight, saveSelectionState = () => {} }) {
  const searchModalCandidate = els.searchPanel.querySelector?.(".search-modal");
  const searchModal = searchModalCandidate?.classList
    && typeof searchModalCandidate.getBoundingClientRect === "function"
    ? searchModalCandidate
    : null;
  const searchDragHandle = searchModal?.querySelector?.("[data-search-drag-handle]") ?? null;
  let searchDrag = null;

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
    if (!searchModal || event.button !== 0 || event.isPrimary === false) return;
    const rect = searchModal.getBoundingClientRect();
    searchDrag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    setSearchModalPosition(rect.left, rect.top);
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
  }

  function showSearch() {
    Object.assign(state.search, searchStateAfterInput());
    els.searchPanel.classList.remove("hidden");
    clampSearchModalToViewport();
    els.searchInput.focus();
    els.searchInput.select();
  }

  function closeSearch() {
    searchDrag = null;
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
    saveSelectionState();
    grid.scrollCellToCenter(target.row, target.column, searchScrollOptionsForScope(scope));
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
    els.searchPanel.addEventListener("wheel", (event) => {
      if (event.ctrlKey) return;
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
    findNext,
    showSearch,
    wireEvents
  };
}
