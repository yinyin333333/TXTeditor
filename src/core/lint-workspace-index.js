import { baseName, documentKey, normalizePath } from "./lint-paths.js";
import {
  rowLabelsForTable,
  setFromColumn,
  tableFromDocument,
  unionSets,
  uniqueDocuments
} from "./lint-table.js";

const DEFAULT_PROFILE = "RotW";

export function buildWorkspaceIndex(documents, profile = DEFAULT_PROFILE) {
  const tables = uniqueDocuments(documents).map(tableFromDocument).filter(Boolean);
  const tablesByName = new Map();
  for (const table of tables) tablesByName.set(table.fileName, table);
  const itemCodes = unionSets(setFromColumn(tablesByName, "armor.txt", "code"), setFromColumn(tablesByName, "misc.txt", "code"), setFromColumn(tablesByName, "weapons.txt", "code"));
  const properties = setFromColumn(tablesByName, "properties.txt", "code", { caseSensitive: true });
  const propertyGroups = setFromColumn(tablesByName, "propertygroups.txt", "code", { caseSensitive: true });
  const propertyReferenceValues = profile === "RotW" ? unionSets(properties, propertyGroups) : properties;
  return {
    profile,
    files: buildWorkspaceFileStates(
      tables.map((table) => ({ path: table.path || table.displayName, name: table.displayName })),
      tables.map((table) => table.doc)
    ),
    tables,
    tablesByName,
    columnsByFile: new Map(tables.map((table) => [table.fileKey, [...table.headers]])),
    rowLabelsByFile: new Map(tables.map((table) => [table.fileKey, rowLabelsForTable(table)])),
    hasWorkspace: tables.length > 1,
    itemCodes,
    allProperties: propertyReferenceValues,
    itemTypes: setFromColumn(tablesByName, "itemtypes.txt", "code"),
    monModes: setFromColumn(tablesByName, "monmode.txt", "code"),
    monSounds: setFromColumn(tablesByName, "monsounds.txt", "id"),
    missiles: setFromColumn(tablesByName, "missiles.txt", "missile"),
    overlays: setFromColumn(tablesByName, "overlay.txt", "overlay"),
    sounds: setFromColumn(tablesByName, "sounds.txt", "sound"),
    states: setFromColumn(tablesByName, "states.txt", "state"),
    setItems: setFromColumn(tablesByName, "setitems.txt", "index"),
    uniqueItems: setFromColumn(tablesByName, "uniqueitems.txt", "index"),
    properties,
    propertyGroups,
    itemStats: setFromColumn(tablesByName, "itemstatcost.txt", "stat"),
    skills: unionSets(setFromColumn(tablesByName, "skills.txt", "skill"), setFromColumn(tablesByName, "skills.txt", "Id")),
    skillDescs: setFromColumn(tablesByName, "skilldesc.txt", "skilldesc"),
    treasureClasses: setFromColumn(tablesByName, "treasureclassex.txt", "treasure class")
  };
}

export function buildWorkspaceFileStates(explorerFiles = [], documents = [], parseErrors = new Map()) {
  const docsByKey = new Map(uniqueDocuments(documents).map((doc) => [documentKey(doc), doc]));
  const files = new Map();
  for (const file of explorerFiles) {
    const filePath = file.path ?? file.filePath ?? file.name ?? file.fileName ?? "";
    const fileName = file.name ?? file.fileName ?? baseName(filePath);
    const key = normalizePath(filePath || fileName);
    const doc = docsByKey.get(key);
    const parseError = parseErrors instanceof Map ? parseErrors.get(key) : parseErrors?.[key];
    files.set(key, {
      filePath,
      fileName,
      listedInExplorer: true,
      openedInTab: Boolean(doc?.openedInTab),
      readForLint: Boolean(doc || parseError),
      loadedForIndex: Boolean(doc || parseError),
      parsedForLint: Boolean(doc && !parseError),
      parseError: parseError || "",
      columns: doc?.headers ?? doc?.rows?.[0] ?? [],
      rowCount: doc?.rowCount ?? doc?.rows?.length ?? 0,
      rowLabels: doc ? rowLabelsForTable(tableFromDocument(doc)) : new Map(),
      table: doc ? tableFromDocument(doc) : null
    });
  }
  for (const doc of documents) {
    const key = documentKey(doc);
    if (files.has(key)) continue;
    files.set(key, {
      filePath: doc.path ?? "",
      fileName: doc.name ?? baseName(doc.path ?? ""),
      listedInExplorer: false,
      openedInTab: Boolean(doc.openedInTab),
      readForLint: true,
      loadedForIndex: true,
      parsedForLint: true,
      parseError: "",
      columns: doc.headers ?? doc.rows?.[0] ?? [],
      rowCount: doc.rowCount ?? doc.rows?.length ?? 0,
      rowLabels: rowLabelsForTable(tableFromDocument(doc)),
      table: tableFromDocument(doc)
    });
  }
  return files;
}

export function legacyWorkspaceFileSignature(files = []) {
  return files.map((file) => [
    documentKey({ path: file.path, name: file.name }),
    file.modified_ms ?? file.modifiedMs ?? "",
    file.size ?? ""
  ].join(":")).join("\u001f");
}

export function mergeOpenLegacyWorkspaceDocs(workspaceDocs = [], openDocs = []) {
  const openByKey = new Map(openDocs.map((doc) => [documentKey(doc), doc]));
  return workspaceDocs.map((doc) => openByKey.get(documentKey(doc)) ?? doc);
}

export function legacyWorkspaceLoadCacheHit(workspaceLoad = {}, signature = "") {
  return workspaceLoad.status === "ready" && workspaceLoad.signature === signature;
}

export function legacyWorkspaceIndexCacheHit(cache = {}, signature = "", profile = DEFAULT_PROFILE) {
  if (cache.index && cache.signature === signature && cache.profile === profile) {
    return { index: cache.index, ms: 0, cached: true };
  }
  return null;
}
