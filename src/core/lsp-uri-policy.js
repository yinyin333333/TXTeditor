export function docToUri(doc) {
  if (!doc?.path) return null;
  const normalized = String(doc.path).replace(/\\/g, "/");
  const isUnc = normalized.startsWith("//");
  const encoded = encodeFilePath(isUnc ? normalized.slice(2) : normalized);
  const base = isUnc ? `file://${encoded}` : normalized.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
  try { return new URL(base).href; } catch { return base; }
}

export function lspSiblingParentPath(pathValue) {
  const value = String(pathValue || "").trim();
  const separatorIndex = Math.max(value.lastIndexOf("\\"), value.lastIndexOf("/"));
  if (separatorIndex < 0) return null;
  if (separatorIndex === 0) return value[0];
  const parent = value.slice(0, separatorIndex);
  if (/^[a-zA-Z]:$/.test(parent)) return `${parent}${value[separatorIndex]}`;
  return parent || null;
}

export function lspStandaloneParentPath(pathValue, workspacePath = "", { includeSubfolders = true } = {}) {
  const parent = lspSiblingParentPath(pathValue);
  if (!parent) return null;
  const fileKey = normalizedDirectoryIdentity(pathValue);
  const workspaceKey = normalizedDirectoryIdentity(workspacePath).replace(/\/$/, "");
  if (workspaceKey && (fileKey === workspaceKey || fileKey.startsWith(`${workspaceKey}/`))) {
    if (includeSubfolders || normalizedDirectoryIdentity(parent).replace(/\/$/, "") === workspaceKey) return null;
  }
  return parent;
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
  return String(pathValue || "").replace(/\\/g, "/").toLowerCase();
}

function normalizedDirectoryIdentity(pathValue) {
  return String(pathValue || "").trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
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
