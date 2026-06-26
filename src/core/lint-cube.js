import { clean, normalizeToken } from "./lint-table.js";

export function cubeInputCount(raw) {
  const match = clean(raw).match(/(?:^".*,qty=([0-9]+).*"$)|(?:^[^"]*,qty=([0-9]+))/i);
  if (!match) return 1;
  return Number.parseInt(match[1] ?? match[2], 10);
}

export function parseCubeItem(value) {
  const raw = clean(value);
  if (!raw) return { raw: "", code: "", qualifiers: [], qty: null };
  const quoted = raw.match(/"(.+)"/);
  const formula = quoted ? quoted[1] : raw;
  const parts = formula.split(",").map((part) => clean(part)).filter(Boolean);
  let code = parts[0] ?? "";
  const qualifiers = [];
  let qty = null;
  if (/^qty=\d+$/i.test(code)) {
    qty = Number(code.split("=")[1]);
    code = parts[1] ?? "";
    qualifiers.push(normalizeToken(parts[0]));
    qualifiers.push(...parts.slice(2).map(normalizeToken));
  } else {
    qualifiers.push(...parts.slice(1).map(normalizeToken));
  }
  for (const qualifier of qualifiers) {
    if (/^qty=\d+$/.test(qualifier)) qty = Number(qualifier.split("=")[1]);
  }
  return { raw, code, qualifiers, qty };
}

export function inputColumns(row, table) {
  const values = [];
  for (let index = 1; index <= 7; index += 1) {
    const columnName = `input ${index}`;
    if (table.hasColumn(columnName) && clean(row.get(columnName))) values.push(columnName);
  }
  return values;
}
