export function normalizeNativeReadResult(entry, fallbackPath, bulkRead) {
  if (entry?.Ok) return { path: entry.Ok.path ?? fallbackPath, payload: entry.Ok, bulkRead };
  if (entry?.Err) return { path: fallbackPath, error: String(entry.Err), bulkRead };
  if (entry?.ok) return { path: entry.ok.path ?? fallbackPath, payload: entry.ok, bulkRead };
  if (entry?.err) return { path: fallbackPath, error: String(entry.err), bulkRead };
  if (entry?.path && typeof entry.text === "string") return { path: entry.path, payload: entry, bulkRead };
  return { path: fallbackPath, error: "Unexpected native read result.", bulkRead };
}

export function documentFromTextPayload(payload, DocumentType) {
  return DocumentType.fromText(payload.name, payload.text, {
    path: payload.path,
    encoding: payload.encoding,
    dirty: false
  });
}

export function documentOpenResultFromNativeRead(result, DocumentType, { now = defaultNow } = {}) {
  if (result.error) return result;
  const started = now();
  try {
    const doc = documentFromTextPayload(result.payload, DocumentType);
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

export function applySavedTextPayload(doc, payload) {
  doc.path = payload.path;
  doc.name = payload.name;
  doc.dirty = false;
  return doc;
}

function defaultNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function elapsedMs(started, now) {
  return Math.round((now() - started) * 100) / 100;
}
