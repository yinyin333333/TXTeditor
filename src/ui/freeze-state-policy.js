export const FREEZE_STATE_KEY = "txteditor.freeze";

export function normalizeFreezeState(value = {}) {
  return {
    row: value?.row === true,
    column: value?.column === true
  };
}

export function freezeStateFromStorage(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(FREEZE_STATE_KEY);
    return raw ? normalizeFreezeState(JSON.parse(raw)) : normalizeFreezeState();
  } catch {
    return normalizeFreezeState();
  }
}

export function persistFreezeState(state, storage = globalThis.localStorage) {
  const value = normalizeFreezeState({
    row: Boolean(state?.freezeRow),
    column: Boolean(state?.freezeColumn)
  });
  try {
    storage?.setItem?.(FREEZE_STATE_KEY, JSON.stringify(value));
  } catch {
    // Storage can be disabled; the active session should still keep working.
  }
  return value;
}
