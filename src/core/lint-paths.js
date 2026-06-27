import { lintDocumentKey, normalizeFilePathKey } from "./file-identity.js";

export function documentKey(doc) {
  return lintDocumentKey(doc);
}

export function normalizePath(value) {
  return normalizeFilePathKey(value);
}

export function baseName(path) {
  return String(path).replace(/\\/g, "/").split("/").pop() || String(path);
}
