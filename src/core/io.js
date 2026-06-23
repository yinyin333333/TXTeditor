const LEGACY_DECODERS = ["utf-8", "windows-1252"];

let tauriApiPromise = null;

export function isTauriRuntime() {
  return Boolean(window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__);
}

async function tauriApi() {
  if (!tauriApiPromise) {
    tauriApiPromise = Promise.resolve().then(() => {
      const tauri = window.__TAURI__;
      if (!tauri?.core?.invoke) throw new Error("Tauri API is not available in this window.");
      return {
        invoke: tauri.core.invoke,
        listen: tauri.event?.listen,
        dragDropEvent: tauri.event?.TauriEvent?.DRAG_DROP ?? "tauri://drag-drop"
      };
    });
  }
  return tauriApiPromise;
}

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
  return payloads.map((result) => {
    if (result.error) return result;
    const started = perfNow();
    try {
      const doc = documentFromTextPayload(result.payload, DocumentType);
      return {
        path: result.payload.path,
        name: result.payload.name,
        bulkRead: result.bulkRead,
        parseMs: elapsedMs(started),
        doc
      };
    } catch (error) {
      return {
        path: result.payload.path,
        name: result.payload.name,
        bulkRead: result.bulkRead,
        parseMs: elapsedMs(started),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}

async function readNativeTextFiles(paths, invoke) {
  if (!paths.length) return [];
  try {
    const results = await invoke("read_text_files", { paths });
    return results.map((entry, index) => normalizeNativeReadResult(entry, paths[index], true));
  } catch {
    const results = [];
    for (const path of paths) {
      try {
        const payload = await invoke("read_text_file", { path });
        results.push({ path, payload, bulkRead: false });
      } catch (error) {
        results.push({ path, error: error instanceof Error ? error.message : String(error), bulkRead: false });
      }
    }
    return results;
  }
}

function normalizeNativeReadResult(entry, fallbackPath, bulkRead) {
  if (entry?.Ok) return { path: entry.Ok.path ?? fallbackPath, payload: entry.Ok, bulkRead };
  if (entry?.Err) return { path: fallbackPath, error: String(entry.Err), bulkRead };
  if (entry?.ok) return { path: entry.ok.path ?? fallbackPath, payload: entry.ok, bulkRead };
  if (entry?.err) return { path: fallbackPath, error: String(entry.err), bulkRead };
  if (entry?.path && typeof entry.text === "string") return { path: entry.path, payload: entry, bulkRead };
  return { path: fallbackPath, error: "Unexpected native read result.", bulkRead };
}

function documentFromTextPayload(payload, DocumentType) {
  return DocumentType.fromText(payload.name, payload.text, {
    path: payload.path,
    encoding: payload.encoding,
    dirty: false
  });
}

export async function saveDocumentNative(doc, saveAs = false) {
  const api = await tauriApi();
  let target = doc.path;
  if (saveAs || !target) {
    target = await api.invoke("save_file_dialog", { defaultName: doc.name });
    if (!target) return false;
  }
  const payload = await api.invoke("write_text_file_safe", {
    path: target,
    text: doc.toText()
  });
  doc.path = payload.path;
  doc.name = payload.name;
  doc.dirty = false;
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

export function decodeBuffer(buffer) {
  for (const encoding of LEGACY_DECODERS) {
    const decoder = new TextDecoder(encoding, { fatal: encoding === "utf-8" });
    try {
      return { text: decoder.decode(buffer), encoding };
    } catch {
      // Try the next practical legacy encoding.
    }
  }
  return { text: new TextDecoder().decode(buffer), encoding: "utf-8" };
}

export function encodeText(text, encoding = "utf-8") {
  if (encoding !== "utf-8") {
    return new TextEncoder().encode(text);
  }
  return new TextEncoder().encode(text);
}

function perfNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function elapsedMs(started) {
  return Math.round((perfNow() - started) * 100) / 100;
}

export async function getConfig() {
  if (!isTauriRuntime()) return {};
  const api = await tauriApi();
  return api.invoke("get_config");
}

export async function saveConfig(config) {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("save_config", { config });
}

export async function pickFilePath() {
  if (!isTauriRuntime()) return null;
  const api = await tauriApi();
  return api.invoke("pick_file_path");
}

export async function pickFolderPath() {
  if (!isTauriRuntime()) return null;
  const api = await tauriApi();
  const result = await api.invoke("open_folder_dialog");
  return result ?? null;
}

export async function lspStart(workspacePath) {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("lsp_start", { workspacePath });
}

export async function lspOpenFile(uri, text) {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("lsp_open_file", { uri, text });
}

export async function lspUpdateFile(uri, version, text) {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("lsp_update_file", { uri, version, text });
}

export async function lspUpdateFileIncremental(uri, version, changes) {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("lsp_update_file_incremental", { uri, version, changes });
}

export async function lspCloseFile(uri) {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("lsp_close_file", { uri });
}

export async function lspGetDiagnostics(uri) {
  if (!isTauriRuntime()) return [];
  const api = await tauriApi();
  return api.invoke("lsp_get_diagnostics", { uri });
}

export async function lspHover(uri, line, character) {
  if (!isTauriRuntime()) return null;
  const api = await tauriApi();
  return api.invoke("lsp_hover", { uri, line, character });
}

export async function lspDefinition(uri, line, character) {
  if (!isTauriRuntime()) return null;
  const api = await tauriApi();
  return api.invoke("lsp_definition", { uri, line, character });
}

export async function closeWindow() {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("close_window");
}

export async function lspListen(callback) {
  if (!isTauriRuntime()) return () => {};
  const api = await tauriApi();
  if (!api.listen) return () => {};
  const unlisten = await api.listen("lsp-diagnostics-changed", (event) => callback(event.payload));
  return unlisten;
}

export async function lspLogListen(callback) {
  if (!isTauriRuntime()) return () => {};
  const api = await tauriApi();
  if (!api.listen) return () => {};
  const unlisten = await api.listen("lsp-log", (event) => callback(event.payload));
  return unlisten;
}

export function downloadText(name, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
