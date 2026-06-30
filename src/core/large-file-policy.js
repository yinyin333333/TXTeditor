export const LARGE_FILE_THRESHOLDS = {
  fileSizeBytes: 25 * 1024 * 1024,
  rows: 100000,
  columns: 2000,
  cells: 5000000
};

export function largeFileInfo({
  fileSizeBytes = 0,
  rowCount = 0,
  columnCount = 0,
  thresholds = LARGE_FILE_THRESHOLDS
} = {}) {
  const safeFileSizeBytes = Math.max(0, Math.floor(Number(fileSizeBytes) || 0));
  const safeRowCount = Math.max(0, Math.floor(Number(rowCount) || 0));
  const safeColumnCount = Math.max(0, Math.floor(Number(columnCount) || 0));
  const estimatedCellCount = safeRowCount * safeColumnCount;
  const reasons = [];
  if (safeFileSizeBytes >= thresholds.fileSizeBytes) reasons.push("file-size");
  if (safeRowCount >= thresholds.rows) reasons.push("row-count");
  if (safeColumnCount >= thresholds.columns) reasons.push("column-count");
  if (estimatedCellCount >= thresholds.cells) reasons.push("cell-count");
  return {
    fileSizeBytes: safeFileSizeBytes,
    rowCount: safeRowCount,
    columnCount: safeColumnCount,
    estimatedCellCount,
    largeFileMode: reasons.length > 0,
    reasons
  };
}
