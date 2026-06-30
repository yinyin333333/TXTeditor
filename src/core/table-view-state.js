import { RangeSet } from "./range-set.js";

const tableViewStates = new WeakMap();

export function resetTableViewState(doc, meta = {}) {
  const state = {
    hiddenRows: RangeSet.from(meta.hiddenRows),
    hiddenColumns: RangeSet.from(meta.hiddenColumns),
    columnWidths: meta.columnWidths ? [...meta.columnWidths] : [],
    rowHeights: meta.rowHeights ? [...meta.rowHeights] : [],
    defaultColumnWidth: meta.defaultColumnWidth ?? 120,
    defaultRowHeight: meta.defaultRowHeight ?? 26,
    hasCustomRowHeights: meta.hasCustomRowHeights ?? false,
    zoom: meta.zoom ?? 1,
    freezeFirstRow: meta.freezeFirstRow ?? false,
    freezeFirstColumn: meta.freezeFirstColumn ?? false,
    scrollLeft: meta.scrollLeft,
    scrollTop: meta.scrollTop,
    selection: meta.selection ?? null,
    initialColumnFitApplied: meta.initialColumnFitApplied ?? false,
    revision: meta.viewRevision ?? 0
  };
  tableViewStates.set(doc, state);
  return state;
}

export function tableViewState(doc) {
  let state = tableViewStates.get(doc);
  if (!state) state = resetTableViewState(doc);
  return state;
}

export function markTableViewDirty(doc) {
  tableViewState(doc).revision += 1;
}
