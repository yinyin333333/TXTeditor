export function initialSearchState() {
  return { lastQuery: "" };
}

export function searchStateAfterInput() {
  return { lastQuery: "" };
}

export function searchStateAfterFind(query) {
  return { lastQuery: query };
}

export function searchShouldIncludeStart(query, lastQuery) {
  return query !== lastQuery;
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
