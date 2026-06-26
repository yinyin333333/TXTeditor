const LEGACY_DECODERS = ["utf-8", "windows-1252"];

export function decodeBuffer(buffer) {
  for (const encoding of LEGACY_DECODERS) {
    const decoder = new TextDecoder(encoding, { fatal: encoding === "utf-8" });
    try {
      return { text: decoder.decode(buffer), encoding };
    } catch {
      // Try the next practical legacy encoding.
    }
  }
  return { text: new TextDecoder().decode(buffer), encoding: "utf-8" };
}

export function encodeText(text, encoding = "utf-8") {
  if (encoding !== "utf-8") {
    return new TextEncoder().encode(text);
  }
  return new TextEncoder().encode(text);
}
