import { normalizePath } from "./lint-paths.js";

export function legacySiblingContextTargets(openDocuments = [], workspacePath = "", options = {}) {
  const targetsByParent = new Map();
  for (const doc of openDocuments) {
    const filePath = String(doc?.path ?? "").trim();
    const parentKey = legacySiblingContextParentKey(doc, workspacePath, options);
    if (!parentKey || targetsByParent.has(parentKey)) continue;
    targetsByParent.set(parentKey, { filePath, parentKey });
  }
  return [...targetsByParent.values()];
}

export function legacySiblingContextParentKey(doc, workspacePath = "", { includeSubfolders = true } = {}) {
  const filePath = String(doc?.path ?? "").trim();
  if (!isAbsoluteTxtPath(filePath)) return "";
  const fileKey = normalizePath(filePath);
  const workspaceKey = normalizedDirectoryKey(workspacePath);
  if (workspaceKey && isWithinDirectory(fileKey, workspaceKey)
    && (includeSubfolders || parentDirectoryKey(fileKey) === workspaceKey)) return "";
  return parentDirectoryKey(fileKey);
}

export function isLegacyLintWorkspaceDocument(doc, workspacePath = "", { includeSubfolders = true } = {}) {
  const filePath = String(doc?.path ?? "").trim();
  const workspaceKey = normalizedDirectoryKey(workspacePath);
  const fileKey = normalizePath(filePath);
  return Boolean(
    workspaceKey
    && isAbsoluteTxtPath(filePath)
    && isWithinDirectory(fileKey, workspaceKey)
    && (includeSubfolders || parentDirectoryKey(fileKey) === workspaceKey)
  );
}

export function legacyDocumentDirectoryKey(value) {
  const filePath = String(value?.path ?? value?.filePath ?? value?.name ?? value?.fileName ?? "").trim();
  const fileKey = normalizePath(filePath);
  return parentDirectoryKey(fileKey);
}

export function isDirectTxtSibling(file, openDocumentKeys = new Set()) {
  const filePath = String(file?.path ?? file?.filePath ?? "").trim();
  const fileName = String(file?.name ?? file?.fileName ?? filePath).trim();
  return fileName.toLowerCase().endsWith(".txt")
    && isAbsoluteLocalPath(filePath)
    && !openDocumentKeys.has(normalizePath(filePath));
}

function isAbsoluteTxtPath(value) {
  return value.toLowerCase().endsWith(".txt") && isAbsoluteLocalPath(value);
}

function isAbsoluteLocalPath(value) {
  const normalized = String(value).replace(/\\/g, "/");
  if (/^[a-z]:\//i.test(normalized)) return true;
  if (normalized.startsWith("//") && !normalized.toLowerCase().startsWith("//?/")) return true;
  return normalized.startsWith("/") && !/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized);
}

function normalizedDirectoryKey(value) {
  return normalizePath(value).replace(/\/+$/, "");
}

function parentDirectoryKey(fileKey) {
  const separator = fileKey.lastIndexOf("/");
  if (separator < 0) return "";
  if (separator === 2 && /^[a-z]:\//.test(fileKey)) return fileKey.slice(0, 3);
  return fileKey.slice(0, separator).replace(/\/+$/, "");
}

function isWithinDirectory(fileKey, directoryKey) {
  const root = directoryKey.endsWith("/") ? directoryKey : `${directoryKey}/`;
  return fileKey === directoryKey || fileKey.startsWith(root);
}
