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

  const fileButton = (file) => {
    const hidden = hiddenKeys.has(pathKey(file.path));
    const action = tText(hidden ? "workspace.showFile" : "workspace.hideFile");
    return `<div class="workspace-file-row${hidden ? " is-hidden" : ""}"><button data-open-path="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}"><span class="workspace-file-name">${escapeHtml(file.name)}</span>${hidden ? `<span class="workspace-hidden-badge">${tText("workspace.hidden")}</span>` : ""}${problemBadgeForPath(file.path)}</button><button class="workspace-visibility-action" data-toggle-hidden-path="${escapeHtml(file.path)}" title="${escapeHtml(action)}" aria-label="${escapeHtml(action + ': ' + file.name)}">${tText(hidden ? "workspace.restore" : "workspace.hide")}</button></div>`;
  };
  if (subDirMap.size === 0) return rootFiles.map(fileButton).join("");

  const group = (label, files) => {
    const open = !collapsedFileGroups.has(label);
    return `<details class="file-group"${open ? " open" : ""} data-file-group="${escapeHtml(label)}"><summary class="file-group-label">${escapeHtml(label)}</summary><div class="file-group-content">${files.map(fileButton).join("")}</div></details>`;
  };

  return (rootFiles.length ? group("Data Files", rootFiles) : "")
    + [...subDirMap.entries()].map(([dir, files]) => group(dir, files)).join("");
}

export function renderExplorerSections({ state, openEditors, workspaceFiles, escapeHtml, pathKey = defaultPathKey }) {
  const sectionTitle = (label, count) => `<h3 class="explorer-section-title">${label}<span class="explorer-section-count">${count}</span></h3>`;
  const editors = `<section class="explorer-section explorer-open-editors" aria-label="${tText("workspace.openEditors")}">${sectionTitle(tText("workspace.openEditors"), state.docs.length)}${openEditors}</section>`;
  if (!state.workspace) return editors;
  const folder = state.workspace.path;
  const basename = (path) => String(path).replaceAll("\\", "/").replace(/\/+$/, "").split("/").at(-1) || path;
  const profile = state.workspaceProfilePath || "";
  return editors + `<section class="explorer-section explorer-workspace" aria-label="${tText("workspace.section")}"><header class="workspace-section-header"><h3 title="${escapeHtml(profile ? profile + "\n" + folder : folder)}">${escapeHtml(basename(profile || folder))}</h3><span class="explorer-section-count">${state.workspace.files?.length ?? 0}</span></header>${workspaceFiles}</section>`;
}
