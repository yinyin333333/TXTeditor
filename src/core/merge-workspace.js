import { TableDocument } from "./table-model.js";
import {
  acknowledgeMergeSchema,
  materializeMergeFile,
  mergeFileCanSave,
  mergeTableDocuments,
  refreshMergeFileStatus,
  serializeMergeFile,
  unresolvedMergeConflicts
} from "./merge-engine.js";
import { isTxtLikeName } from "./lint-table.js";

export function normalizeMergeRelativePath(path, root = "") {
  const normalizedPath = normalizeSlashes(path);
  const normalizedRoot = normalizeSlashes(root).replace(/\/$/, "");
  let relative = normalizedPath;
  if (normalizedRoot && pathStartsWith(relative, normalizedRoot)) relative = relative.slice(normalizedRoot.length).replace(/^\//, "");
  return relative.replace(/^\.\//, "");
}

export function canonicalMergeFileKey(relativePath) {
  let value = normalizeSlashes(relativePath).replace(/^\.\//, "").toLowerCase();
  const excelMarker = "/global/excel/";
  const markerIndex = value.lastIndexOf(excelMarker);
  if (markerIndex >= 0) value = value.slice(markerIndex + excelMarker.length);
  value = value.replace(/^(?:data\/)?global\/excel\//, "").replace(/^excel\//, "");
  return value;
}

export function mergeInputFileFromPayload(payload, { root = "", relativePath = "" } = {}) {
  if (!payload) return null;
  const path = payload.path || payload.name || relativePath;
  const resolvedRelativePath = relativePath || normalizeMergeRelativePath(path, root) || payload.name;
  return {
    name: payload.name || fileNameFromPath(resolvedRelativePath),
    path,
    relativePath: resolvedRelativePath,
    text: String(payload.text ?? ""),
    encoding: payload.encoding || "utf-8",
    sizeBytes: payload.sizeBytes ?? payload.bytes ?? String(payload.text ?? "").length
  };
}

export function referenceFilesFromDataset(dataset) {
  return (dataset?.files ?? [])
    .filter((file) => isTxtLikeName(file.name))
    .map((file) => mergeInputFileFromPayload({ ...file, path: file.name }, { relativePath: file.name }));
}

export function analyzeFileMerge({ baseFile = null, aFile, bFile, gameVersion = "", outputPath = "" }) {
  if (!aFile || !bFile) throw new Error("File merge requires both A and B files.");
  const aKey = canonicalMergeFileKey(aFile.relativePath || aFile.name);
  const bKey = canonicalMergeFileKey(bFile.relativePath || bFile.name);
  if (aKey !== bKey) throw new Error(`A and B are different tables (${aFile.name} / ${bFile.name}).`);
  const file = analyzePair({ key: aKey, baseFile, aFile, bFile, sidePresence: { a: true, b: true } });
  file.includeInOutput = true;
  return createMergeSession({ kind: "file", gameVersion, outputPath, files: [file] });
}

export function analyzeFolderMerge({ baseFiles = [], aFiles = [], bFiles = [], gameVersion = "", aPath = "", bPath = "", outputPath = "" }) {
  const baseMap = uniqueFileMap(baseFiles, "built-in original");
  const aMap = uniqueFileMap(aFiles, "A");
  const bMap = uniqueFileMap(bFiles, "B");
  const keys = orderedUnion([...aMap.keys()], [...bMap.keys()]);
  const files = [];
  for (const key of keys) {
    const baseFile = baseMap.get(key) ?? null;
    const aFile = aMap.get(key) ?? null;
    const bFile = bMap.get(key) ?? null;
    const sidePresence = { a: Boolean(aFile), b: Boolean(bFile) };
    if (!baseFile && !aFile && !bFile) continue;
    if (!baseFile && (!aFile || !bFile)) {
      files.push(createCustomCopyResult({ key, aFile, bFile }));
      continue;
    }
    const file = analyzePair({
      key,
      baseFile,
      aFile: aFile ?? baseFile,
      bFile: bFile ?? baseFile,
      sidePresence
    });
    if (!baseFile) {
      file.custom = true;
      file.statusDetail = "Reference does not contain this custom file; A and B were compared conservatively without the built-in original.";
      refreshMergeFileStatus(file);
    }
    files.push(file);
  }
  if (!files.length) throw new Error("The selected folders contain no supported tabular text files to merge.");
  return createMergeSession({ kind: "folder", gameVersion, aPath, bPath, outputPath, files });
}

export function createMergeSession({ kind, gameVersion, aPath = "", bPath = "", outputPath = "", files = [] }) {
  const session = {
    kind,
    gameVersion,
    aPath,
    bPath,
    outputPath,
    stage: files.some((file) => unresolvedMergeConflicts(file).length) ? "conflicts" : "review",
    files,
    selectedFileId: files[0]?.id ?? null,
    createdAt: Date.now(),
    savedAt: null
  };
  refreshMergeSession(session);
  return session;
}

export function refreshMergeSession(session) {
  for (const file of session?.files ?? []) refreshMergeFileStatus(file);
  session.summary = mergeSessionSummary(session);
  if (session.summary.unresolvedConflicts) session.stage = "conflicts";
  else if (session.stage !== "saved" && session.stage !== "saving") session.stage = "review";
  return session;
}

export function mergeSessionSummary(session) {
  const summary = {
    totalFiles: 0,
    outputFiles: 0,
    unchangedFiles: 0,
    autoMergedFiles: 0,
    conflictFiles: 0,
    resolvedFiles: 0,
    schemaMismatchFiles: 0,
    customFiles: 0,
    aOnlyFiles: 0,
    bOnlyFiles: 0,
    unresolvedConflicts: 0,
    resolvedConflicts: 0,
    changedCells: 0,
    addedRows: 0,
    deletedRows: 0
  };
  for (const file of session?.files ?? []) {
    summary.totalFiles += 1;
    if (file.includeInOutput !== false) summary.outputFiles += 1;
    if (file.status === "unchanged") summary.unchangedFiles += 1;
    if (file.status === "auto-merged") summary.autoMergedFiles += 1;
    if (file.status === "conflict") summary.conflictFiles += 1;
    if (file.status === "resolved") summary.resolvedFiles += 1;
    if (file.status === "schema-mismatch") summary.schemaMismatchFiles += 1;
    if (file.custom) summary.customFiles += 1;
    if (file.sidePresence?.a && !file.sidePresence?.b) summary.aOnlyFiles += 1;
    if (file.sidePresence?.b && !file.sidePresence?.a) summary.bOnlyFiles += 1;
    summary.unresolvedConflicts += unresolvedMergeConflicts(file).length;
    summary.resolvedConflicts += file.conflicts.length - unresolvedMergeConflicts(file).length;
    summary.changedCells += file.metrics?.changedCells ?? 0;
    summary.addedRows += file.metrics?.addedRows ?? 0;
    summary.deletedRows += file.metrics?.deletedRows ?? 0;
  }
  return summary;
}

export function mergeSessionCanSave(session) {
  const includedFiles = (session?.files ?? []).filter((file) => file.includeInOutput !== false);
  return includedFiles.length >= 1 && includedFiles.every((file) => mergeFileCanSave(file));
}

export function acknowledgeAllMergeSchemas(session, acknowledged = true) {
  for (const file of session?.files ?? []) acknowledgeMergeSchema(file, acknowledged);
  return refreshMergeSession(session);
}

export function mergeOutputPayload(session) {
  if (!mergeSessionCanSave(session)) throw new Error("Resolve all conflicts and acknowledge schema warnings before saving.");
  return (session.files ?? [])
    .filter((file) => file.includeInOutput !== false)
    .map((file) => ({
      relativePath: file.outputRelativePath || file.relativePath || file.name,
      text: serializeMergeFile(file),
      encoding: file.result?.encoding || "utf-8"
    }));
}

function analyzePair({ key, baseFile, aFile, bFile, sidePresence }) {
  const base = documentFromMergeFile(baseFile);
  const a = documentFromMergeFile(aFile);
  const b = documentFromMergeFile(bFile);
  const outputRelativePath = aFile?.relativePath || bFile?.relativePath || baseFile?.relativePath || key;
  const result = mergeTableDocuments({
    base,
    a,
    b,
    fileName: aFile?.name || bFile?.name || baseFile?.name || fileNameFromPath(key),
    relativePath: outputRelativePath,
    sidePresence
  });
  result.outputRelativePath = outputRelativePath;
  result.sidePresence = sidePresence;
  result.referencePath = baseFile?.relativePath ?? "";
  result.inputPaths = { a: aFile?.path ?? "", b: bFile?.path ?? "" };
  if (!sidePresence.a || !sidePresence.b) {
    result.statusDetail = !sidePresence.a ? "A file absent; treated as unchanged built-in original" : "B file absent; treated as unchanged built-in original";
    const preferredFormat = sidePresence.a ? "a" : sidePresence.b ? "b" : "base";
    if (result.docs?.[preferredFormat]) result.formatSource = preferredFormat;
    materializeMergeFile(result);
  }
  result.includeInOutput = result.status !== "unchanged" || !baseFile;
  return result;
}

function createCustomCopyResult({ key, aFile, bFile }) {
  const source = aFile ?? bFile;
  const document = documentFromMergeFile(source);
  const side = aFile ? "a" : "b";
  const file = mergeTableDocuments({
    base: null,
    a: aFile ? document : null,
    b: bFile ? document : null,
    fileName: source.name,
    relativePath: source.relativePath,
    sidePresence: { a: Boolean(aFile), b: Boolean(bFile) }
  });
  file.custom = true;
  file.overrideSource = side;
  file.conflicts = [];
  file.warnings = [];
  file._model = null;
  file.outputRelativePath = source.relativePath || key;
  file.includeInOutput = true;
  file.statusDetail = `Reference does not contain this custom file; copied from ${side.toUpperCase()}.`;
  materializeMergeFile(file);
  refreshMergeFileStatus(file);
  return file;
}

function documentFromMergeFile(file) {
  if (!file) return null;
  return TableDocument.fromText(file.name || fileNameFromPath(file.relativePath), file.text, {
    path: file.path || file.relativePath,
    encoding: file.encoding || "utf-8",
    fileSizeBytes: file.sizeBytes
  });
}

function uniqueFileMap(files, label) {
  const map = new Map();
  for (const file of files ?? []) {
    if (!file || !isTxtLikeName(file.name || file.relativePath || file.path)) continue;
    const key = canonicalMergeFileKey(file.relativePath || file.name || file.path);
    if (!key) continue;
    if (map.has(key)) throw new Error(`${label} contains multiple files that map to '${key}'.`);
    map.set(key, file);
  }
  return map;
}

function orderedUnion(...sequences) {
  const seen = new Set();
  const result = [];
  for (const sequence of sequences) for (const value of sequence ?? []) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function normalizeSlashes(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
}

function pathStartsWith(path, root) {
  if (path === root) return true;
  const caseInsensitive = /^[A-Za-z]:\//.test(path) || path.startsWith("//");
  const left = caseInsensitive ? path.toLowerCase() : path;
  const right = caseInsensitive ? root.toLowerCase() : root;
  return left.startsWith(`${right}/`);
}

function fileNameFromPath(value) {
  return normalizeSlashes(value).split("/").pop() || "Result.txt";
}
