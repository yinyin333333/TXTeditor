import { documentKey } from "./lint-paths.js";
import { resolveLocalizedMessage } from "./i18n.js";
import { resolveLegacyMessage } from "./legacy-lint-i18n.js";

export function groupDiagnosticsByCell(diagnostics) {
  const grouped = new Map();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.rowIndex}:${diagnostic.columnIndex}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(diagnostic);
  }
  return grouped;
}

export function diagnosticsForDocument(diagnostics, doc) {
  const key = documentKey(doc);
  return diagnostics.filter((diagnostic) => diagnostic.fileKey === key);
}

export function createRuleContext({ ruleId, severity, diagnostics, profile, rowLabelFor, locale }) {
  return {
    add(table, rowIndex, columnName, message, meta = {}) {
      const columnIndex = typeof columnName === "number" ? columnName : table.columnIndex(columnName);
      const header = typeof columnName === "number" ? table.headerAt(columnName) : table.headerAt(columnIndex);
      const rowLabel = rowLabelFor(table, rowIndex);
      const primaryLocationLabel = rowLabel ? `${rowLabel} > ${header}` : header;
      const technicalLocationLabel = `R${rowIndex + 1}:C${Math.max(0, columnIndex) + 1}`;
      const isLegacyMessage = Boolean(message?.legacyKey);
      diagnostics.push({
        id: "",
        ruleId,
        profile,
        severity,
        message: isLegacyMessage ? resolveLegacyMessage(message, locale) : resolveLocalizedMessage(message, locale),
        ...(isLegacyMessage
          ? { messageKey: message.legacyKey, messageArgs: message.params ?? {} }
          : message?.key ? { messageKey: message.key, messageArgs: message.params ?? {} } : {}),
        fileName: table.displayName,
        fileKey: table.fileKey,
        filePath: table.path,
        rowIndex,
        columnIndex: Math.max(0, columnIndex),
        columnName: header,
        rowLabel,
        primaryLocationLabel,
        technicalLocationLabel,
        locationLabel: primaryLocationLabel,
        offendingValue: table.rows[rowIndex]?.[Math.max(0, columnIndex)] ?? "",
        ...meta
      });
    }
  };
}

export function compareDiagnostics(a, b) {
  return a.fileName.localeCompare(b.fileName) || a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex || a.ruleId.localeCompare(b.ruleId);
}
