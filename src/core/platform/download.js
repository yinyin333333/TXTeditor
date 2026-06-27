export function downloadText(name, text) {
  return downloadBytes(name, text, "text/plain;charset=utf-8");
}

export function downloadBytes(name, bytes, type = "text/plain") {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
