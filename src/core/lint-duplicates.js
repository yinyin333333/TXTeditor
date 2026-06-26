import { clean } from "./lint-table.js";

export function duplicateRowPairs(table, columnName, { ignoredValues = new Set(["Expansion"]) } = {}) {
  if (!table?.hasColumn(columnName)) return [];
  const column = table.columnIndex(columnName);
  const seen = new Map();
  const pairs = [];
  for (let rowIndex = 1; rowIndex < table.rows.length; rowIndex += 1) {
    const value = clean(table.rows[rowIndex]?.[column]);
    if (!value || ignoredValues.has(value)) continue;
    const previousRows = seen.get(value);
    if (previousRows) {
      for (const previousRow of previousRows) pairs.push({ rowIndex, previousRow, value });
      previousRows.push(rowIndex);
    } else {
      seen.set(value, [rowIndex]);
    }
  }
  return pairs;
}
