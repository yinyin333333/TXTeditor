import { PROBLEMS_VISIBILITY_KEY } from "./panel-state-policy.js";

export function finishDiagnosticNavigation({
  state,
  grid,
  storage,
  renderChrome,
  updateGridDiagnostics,
  updateActiveProblemHighlight,
  host
}) {
  state.problemsVisible = true;
  storage?.setItem?.(PROBLEMS_VISIBILITY_KEY, "visible");
  updateGridDiagnostics();
  renderChrome();
  grid.layout();
  const { row, column } = state.selection.focus;
  grid.scrollCellToCenter(row, column);
  grid.draw();
  updateActiveProblemHighlight();
  host?.focus?.();
  return { row, column };
}
