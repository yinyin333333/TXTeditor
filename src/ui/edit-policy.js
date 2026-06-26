export function isArrowNavigationKey(key) {
  return key === "ArrowDown" || key === "ArrowUp" || key === "ArrowRight" || key === "ArrowLeft";
}

export function shouldCommitEditOnArrow(editMode, key) {
  return editMode === "quick" && isArrowNavigationKey(key);
}

export function arrowNavigationDelta(key) {
  if (key === "ArrowDown") return { rowDelta: 1, columnDelta: 0 };
  if (key === "ArrowUp") return { rowDelta: -1, columnDelta: 0 };
  if (key === "ArrowRight") return { rowDelta: 0, columnDelta: 1 };
  if (key === "ArrowLeft") return { rowDelta: 0, columnDelta: -1 };
  return { rowDelta: 0, columnDelta: 0 };
}

export function editorKeyAction({ key, shiftKey = false, editMode = null } = {}) {
  if (shouldCommitEditOnArrow(editMode, key)) {
    return { action: "commit-move", ...arrowNavigationDelta(key) };
  }
  if (key === "Enter") {
    return { action: "commit-move", rowDelta: shiftKey ? -1 : 1, columnDelta: 0 };
  }
  if (key === "Tab") {
    return { action: "commit-move", rowDelta: 0, columnDelta: shiftKey ? -1 : 1 };
  }
  if (key === "Escape") return { action: "cancel" };
  return { action: "none" };
}

export function isPrintableEditKey(event) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

export function keyboardEditStartAction(event) {
  if (event.key === "Enter" || event.key === "F2") {
    return { action: "start-edit", initialText: null, replace: false, mode: "explicit" };
  }
  if (isPrintableEditKey(event)) {
    return { action: "start-edit", initialText: event.key, replace: true, mode: "quick" };
  }
  return { action: "none" };
}

export function editorBoxStyle({ hostBox, cellBox, zoom }) {
  return {
    left: `${hostBox.left + cellBox.left + 1}px`,
    top: `${hostBox.top + cellBox.top + 1}px`,
    width: `${cellBox.width - 2}px`,
    height: `${cellBox.height - 2}px`,
    fontSize: `${Math.max(10, Math.round(12 * zoom))}px`
  };
}

export function editorCellState({ row, column, freezeFirstRow = false, freezeFirstColumn = false }) {
  const frozen = (freezeFirstRow && row === 0) || (freezeFirstColumn && column === 0);
  const firstColumnLabel = column === 0 && row > 0;
  return {
    frozen,
    firstColumnLabel,
    fontWeight: row === 0 || firstColumnLabel ? "600" : "400"
  };
}
