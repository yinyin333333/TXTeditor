import { normalizePath } from "./lint-paths.js";

export function isJsonPath(path) {
  return /\.json$/i.test(String(path ?? ""));
}

export function localizationJsonDataRoot(path) {
  const normalized = normalizePath(path);
  const match = normalized.match(/^(.*\/data)\/local\/lng\/strings\/([^/]+\.json)$/i);
  return match ? match[1] : null;
}

export function excelTxtDataRoot(path) {
  const normalized = normalizePath(path);
  if (!/\.txt$/i.test(normalized)) return null;
  const match = normalized.match(/^(.*\/data)\/global\/excel(?:\/|$)/i);
  return match ? match[1] : null;
}

export function isEditableLocalizationJsonPath(path) {
  return Boolean(localizationJsonDataRoot(path));
}

export function jsonPrimaryDataRoots(state = {}) {
  const roots = new Set();
  const paths = [
    ...(state.docs ?? []).filter((doc) => doc?.kind !== "json").map((doc) => doc?.path),
    ...(state.workspace?.files ?? []).map((file) => file?.path)
  ].filter(Boolean);
  for (const path of paths) {
    if (!pathBelongsToPrimarySession(path, state)) continue;
    const root = excelTxtDataRoot(path);
    if (root) roots.add(root);
  }
  return roots;
}

export function isLocalizationJsonPathInCurrentMode(path, state = {}) {
  const root = localizationJsonDataRoot(path);
  if (!root) return false;
  const primaryRoots = jsonPrimaryDataRoots(state);
  if (primaryRoots.has(root)) return true;
  return (state.docs ?? []).some((doc) => doc?.kind === "json"
    && localizationJsonDataRoot(doc.path) === root
    && normalizePath(doc.path) === normalizePath(path));
}

export function canNavigateLocalizationJsonDiagnostic({
  diagnostic,
  state,
  editorReady = false,
  desktop = false
} = {}) {
  if (!desktop || !editorReady || !state?.lsp?.started) return false;
  if (!diagnostic?.filePath || diagnostic?.sourceExists === false) return false;
  if (Number(diagnostic.generation) !== Number(state.lsp.generation)) return false;
  return isLocalizationJsonPathInCurrentMode(diagnostic.filePath, state);
}

function pathBelongsToPrimarySession(path, state) {
  if (!state?.lsp?.started || !state.lsp.workspacePath) return true;
  const candidate = normalizePath(path);
  const root = normalizePath(state.lsp.workspacePath).replace(/\/$/, "");
  if (!root) return true;
  if (state.lsp.contextMode === "sibling") {
    return parentPath(candidate) === root;
  }
  if (state.lsp.includeSubfolders === false) return parentPath(candidate) === root;
  return candidate === root || candidate.startsWith(`${root}/`);
}

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}
