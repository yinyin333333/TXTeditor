import { documentFileKey } from "../core/file-identity.js";

export function documentOpenPlan(docs, doc) {
  const key = documentFileKey(doc);
  const existingIndex = key ? docs.findIndex((openDoc) => documentFileKey(openDoc) === key) : -1;
  if (existingIndex >= 0) return { action: "activate-existing", activeIndex: existingIndex };
  return { action: "add-new", activeIndex: docs.length };
}

export function unsavedDocuments(docs) {
  return docs.filter((doc) => doc.dirty);
}

export function activeIndexAfterTabClose({ activeIndex, closeIndex, documentCount }) {
  if (documentCount <= 1) return -1;
  const remainingCount = documentCount - 1;
  const next = closeIndex <= activeIndex ? activeIndex - 1 : activeIndex;
  return Math.max(0, Math.min(remainingCount - 1, next));
}

export function closeDialogMessage(doc) {
  return `${doc.name} has unsaved changes.`;
}
