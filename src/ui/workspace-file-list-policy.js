import { tText } from "../core/i18n.js";

function defaultPathKey(path) {
  return String(path || "").replace(/\\/g, "/").toLowerCase();
}

export function renderWorkspaceFileList({
  workspace,
  docs = [],
  hiddenFiles = [],
  showHiddenFiles = false,
  collapsedFileGroups = new Set(),
  pathKey = defaultPathKey,
  escapeHtml,
  problemBadgeForPath
}) {
  if (!workspace?.files?.length) return "";
  const seenKeys = new Set(docs.map((doc) => pathKey(doc.path || "")));
  const hiddenKeys = new Set(hiddenFiles.map(pathKey));
  const workspaceKey = pathKey(workspace.path).replace(/\/$/, "");
  const rootFiles = [];
  const subDirMap = new Map();

  for (const file of workspace.files) {
    const key = pathKey(file.path);
    if (hiddenKeys.has(key) && !showHiddenFiles) continue;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const relativePath = key.startsWith(`${workspaceKey}/`) ? key.slice(workspaceKey.length + 1) : file.name;
    const slash = relativePath.indexOf("/");
    if (slash < 0) {
      rootFiles.push(file);
    } else {
      const dir = relativePath.slice(0, slash);
      if (!subDirMap.has(dir)) subDirMap.set(dir, []);
      subDirMap.get(dir).push(file);
    }
  }

  const fileButton = (file) => `<div class="workspace-file-row"><button data-open-path="${escapeHtml(file.path)}">${escapeHtml(file.name)}${problemBadgeForPath(file.path)}</button><button data-toggle-hidden-path="${escapeHtml(file.path)}" title="${hiddenKeys.has(pathKey(file.path)) ? tText("workspace.showFile") : tText("workspace.hideFile")}" aria-label="${hiddenKeys.has(pathKey(file.path)) ? tText("workspace.showFile") : tText("workspace.hideFile")}">${hiddenKeys.has(pathKey(file.path)) ? "+" : "−"}</button></div>`;
  if (subDirMap.size === 0) return rootFiles.map(fileButton).join("");

  const group = (label, files) => {
    const open = !collapsedFileGroups.has(label);
    return `<details class="file-group"${open ? " open" : ""} data-file-group="${escapeHtml(label)}"><summary class="file-group-label">${escapeHtml(label)}</summary><div class="file-group-content">${files.map(fileButton).join("")}</div></details>`;
  };

  return (rootFiles.length ? group("Data Files", rootFiles) : "")
    + [...subDirMap.entries()].map(([dir, files]) => group(dir, files)).join("");
}
