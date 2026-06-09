export function groupDiagnosticsByCell(diagnostics) {
  const grouped = new Map();
  for (const diagnostic of diagnostics ?? []) {
    const key = `${diagnostic.rowIndex}:${diagnostic.columnIndex}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(diagnostic);
  }
  return grouped;
}

export function diagnosticsForDocument(diagnostics, doc) {
  const key = documentKey(doc);
  return (diagnostics ?? []).filter((diagnostic) => diagnostic.fileKey === key);
}

export function documentKey(doc) {
  return normalizePath(doc?.path || doc?.name || "");
}

export function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").toLowerCase();
}
