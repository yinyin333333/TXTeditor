import { normalizePath } from "../core/lint-paths.js";
import { tText } from "../core/i18n.js";

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

export function cyclicDocumentIndex({ activeIndex, documentCount, delta = 1 }) {
  if (documentCount <= 0) return -1;
  const current = Math.max(0, Math.min(documentCount - 1, Number(activeIndex) || 0));
  return ((current + Number(delta || 0)) % documentCount + documentCount) % documentCount;
}

export function closeDialogMessage(doc) {
  return tText("dialog.fileUnsaved", { file: doc.name });
}
