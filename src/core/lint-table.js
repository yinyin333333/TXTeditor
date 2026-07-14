import { baseName, documentKey } from "./lint-paths.js";

const DEFAULT_ROW_LABEL_COLUMNS = ["treasure class", "code", "id", "index", "name", "skill", "state", "description"];
const ROW_LABEL_COLUMNS = {
  "armor.txt": ["code", "name"],
  "cubemain.txt": ["description", "output", "input 1"],
  "itemstatcost.txt": ["stat"],
  "itemtypes.txt": ["code", "itemtype"],
  "misc.txt": ["code", "name"],
  "missiles.txt": ["missile"],
  "properties.txt": ["code"],
  "setitems.txt": ["index"],
  "skills.txt": ["skill"],
  "states.txt": ["state"],
  "superuniques.txt": ["superunique", "name"],
  "treasureclassex.txt": ["treasure class"],
  "uniqueitems.txt": ["index"],
  "weapons.txt": ["code", "name"]
};

export function uniqueDocuments(documents) {
  const seen = new Set();
  const result = [];
  for (const doc of documents ?? []) {
    const key = documentKey(doc);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(doc);
  }
  return result;
}

export function tableFromDocument(doc) {
  if (!doc || !isTxtLikeName(doc.name) && !isTxtLikeName(doc.path)) return null;
  const fileName = baseName(doc.path || doc.name).toLowerCase();
  const headerMap = new Map();
  const headers = doc.headers ?? doc.rows?.[0] ?? [];
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized && !headerMap.has(normalized)) headerMap.set(normalized, index);
  });
  return {
    doc,
    path: doc.path ?? "",
    fileName,
    fileKey: documentKey(doc),
    displayName: baseName(doc.path || doc.name || fileName),
    headers,
    rows: doc.rows ?? [],
    headerAt(column) {
      return headers[column] ?? `Column ${column + 1}`;
    },
    hasColumn(columnName) {
      return headerMap.has(normalizeHeader(columnName));
    },
    columnIndex(columnName) {
      return headerMap.get(normalizeHeader(columnName)) ?? 0;
    },
    eachRow(callback) {
      for (let rowIndex = 1; rowIndex < this.rows.length; rowIndex += 1) {
        if (String(this.rows[rowIndex]?.[0] ?? "").trimStart().startsWith("*")) continue;
        callback({
          table: this,
          rowIndex,
          get: (columnName) => this.rows[rowIndex]?.[this.columnIndex(columnName)] ?? ""
        });
      }
    }
  };
}

export function setFromColumn(tablesByName, fileName, columnName, options = {}) {
  const table = tablesByName.get(fileName);
  const values = new Set();
  if (!table?.hasColumn(columnName)) return values;
  table.eachRow((row) => {
    const value = clean(row.get(columnName));
    if (value) values.add(options.caseSensitive ? value : normalizeToken(value));
  });
  return values;
}

export function rowLabelFor(table, rowIndex) {
  if (rowIndex === 0) return "Header";
  const candidates = ROW_LABEL_COLUMNS[table.fileName] ?? DEFAULT_ROW_LABEL_COLUMNS;
  for (const columnName of candidates) {
    if (!table.hasColumn(columnName)) continue;
    const value = clean(table.rows[rowIndex]?.[table.columnIndex(columnName)]);
    if (value) return value;
  }
  const firstValue = clean(table.rows[rowIndex]?.find((value) => clean(value)));
  return firstValue || `Row ${rowIndex + 1}`;
}

export function rowLabelsForTable(table) {
  const labels = new Map();
  for (let rowIndex = 1; rowIndex < table.rows.length; rowIndex += 1) labels.set(rowIndex, rowLabelFor(table, rowIndex));
  return labels;
}

export function unionSets(...sets) {
  const values = new Set();
  for (const set of sets) for (const value of set) values.add(value);
  return values;
}

export function normalizeHeader(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

export function normalizeToken(value) {
  return clean(value).toLowerCase();
}

export function clean(value) {
  const text = String(value ?? "").trim();
  if (text.length >= 2 && text.startsWith("\"") && text.endsWith("\"")) return text.slice(1, -1).trim();
  return text;
}

export function isTxtLikeName(value) {
  return /\.(txt|tsv|tbl|csv)$/i.test(String(value ?? ""));
}
