import { baseName, documentKey, normalizePath } from "./lint-paths.js";
import { fixed4ccValues, propertyGroupsEnabled } from "./lint-reference-semantics.js";
import {
  rowLabelsForTable,
  setFromColumn,
  tableFromDocument,
  unionSets,
  uniqueDocuments
} from "./lint-table.js";

const DEFAULT_PROFILE = "RotW";

export function buildWorkspaceIndex(documents, profile = DEFAULT_PROFILE, {
  referenceDocuments = [],
  referenceVersion = null,
  workspaceFileNames = [],
  workspaceDocuments = null,
  siblingDocuments = [],
  siblingFileNames = [],
  openDocuments = null,
  referenceOpenDocuments = null
} = {}) {
  const tables = uniqueDocuments(documents).map(tableFromDocument).filter(Boolean);
  const workspacePresentPaths = new Set(workspaceFileNames.map((file) => documentKey({
    path: file?.path ?? file?.filePath,
    name: file?.name ?? file?.fileName
  })).filter(Boolean));
  const effectiveWorkspaceDocuments = workspaceDocuments === null
    ? documents.filter((doc) => workspacePresentPaths.has(documentKey(doc)))
    : workspaceDocuments;
  const effectiveOpenDocuments = openDocuments === null
    ? documents.filter((doc) => !workspacePresentPaths.has(documentKey(doc)))
    : openDocuments;
  const effectiveReferenceOpenDocuments = referenceOpenDocuments === null
    ? effectiveOpenDocuments
    : referenceOpenDocuments;
  const openDocumentKeys = new Set(effectiveOpenDocuments.map(documentKey));
  const diagnosticTableByDocumentKey = new Map(tables.map((table) => [documentKey(table.doc), table]));
  const tablesByName = new Map();
  // Preserve the first semantic table for ordinary workspace duplicates, then
  // overlay an opened basename so a user document is always the diagnostic and
  // reference authority even when another disk URI has the same filename.
  for (const table of tables) {
    if (openDocumentKeys.has(documentKey(table.doc))) continue;
    if (!tablesByName.has(table.fileName)) tablesByName.set(table.fileName, table);
  }
  const openTablesByName = new Map();
  for (const doc of uniqueDocuments(effectiveOpenDocuments)) {
    const table = diagnosticTableByDocumentKey.get(documentKey(doc)) ?? tableFromDocument(doc);
    if (table && !openTablesByName.has(table.fileName)) openTablesByName.set(table.fileName, table);
  }
  for (const [fileName, table] of openTablesByName) tablesByName.set(fileName, table);

  const selectedReferenceVersion = normalizeReferenceVersion(referenceVersion);
  const bundledTablesByName = new Map();
  for (const doc of uniqueDocuments(referenceDocuments)) {
    if (!doc?.lintReferenceBundled) continue;
    const documentVersion = normalizeReferenceVersion(doc.lintReferenceVersion);
    if (selectedReferenceVersion && documentVersion !== selectedReferenceVersion) continue;
    if (!selectedReferenceVersion && documentVersion) continue;
    const table = tableFromDocument(doc);
    if (table && !bundledTablesByName.has(table.fileName)) bundledTablesByName.set(table.fileName, table);
  }

  const referenceTablesByName = new Map();
  const referenceSourceByName = new Map();
  for (const [fileName, table] of bundledTablesByName) {
    referenceTablesByName.set(fileName, table);
    referenceSourceByName.set(fileName, {
      kind: "bundled",
      version: table.doc.lintReferenceVersion,
      digest: table.doc.lintReferenceDigest
    });
  }
  applyReferenceTier(referenceTablesByName, referenceSourceByName, {
    documents: effectiveWorkspaceDocuments,
    presentFiles: workspaceFileNames,
    kind: "workspace",
    diagnosticTableByDocumentKey
  });
  applyReferenceTier(referenceTablesByName, referenceSourceByName, {
    documents: siblingDocuments,
    presentFiles: siblingFileNames,
    kind: "sibling"
  });
  applyReferenceTier(referenceTablesByName, referenceSourceByName, {
    documents: effectiveReferenceOpenDocuments,
    presentFiles: effectiveReferenceOpenDocuments,
    kind: "open",
    diagnosticTableByDocumentKey
  });

  const itemCodes = unionSets(setFromColumn(referenceTablesByName, "armor.txt", "code"), setFromColumn(referenceTablesByName, "misc.txt", "code"), setFromColumn(referenceTablesByName, "weapons.txt", "code"));
  const properties = setFromColumn(referenceTablesByName, "properties.txt", "code", { caseSensitive: true });
  const propertyGroups = setFromColumn(referenceTablesByName, "propertygroups.txt", "code", { caseSensitive: true });
  const propertyReferenceValues = propertyGroupsEnabled({ profile, referenceVersion: selectedReferenceVersion })
    ? unionSets(properties, propertyGroups)
    : properties;
  const index = {
    profile,
    referenceVersion: selectedReferenceVersion,
    referenceTablesByName,
    referenceSourceByName,
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
    itemTypes: setFromColumn(referenceTablesByName, "itemtypes.txt", "code"),
    monModes: setFromColumn(referenceTablesByName, "monmode.txt", "code"),
    monSounds: setFromColumn(referenceTablesByName, "monsounds.txt", "id"),
    missiles: setFromColumn(referenceTablesByName, "missiles.txt", "missile"),
    overlays: setFromColumn(referenceTablesByName, "overlay.txt", "overlay"),
    sounds: setFromColumn(referenceTablesByName, "sounds.txt", "sound"),
    states: setFromColumn(referenceTablesByName, "states.txt", "state"),
    setItems: setFromColumn(referenceTablesByName, "setitems.txt", "index"),
    uniqueItems: setFromColumn(referenceTablesByName, "uniqueitems.txt", "index"),
    properties,
    propertyGroups,
    itemStats: setFromColumn(referenceTablesByName, "itemstatcost.txt", "stat"),
    skills: unionSets(setFromColumn(referenceTablesByName, "skills.txt", "skill"), setFromColumn(referenceTablesByName, "skills.txt", "Id")),
    skillDescs: setFromColumn(referenceTablesByName, "skilldesc.txt", "skilldesc"),
    treasureClasses: setFromColumn(referenceTablesByName, "treasureclassex.txt", "treasure class")
  };
  index.itemCodesFixed4 = fixed4ccValues(index, ["armor.txt", "misc.txt", "weapons.txt"], "code");
  index.itemTypesFixed4 = fixed4ccValues(index, ["itemtypes.txt"], "code");
  return index;
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
  const merged = workspaceDocs.map((doc) => openByKey.get(documentKey(doc)) ?? doc);
  const workspaceKeys = new Set(workspaceDocs.map(documentKey));
  for (const doc of openDocs) {
    if (!workspaceKeys.has(documentKey(doc))) merged.push(doc);
  }
  return merged;
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

function normalizeFileName(value) {
  return baseName(value?.path ?? value?.filePath ?? value?.name ?? value?.fileName ?? value ?? "").toLowerCase();
}

function applyReferenceTier(referenceTablesByName, referenceSourceByName, {
  documents = [],
  presentFiles = [],
  kind,
  diagnosticTableByDocumentKey = null
}) {
  // Presence is authoritative even when reading/parsing failed. Removing the
  // lower tier prevents a bad local sibling from being silently replaced by a
  // pristine bundled table and hiding the local problem.
  const presentNames = new Set(presentFiles.map(normalizeFileName).filter(Boolean));
  for (const fileName of presentNames) {
    referenceTablesByName.delete(fileName);
    referenceSourceByName.delete(fileName);
  }
  const tablesByName = new Map();
  for (const doc of uniqueDocuments(documents)) {
    const table = diagnosticTableByDocumentKey?.get(documentKey(doc)) ?? tableFromDocument(doc);
    if (table && !tablesByName.has(table.fileName)) tablesByName.set(table.fileName, table);
  }
  for (const [fileName, table] of tablesByName) {
    referenceTablesByName.set(fileName, table);
    referenceSourceByName.set(fileName, {
      kind,
      version: null,
      digest: null,
      path: table.path || table.displayName
    });
  }
}

function normalizeReferenceVersion(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "1.13" || normalized === "1.13c") return "1.13c";
  if (["2.4", "3.1", "3.2"].includes(normalized)) return normalized;
  return null;
}
