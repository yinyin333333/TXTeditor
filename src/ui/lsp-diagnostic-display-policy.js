export function mapLspDiagnosticToDisplay(diagnostic, {
  uri = "",
  fileKey = "",
  fileName = "",
  filePath = "",
  index = 0,
  doc = null,
  generation = 0,
  sequence = null,
  version = null,
  sourceExists = true,
  jsonNavigationEnabled = false
} = {}) {
  const rowIndex = numberOr(diagnostic?.row, 0);
  const endRowIndex = numberOr(diagnostic?.endRow, rowIndex);
  const resourceIsJson = isJsonResource(filePath || fileName);
  const tableColumnIndex = numberOr(diagnostic?.col ?? diagnostic?.column, 0);
  const columnIndex = !doc && resourceIsJson
    ? numberOr(diagnostic?.startCharacter, tableColumnIndex)
    : tableColumnIndex;
  const cellValue = knownCellValue(doc, rowIndex, columnIndex);
  const data = diagnostic?.data ?? null;
  const code = diagnostic?.code == null ? "" : String(diagnostic.code);
  const range = displayDiagnosticRange(diagnostic, cellValue, data);
  const navigationDisabled = resourceIsJson ? !jsonNavigationEnabled : false;
  return {
    id: `lsp:${uri}:${rowIndex}:${columnIndex}:${index}`,
    uri,
    generation,
    sequence,
    version,
    sourceExists,
    documentKind: resourceIsJson ? "json" : "table",
    fileKey,
    fileName,
    filePath,
    rowIndex,
    endRowIndex,
    columnIndex,
    severity: diagnostic?.severity ?? "warning",
    message: diagnostic?.message ?? "",
    ruleId: code,
    code,
    data,
    navigationDisabled,
    locationLabel: `Row ${rowIndex + 1}, Col ${columnIndex + 1}`,
    ...range
  };
}

function isJsonResource(value) {
  return /\.json$/i.test(String(value ?? "").trim());
}

function knownCellValue(doc, rowIndex, columnIndex) {
  if (!doc || typeof doc.getCell !== "function") return null;
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return null;
  if (rowIndex < 0 || columnIndex < 0) return null;
  if (rowIndex >= Number(doc.rowCount) || columnIndex >= Number(doc.columnCount)) return null;
  return doc.getCell(rowIndex, columnIndex);
}

function displayDiagnosticRange(diagnostic, cellValue, data = null) {
  const startCharacter = optionalNumber(diagnostic?.startCharacter);
  const endCharacter = optionalNumber(diagnostic?.endCharacter);
  const cellStartCharacter = optionalNumber(diagnostic?.cellStartCharacter);
  const cellEndCharacter = optionalNumber(diagnostic?.cellEndCharacter);
  const insertionPoint = optionalNumber(data?.insertionPoint);
  const fallback = {
    startCharacter,
    endCharacter,
    cellStartCharacter,
    cellEndCharacter,
    insertionPoint,
    localStart: null,
    localEnd: null,
    localInsertionPoint: null,
    isInsertionPoint: false,
    hasPreciseRange: false
  };
  if (cellValue == null || [startCharacter, endCharacter, cellStartCharacter, cellEndCharacter].some((value) => value == null)) {
    return fallback;
  }
  const cellLength = String(cellValue).length;
  const rawLocalStart = startCharacter - cellStartCharacter;
  const rawLocalEnd = endCharacter - cellStartCharacter;
  const rangeWithinCell = startCharacter >= cellStartCharacter
    && startCharacter <= cellEndCharacter
    && endCharacter >= cellStartCharacter
    && endCharacter <= cellEndCharacter
    && endCharacter >= startCharacter;
  const localRangeWithinKnownCell = rangeWithinCell
    && rawLocalStart >= 0
    && rawLocalStart <= cellLength
    && rawLocalEnd >= 0
    && rawLocalEnd <= cellLength
    && rawLocalEnd >= rawLocalStart;
  const localStart = localRangeWithinKnownCell ? rawLocalStart : null;
  const localEnd = localRangeWithinKnownCell ? rawLocalEnd : null;
  const structuredInsertionPoint = isStructuredInsertionPointData(data);
  const fallbackInsertionPoint = localInsertionPointFromData(insertionPoint, {
    cellStartCharacter,
    cellLength
  });
  const localInsertionPoint = structuredInsertionPoint && localRangeWithinKnownCell
    ? localStart
    : fallbackInsertionPoint;
  const zeroWidthRange = localRangeWithinKnownCell && startCharacter === endCharacter;
  const isInsertionPoint = (structuredInsertionPoint && localInsertionPoint != null) || zeroWidthRange;
  const fullCellRange = localRangeWithinKnownCell && localStart <= 0 && localEnd >= cellLength;
  return {
    ...fallback,
    localStart,
    localEnd,
    localInsertionPoint,
    isInsertionPoint,
    hasPreciseRange: isInsertionPoint || (localRangeWithinKnownCell && !fullCellRange)
  };
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOr(value, fallback) {
  const number = optionalNumber(value);
  return number == null ? fallback : number;
}

function isStructuredInsertionPointData(data) {
  return data?.kind === "missing-token" || data?.kind === "unexpected-eof";
}

function localInsertionPointFromData(insertionPoint, { cellStartCharacter, cellLength }) {
  if (insertionPoint == null) return null;
  if (insertionPoint >= 0 && insertionPoint <= cellLength) return insertionPoint;
  const absoluteLocalInsertionPoint = insertionPoint - cellStartCharacter;
  return absoluteLocalInsertionPoint >= 0 && absoluteLocalInsertionPoint <= cellLength
    ? absoluteLocalInsertionPoint
    : null;
}
