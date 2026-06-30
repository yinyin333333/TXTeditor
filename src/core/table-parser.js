export function parseTableText(text) {
  const source = String(text ?? "");
  const crlf = (source.match(/\r\n/g) ?? []).length;
  const lf = (source.match(/(?<!\r)\n/g) ?? []).length;
  const lineEnding = crlf >= lf && crlf > 0 ? "\r\n" : "\n";
  const finalNewline = source.endsWith("\n") || source.endsWith("\r");
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (finalNewline) lines.pop();
  return {
    rows: lines.map((line) => line.split("\t")),
    lineEnding,
    finalNewline
  };
}
