export const SEARCH_SCOPE_ALL = "all";
export const SEARCH_SCOPE_COLUMN_TITLES = "column-titles";
export const SEARCH_SCOPE_ROW_TITLES = "row-titles";
export const SEARCH_DIRECTION_FORWARD = "forward";
export const SEARCH_DIRECTION_BACKWARD = "backward";

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
  const direction = normalizeSearchDirection(options.direction);
  const offset = options.includeStart ? 0 : direction === SEARCH_DIRECTION_BACKWARD ? -1 : 1;
  const startIndex = searchStartIndex(doc, scope, start) + offset;

  for (let step = 0; step < total; step++) {
    const delta = direction === SEARCH_DIRECTION_BACKWARD ? -step : step;
    const index = wrapIndex(startIndex + delta, total);
    const { row, column } = searchCandidateAt(doc, scope, index);
    const raw = doc.getCell(row, column);
    const hay = searchableText(raw, options);
    if (hay.includes(needle)) return { row, column };
  }
  return null;
}

export function replaceNextInTable(doc, query, replacement, start = { row: 0, column: 0 }, options = {}) {
  const found = findInTable(doc, query, start, { ...options, includeStart: true });
  if (!found) return { found: null, edits: [], replacementCount: 0 };
  const current = doc.getCell(found.row, found.column);
  const replaced = replaceText(current, query, replacement, { ...options, limit: 1 });
  return {
    found,
    edits: replaced.count ? [{ row: found.row, column: found.column, value: replaced.value }] : [],
    replacementCount: replaced.count
  };
}

export function replaceAllInTable(doc, query, replacement, options = {}) {
  if (!query) return { edits: [], replacementCount: 0 };
  const scope = normalizeSearchScope(options.scope);
  const edits = [];
  let replacementCount = 0;
  for (let index = 0; index < searchCandidateCount(doc, scope); index++) {
    const { row, column } = searchCandidateAt(doc, scope, index);
    const current = doc.getCell(row, column);
    const replaced = replaceText(current, query, replacement, options);
    if (!replaced.count) continue;
    edits.push({ row, column, value: replaced.value });
    replacementCount += replaced.count;
  }
  return { edits, replacementCount };
}

export function normalizeSearchDirection(direction) {
  return direction === SEARCH_DIRECTION_BACKWARD ? SEARCH_DIRECTION_BACKWARD : SEARCH_DIRECTION_FORWARD;
}

function wrapIndex(index, total) {
  return ((index % total) + total) % total;
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

function replaceText(value, query, replacement, options = {}) {
  const source = String(value);
  const needle = searchableText(query, options);
  if (!needle) return { value: source, count: 0 };
  const haystack = searchableText(source, options);
  const replacementText = String(replacement);
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : Number.POSITIVE_INFINITY;
  let cursor = 0;
  let count = 0;
  let result = "";
  while (cursor <= source.length && count < limit) {
    const match = haystack.indexOf(needle, cursor);
    if (match < 0) break;
    result += source.slice(cursor, match) + replacementText;
    cursor = match + String(query).length;
    count += 1;
  }
  if (!count) return { value: source, count: 0 };
  return { value: result + source.slice(cursor), count };
}
