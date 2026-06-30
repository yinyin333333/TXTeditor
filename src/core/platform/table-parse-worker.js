import { parseTableText } from "../table-parser.js";
import { decodeBuffer } from "./text-codec.js";

self.onmessage = (event) => {
  const { id, buffer, text, fileSizeBytes } = event.data ?? {};
  try {
    const decoded = buffer ? decodeBuffer(buffer) : { text: String(text ?? ""), encoding: event.data?.encoding };
    const parsed = parseTableText(decoded.text);
    self.postMessage({
      id,
      parsed,
      encoding: decoded.encoding,
      fileSizeBytes: fileSizeBytes ?? decoded.text.length
    });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
