import { normalizeFilePathKey } from "./file-identity.js";

export function docToUri(doc) {
  if (!doc?.path) return null;
  const normalized = String(doc.path).replace(/\\/g, "/");
  const isUnc = normalized.startsWith("//");
  const encoded = encodeFilePath(isUnc ? normalized.slice(2) : normalized);
  const base = isUnc ? `file://${encoded}` : normalized.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
  try { return new URL(base).href; } catch { return base; }
}

export function uriToFileKey(uri, pathKey = defaultLspPathKey) {
  return pathKey(pathFromUri(uri) ?? safeDecodeURIComponent(String(uri || "")));
}

export function pathFromUri(uri) {
  const value = String(uri || "");
  if (!value.toLowerCase().startsWith("file://")) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "file:") return null;
    const decodedPath = safeDecodeURIComponent(parsed.pathname || "");
    if (parsed.host) return `//${parsed.host}${decodedPath}`;
    if (/^\/[a-zA-Z]:\//.test(decodedPath)) return decodedPath.slice(1);
    return decodedPath || "/";
  } catch {
    return legacyPathFromUri(value);
  }
}

export function fileNameFromUri(uri) {
  const pathValue = pathFromUri(uri) ?? String(uri || "");
  return safeDecodeURIComponent(pathValue.split(/[\\/]/).pop() || pathValue);
}

function defaultLspPathKey(pathValue) {
  return normalizeFilePathKey(pathValue);
}

function encodeFilePath(pathValue) {
  return pathValue
    .split("/")
    .map((segment, index) => {
      const encoded = encodeURIComponent(segment);
      if (index === 0 && /^[a-zA-Z]%3A$/.test(encoded)) return `${encoded[0]}:`;
      return encoded;
    })
    .join("/");
}

function legacyPathFromUri(value) {
  if (value.startsWith("file:///")) {
    const decoded = safeDecodeURIComponent(value.slice(8));
    return /^[a-zA-Z]:\//.test(decoded) ? decoded : `/${decoded}`;
  }
  if (value.startsWith("file://")) return `//${safeDecodeURIComponent(value.slice(7))}`;
  return null;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
