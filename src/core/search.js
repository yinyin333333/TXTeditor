export function findInTable(doc, query, start = { row: 0, column: 0 }, options = {}) {
  if (!query) return null;
  const needle = searchableText(query, options);
  const total = doc.rowCount * doc.columnCount;
  const startIndex = start.row * doc.columnCount + start.column + (options.includeStart ? 0 : 1);

  for (let step = 0; step < total; step++) {
    const index = (startIndex + step) % total;
    const row = Math.floor(index / doc.columnCount);
    const column = index % doc.columnCount;
    if (options.skipHidden && (doc.hiddenRows?.has(row) || doc.hiddenColumns?.has(column))) continue;
    const raw = doc.getCell(row, column);
    const hay = searchableText(raw, options);
    if (hay.includes(needle)) return { row, column };
  }
  return null;
}

function searchableText(value, options = {}) {
  const text = String(value);
  return options.matchCase ? text : text.toLocaleLowerCase();
}
