import { encodeText } from "./text-codec.js";

export function downloadText(name, text, encoding = "utf-8") {
  const utf8 = String(encoding || "utf-8").toLowerCase() === "utf-8";
  const blob = new Blob([utf8 ? text : encodeText(text, encoding)], {
    type: utf8 ? "text/plain;charset=utf-8" : "application/octet-stream"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
