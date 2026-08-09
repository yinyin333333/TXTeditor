export const GRID_SCROLL_MODE_PIXEL = "pixel";
export const GRID_SCROLL_MODE_CELL = "cell";

export function normalizeGridScrollMode(value) {
  return value === GRID_SCROLL_MODE_CELL ? GRID_SCROLL_MODE_CELL : GRID_SCROLL_MODE_PIXEL;
}

export function isCellScrollMode(value) {
  return normalizeGridScrollMode(value) === GRID_SCROLL_MODE_CELL;
}
