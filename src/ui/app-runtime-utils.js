import { isTauriRuntime, tauriApi } from "../core/platform/tauri-api.js";
import { tText } from "../core/i18n.js";

export function readJsonStorage(key, fallback, storage = localStorage) {
  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function createToastFeedback(els) {
  let toastTimer = 0;
  function showError(error) {
    const message = error instanceof Error ? error.message : String(error);
    els.toast.textContent = message || tText("error.actionFailed");
    els.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 5200);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2600);
  }

  return { showError, showToast };
}

export async function writeClipboardText(text) {
  if (isTauriRuntime()) {
    const { invoke } = await tauriApi();
    await invoke("write_clipboard_text", { text: String(text) });
    return;
  }
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) {
    throw new Error(tText("error.clipboardWriteUnavailable"));
  }
  await clipboard.writeText(String(text));
}

export async function readClipboardText() {
  if (isTauriRuntime()) {
    const { invoke } = await tauriApi();
    return invoke("read_clipboard_text");
  }
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.readText) {
    throw new Error(tText("error.clipboardReadUnavailable"));
  }
  return clipboard.readText();
}
