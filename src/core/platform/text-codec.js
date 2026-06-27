const WINDOWS_1252_DECODE = new Map([
  [0x80, 0x20AC],
  [0x82, 0x201A],
  [0x83, 0x0192],
  [0x84, 0x201E],
  [0x85, 0x2026],
  [0x86, 0x2020],
  [0x87, 0x2021],
  [0x88, 0x02C6],
  [0x89, 0x2030],
  [0x8A, 0x0160],
  [0x8B, 0x2039],
  [0x8C, 0x0152],
  [0x8E, 0x017D],
  [0x91, 0x2018],
  [0x92, 0x2019],
  [0x93, 0x201C],
  [0x94, 0x201D],
  [0x95, 0x2022],
  [0x96, 0x2013],
  [0x97, 0x2014],
  [0x98, 0x02DC],
  [0x99, 0x2122],
  [0x9A, 0x0161],
  [0x9B, 0x203A],
  [0x9C, 0x0153],
  [0x9E, 0x017E],
  [0x9F, 0x0178]
]);

const WINDOWS_1252_ENCODE = new Map([...WINDOWS_1252_DECODE.entries()].map(([byte, codePoint]) => [codePoint, byte]));

export function decodeBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  const utf8Bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: utf8Bom ? "utf-8-bom" : "utf-8"
    };
  } catch {
    return { text: decodeWindows1252(bytes), encoding: "windows-1252" };
  }
}

export function encodeText(text, encoding = "utf-8") {
  if (encoding === "windows-1252") return encodeWindows1252(text);
  const bytes = new TextEncoder().encode(text);
  if (encoding === "utf-8-bom") {
    const withBom = new Uint8Array(bytes.length + 3);
    withBom.set([0xEF, 0xBB, 0xBF], 0);
    withBom.set(bytes, 3);
    return withBom;
  }
  return bytes;
}

export function decodeWindows1252(bytes) {
  return [...bytes].map((byte) => String.fromCodePoint(WINDOWS_1252_DECODE.get(byte) ?? byte)).join("");
}

export function encodeWindows1252(text) {
  const bytes = [];
  for (const char of String(text)) {
    const codePoint = char.codePointAt(0);
    if (codePoint <= 0x7F || (codePoint >= 0xA0 && codePoint <= 0xFF)) {
      bytes.push(codePoint);
    } else if (WINDOWS_1252_ENCODE.has(codePoint)) {
      bytes.push(WINDOWS_1252_ENCODE.get(codePoint));
    } else {
      throw new Error(`Character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} cannot be saved as Windows-1252.`);
    }
  }
  return new Uint8Array(bytes);
}
