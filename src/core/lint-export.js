// Development-only formatter for the lint parity comparator.
// Rule messages are shaped to match d2rlint by eezstreet (GPLv3).

export function formatD2rlintCompatibleExport({ diagnostics = [] } = {}) {
  const sortedDiagnostics = [...diagnostics].sort(compareD2rlintDiagnostics);
  return `${sortedDiagnostics.map(formatD2rlintDiagnosticLine).join("\n")}${sortedDiagnostics.length ? "\n" : ""}`;
}

export function formatTxteditorLintExport({ diagnostics = [] } = {}) {
  const sortedDiagnostics = [...diagnostics].sort(compareTxteditorDiagnostics);
  const lines = [
    "severity\truleId\tprofile\tfilePath\tfileName\trowIndex\tline\trowLabel\tcolumnName\tcellValue\tmessage"
  ];
  for (const diagnostic of sortedDiagnostics) {
    lines.push([
      severityLabel(diagnostic.severity),
      diagnostic.ruleId,
      diagnostic.profile,
      diagnostic.filePath,
      diagnostic.fileName,
      Number.isFinite(diagnostic.rowIndex) ? diagnostic.rowIndex : "",
      rowNumber(diagnostic),
      diagnostic.rowLabel,
      diagnostic.columnName,
      diagnostic.offendingValue,
      diagnostic.message
    ].map(field).join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

export function compareTxteditorDiagnostics(a, b) {
  return String(a.filePath || a.fileName || "").localeCompare(String(b.filePath || b.fileName || "")) ||
    numericExportValue(a.rowIndex) - numericExportValue(b.rowIndex) ||
    numericExportValue(a.columnIndex) - numericExportValue(b.columnIndex) ||
    String(a.ruleId ?? "").localeCompare(String(b.ruleId ?? "")) ||
    String(a.message ?? "").localeCompare(String(b.message ?? ""));
}

export function compareD2rlintDiagnostics(a, b) {
  return String(a.ruleId ?? "").localeCompare(String(b.ruleId ?? "")) ||
    String(a.fileName ?? "").localeCompare(String(b.fileName ?? "")) ||
    numericExportValue(a.d2rSortLine) - numericExportValue(b.d2rSortLine) ||
    numericExportValue(a.rowIndex) - numericExportValue(b.rowIndex) ||
    numericExportValue(a.columnIndex) - numericExportValue(b.columnIndex) ||
    String(d2rlintMessage(a)).localeCompare(String(d2rlintMessage(b)));
}

function formatD2rlintDiagnosticLine(diagnostic) {
  return `${severityLabel(diagnostic.severity)}\t${field(diagnostic.ruleId)}\t${d2rlintMessage(diagnostic)}`;
}

function d2rlintMessage(diagnostic) {
  if (diagnostic.d2rMessage) return diagnostic.d2rMessage;
  const row = rowNumber(diagnostic);
  const location = row ? `${field(diagnostic.fileName)}, line ${row}: ` : `${field(diagnostic.fileName)} - `;
  return `${location}${diagnostic.message || ""}`;
}

function rowNumber(diagnostic) {
  return Number.isFinite(diagnostic.rowIndex) ? diagnostic.rowIndex + 1 : "";
}

function numericExportValue(value) {
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function severityLabel(severity) {
  if (severity === "error") return "ERROR";
  if (severity === "info") return "INFO";
  return "WARN";
}

function field(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
