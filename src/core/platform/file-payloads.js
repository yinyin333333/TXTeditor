import { documentRevision, markDocumentSaved } from "../document-file-state.js";
import { LARGE_FILE_THRESHOLDS } from "../large-file-policy.js";

export function normalizeNativeReadResult(entry, fallbackPath, bulkRead) {
  if (entry?.Ok) return { path: entry.Ok.path ?? fallbackPath, payload: entry.Ok, bulkRead };
  if (entry?.Err) return { path: fallbackPath, error: String(entry.Err), bulkRead };
  return { path: fallbackPath, error: "Unexpected native read result.", bulkRead };
}

export function documentFromTextPayload(payload, DocumentType) {
  return DocumentType.fromText(payload.name, payload.text, {
    path: payload.path,
    encoding: payload.encoding,
    fileSizeBytes: payload.fileSizeBytes ?? payload.sizeBytes ?? payload.size_bytes,
    dirty: false
  });
}

export async function documentFromTextPayloadAsync(payload, DocumentType) {
  if (shouldUseParseWorker(payload)) {
    const parsed = await parseTablePayloadInWorker(payload);
    return documentFromParsedPayload({
      ...payload,
      encoding: parsed.encoding ?? payload.encoding,
      fileSizeBytes: parsed.fileSizeBytes ?? payload.fileSizeBytes
    }, parsed.parsed, DocumentType);
  }
  return documentFromTextPayload(payload, DocumentType);
}

function documentFromParsedPayload(payload, parsed, DocumentType) {
  const meta = {
    path: payload.path,
    encoding: payload.encoding,
    fileSizeBytes: payload.fileSizeBytes ?? payload.sizeBytes ?? payload.size_bytes,
    dirty: false
  };
  return DocumentType.fromParsed(payload.name, parsed, meta);
}

export async function documentOpenResultFromNativeReadAsync(result, DocumentType, { now = defaultNow } = {}) {
  if (result.error) return result;
  const started = now();
  try {
    const doc = await documentFromTextPayloadAsync(result.payload, DocumentType);
    return {
      path: result.payload.path,
      name: result.payload.name,
      bulkRead: result.bulkRead,
      parseMs: elapsedMs(started, now),
      doc
    };
  } catch (error) {
    return {
      path: result.payload.path,
      name: result.payload.name,
      bulkRead: result.bulkRead,
      parseMs: elapsedMs(started, now),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function applySavedTextPayload(doc, payload, revision = documentRevision(doc), snapshot = {}) {
  doc.path = payload.path;
  doc.name = payload.name;
  markDocumentSaved(doc, revision, snapshot);
  return doc;
}

function defaultNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function elapsedMs(started, now) {
  return Math.round((now() - started) * 100) / 100;
}

function shouldUseParseWorker(payload) {
  const size = Number(payload?.fileSizeBytes ?? payload?.sizeBytes ?? payload?.size_bytes ?? payload?.text?.length ?? 0);
  return size >= LARGE_FILE_THRESHOLDS.fileSizeBytes && typeof globalThis.Worker !== "undefined";
}

function parseTablePayloadInWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new globalThis.Worker(new URL("./table-parse-worker.js", import.meta.url), { type: "module" });
    const id = `${Date.now()}:${Math.random()}`;
    worker.onmessage = (event) => {
      if (event.data?.id !== id) return;
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Large-file parser worker failed."));
    };
    const message = {
      id,
      text: payload.text,
      buffer: payload.buffer,
      encoding: payload.encoding,
      fileSizeBytes: payload.fileSizeBytes ?? payload.sizeBytes ?? payload.size_bytes
    };
    const transfer = payload.buffer ? [payload.buffer] : [];
    worker.postMessage(message, transfer);
  });
}
