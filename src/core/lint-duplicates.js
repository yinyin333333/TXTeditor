import { clean } from "./lint-table.js";
import { asciiLower, exactOuterUnquote, fixed4Key } from "./lint-reference-semantics.js";

export function duplicateRowPairs(table, columnName, { ignoredValues = new Set(["Expansion"]), comparison = "raw" } = {}) {
  if (!table?.hasColumn(columnName)) return [];
  const column = table.columnIndex(columnName);
  const seen = new Map();
  const pairs = [];
  for (let rowIndex = 1; rowIndex < table.rows.length; rowIndex += 1) {
    const value = clean(table.rows[rowIndex]?.[column]);
    if (!value || ignoredValues.has(value)) continue;
    const identity = duplicateIdentity(table.rows[rowIndex]?.[column], comparison);
    const previousRows = seen.get(identity);
    if (previousRows) {
      for (const previousRow of previousRows) pairs.push({ rowIndex, previousRow, value });
      previousRows.push(rowIndex);
    } else {
      seen.set(identity, [rowIndex]);
    }
  }
  return pairs;
}

function duplicateIdentity(value, comparison) {
  if (comparison === "fixed4cc") return fixed4Key(value);
  if (comparison === "ascii-ci") return asciiLower(String(value ?? ""));
  if (comparison === "integer") {
    const text = clean(value);
    if (/^-?\d+$/.test(text)) return `integer:${BigInt(text)}`;
  }
  return exactOuterUnquote(value).trim();
}
