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
  const invoke = invokeFn ?? (await tauriApi()).invoke;
  const docs = [];
  for (const path of paths) {
    const payload = await invoke("read_text_file", { path });
    docs.push(DocumentType.fromText(payload.name, payload.text, {
      path: payload.path,
      encoding: payload.encoding,
      dirty: false
    }));
  }
  return docs;
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
    text: doc.toText(),
    backup: true
  });
  doc.path = payload.path;
  doc.name = payload.name;
  doc.dirty = false;
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
