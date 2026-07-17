import { isTauriRuntime, tauriApi } from "./tauri-api.js";

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

export async function loadLintReferenceDataset(gameVersion) {
  if (!isTauriRuntime()) return null;
  const api = await tauriApi();
  return api.invoke("load_lint_reference_dataset", { gameVersion });
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

export async function closeWindow() {
  if (!isTauriRuntime()) return;
  const api = await tauriApi();
  await api.invoke("close_window");
}
