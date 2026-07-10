const CP1252_SPECIAL = new Map([
  [0x80, 0x20AC], [0x82, 0x201A], [0x83, 0x0192], [0x84, 0x201E],
  [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02C6],
  [0x89, 0x2030], [0x8A, 0x0160], [0x8B, 0x2039], [0x8C, 0x0152],
  [0x8E, 0x017D], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201C],
  [0x94, 0x201D], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014],
  [0x98, 0x02DC], [0x99, 0x2122], [0x9A, 0x0161], [0x9B, 0x203A],
  [0x9C, 0x0153], [0x9E, 0x017E], [0x9F, 0x0178]
]);

const CP1252_REVERSE = new Map([...CP1252_SPECIAL].map(([byte, codePoint]) => [codePoint, byte]));
const CP1252_UNDEFINED_CONTROLS = new Set([0x81, 0x8D, 0x8F, 0x90, 0x9D]);

export function decodeBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (startsWithBytes(bytes, [0xFF, 0xFE])) {
    return { text: new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2)), encoding: "utf-16le" };
  }
  if (startsWithBytes(bytes, [0xFE, 0xFF])) {
    return { text: new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2)), encoding: "utf-16be" };
  }
  if (startsWithBytes(bytes, [0xEF, 0xBB, 0xBF])) {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(3)), encoding: "utf-8-bom" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: decodeWindows1252(bytes), encoding: "windows-1252" };
  }
}

export function encodeText(text, encoding = "utf-8", { includeBom = true } = {}) {
  const normalized = String(encoding || "utf-8").toLowerCase();
  if (normalized === "utf-8") return new TextEncoder().encode(text);
  if (normalized === "utf-8-bom") {
    return concatBytes(includeBom ? [0xEF, 0xBB, 0xBF] : [], new TextEncoder().encode(text));
  }
  if (normalized === "windows-1252" || normalized === "windows-1252-lossy") {
    return encodeWindows1252(text);
  }
  if (normalized === "utf-16le" || normalized === "utf-16be") {
    return encodeUtf16(text, normalized === "utf-16le", includeBom);
  }
  throw new Error(`Unsupported text encoding: ${encoding}`);
}

function decodeWindows1252(bytes) {
  return Array.from(bytes, (byte) => String.fromCodePoint(CP1252_SPECIAL.get(byte) ?? byte)).join("");
}

function encodeWindows1252(text) {
  const bytes = [];
  for (const character of String(text)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7F || (codePoint >= 0xA0 && codePoint <= 0xFF)) {
      bytes.push(codePoint);
      continue;
    }
    if (CP1252_UNDEFINED_CONTROLS.has(codePoint)) {
      bytes.push(codePoint);
      continue;
    }
    const byte = CP1252_REVERSE.get(codePoint);
    if (byte == null) throw new Error(`Character ${character} (U+${codePoint.toString(16).toUpperCase()}) cannot be encoded as Windows-1252.`);
    bytes.push(byte);
  }
  return Uint8Array.from(bytes);
}

function encodeUtf16(text, littleEndian, includeBom) {
  const bytes = [];
  if (includeBom) bytes.push(...(littleEndian ? [0xFF, 0xFE] : [0xFE, 0xFF]));
  for (let index = 0; index < String(text).length; index++) {
    const unit = String(text).charCodeAt(index);
    bytes.push(...(littleEndian ? [unit & 0xFF, unit >>> 8] : [unit >>> 8, unit & 0xFF]));
  }
  return Uint8Array.from(bytes);
}

function startsWithBytes(bytes, prefix) {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

function concatBytes(prefix, body) {
  const result = new Uint8Array(prefix.length + body.length);
  result.set(prefix, 0);
  result.set(body, prefix.length);
  return result;
}
