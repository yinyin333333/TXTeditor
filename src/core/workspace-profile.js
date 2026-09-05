import { normalizePath } from "./lint-paths.js";

export const WORKSPACE_PROFILE_EXTENSION = ".txtworkspace";

function absolutePath(value) {
  return typeof value === "string" && /^(?:[a-z]:[\\/]|[\\/]{2}|\/)/i.test(value) && !value.includes("\0");
}

function relativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error("Invalid workspace file path.");
  const path = value.replaceAll("\\", "/");
  if (path.startsWith("/") || path.includes(":") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Workspace file paths must stay inside the workspace folder.");
  }
  return path;
}

export function parseWorkspaceProfile(text) {
  const value = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!value || value.version !== 1 || !absolutePath(value.folder)
    || !Array.isArray(value.openFiles) || !Array.isArray(value.hiddenFiles)) {
    throw new Error("Invalid or unsupported workspace profile.");
  }
  const openFiles = [...new Set(value.openFiles.map(relativePath))];
  const hiddenFiles = [...new Set(value.hiddenFiles.map(relativePath))];
  const activeFile = value.activeFile == null ? null : relativePath(value.activeFile);
  if (activeFile && !openFiles.some((path) => normalizePath(path) === normalizePath(activeFile))) {
    throw new Error("The active file must be in openFiles.");
  }
  return { version: 1, folder: value.folder, openFiles, activeFile, hiddenFiles };
}

export function workspaceRelativePath(folder, path) {
  const root = String(folder).replaceAll("\\", "/").replace(/\/+$/, "");
  const file = String(path || "").replaceAll("\\", "/");
  if (!normalizePath(file).startsWith(`${normalizePath(root)}/`)) return null;
  return relativePath(file.slice(root.length + 1));
}

export function workspaceProfilePath(folder, relative) {
  return `${folder.replace(/[\\/]+$/, "")}/${relativePath(relative)}`;
}

export function createWorkspaceProfile(state) {
  const folder = state.workspace?.path;
  if (!folder) throw new Error("Open a folder before saving a workspace profile.");
  const openFiles = state.docs.map((doc) => workspaceRelativePath(folder, doc.path)).filter(Boolean);
  const activeFile = workspaceRelativePath(folder, state.docs[state.active]?.path);
  const hiddenFiles = (state.workspaceHiddenFiles ?? []).map((path) => workspaceRelativePath(folder, path)).filter(Boolean);
  return parseWorkspaceProfile(JSON.stringify({ version: 1, folder, openFiles, activeFile, hiddenFiles }));
}
