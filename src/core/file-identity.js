export function normalizeFilePathKey(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

export function documentFileKey(doc) {
  if (doc?.fileKey) return normalizeFilePathKey(doc.fileKey);
  if (doc?.path) return normalizeFilePathKey(doc.path);
  return "";
}

export function lintDocumentKey(doc) {
  return documentFileKey(doc) || normalizeFilePathKey(doc?.name || "");
}
