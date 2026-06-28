import {
  SEARCH_SCOPE_ALL,
  SEARCH_SCOPE_COLUMN_TITLES,
  SEARCH_SCOPE_ROW_TITLES,
  normalizeSearchScope
} from "../core/search.js";

export function initialSearchState() {
  return { lastQuery: "", lastScope: SEARCH_SCOPE_ALL };
}

export function searchStateAfterInput() {
  return { lastQuery: "", lastScope: SEARCH_SCOPE_ALL };
}

export function searchStateAfterFind(query, scope = SEARCH_SCOPE_ALL) {
  return { lastQuery: query, lastScope: normalizeSearchScope(scope) };
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
    return `Column C${target.column + 1} (header R${found.row + 1}:C${found.column + 1})`;
  }
  if (normalized === SEARCH_SCOPE_ROW_TITLES) {
    return `Row R${target.row + 1} (title R${found.row + 1}:C${found.column + 1})`;
  }
  return `R${target.row + 1}:C${target.column + 1}`;
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
