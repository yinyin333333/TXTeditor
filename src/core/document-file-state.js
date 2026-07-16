import { markTableSaved, tableFileState } from "./table-file-state.js";

export function isJsonDocument(doc) {
  return doc?.kind === "json";
}

export function isTableDocument(doc) {
  return doc?.kind !== "json";
}

export function documentRevision(doc) {
  if (isJsonDocument(doc)) return Number(doc.revision) || 0;
  return tableFileState(doc).revision;
}

export function documentTextSnapshot(doc) {
  const chunks = typeof doc?.snapshotTextChunks === "function"
    ? [...doc.snapshotTextChunks()]
    : [String(doc?.toText?.() ?? "")];
  return {
    revision: documentRevision(doc),
    chunks,
    text: chunks.join(""),
    encoding: doc?.encoding || "utf-8"
  };
}

export function markDocumentSaved(doc, revision, snapshot = {}) {
  if (isJsonDocument(doc)) {
    doc.markSaved(revision, snapshot);
    return;
  }
  markTableSaved(doc, revision);
}
