const lspDocumentStates = new WeakMap();

function createLspDocumentState() {
  return {
    version: 0,
    ready: false,
    opened: false,
    diagnosticsReady: false,
    hoverReady: false,
    openingUri: null,
    openingGeneration: 0,
    openedUri: null,
    openedVersion: null,
    syncedRevision: null,
    sessionGeneration: 0,
    openPromise: null,
    updatePromise: null,
    requiresFullSync: false,
    hoverReadyTimer: null,
    fullUpdateTimer: null
  };
}

export function lspDocumentState(doc) {
  if (!doc || typeof doc !== "object") return createLspDocumentState();
  let state = lspDocumentStates.get(doc);
  if (!state) {
    state = createLspDocumentState();
    lspDocumentStates.set(doc, state);
  }
  return state;
}

export function resetLspDocumentState(doc, { version = 0 } = {}) {
  const state = lspDocumentState(doc);
  if (state.hoverReadyTimer != null) clearTimeout(state.hoverReadyTimer);
  if (state.fullUpdateTimer != null) clearTimeout(state.fullUpdateTimer);
  Object.assign(state, createLspDocumentState(), { version });
  return state;
}

export function ensureLspDocumentVersion(doc, version = 1) {
  const state = lspDocumentState(doc);
  if (!state.version) state.version = version;
  return state.version;
}

export function nextLspDocumentVersion(doc) {
  const state = lspDocumentState(doc);
  state.version = (state.version ?? 0) + 1;
  return state.version;
}
