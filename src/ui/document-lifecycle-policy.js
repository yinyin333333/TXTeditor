import { normalizePath } from "../core/lint-paths.js";

export function documentOpenPlan(docs, doc) {
  const target = doc?.path ? normalizePath(doc.path) : "";
  const existingIndex = target
    ? docs.findIndex((openDoc) => normalizePath(openDoc.path) === target)
    : -1;
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
