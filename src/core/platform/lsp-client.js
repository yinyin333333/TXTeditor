import { isTauriRuntime, tauriApi } from "./tauri-api.js";
import { normalizeLocale } from "../i18n.js";

function withGeneration(payload, generation) {
  return generation == null ? payload : { ...payload, generation };
}

export async function lspStart(workspacePath, generation, contextMode = "workspace", referenceRootPath = "", includeSubfolders = true, locale = "enUS") {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  const payload = { workspacePath };
  if (contextMode === "sibling") payload.contextMode = contextMode;
  if (referenceRootPath) payload.referenceRootPath = referenceRootPath;
  if (!includeSubfolders) payload.includeSubfolders = false;
  payload.locale = normalizeLocale(locale);
  return api.invoke("lsp_start", withGeneration(payload, generation));
}

export async function lspOpenFile(uri, version, text, generation) {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("lsp_open_file", withGeneration({ uri, version, text }, generation));
}

export async function lspUpdateFile(uri, version, text, generation) {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("lsp_update_file", withGeneration({ uri, version, text }, generation));
}

export async function lspUpdateFileIncremental(uri, version, changes, generation) {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("lsp_update_file_incremental", withGeneration({ uri, version, changes }, generation));
}

export async function lspCloseFile(uri, generation) {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("lsp_close_file", withGeneration({ uri }, generation));
}

export async function lspGetDiagnostics(uri, generation, sequence) {
  if (!isTauriRuntime()) return [];
  const api = await tauriApi();
  const payload = withGeneration({ uri }, generation);
  if (sequence != null) payload.sequence = sequence;
  return api.invoke("lsp_get_diagnostics", payload);
}

export async function lspGetDiagnosticsBatch(requests, generation) {
  if (!isTauriRuntime()) return requests.map(() => []);
  const api = await tauriApi();
  return api.invoke("lsp_get_diagnostics_batch", withGeneration({ requests }, generation));
}

export async function lspHover(uri, line, character, generation) {
  if (!isTauriRuntime()) return null;
  const api = await tauriApi();
  return api.invoke("lsp_hover", withGeneration({ uri, line, character }, generation));
}

export async function lspDefinition(uri, line, character, generation) {
  if (!isTauriRuntime()) return null;
  const api = await tauriApi();
  return api.invoke("lsp_definition", withGeneration({ uri, line, character }, generation));
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

export async function lspWatchedFilesListen(callback) {
  return listenForLspEvent("lsp-watched-files-changed", callback);
}

async function listenForLspEvent(eventName, callback) {
  if (!isTauriRuntime()) return () => {};
  const api = await tauriApi();
  if (!api.listen) return () => {};
  return api.listen(eventName, (event) => callback(event.payload));
}

export async function lspReadyListen(callback) {
  return listenForLspEvent("lsp-ready", callback);
}

export async function lspStoppedListen(callback) {
  return listenForLspEvent("lsp-stopped", callback);
}
