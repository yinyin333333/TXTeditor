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


export function searchMatchRange(value, query, options = {}) {
  return searchMatchRanges(value, query, options)[0] ?? null;
}

export function searchMatchRanges(value, query, options = {}) {
  if (!query) return [];
  const source = String(value);
  const haystack = searchableText(source, options);
  const needle = searchableText(query, options);
  const ranges = [];
  let start = haystack.indexOf(needle);
  while (start >= 0) {
    ranges.push({ start, end: start + String(query).length });
    start = haystack.indexOf(needle, start + Math.max(1, needle.length));
  }
  return ranges;
}

export async function findAllInTableAsync(doc, query, options = {}) {
  if (!query) return emptyFindAllResult();
  const scope = normalizeSearchScope(options.scope);
  const totalCandidates = searchCandidateCount(doc, scope);
  const batchSize = positiveInteger(options.batchSize, 1000);
  const maxResults = nonNegativeInteger(options.maxResults, 2000);
  const yieldControl = typeof options.yieldControl === "function" ? options.yieldControl : defaultYieldControl;
  const shouldContinue = typeof options.shouldContinue === "function" ? options.shouldContinue : () => true;
  const matches = [];
  let totalMatches = 0;

  for (let index = 0; index < totalCandidates; index++) {
    if (!shouldContinue()) return { matches, totalMatches, truncated: totalMatches > matches.length, canceled: true };
    const { row, column } = searchCandidateAt(doc, scope, index);
    const value = String(doc.getCell(row, column));
    const ranges = searchMatchRanges(value, query, options);
    totalMatches += ranges.length;
    for (const range of ranges) {
      if (matches.length < maxResults) matches.push({ row, column, value, ...range });
    }
    if ((index + 1) % batchSize === 0 && index + 1 < totalCandidates) {
      await yieldControl();
    }
  }

  return { matches, totalMatches, truncated: totalMatches > matches.length, canceled: false };
}

export function findInText(text, query, startOffset = 0, options = {}) {
  if (!query) return null;
  const source = String(text);
  const haystack = searchableText(source, options);
  const needle = searchableText(query, options);
  const direction = normalizeSearchDirection(options.direction);
  const maxStart = Math.max(0, haystack.length - needle.length);
  const numericStart = Number(startOffset);
  const requestedStart = Number.isFinite(numericStart) ? numericStart : 0;
  let start;

  if (direction === SEARCH_DIRECTION_BACKWARD) {
    start = requestedStart < 0 ? -1 : haystack.lastIndexOf(needle, Math.min(maxStart, requestedStart));
    if (start < 0) start = haystack.lastIndexOf(needle);
  } else {
    start = haystack.indexOf(needle, clamp(requestedStart, 0, haystack.length));
    if (start < 0) start = haystack.indexOf(needle, 0);
  }
  if (start < 0) return null;
  return { start, end: start + String(query).length };
}

export async function findAllInTextAsync(text, query, options = {}) {
  if (!query) return emptyFindAllResult();
  const source = String(text);
  const haystack = searchableText(source, options);
  const needle = searchableText(query, options);
  const chunkSize = positiveInteger(options.chunkSize, 131072);
  const maxResults = nonNegativeInteger(options.maxResults, 2000);
  const yieldControl = typeof options.yieldControl === "function" ? options.yieldControl : defaultYieldControl;
  const shouldContinue = typeof options.shouldContinue === "function" ? options.shouldContinue : () => true;
  const matches = [];
  let totalMatches = 0;
  let cursor = 0;

  while (cursor <= haystack.length - needle.length) {
    if (!shouldContinue()) return { matches, totalMatches, truncated: totalMatches > matches.length, canceled: true };
    const ownedEnd = Math.min(haystack.length, cursor + chunkSize);
    let match = haystack.indexOf(needle, cursor);
    while (match >= 0 && match < ownedEnd) {
      totalMatches += 1;
      if (matches.length < maxResults) matches.push({ start: match, end: match + String(query).length });
      match = haystack.indexOf(needle, match + Math.max(1, needle.length));
    }
    if (ownedEnd >= haystack.length) break;
    cursor = ownedEnd;
    await yieldControl();
  }

  return { matches, totalMatches, truncated: totalMatches > matches.length, canceled: false };
}

export function textLineStarts(text) {
  const source = String(text);
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

export function textLineColumn(lineStarts, offset) {
  const starts = Array.isArray(lineStarts) && lineStarts.length ? lineStarts : [0];
  const target = Math.max(0, Number(offset) || 0);
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (starts[middle] <= target) low = middle + 1;
    else high = middle - 1;
  }
  const lineIndex = Math.max(0, high);
  return { line: lineIndex + 1, column: target - starts[lineIndex] + 1 };
}

export function searchSnippet(value, start = 0, end = start, maxLength = 96) {
  const source = String(value);
  const safeMax = Math.max(16, Number(maxLength) || 96);
  const matchStart = clamp(Number(start) || 0, 0, source.length);
  const matchEnd = clamp(Number(end) || matchStart, matchStart, source.length);
  let sliceStart = Math.max(0, matchStart - Math.floor((safeMax - Math.min(safeMax, matchEnd - matchStart)) / 2));
  let sliceEnd = Math.min(source.length, sliceStart + safeMax);
  sliceStart = Math.max(0, sliceEnd - safeMax);
  const prefix = sliceStart > 0 ? "…" : "";
  const suffix = sliceEnd < source.length ? "…" : "";
  return `${prefix}${source.slice(sliceStart, sliceEnd).replace(/\r\n?|\n/g, " ")}${suffix}`;
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

function emptyFindAllResult() {
  return { matches: [], totalMatches: 0, truncated: false, canceled: false };
}

function positiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function defaultYieldControl() {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
