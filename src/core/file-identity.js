export function normalizeFilePathKey(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

export function documentFileKey(doc) {
  if (doc?.path) return normalizeFilePathKey(doc.path);
  if (doc?.fileKey) return normalizeFilePathKey(doc.fileKey);
  return "";
}

export function lintDocumentKey(doc) {
  return documentFileKey(doc) || normalizeFilePathKey(doc?.name || "");
}
