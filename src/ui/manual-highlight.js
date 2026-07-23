import { normalizePath } from "../core/lint-paths.js";
import { isTableDocument } from "../core/document-file-state.js";
import { tText } from "../core/i18n.js";

export const MANUAL_HIGHLIGHT_STORAGE_KEY = "txteditor.manualHighlights.v1";

export const MANUAL_HIGHLIGHT_PALETTE = Object.freeze([
  { id: "red", labelKey: "highlight.color.red" },
  { id: "orange", labelKey: "highlight.color.orange" },
  { id: "yellow", labelKey: "highlight.color.yellow" },
  { id: "lime", labelKey: "highlight.color.lime" },
  { id: "green", labelKey: "highlight.color.green" },
  { id: "sky", labelKey: "highlight.color.sky" },
  { id: "blue", labelKey: "highlight.color.blue" },
  { id: "purple", labelKey: "highlight.color.purple" },
  { id: "pink", labelKey: "highlight.color.pink" },
  { id: "brown", labelKey: "highlight.color.brown" },
  { id: "gray", labelKey: "highlight.color.gray" }
]);

export const MANUAL_HIGHLIGHT_IDS = Object.freeze(MANUAL_HIGHLIGHT_PALETTE.map(({ id }) => id));
const VALID_COLORS = new Set(MANUAL_HIGHLIGHT_IDS);
const CELL_KEY_SEPARATOR = "\u001f";

export function manualHighlightDocumentKey(doc) {
  if (!doc) return "";
  const path = normalizePath(doc.path || "");
  if (path) return `path:${path}`;
  const name = String(doc.name || "untitled.txt").trim().toLocaleLowerCase();
  return `name:${name || "untitled.txt"}`;
}

export function createManualHighlightController({
  state,
  activeDoc,
  grid,
  storage = globalThis.localStorage,
  confirmClear = ({ message }) => Promise.resolve(globalThis.confirm?.(message) ?? true),
  translate = tText
}) {
  const documentStates = new WeakMap();
  const commandSnapshots = new WeakMap();
  let nextRuntimeId = 1;

  function nextId(prefix) {
    const id = `${prefix}${nextRuntimeId}`;
    nextRuntimeId += 1;
    return id;
  }

  function openDocument(doc) {
    if (!isTableDocument(doc)) return null;
    const runtime = createRuntimeState(doc, nextId);
    const key = manualHighlightDocumentKey(doc);
    const payload = readDocumentPayload(storage, key);
    restorePayload(runtime, doc, payload);
    runtime.committed = cloneWorkingState(runtime);
    runtime.committedKey = key;
    documentStates.set(doc, runtime);
    if (payload) persistCommitted(runtime);
    grid?.draw?.();
    return runtime;
  }

  function closeDocument(doc) {
    documentStates.delete(doc);
  }

  function ensureDocument(doc) {
    if (!isTableDocument(doc)) return null;
    let runtime = documentStates.get(doc);
    if (!runtime) runtime = openDocument(doc);
    return runtime;
  }

  function colorForCell(doc, row, column) {
    const runtime = ensureDocument(doc);
    if (!runtime) return null;
    const rowId = runtime.rowIds[row];
    const columnId = runtime.columnIds[column];
    if (!rowId || !columnId) return null;
    const key = cellKey(rowId, columnId);
    if (runtime.cellClears.has(key)) return null;
    return runtime.cellHighlights.get(key) ?? runtime.rowHighlights.get(rowId) ?? null;
  }

  function targetSelection(doc = activeDoc()) {
    if (!isTableDocument(doc)) return { rows: [], cells: [] };
    const ranges = Array.isArray(state?.selection?.ranges) ? state.selection.ranges : [];
    const rowTargets = new Set();
    const cellTargets = new Set();
    for (const range of ranges) {
      const rowA = clampIndex(range?.top, doc.rowCount);
      const rowB = clampIndex(range?.bottom, doc.rowCount);
      const columnA = clampIndex(range?.left, doc.columnCount);
      const columnB = clampIndex(range?.right, doc.columnCount);
      const [top, bottom] = rowA <= rowB ? [rowA, rowB] : [rowB, rowA];
      const [left, right] = columnA <= columnB ? [columnA, columnB] : [columnB, columnA];
      if (left === 0 && right >= doc.columnCount - 1) {
        for (let row = top; row <= bottom; row += 1) rowTargets.add(row);
        continue;
      }
      for (let row = top; row <= bottom; row += 1) {
        for (let column = left; column <= right; column += 1) cellTargets.add(`${row}:${column}`);
      }
    }
    return {
      rows: [...rowTargets],
      cells: [...cellTargets].map((value) => {
        const separator = value.indexOf(":");
        return { row: Number(value.slice(0, separator)), column: Number(value.slice(separator + 1)) };
      })
    };
  }

  function applyColor(color, doc = activeDoc()) {
    if (!VALID_COLORS.has(color) || !isTableDocument(doc)) return false;
    const runtime = ensureDocument(doc);
    const targets = targetSelection(doc);
    let changed = false;
    for (const row of targets.rows) {
      const rowId = runtime.rowIds[row];
      if (!rowId) continue;
      changed = setRowColor(runtime, rowId, color) || changed;
      applyToCommitted(runtime, (committed) => {
        if (committed.rowIds.includes(rowId)) setRowColor(committed, rowId, color);
      });
    }
    for (const { row, column } of targets.cells) {
      const rowId = runtime.rowIds[row];
      const columnId = runtime.columnIds[column];
      if (!rowId || !columnId) continue;
      changed = setCellColor(runtime, rowId, columnId, color) || changed;
      applyToCommitted(runtime, (committed) => {
        if (committed.rowIds.includes(rowId) && committed.columnIds.includes(columnId)) {
          setCellColor(committed, rowId, columnId, color);
        }
      });
    }
    if (!changed) return false;
    persistCommitted(runtime);
    grid?.draw?.();
    return true;
  }

  function removeSelection(doc = activeDoc()) {
    if (!isTableDocument(doc)) return false;
    const runtime = ensureDocument(doc);
    const targets = targetSelection(doc);
    let changed = false;
    for (const row of targets.rows) {
      const rowId = runtime.rowIds[row];
      if (!rowId) continue;
      changed = removeRowColor(runtime, rowId) || changed;
      applyToCommitted(runtime, (committed) => {
        if (committed.rowIds.includes(rowId)) removeRowColor(committed, rowId);
      });
    }
    for (const { row, column } of targets.cells) {
      const rowId = runtime.rowIds[row];
      const columnId = runtime.columnIds[column];
      if (!rowId || !columnId) continue;
      changed = removeCellColor(runtime, rowId, columnId) || changed;
      applyToCommitted(runtime, (committed) => {
        if (committed.rowIds.includes(rowId) && committed.columnIds.includes(columnId)) {
          removeCellColor(committed, rowId, columnId);
        }
      });
    }
    if (!changed) return false;
    persistCommitted(runtime);
    grid?.draw?.();
    return true;
  }

  async function clearAll(doc = activeDoc()) {
    if (!isTableDocument(doc)) return false;
    const runtime = ensureDocument(doc);
    if (!hasAnyHighlights(doc)) return false;
    const message = translate("highlight.clearConfirm", { file: doc.name || "Untitled.txt" });
    const confirmed = await confirmClear({ doc, message, scope: "document" });
    if (!confirmed) return false;
    clearWorkingHighlights(runtime);
    clearWorkingHighlights(runtime.committed);
    persistCommitted(runtime);
    grid?.draw?.();
    return true;
  }

  function selectionHasHighlight(doc = activeDoc()) {
    if (!isTableDocument(doc)) return false;
    const targets = targetSelection(doc);
    for (const row of targets.rows) {
      for (let column = 0; column < doc.columnCount; column += 1) {
        if (colorForCell(doc, row, column)) return true;
      }
    }
    for (const { row, column } of targets.cells) {
      if (colorForCell(doc, row, column)) return true;
    }
    return false;
  }

  function hasAnyHighlights(doc = activeDoc()) {
    const runtime = ensureDocument(doc);
    return Boolean(runtime && (runtime.rowHighlights.size || runtime.cellHighlights.size));
  }

  function beforeCommand(doc, command) {
    const runtime = ensureDocument(doc);
    if (!runtime || !isStructuralChange(command?.lspChange) || commandSnapshots.has(command)) return;
    commandSnapshots.set(command, { doc, before: cloneWorkingState(runtime), after: null });
  }

  function afterCommand(doc, command, direction) {
    const record = commandSnapshots.get(command);
    if (!record || record.doc !== doc) return;
    const runtime = ensureDocument(doc);
    if (direction === "undo") {
      restoreWorkingState(runtime, record.before);
      grid?.draw?.();
      return;
    }
    if (direction === "redo" && record.after) {
      restoreWorkingState(runtime, record.after);
      grid?.draw?.();
      return;
    }
    if (direction === "execute" && !record.after) {
      applyStructuralChange(runtime, doc, command.lspChange, nextId);
      record.after = cloneWorkingState(runtime);
      grid?.draw?.();
    }
  }

  function commitSavedDocument(doc, { saveAs = false, previousKey = "" } = {}) {
    const runtime = ensureDocument(doc);
    if (!runtime) return false;
    refreshRuntimeIdentities(runtime, doc);
    runtime.committed = cloneWorkingState(runtime);
    const nextKey = manualHighlightDocumentKey(doc);
    runtime.committedKey = nextKey;
    persistCommitted(runtime);
    if (!saveAs && previousKey && previousKey !== nextKey) removeDocumentPayload(storage, previousKey);
    return true;
  }

  function captureDocumentKey(doc) {
    return manualHighlightDocumentKey(doc);
  }

  function executeTableCommand(doc, command) {
    beforeCommand(doc, command);
    command.redo(doc);
    afterCommand(doc, command, "execute");
  }

  function documentLifecycleHooks() {
    return {
      onTableDocumentOpened: openDocument,
      onTableDocumentClosed: closeDocument,
      captureTableAnnotationIdentity: captureDocumentKey,
      onTableDocumentSaved: commitSavedDocument
    };
  }

  function persistCommitted(runtime) {
    if (!runtime?.committedKey || !runtime.committed) return;
    const payload = serializeSnapshot(runtime.committed);
    writeDocumentPayload(storage, runtime.committedKey, payload);
  }

  return {
    afterCommand,
    applyColor,
    beforeCommand,
    captureDocumentKey,
    clearAll,
    closeDocument,
    colorForCell,
    commitSavedDocument,
    documentLifecycleHooks,
    executeTableCommand,
    hasAnyHighlights,
    openDocument,
    removeSelection,
    selectionHasHighlight,
    targetSelection
  };
}

function createRuntimeState(doc, nextId) {
  const rowIds = Array.from({ length: doc.rowCount }, () => nextId("r"));
  const columnIds = Array.from({ length: doc.columnCount }, () => nextId("c"));
  const rowIdentities = new Map();
  const columnIdentities = new Map();
  const currentRows = currentRowIdentities(doc);
  const currentColumns = currentColumnIdentities(doc);
  rowIds.forEach((id, index) => rowIdentities.set(id, currentRows[index]));
  columnIds.forEach((id, index) => columnIdentities.set(id, currentColumns[index]));
  return {
    rowIds,
    columnIds,
    rowIdentities,
    columnIdentities,
    rowHighlights: new Map(),
    cellHighlights: new Map(),
    cellClears: new Set(),
    committed: null,
    committedKey: ""
  };
}

function cloneWorkingState(runtime) {
  return {
    rowIds: [...runtime.rowIds],
    columnIds: [...runtime.columnIds],
    rowIdentities: cloneIdentityMap(runtime.rowIdentities),
    columnIdentities: cloneIdentityMap(runtime.columnIdentities),
    rowHighlights: new Map(runtime.rowHighlights),
    cellHighlights: new Map(runtime.cellHighlights),
    cellClears: new Set(runtime.cellClears)
  };
}

function restoreWorkingState(runtime, snapshot) {
  runtime.rowIds = [...snapshot.rowIds];
  runtime.columnIds = [...snapshot.columnIds];
  runtime.rowIdentities = cloneIdentityMap(snapshot.rowIdentities);
  runtime.columnIdentities = cloneIdentityMap(snapshot.columnIdentities);
  runtime.rowHighlights = new Map(snapshot.rowHighlights);
  runtime.cellHighlights = new Map(snapshot.cellHighlights);
  runtime.cellClears = new Set(snapshot.cellClears);
}

function cloneIdentityMap(source) {
  return new Map([...source].map(([key, value]) => [key, value ? { ...value } : value]));
}

function setRowColor(runtime, rowId, color) {
  let changed = runtime.rowHighlights.get(rowId) !== color;
  runtime.rowHighlights.set(rowId, color);
  for (const key of [...runtime.cellHighlights.keys()]) {
    if (cellKeyHasRow(key, rowId)) {
      runtime.cellHighlights.delete(key);
      changed = true;
    }
  }
  for (const key of [...runtime.cellClears]) {
    if (cellKeyHasRow(key, rowId)) {
      runtime.cellClears.delete(key);
      changed = true;
    }
  }
  return changed;
}

function setCellColor(runtime, rowId, columnId, color) {
  const key = cellKey(rowId, columnId);
  const changed = runtime.cellHighlights.get(key) !== color || runtime.cellClears.has(key);
  runtime.cellHighlights.set(key, color);
  runtime.cellClears.delete(key);
  return changed;
}

function removeRowColor(runtime, rowId) {
  let changed = runtime.rowHighlights.delete(rowId);
  for (const key of [...runtime.cellHighlights.keys()]) {
    if (cellKeyHasRow(key, rowId)) {
      runtime.cellHighlights.delete(key);
      changed = true;
    }
  }
  for (const key of [...runtime.cellClears]) {
    if (cellKeyHasRow(key, rowId)) {
      runtime.cellClears.delete(key);
      changed = true;
    }
  }
  return changed;
}

function removeCellColor(runtime, rowId, columnId) {
  const key = cellKey(rowId, columnId);
  const direct = runtime.cellHighlights.delete(key);
  if (runtime.rowHighlights.has(rowId)) {
    const masked = !runtime.cellClears.has(key);
    runtime.cellClears.add(key);
    return direct || masked;
  }
  return direct;
}

function clearWorkingHighlights(runtime) {
  runtime.rowHighlights.clear();
  runtime.cellHighlights.clear();
  runtime.cellClears.clear();
}

function applyToCommitted(runtime, mutate) {
  if (runtime.committed) mutate(runtime.committed);
}

function isStructuralChange(change) {
  return ["insertRows", "deleteRows", "insertColumns", "deleteColumns"].includes(change?.kind);
}

function applyStructuralChange(runtime, doc, change, nextId) {
  const index = Math.max(0, Math.floor(Number(change?.index) || 0));
  const count = Math.max(0, Math.floor(Number(change?.count) || 0));
  if (change.kind === "insertRows") {
    insertRuntimeIds(runtime, "row", index, count, doc.rowCount, doc, nextId);
  } else if (change.kind === "deleteRows") {
    deleteRuntimeIds(runtime, "row", index, count, doc.rowCount, doc, nextId);
  } else if (change.kind === "insertColumns") {
    insertRuntimeIds(runtime, "column", index, count, doc.columnCount, doc, nextId);
  } else if (change.kind === "deleteColumns") {
    deleteRuntimeIds(runtime, "column", index, count, doc.columnCount, doc, nextId);
  }
}

function insertRuntimeIds(runtime, axis, index, requestedCount, finalCount, doc, nextId) {
  const ids = axis === "row" ? runtime.rowIds : runtime.columnIds;
  const identities = axis === "row" ? runtime.rowIdentities : runtime.columnIdentities;
  const at = Math.min(index, ids.length);
  const insertCount = Math.max(0, Math.min(requestedCount, finalCount - ids.length));
  const inserted = Array.from({ length: insertCount }, () => nextId(axis === "row" ? "r" : "c"));
  ids.splice(at, 0, ...inserted);
  while (ids.length < finalCount) ids.splice(Math.min(at + inserted.length, ids.length), 0, nextId(axis === "row" ? "r" : "c"));
  if (ids.length > finalCount) ids.length = finalCount;
  const current = axis === "row" ? currentRowIdentities(doc) : currentColumnIdentities(doc);
  ids.forEach((id, position) => {
    if (!identities.has(id)) identities.set(id, current[position]);
  });
}

function deleteRuntimeIds(runtime, axis, index, requestedCount, finalCount, doc, nextId) {
  const ids = axis === "row" ? runtime.rowIds : runtime.columnIds;
  const identities = axis === "row" ? runtime.rowIdentities : runtime.columnIdentities;
  const at = Math.min(index, Math.max(0, ids.length - 1));
  const removeCount = Math.min(requestedCount, Math.max(0, ids.length - at));
  const removed = ids.splice(at, removeCount);
  for (const id of removed) {
    identities.delete(id);
    removeRuntimeHighlightsForId(runtime, axis, id);
  }
  while (ids.length < finalCount) {
    const id = nextId(axis === "row" ? "r" : "c");
    ids.splice(Math.min(at, ids.length), 0, id);
  }
  if (ids.length > finalCount) {
    const extra = ids.splice(finalCount);
    for (const id of extra) {
      identities.delete(id);
      removeRuntimeHighlightsForId(runtime, axis, id);
    }
  }
  const current = axis === "row" ? currentRowIdentities(doc) : currentColumnIdentities(doc);
  ids.forEach((id, position) => {
    if (!identities.has(id)) identities.set(id, current[position]);
  });
}

function removeRuntimeHighlightsForId(runtime, axis, id) {
  if (axis === "row") runtime.rowHighlights.delete(id);
  for (const key of [...runtime.cellHighlights.keys()]) {
    if (axis === "row" ? cellKeyHasRow(key, id) : cellKeyHasColumn(key, id)) runtime.cellHighlights.delete(key);
  }
  for (const key of [...runtime.cellClears]) {
    if (axis === "row" ? cellKeyHasRow(key, id) : cellKeyHasColumn(key, id)) runtime.cellClears.delete(key);
  }
}

function refreshRuntimeIdentities(runtime, doc) {
  const rows = currentRowIdentities(doc);
  const columns = currentColumnIdentities(doc);
  runtime.rowIdentities = new Map(runtime.rowIds.map((id, index) => [id, rows[index]]));
  runtime.columnIdentities = new Map(runtime.columnIds.map((id, index) => [id, columns[index]]));
}

function serializeSnapshot(snapshot) {
  const rows = [];
  const cells = [];
  const clears = [];
  for (const [rowId, color] of snapshot.rowHighlights) {
    const row = snapshot.rowIdentities.get(rowId);
    if (row && VALID_COLORS.has(color)) rows.push({ row, color });
  }
  for (const [key, color] of snapshot.cellHighlights) {
    const [rowId, columnId] = splitCellKey(key);
    const row = snapshot.rowIdentities.get(rowId);
    const column = snapshot.columnIdentities.get(columnId);
    if (row && column && VALID_COLORS.has(color)) cells.push({ row, column, color });
  }
  for (const key of snapshot.cellClears) {
    const [rowId, columnId] = splitCellKey(key);
    const row = snapshot.rowIdentities.get(rowId);
    const column = snapshot.columnIdentities.get(columnId);
    if (row && column && snapshot.rowHighlights.has(rowId)) clears.push({ row, column });
  }
  return { version: 1, rows, cells, clears };
}

function restorePayload(runtime, doc, payload) {
  if (!payload || Number(payload.version) !== 1) return;
  const rowLookup = buildRowLookup(doc, runtime.rowIds);
  const columnLookup = buildColumnLookup(doc, runtime.columnIds);
  for (const entry of payload.rows ?? []) {
    const rowId = resolveRowIdentity(entry?.row, rowLookup);
    if (rowId && VALID_COLORS.has(entry?.color)) runtime.rowHighlights.set(rowId, entry.color);
  }
  for (const entry of payload.cells ?? []) {
    const rowId = resolveRowIdentity(entry?.row, rowLookup);
    const columnId = resolveColumnIdentity(entry?.column, columnLookup);
    if (rowId && columnId && VALID_COLORS.has(entry?.color)) runtime.cellHighlights.set(cellKey(rowId, columnId), entry.color);
  }
  for (const entry of payload.clears ?? []) {
    const rowId = resolveRowIdentity(entry?.row, rowLookup);
    const columnId = resolveColumnIdentity(entry?.column, columnLookup);
    if (rowId && columnId && runtime.rowHighlights.has(rowId)) runtime.cellClears.add(cellKey(rowId, columnId));
  }
}

function currentRowIdentities(doc) {
  const occurrences = new Map();
  const identities = [];
  for (let row = 0; row < doc.rowCount; row += 1) {
    if (row === 0) {
      identities.push({ header: true, index: 0, fingerprint: rowFingerprint(doc, row) });
      continue;
    }
    const key = String(doc.getCell(row, 0) ?? "");
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    identities.push({ key, occurrence, index: row, fingerprint: rowFingerprint(doc, row) });
  }
  return identities;
}

function currentColumnIdentities(doc) {
  const occurrences = new Map();
  const identities = [];
  for (let column = 0; column < doc.columnCount; column += 1) {
    const name = String(doc.getCell(0, column) ?? "");
    const occurrence = occurrences.get(name) ?? 0;
    occurrences.set(name, occurrence + 1);
    identities.push({ name, occurrence, index: column });
  }
  return identities;
}

function buildRowLookup(doc, ids) {
  const identities = currentRowIdentities(doc);
  return identities.map((identity, index) => ({ identity, id: ids[index] }));
}

function buildColumnLookup(doc, ids) {
  const identities = currentColumnIdentities(doc);
  return identities.map((identity, index) => ({ identity, id: ids[index] }));
}

function resolveRowIdentity(identity, lookup) {
  if (!identity || typeof identity !== "object") return null;
  if (identity.header) return lookup.find(({ identity: current }) => current.header)?.id ?? null;
  const exact = lookup.find(({ identity: current }) => !current.header
    && current.key === String(identity.key ?? "")
    && current.occurrence === Number(identity.occurrence)
    && current.fingerprint === identity.fingerprint);
  if (exact) return exact.id;
  const fingerprint = lookup.filter(({ identity: current }) => !current.header
    && current.key === String(identity.key ?? "")
    && current.fingerprint === identity.fingerprint);
  if (fingerprint.length === 1) return fingerprint[0].id;
  return lookup.find(({ identity: current }) => !current.header
    && current.key === String(identity.key ?? "")
    && current.occurrence === Number(identity.occurrence))?.id ?? null;
}

function resolveColumnIdentity(identity, lookup) {
  if (!identity || typeof identity !== "object") return null;
  return lookup.find(({ identity: current }) => current.name === String(identity.name ?? "")
    && current.occurrence === Number(identity.occurrence))?.id ?? null;
}

function rowFingerprint(doc, row) {
  let hash = 2166136261;
  for (let column = 0; column < doc.columnCount; column += 1) {
    const value = String(doc.getCell(row, column) ?? "");
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 31;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function readDocumentPayload(storage, key) {
  if (!key) return null;
  try {
    const root = JSON.parse(storage?.getItem?.(MANUAL_HIGHLIGHT_STORAGE_KEY) || "{}");
    return root && typeof root === "object" && root.documents && typeof root.documents === "object"
      ? root.documents[key] ?? null
      : null;
  } catch {
    return null;
  }
}

function writeDocumentPayload(storage, key, payload) {
  if (!key || !storage?.setItem) return false;
  try {
    let root;
    try {
      root = JSON.parse(storage.getItem?.(MANUAL_HIGHLIGHT_STORAGE_KEY) || "{}");
    } catch {
      root = {};
    }
    if (!root || typeof root !== "object" || Array.isArray(root)) root = {};
    if (!root.documents || typeof root.documents !== "object" || Array.isArray(root.documents)) root.documents = {};
    if (payload.rows.length || payload.cells.length || payload.clears.length) root.documents[key] = payload;
    else delete root.documents[key];
    storage.setItem(MANUAL_HIGHLIGHT_STORAGE_KEY, JSON.stringify({ version: 1, documents: root.documents }));
    return true;
  } catch {
    return false;
  }
}

function removeDocumentPayload(storage, key) {
  if (!key) return false;
  try {
    const root = JSON.parse(storage?.getItem?.(MANUAL_HIGHLIGHT_STORAGE_KEY) || "{}");
    if (!root?.documents || typeof root.documents !== "object") return false;
    delete root.documents[key];
    storage.setItem(MANUAL_HIGHLIGHT_STORAGE_KEY, JSON.stringify({ version: 1, documents: root.documents }));
    return true;
  } catch {
    return false;
  }
}

function cellKey(rowId, columnId) {
  return `${rowId}${CELL_KEY_SEPARATOR}${columnId}`;
}

function splitCellKey(key) {
  const index = key.indexOf(CELL_KEY_SEPARATOR);
  return [key.slice(0, index), key.slice(index + CELL_KEY_SEPARATOR.length)];
}

function cellKeyHasRow(key, rowId) {
  return key.startsWith(`${rowId}${CELL_KEY_SEPARATOR}`);
}

function cellKeyHasColumn(key, columnId) {
  return key.endsWith(`${CELL_KEY_SEPARATOR}${columnId}`);
}

function clampIndex(value, count) {
  return Math.max(0, Math.min(Math.max(0, count - 1), Math.floor(Number(value) || 0)));
}
