import { isTauriRuntime, tauriApi } from "./tauri-api.js";
import { applySavedTextPayload, documentOpenResultFromNativeRead } from "./file-payloads.js";
import { decodeBuffer } from "./text-codec.js";
import { readNativeTextFiles } from "./native-read.js";
import { tableFileState } from "../table-file-state.js";

export async function readFileAsDocument(file, DocumentType) {
  const buffer = await file.arrayBuffer();
  const { text, encoding } = decodeBuffer(buffer);
  return DocumentType.fromText(file.name, text, { encoding, path: file.name });
}

export async function openFilesNative(DocumentType) {
  const api = await tauriApi();
  const paths = await api.invoke("open_files_dialog");
  return openNativePaths(paths, DocumentType, api.invoke);
}

export async function openWorkspaceNative() {
  const api = await tauriApi();
  const selected = await api.invoke("open_folder_dialog");
  if (!selected) return null;
  return api.invoke("list_workspace_files", { path: selected });
}

export async function openNativePaths(paths, DocumentType, invokeFn = null) {
  const results = await openNativePathsBulk(paths, DocumentType, invokeFn);
  const failed = results.find((result) => result.error);
  if (failed) throw new Error(failed.error);
  return results.map((result) => result.doc).filter(Boolean);
}

export async function openNativePathsBulk(paths, DocumentType, invokeFn = null) {
  const invoke = invokeFn ?? (await tauriApi()).invoke;
  const payloads = await readNativeTextFiles(paths, invoke);
  return payloads.map((result) => documentOpenResultFromNativeRead(result, DocumentType, { now: perfNow }));
}

export async function saveDocumentNative(doc, saveAs = false) {
  const api = await tauriApi();
  let target = doc.path;
  if (saveAs || !target) {
    target = await api.invoke("save_file_dialog", { defaultName: doc.name });
    if (!target) return false;
  }
  const revision = tableFileState(doc).revision;
  const text = doc.toText();
  const payload = await api.invoke("write_text_file_safe", {
    path: target,
    text
  });
  applySavedTextPayload(doc, payload, revision);
  return true;
}

export async function saveTextNative(defaultName, text) {
  const api = await tauriApi();
  const target = await api.invoke("save_file_dialog", { defaultName });
  if (!target) return false;
  await api.invoke("write_text_file_safe", {
    path: target,
    text
  });
  return true;
}

export async function listenForNativeDrops(callback) {
  if (!isTauriRuntime()) return () => {};
  const api = await tauriApi();
  if (!api.listen) return () => {};
  const unlisten = await api.listen(api.dragDropEvent, (payload) => {
    const paths = payload.payload?.paths ?? payload.payload ?? [];
    if (Array.isArray(paths)) callback(paths);
  });
  return unlisten;
}

function perfNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
