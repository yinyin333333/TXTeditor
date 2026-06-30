import { isTauriRuntime, tauriApi } from "./tauri-api.js";
import {
  applySavedTextPayload,
  documentFromTextPayloadAsync,
  documentOpenResultFromNativeReadAsync
} from "./file-payloads.js";
import { decodeBuffer } from "./text-codec.js";
import { readNativeTextFiles } from "./native-read.js";
import { tableFileState } from "../table-file-state.js";
import { LARGE_FILE_THRESHOLDS } from "../large-file-policy.js";

export async function readFileAsDocument(file, DocumentType) {
  const buffer = await file.arrayBuffer();
  if (typeof globalThis.Worker !== "undefined" && file.size >= LARGE_FILE_THRESHOLDS.fileSizeBytes) {
    return documentFromTextPayloadAsync({
      name: file.name,
      path: file.name,
      buffer,
      fileSizeBytes: file.size
    }, DocumentType);
  }
  const { text, encoding } = decodeBuffer(buffer);
  return DocumentType.fromText(file.name, text, { encoding, path: file.name, fileSizeBytes: file.size });
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
  return Promise.all(payloads.map((result) => documentOpenResultFromNativeReadAsync(result, DocumentType, { now: perfNow })));
}

export async function saveDocumentNative(doc, saveAs = false) {
  const api = await tauriApi();
  let target = doc.path;
  if (saveAs || !target) {
    target = await api.invoke("save_file_dialog", { defaultName: doc.name });
    if (!target) return false;
  }
  const revision = tableFileState(doc).revision;
  const payload = await writeDocumentNative(api.invoke, target, doc);
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

async function writeDocumentNative(invoke, path, doc) {
  const iterator = doc.toTextChunks()[Symbol.iterator]();
  let current = iterator.next();
  if (current.done) {
    return invoke("write_text_file_chunk_safe", { path, text: "", first: true, last: true });
  }
  let first = true;
  while (!current.done) {
    const next = iterator.next();
    const payload = await invoke("write_text_file_chunk_safe", {
      path,
      text: current.value ?? "",
      first,
      last: next.done
    });
    if (next.done) return payload;
    first = false;
    current = next;
  }
  throw new Error("Native document save did not finish.");
}
