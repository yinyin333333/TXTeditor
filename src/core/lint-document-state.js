const legacyLintDocumentStates = new WeakMap();

function legacyLintDocumentState(doc) {
  if (!doc || typeof doc !== "object") return { version: 0 };
  let state = legacyLintDocumentStates.get(doc);
  if (!state) {
    state = { version: 0 };
    legacyLintDocumentStates.set(doc, state);
  }
  return state;
}

export function legacyLintDocumentVersion(doc) {
  return legacyLintDocumentState(doc).version;
}

export function markLegacyLintDocumentChanged(doc) {
  if (!doc) return 0;
  const state = legacyLintDocumentState(doc);
  state.version += 1;
  return state.version;
}
