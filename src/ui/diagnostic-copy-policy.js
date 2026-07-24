import { tText } from "../core/i18n.js";

export const DIAGNOSTIC_COPY_MESSAGE = "message";
export const DIAGNOSTIC_COPY_FULL = "full";

export function diagnosticColumnName(diagnostic = {}) {
  const raw = diagnostic.columnName;
  if (raw != null && String(raw) !== "") return String(raw);
  const index = Number(diagnostic.columnIndex);
  return Number.isFinite(index) ? String(Math.max(0, Math.trunc(index)) + 1) : "1";
}

export function diagnosticRecordKey(diagnostic = {}) {
  const value = diagnostic.recordKey ?? diagnostic.rowLabel;
  return value == null ? "" : String(value);
}

export function diagnosticDisplayLocation(diagnostic = {}, translate = tText) {
  const rowIndex = Number(diagnostic.rowIndex);
  const row = Number.isFinite(rowIndex) ? Math.max(0, Math.trunc(rowIndex)) + 1 : 1;
  const column = diagnosticColumnName(diagnostic);
  const record = diagnosticRecordKey(diagnostic);
  const rowId = record || String(row);
  return {
    row,
    rowId,
    column,
    record,
    locationText: translate("problems.displayLocation", { row: rowId, column })
  };
}

export function diagnosticCopyText(diagnostic = {}, mode = DIAGNOSTIC_COPY_FULL, translate = tText) {
  const message = String(diagnostic.message ?? "");
  if (mode === DIAGNOSTIC_COPY_MESSAGE) return message;

  const { rowId, column } = diagnosticDisplayLocation(diagnostic, translate);
  const inlineSeparator = translate("problems.copy.inlineSeparator");
  const blockSeparator = translate("problems.copy.blockSeparator");
  const inline = (labelKey, value) => `${translate(labelKey)}${inlineSeparator}${String(value ?? "")}`;
  const block = (labelKey, value) => `${translate(labelKey)}${blockSeparator}${String(value ?? "")}`;
  const fileName = String(diagnostic.fileName ?? "");
  const identityPath = String(diagnostic.filePath || diagnostic.fileKey || "");
  const lines = [
    inline("problems.copy.file", fileName),
    ...(identityPath && identityPath !== fileName
      ? [inline("problems.copy.path", identityPath)]
      : []),
    inline("problems.copy.row", rowId),
    inline("problems.copy.column", column),
    block("problems.copy.messageLabel", message),
    ...(diagnostic.ruleId ? [inline("problems.copy.rule", diagnostic.ruleId)] : []),
    ...(diagnostic.profile ? [inline("problems.copy.profile", diagnostic.profile)] : []),
    ...(Object.hasOwn(diagnostic, "offendingValue")
      ? [block("problems.copy.value", diagnostic.offendingValue)]
      : [])
  ];
  return lines.join("\n");
}

export function isDiagnosticCopyShortcut(event = {}) {
  return String(event.key ?? "").toLowerCase() === "c"
    && Boolean(event.ctrlKey || event.metaKey)
    && !event.altKey;
}
