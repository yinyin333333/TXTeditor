import { isTauriRuntime, tauriApi } from "./tauri-api.js";

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
