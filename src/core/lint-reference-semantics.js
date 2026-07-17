// Binary-backed lookup helpers shared by Legacy lint rules. Packed TXT codes
// copy at most four UTF-8 bytes from the decoded document and space-pad the
// stored value, matching Vector-LSP's byte key; unlike name maps, comparison
// is case-sensitive and does not trim or unquote the cell.
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");

export function fixed4cc(value) {
  const packed = new Uint8Array([0x20, 0x20, 0x20, 0x20]);
  packed.set(UTF8_ENCODER.encode(String(value ?? "")).subarray(0, 4));
  return UTF8_DECODER.decode(packed);
}

// Lookup identity stays byte-exact even when the fourth byte truncates a
// multibyte UTF-8 sequence. Decoding that byte sequence for display would map
// distinct values such as `abcé` and `abc€` to the same replacement glyph.
export function fixed4Key(value) {
  const packed = new Uint8Array([0x20, 0x20, 0x20, 0x20]);
  packed.set(UTF8_ENCODER.encode(String(value ?? "")).subarray(0, 4));
  return [...packed].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function fitsFixed4cc(value) {
  return UTF8_ENCODER.encode(String(value ?? "")).length <= 4;
}

export function asciiLower(value) {
  return String(value ?? "").replace(/[A-Z]/g, (character) => character.toLowerCase());
}

export function exactOuterUnquote(value) {
  const text = String(value ?? "");
  if (text.length >= 2 && text.startsWith("\"") && text.endsWith("\"")) return text.slice(1, -1);
  return text;
}

export function propertyGroupsEnabled(index) {
  const version = String(index?.referenceVersion ?? "").trim().toLowerCase();
  if (version === "1.13" || version === "1.13c" || version === "2.4") return false;
  if (version === "3.1" || version === "3.2") return true;
  return index?.profile === "RotW";
}

export function referenceTable(index, fileName) {
  // A missing entry in an explicit reference map can be intentional: an
  // unreadable local workspace/sibling file blocks lower fallback tiers. Only
  // old/simple indexes without a reference map may fall back to tablesByName.
  if (index?.referenceTablesByName instanceof Map) return index.referenceTablesByName.get(fileName);
  return index?.tablesByName?.get(fileName);
}

export function fixed4ccValues(index, fileNames, columnName) {
  const values = new Set();
  for (const fileName of fileNames) {
    const table = referenceTable(index, fileName);
    if (!table?.hasColumn(columnName)) continue;
    table.eachRow((row) => {
      const value = String(row.get(columnName) ?? "");
      if (value) values.add(fixed4Key(value));
    });
  }
  return values;
}

export function asciiCaseInsensitiveValues(index, fileNames, columnName) {
  const values = new Set();
  for (const fileName of fileNames) {
    const table = referenceTable(index, fileName);
    if (!table?.hasColumn(columnName)) continue;
    table.eachRow((row) => {
      const value = String(row.get(columnName) ?? "");
      if (value) values.add(asciiLower(value));
    });
  }
  return values;
}
