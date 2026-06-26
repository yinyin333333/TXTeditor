let tauriApiPromise = null;
let tauriApiWindow = null;

export function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  return Boolean(window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__);
}

export async function tauriApi() {
  const currentWindow = typeof window === "undefined" ? null : window;
  if (!tauriApiPromise || tauriApiWindow !== currentWindow) {
    tauriApiWindow = currentWindow;
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
