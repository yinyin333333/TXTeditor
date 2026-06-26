export const LINT_ENGINE_VECTOR = "vector-lsp";
export const LINT_ENGINE_LEGACY = "legacy";

export function normalizeLintEngine(value) {
  return value === LINT_ENGINE_LEGACY ? LINT_ENGINE_LEGACY : LINT_ENGINE_VECTOR;
}

export function isVectorLintEngineValue(engine) {
  return engine === LINT_ENGINE_VECTOR;
}

export function isLegacyLintEngineValue(engine) {
  return engine === LINT_ENGINE_LEGACY;
}

export function effectiveVectorLspHover({ engine, vectorLspHover }) {
  return isVectorLintEngineValue(engine) && Boolean(vectorLspHover);
}

export function vectorLspHoverFromStorage(value) {
  return value !== "off";
}

export function vectorLspHoverStorageValue(enabled) {
  return enabled ? "on" : "off";
}

export function documentChangeSyncRoute(engine) {
  return isVectorLintEngineValue(engine) ? "vector-update" : "legacy-lint-edit";
}

export function documentOpenSyncRoute(engine) {
  return isVectorLintEngineValue(engine) ? "vector-open" : "legacy-lint-open";
}

export function vectorSessionAvailable({ engine, lspStarted }) {
  return isVectorLintEngineValue(engine) && Boolean(lspStarted);
}

export function lintSettingsStorageValue({ enabled }) {
  return JSON.stringify({ enabled: Boolean(enabled) });
}

export function lintEngineStorageValue(engine) {
  return normalizeLintEngine(engine);
}

export function legacyLintSettingsStorageValue(settings) {
  return JSON.stringify(settings);
}

export function legacyLintEditSchedule({ displayActive, hasDiagnostics }) {
  if (!displayActive) return null;
  return {
    reason: hasDiagnostics ? "diagnostic-file-edited" : "file-edited",
    delay: hasDiagnostics ? 120 : 180
  };
}

export function legacyLintOpenSchedule(reason = "file-opened") {
  return { reason, delay: 0 };
}

export function legacyLintImmediateSchedule(reason) {
  return { reason, delay: 0 };
}
