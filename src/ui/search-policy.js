import {
  SEARCH_SCOPE_ALL,
  SEARCH_SCOPE_COLUMN_TITLES,
  SEARCH_SCOPE_ROW_TITLES,
  normalizeSearchScope
} from "../core/search.js";
import { tText } from "../core/i18n.js";

export function initialSearchState() {
  return { lastQuery: "", lastScope: SEARCH_SCOPE_ALL };
}

export function searchStateAfterInput() {
  return { lastQuery: "", lastScope: SEARCH_SCOPE_ALL };
}

export function searchStateAfterFind(query, scope = SEARCH_SCOPE_ALL) {
  return { lastQuery: query, lastScope: normalizeSearchScope(scope) };
}

export function clampSearchModalPosition({
  left = 0,
  top = 0,
  width = 0,
  height = 0,
  viewportWidth = 0,
  viewportHeight = 0,
  margin = 8
} = {}) {
  const safeMargin = Math.max(0, Number(margin) || 0);
  const maxLeft = Math.max(safeMargin, (Number(viewportWidth) || 0) - Math.max(0, Number(width) || 0) - safeMargin);
  const maxTop = Math.max(safeMargin, (Number(viewportHeight) || 0) - Math.max(0, Number(height) || 0) - safeMargin);
  return {
    left: Math.min(maxLeft, Math.max(safeMargin, Number(left) || 0)),
    top: Math.min(maxTop, Math.max(safeMargin, Number(top) || 0))
  };
}

export function searchShouldIncludeStart(query, scope, lastQuery, lastScope = SEARCH_SCOPE_ALL) {
  return query !== lastQuery || normalizeSearchScope(scope) !== normalizeSearchScope(lastScope);
}

export function searchTargetForResult(scope, found, focus) {
  const normalized = normalizeSearchScope(scope);
  if (normalized === SEARCH_SCOPE_COLUMN_TITLES) return { row: focus.row, column: found.column };
  if (normalized === SEARCH_SCOPE_ROW_TITLES) return { row: found.row, column: focus.column };
  return { row: found.row, column: found.column };
}

export function searchScrollOptionsForScope(scope) {
  const normalized = normalizeSearchScope(scope);
  if (normalized === SEARCH_SCOPE_COLUMN_TITLES) return { preserveScrollTop: true };
  if (normalized === SEARCH_SCOPE_ROW_TITLES) return { preserveScrollLeft: true };
  return {};
}

export function searchStatusText(scope, found, target) {
  const normalized = normalizeSearchScope(scope);
  if (normalized === SEARCH_SCOPE_COLUMN_TITLES) {
    return tText("search.columnStatus", { column: target.column + 1, headerRow: found.row + 1, headerColumn: found.column + 1 });
  }
  if (normalized === SEARCH_SCOPE_ROW_TITLES) {
    return tText("search.rowStatus", { row: target.row + 1, titleRow: found.row + 1, titleColumn: found.column + 1 });
  }
  return tText("search.cellStatus", { row: target.row + 1, column: target.column + 1 });
}

export function shouldSubmitSearchKey(key) {
  return key === "Enter";
}

export function shouldCloseSearchKey(key) {
  return key === "Escape";
}

export function isTextInputTarget(target, ElementCtor = globalThis.Element) {
  if (!ElementCtor || !(target instanceof ElementCtor)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}
