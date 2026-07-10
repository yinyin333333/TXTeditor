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

const nativeTargetSaveQueues = new Map();
const NATIVE_OPEN_BATCH_SIZE = 2;
let nativeSaveTransactionSequence = 0;

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

export async function openNativePathsBulk(paths, DocumentType, invokeFn = null, { shouldContinue = () => true } = {}) {
  const invoke = invokeFn ?? (await tauriApi()).invoke;
  const results = new Array(paths.length);
  for (let start = 0; start < paths.length && shouldContinue(); start += NATIVE_OPEN_BATCH_SIZE) {
    const batchPaths = paths.slice(start, start + NATIVE_OPEN_BATCH_SIZE);
    const payloads = await readNativeTextFiles(batchPaths, invoke);
    const parsed = await Promise.all(payloads.map((result) =>
      documentOpenResultFromNativeReadAsync(result, DocumentType, { now: perfNow })
    ));
    for (let index = 0; index < parsed.length; index += 1) results[start + index] = parsed[index];
  }
  return results;
}

export async function saveDocumentNative(doc, saveAs = false) {
  const api = await tauriApi();
  let target = doc.path;
  if (saveAs || !target) {
    target = await api.invoke("save_file_dialog", { defaultName: doc.name });
    if (!target) return false;
  }
  const revision = tableFileState(doc).revision;
  const payload = await queueNativeTargetSave(target, () => writeDocumentNative(api.invoke, target, doc));
  applySavedTextPayload(doc, payload, revision);
  return true;
}

export async function saveTextNative(defaultName, text) {
  const api = await tauriApi();
  const target = await api.invoke("save_file_dialog", { defaultName });
  if (!target) return false;
  await queueNativeTargetSave(target, () => api.invoke("write_text_file_safe", {
    path: target,
    text,
    encoding: "utf-8"
  }));
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
  const transactionId = nextNativeSaveTransactionId();
  const iterator = doc.toTextChunks()[Symbol.iterator]();
  let current = iterator.next();
  if (current.done) {
    return invoke("write_text_file_chunk_safe", { path, text: "", encoding: doc.encoding, transactionId, first: true, last: true });
  }
  let first = true;
  while (!current.done) {
    const next = iterator.next();
    const payload = await invoke("write_text_file_chunk_safe", {
      path,
      text: current.value ?? "",
      encoding: doc.encoding,
      transactionId,
      first,
      last: next.done
    });
    if (next.done) return payload;
    first = false;
    current = next;
  }
  throw new Error("Native document save did not finish.");
}

function queueNativeTargetSave(path, operation) {
  const key = String(path || "").replaceAll("/", "\\").toLowerCase();
  const previous = nativeTargetSaveQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  nativeTargetSaveQueues.set(key, current);
  return current.finally(() => {
    if (nativeTargetSaveQueues.get(key) === current) nativeTargetSaveQueues.delete(key);
  });
}

function nextNativeSaveTransactionId() {
  nativeSaveTransactionSequence += 1;
  return `${Date.now().toString(36)}-${nativeSaveTransactionSequence.toString(36)}`;
}
