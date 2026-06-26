export function documentKey(doc) {
  return normalizePath(doc?.path || doc?.name || "");
}

export function normalizePath(value) {
  return String(value).replace(/\\/g, "/").toLowerCase();
}

export function baseName(path) {
  return String(path).replace(/\\/g, "/").split("/").pop() || String(path);
}
