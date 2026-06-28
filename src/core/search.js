export const SEARCH_SCOPE_ALL = "all";
export const SEARCH_SCOPE_COLUMN_TITLES = "column-titles";
export const SEARCH_SCOPE_ROW_TITLES = "row-titles";

export function normalizeSearchScope(scope) {
  if (scope === SEARCH_SCOPE_COLUMN_TITLES || scope === SEARCH_SCOPE_ROW_TITLES) return scope;
  return SEARCH_SCOPE_ALL;
}

export function findInTable(doc, query, start = { row: 0, column: 0 }, options = {}) {
  if (!query) return null;
  const needle = searchableText(query, options);
  const scope = normalizeSearchScope(options.scope);
  const total = searchCandidateCount(doc, scope);
  if (total <= 0) return null;
  const startIndex = searchStartIndex(doc, scope, start) + (options.includeStart ? 0 : 1);

  for (let step = 0; step < total; step++) {
    const index = (startIndex + step) % total;
    const { row, column } = searchCandidateAt(doc, scope, index);
    const raw = doc.getCell(row, column);
    const hay = searchableText(raw, options);
    if (hay.includes(needle)) return { row, column };
  }
  return null;
}

function searchCandidateCount(doc, scope) {
  if (scope === SEARCH_SCOPE_COLUMN_TITLES) return doc.rowCount > 0 ? doc.columnCount : 0;
  if (scope === SEARCH_SCOPE_ROW_TITLES) return doc.columnCount > 0 ? doc.rowCount : 0;
  return doc.rowCount * doc.columnCount;
}

function searchCandidateAt(doc, scope, index) {
  if (scope === SEARCH_SCOPE_COLUMN_TITLES) return { row: 0, column: index };
  if (scope === SEARCH_SCOPE_ROW_TITLES) return { row: index, column: 0 };
  return {
    row: Math.floor(index / doc.columnCount),
    column: index % doc.columnCount
  };
}

function searchStartIndex(doc, scope, start) {
  if (scope === SEARCH_SCOPE_COLUMN_TITLES) return clamp(start.column, 0, Math.max(0, doc.columnCount - 1));
  if (scope === SEARCH_SCOPE_ROW_TITLES) return clamp(start.row, 0, Math.max(0, doc.rowCount - 1));
  return clamp(start.row, 0, Math.max(0, doc.rowCount - 1)) * doc.columnCount
    + clamp(start.column, 0, Math.max(0, doc.columnCount - 1));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function searchableText(value, options = {}) {
  const text = String(value);
  return options.matchCase ? text : text.toLocaleLowerCase();
}
