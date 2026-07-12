export function documentKey(doc) {
  return normalizePath(doc?.path || doc?.name || "");
}

export function normalizePath(value) {
  let normalized = String(value).replace(/\\/g, "/");
  if (normalized.toLowerCase().startsWith("//?/unc/")) {
    normalized = `//${normalized.slice(8)}`;
  } else if (normalized.startsWith("//?/")) {
    normalized = normalized.slice(4);
  }
  return normalized.toLowerCase();
}

export function baseName(path) {
  return String(path).replace(/\\/g, "/").split("/").pop() || String(path);
}
