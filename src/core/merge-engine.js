import { baseName } from "./lint-paths.js";
import { duplicateIdentity } from "./lint-duplicates.js";
import { DUPLICATE_KEYS, DUPLICATE_KEY_COMPARISONS } from "./lint-rule-data.js";

export const MERGE_MISSING = Symbol.for("txteditor.merge.missing");

export const MERGE_CONFLICT_KINDS = Object.freeze({
  VALUE: "value",
  ADD_ADD: "add-add",
  DELETE_MODIFY: "delete-modify",
  COLUMN_DELETE_MODIFY: "column-delete-modify",
  HEADER_NAME: "header-name",
  ROW_ORDER: "row-order",
  COLUMN_ORDER: "column-order",
  AMBIGUOUS_SCHEMA: "ambiguous-schema",
  AMBIGUOUS_ROW_KEY: "ambiguous-row-key"
});

export const MERGE_CELL_STATES = Object.freeze({
  UNCHANGED: "unchanged",
  AUTO_A: "auto-a",
  AUTO_B: "auto-b",
  AUTO_BOTH: "auto-both",
  ADDED_A: "added-a",
  ADDED_B: "added-b",
  ADDED_BOTH: "added-both",
  CONFLICT: "conflict",
  RESOLVED: "resolved",
  MOVED: "moved",
  STRUCTURE: "structure"
});

const DEFAULT_KEY_CANDIDATES = [
  ["treasure class"], ["code"], ["id"], ["index"], ["name"], ["skill"], ["state"],
  ["description"], ["stat"], ["missile"], ["superunique"], ["level"], ["type"], ["key"]
];

const FILE_KEY_CANDIDATES = Object.freeze({
  "armor.txt": [["code"], ["name"]],
  "automagic.txt": [["name"]],
  "belts.txt": [["numboxes"]],
  "books.txt": [["name"]],
  "charstats.txt": [["class"]],
  "colors.txt": [["code"]],
  "compcode.txt": [["component"]],
  "cubemain.txt": [["description"], ["input 1", "output"]],
  "difficultylevels.txt": [["name"]],
  "experience.txt": [["level"]],
  "gems.txt": [["name"], ["code"]],
  "hireling.txt": [["id", "level"], ["id"]],
  "inventory.txt": [["class"]],
  "itemratio.txt": [["version", "uber", "class specific"], ["version"]],
  "itemstatcost.txt": [["stat"]],
  "itemtypes.txt": [["code"], ["itemtype"]],
  "levels.txt": [["id"], ["name"]],
  "lowqualityitems.txt": [["name"]],
  "magicprefix.txt": [["name"]],
  "magicsuffix.txt": [["name"]],
  "misc.txt": [["code"], ["name"]],
  "missiles.txt": [["missile"]],
  "monai.txt": [["ai"]],
  "monequip.txt": [["monster", "level", "oninit"]],
  "monlvl.txt": [["level"]],
  "monpreset.txt": [["act", "place", "id"]],
  "monprop.txt": [["id"]],
  "monseq.txt": [["sequence", "mode"]],
  "monstats.txt": [["id"]],
  "monstats2.txt": [["id"]],
  "montype.txt": [["type"]],
  "objects.txt": [["id"]],
  "objgroup.txt": [["groupname"]],
  "objmode.txt": [["name"]],
  "overlay.txt": [["overlay"]],
  "pettype.txt": [["pet type"]],
  "properties.txt": [["code"]],
  "qualityitems.txt": [["nummods"]],
  "rareprefix.txt": [["name"]],
  "raresuffix.txt": [["name"]],
  "runes.txt": [["name"]],
  "setitems.txt": [["index"]],
  "sets.txt": [["index"]],
  "shrines.txt": [["shrine type"]],
  "skills.txt": [["skill"]],
  "states.txt": [["state"]],
  "superuniques.txt": [["superunique"], ["name"]],
  "treasureclassex.txt": [["treasure class"]],
  "uniqueitems.txt": [["index"]],
  "weapons.txt": [["code"], ["name"]]
});

let nextConflictSequence = 0;

export function mergeScalar(base, a, b) {
  if (sameMergeValue(a, b)) {
    return {
      value: a,
      state: sameMergeValue(a, base) ? MERGE_CELL_STATES.UNCHANGED : MERGE_CELL_STATES.AUTO_BOTH,
      conflict: false
    };
  }
  if (sameMergeValue(a, base)) return { value: b, state: MERGE_CELL_STATES.AUTO_B, conflict: false };
  if (sameMergeValue(b, base)) return { value: a, state: MERGE_CELL_STATES.AUTO_A, conflict: false };
  return {
    value: base !== MERGE_MISSING ? base : a !== MERGE_MISSING ? a : b,
    state: MERGE_CELL_STATES.CONFLICT,
    conflict: true
  };
}

export function mergeTableDocuments({
  base = null,
  a = null,
  b = null,
  fileName = a?.name || b?.name || base?.name || "Result.txt",
  relativePath = fileName,
  sidePresence = { a: Boolean(a), b: Boolean(b) },
  schemaMismatchThreshold = 0.7
} = {}) {
  const docs = { base, a, b };
  const descriptor = {
    id: normalizedFileId(relativePath || fileName),
    name: baseName(relativePath || fileName) || fileName,
    relativePath: normalizeRelativePath(relativePath || fileName),
    fileName: baseName(fileName || relativePath).toLowerCase(),
    docs,
    sidePresence: { a: sidePresence.a !== false, b: sidePresence.b !== false },
    baseAvailable: Boolean(base),
    conflicts: [],
    warnings: [],
    schemaAcknowledged: false,
    formatSource: null,
    formats: {
      base: formatFromDocument(base),
      a: formatFromDocument(a),
      b: formatFromDocument(b)
    },
    metrics: emptyMetrics(),
    status: "unchanged",
    keySpec: null,
    includeInOutput: true,
    overrideSource: null,
    _model: null,
    result: null
  };
  descriptor.formatSource = automaticFormatSource(descriptor);

  const present = [base, a, b].filter(Boolean);
  if (!present.length) return fallbackFile(descriptor, "No merge inputs were available.", MERGE_CONFLICT_KINDS.AMBIGUOUS_SCHEMA);

  const headerDescriptors = {
    base: describeHeaders(base),
    a: describeHeaders(a),
    b: describeHeaders(b)
  };
  const invalidHeaders = Object.entries(headerDescriptors)
    .filter(([, header]) => header && header.invalidReasons.length)
    .map(([side, header]) => ({ side, reasons: header.invalidReasons }));
  if (invalidHeaders.length) {
    return safeWholeTableFallback(descriptor, {
      kind: MERGE_CONFLICT_KINDS.AMBIGUOUS_SCHEMA,
      message: invalidHeaders.map(({ side, reasons }) => `${side.toUpperCase()}: ${reasons.join(", ")}`).join("; ")
    });
  }

  if (base && a && b) {
    const baseIds = new Set(headerDescriptors.base.order);
    const missingFromBoth = headerDescriptors.base.order.filter((id) => (
      !headerDescriptors.a.byId.has(id) && !headerDescriptors.b.byId.has(id)
    ));
    const addedA = headerDescriptors.a.order.filter((id) => !baseIds.has(id));
    const addedB = headerDescriptors.b.order.filter((id) => !baseIds.has(id));
    if (missingFromBoth.length && (addedA.length || addedB.length) && !arrayEquals(addedA, addedB)) {
      return safeWholeTableFallback(descriptor, {
        kind: MERGE_CONFLICT_KINDS.AMBIGUOUS_SCHEMA,
        message: `A and B both removed the same built-in column(s) (${missingFromBoth.join(", ")}) but introduced different replacement headers (${addedA.join(", ") || "none"} vs ${addedB.join(", ") || "none"}); rename mapping is ambiguous.`
      });
    }
  }

  if (base) {
    for (const side of ["a", "b"]) {
      if (!docs[side]) continue;
      const similarity = headerSimilarity(headerDescriptors.base, headerDescriptors[side]);
      if (similarity < schemaMismatchThreshold) {
        descriptor.warnings.push({
          id: `${descriptor.id}:schema:${side}`,
          kind: "schema-mismatch",
          side,
          similarity,
          blockingUntilAcknowledged: true,
          message: `${side.toUpperCase()} headers match only ${Math.round(similarity * 100)}% of the selected built-in original schema.`
        });
      }
    }
  }

  const keySpec = inferRowKeySpec(descriptor.fileName, docs, headerDescriptors);
  if (!keySpec) {
    return safeWholeTableFallback(descriptor, {
      kind: MERGE_CONFLICT_KINDS.AMBIGUOUS_ROW_KEY,
      message: "No stable unique row key could be determined without using row numbers."
    });
  }

  descriptor.keySpec = {
    names: [...keySpec.names],
    strategy: keySpec.strategy,
    comparisons: [...keySpec.comparisons]
  };

  const rowIndexes = {
    base: buildRowIndex(base, headerDescriptors.base, keySpec),
    a: buildRowIndex(a, headerDescriptors.a, keySpec),
    b: buildRowIndex(b, headerDescriptors.b, keySpec)
  };
  const invalidIndex = Object.entries(rowIndexes).find(([, index]) => index && index.errors.length);
  if (invalidIndex) {
    return safeWholeTableFallback(descriptor, {
      kind: MERGE_CONFLICT_KINDS.AMBIGUOUS_ROW_KEY,
      message: `${invalidIndex[0].toUpperCase()} has ambiguous row keys: ${invalidIndex[1].errors.join("; ")}`
    });
  }

  const model = createStructuredModel({ descriptor, headerDescriptors, rowIndexes, keySpec });
  descriptor._model = model;
  mergeColumns(descriptor, model);
  mergeRows(descriptor, model);
  mergeResultOrder(descriptor, model);
  materializeMergeFile(descriptor);
  refreshMergeFileStatus(descriptor);
  return descriptor;
}

export function resolveMergeConflict(file, conflictId, { choice, value = "" } = {}) {
  const conflict = file?.conflicts?.find((candidate) => candidate.id === conflictId);
  if (!conflict) throw new Error(`Unknown merge conflict: ${conflictId}`);
  if (!MERGE_RESOLUTION_CHOICES.has(choice)) throw new Error(`Unsupported merge resolution: ${choice}`);
  const model = file._model;

  if (conflict.target.type === "cell") {
    const row = model.rows.get(conflict.target.rowKey);
    if (!row) throw new Error("The conflict row is no longer present in the Result.");
    row.values.set(conflict.target.columnId, choice === "custom" ? String(value) : conflict.values[choice]);
    model.cellStates.set(cellKey(conflict.target.rowKey, conflict.target.columnId), MERGE_CELL_STATES.RESOLVED);
  } else if (conflict.target.type === "row") {
    applyRowConflictChoice(model, conflict, choice);
  } else if (conflict.target.type === "column") {
    applyColumnConflictChoice(model, conflict, choice);
  } else if (conflict.target.type === "header") {
    const column = model.columns.get(conflict.target.columnId);
    if (!column) throw new Error("The conflict column is no longer present in the Result.");
    column.name = choice === "custom" ? String(value) : conflict.values[choice];
    model.headerStates.set(conflict.target.columnId, MERGE_CELL_STATES.RESOLVED);
  } else if (conflict.target.type === "row-order") {
    model.rowOrder = resolveOrderChoice(model, conflict, choice, "row");
  } else if (conflict.target.type === "column-order") {
    model.columnOrder = resolveOrderChoice(model, conflict, choice, "column");
  } else if (conflict.target.type === "file") {
    if (choice === "custom") throw new Error("Whole-file conflicts require A, B, or the built-in original.");
    if (!file.docs[choice]) throw new Error(`${choice.toUpperCase()} is not available for this file.`);
    file.overrideSource = choice;
    for (const candidate of file.conflicts) candidate.resolution = { choice };
  }

  conflict.resolution = { choice, ...(choice === "custom" ? { value: String(value) } : {}) };
  materializeMergeFile(file);
  refreshMergeFileStatus(file);
  return file;
}

export function acknowledgeMergeSchema(file, acknowledged = true) {
  if (file) file.schemaAcknowledged = Boolean(acknowledged);
  return file;
}

export function unresolvedMergeConflicts(file) {
  return (file?.conflicts ?? []).filter((conflict) => !conflict.resolution);
}

export function mergeFileCanSave(file) {
  if (!file || unresolvedMergeConflicts(file).length) return false;
  return !file.warnings.some((warning) => warning.blockingUntilAcknowledged && !file.schemaAcknowledged);
}

export function materializeMergeFile(file) {
  if (!file) return null;
  if (file.overrideSource) {
    const source = file.docs[file.overrideSource];
    file.result = {
      rows: cloneRows(source?.rows ?? [[]]),
      ...selectedFormat(file),
      source: file.overrideSource
    };
    file._coordinates = coordinatesForRows(file.result.rows);
    refreshConflictCoordinates(file);
    return file.result;
  }

  const model = file._model;
  if (!model) return file.result;
  const columnOrder = model.columnOrder.filter((columnId) => model.columns.get(columnId)?.enabled !== false);
  const header = columnOrder.map((columnId) => model.columns.get(columnId)?.name ?? "");
  const rows = [header];
  const rowKeyByIndex = new Map();
  const rowIndexByKey = new Map();
  const columnIndexById = new Map(columnOrder.map((columnId, index) => [columnId, index]));
  for (const rowKey of model.rowOrder) {
    const row = model.rows.get(rowKey);
    if (!row || row.deleted) continue;
    const values = sparseResultRow(columnOrder.map((columnId) => row.values.get(columnId) ?? MERGE_MISSING));
    const rowIndex = rows.length;
    rows.push(values);
    rowKeyByIndex.set(rowIndex, rowKey);
    rowIndexByKey.set(rowKey, rowIndex);
  }
  file.result = { rows, ...selectedFormat(file), source: "merge" };
  file._coordinates = { rowKeyByIndex, rowIndexByKey, columnIndexById, columnIdByIndex: new Map(columnOrder.map((id, index) => [index, id])) };
  refreshConflictCoordinates(file);
  file.metrics = calculateMetrics(file);
  return file.result;
}

export function serializeMergeFile(file) {
  const result = materializeMergeFile(file);
  if (!result) return "";
  const body = result.rows.map((row) => row.join("\t")).join(result.lineEnding || "\n");
  return result.finalNewline ? `${body}${result.lineEnding || "\n"}` : body;
}

export function mergeHighlightIdForCell(file, rowIndex, columnIndex) {
  if (!file?._model || file.overrideSource) return null;
  const coordinates = file._coordinates;
  const columnId = coordinates?.columnIdByIndex?.get(columnIndex);
  if (rowIndex === 0) return highlightIdForState(file._model.headerStates.get(columnId));
  const rowKey = coordinates?.rowKeyByIndex?.get(rowIndex);
  if (!rowKey || !columnId) return null;
  const conflict = file.conflicts.find((candidate) => !candidate.resolution
    && candidate.row === rowIndex && (candidate.column === columnIndex || candidate.target.type === "row"));
  if (conflict) return "red";
  const rowState = file._model.rowStates.get(rowKey);
  const cellState = file._model.cellStates.get(cellKey(rowKey, columnId));
  return highlightIdForState(cellState === MERGE_CELL_STATES.UNCHANGED ? rowState : cellState || rowState);
}

export function mergeValueForDisplay(value) {
  return value === MERGE_MISSING ? "<missing>" : String(value ?? "");
}

// This is deliberately a display projection: callers never receive the merge
// model's Maps, row objects, or mutable conflict values.
export function mergeFileChanges(file) {
  if (!file) return [];
  const items = [];
  const model = file._model;
  const path = file.relativePath || file.name || "";
  const push = (details) => items.push({
    id: `change:${file.id}:${details.id}`,
    fileId: file.id,
    path,
    relativePath: path,
    fileName: file.name,
    kind: details.kind,
    kindKey: `merge.change.kind.${details.kind}`,
    source: details.source,
    sourceKey: `merge.change.source.${details.source}`,
    rowLabel: details.rowLabel ?? "",
    columnLabel: details.columnLabel ?? "",
    resultRow: details.resultRow ?? null,
    resultColumn: details.resultColumn ?? null,
    rowIndex: details.resultRow ?? null,
    columnIndex: details.resultColumn ?? null,
    base: displayProjectionValue(details.base),
    a: displayProjectionValue(details.a),
    b: displayProjectionValue(details.b),
    result: displayProjectionValue(details.result),
    conflictId: details.conflictId ?? null,
    conflictKind: details.conflictKind ?? null,
    resolution: details.resolution ? { ...details.resolution } : null
  });

  if (!model) {
    for (const conflict of file.conflicts ?? []) appendConflictProjection(push, file, conflict, null);
    if (!(file.conflicts ?? []).length && file.metrics?.changedFiles) {
      push({
        id: "file",
        kind: "file",
        source: file.overrideSource || "base",
        base: file.docs?.base ? "built-in original file" : MERGE_MISSING,
        a: file.docs?.a ? "A file" : MERGE_MISSING,
        b: file.docs?.b ? "B file" : MERGE_MISSING,
        result: wholeFileResultMarker(file.overrideSource || "base")
      });
    }
    return items;
  }

  const resultCoordinates = file._coordinates ?? {};
  const addedRows = new Set();
  for (const [rowKey, state] of model.rowStates) {
    if (isAddedRowState(state)) {
      addedRows.add(rowKey);
      const row = model.rows.get(rowKey);
      const rowValues = row?.sourceRows ?? {};
      push({
        id: `row-added:${rowKey}`,
        kind: "row-added",
        source: sourceForState(state),
        rowLabel: displayRowKeyForModel(rowKey, model),
        resultRow: resultCoordinates.rowIndexByKey?.get(rowKey) ?? null,
        base: rowProjectionValue(rowValues.base),
        a: rowProjectionValue(rowValues.a),
        b: rowProjectionValue(rowValues.b),
        result: rowProjectionValue(row?.values)
      });
    } else if (state === MERGE_CELL_STATES.MOVED) {
      const row = model.rows.get(rowKey);
      const rowValues = row?.sourceRows ?? {};
      push({
        id: `row-moved:${rowKey}`,
        kind: "row-moved",
        source: sourceForOrder(model.orderChoices.row, model.rowOrder),
        rowLabel: displayRowKeyForModel(rowKey, model),
        resultRow: resultCoordinates.rowIndexByKey?.get(rowKey) ?? null,
        base: rowProjectionValue(rowValues.base),
        a: rowProjectionValue(rowValues.a),
        b: rowProjectionValue(rowValues.b),
        result: rowProjectionValue(row?.values)
      });
    }
  }
  for (const rowKey of model.deletedRows) {
    const values = projectionRowsForSide(model, rowKey);
    push({
      id: `row-deleted:${rowKey}`,
      kind: "row-deleted",
      source: deletedRowSource(values),
      rowLabel: displayRowKeyForModel(rowKey, model),
      base: values.base,
      a: values.a,
      b: values.b,
      result: MERGE_MISSING
    });
  }

  for (const [key, state] of model.cellStates) {
    if (![MERGE_CELL_STATES.AUTO_A, MERGE_CELL_STATES.AUTO_B, MERGE_CELL_STATES.AUTO_BOTH].includes(state)) continue;
    const [rowKey, columnId] = key.split("\u001d");
    if (addedRows.has(rowKey)) continue;
    const row = model.rows.get(rowKey);
    const column = model.columns.get(columnId);
    if (!row || !column) continue;
    const resultRow = resultCoordinates.rowIndexByKey?.get(rowKey) ?? null;
    const resultColumn = resultCoordinates.columnIndexById?.get(columnId) ?? null;
    push({
      id: `cell:${rowKey}:${columnId}`,
      kind: "cell",
      source: sourceForState(state),
      rowLabel: displayRowKeyForModel(rowKey, model),
      columnLabel: column.name,
      resultRow,
      resultColumn,
      base: row.sourceRows.base?.get(columnId) ?? MERGE_MISSING,
      a: row.sourceRows.a?.get(columnId) ?? MERGE_MISSING,
      b: row.sourceRows.b?.get(columnId) ?? MERGE_MISSING,
      result: row.values.get(columnId) ?? MERGE_MISSING
    });
  }

  const deletedColumnIds = new Set(model.deletedColumns);
  for (const columnId of deletedColumnIds) {
    const column = model.columns.get(columnId);
    const state = model.headerStates.get(columnId);
    if (state === MERGE_CELL_STATES.CONFLICT || state === MERGE_CELL_STATES.RESOLVED) continue;
    push({
      id: `column-deleted:${columnId}`,
      kind: "column-deleted",
      source: state === MERGE_CELL_STATES.AUTO_A ? "a" : state === MERGE_CELL_STATES.AUTO_B ? "b" : "both",
      columnLabel: column?.name ?? columnId,
      base: column?.sourcePresence.base ? column.name : MERGE_MISSING,
      a: column?.sourcePresence.a ? column.name : MERGE_MISSING,
      b: column?.sourcePresence.b ? column.name : MERGE_MISSING,
      result: MERGE_MISSING
    });
  }
  for (const [columnId, state] of model.headerStates) {
    const column = model.columns.get(columnId);
    if (!column || !column.enabled || deletedColumnIds.has(columnId)) continue;
    if (isAddedColumnState(state)) {
      push({
        id: `column-added:${columnId}`,
        kind: "column-added",
        source: sourceForState(state),
        columnLabel: column.name,
        resultRow: 0,
        resultColumn: resultCoordinates.columnIndexById?.get(columnId) ?? null,
        base: MERGE_MISSING,
        a: column.sourcePresence.a ? column.name : MERGE_MISSING,
        b: column.sourcePresence.b ? column.name : MERGE_MISSING,
        result: column.name
      });
    } else if ([MERGE_CELL_STATES.AUTO_A, MERGE_CELL_STATES.AUTO_B, MERGE_CELL_STATES.AUTO_BOTH].includes(state)
      && column.sourcePresence.base) {
      const baseName = model.headerDescriptors.base?.byId.get(columnId)?.name ?? MERGE_MISSING;
      if (!sameMergeValue(baseName, column.name)) {
        push({
          id: `column-renamed:${columnId}`,
          kind: "column-renamed",
          source: sourceForState(state),
          columnLabel: column.name,
          resultRow: 0,
          resultColumn: resultCoordinates.columnIndexById?.get(columnId) ?? null,
          base: baseName,
          a: model.headerDescriptors.a?.byId.get(columnId)?.name ?? MERGE_MISSING,
          b: model.headerDescriptors.b?.byId.get(columnId)?.name ?? MERGE_MISSING,
          result: column.name
        });
      }
    }
  }

  if (!file.conflicts?.some((conflict) => conflict.target.type === "row-order")) {
    const baseOrder = model.orderChoices.row?.base ?? model.rowIndexes.base?.order ?? [];
    if (!arrayEquals(baseOrder, model.rowOrder)) {
      push({
        id: "row-order",
        kind: "row-order",
        source: sourceForOrder(model.orderChoices.row, model.rowOrder),
        base: baseOrder,
        a: model.orderChoices.row?.a ?? [],
        b: model.orderChoices.row?.b ?? [],
        result: model.rowOrder
      });
    }
  }
  if (!file.conflicts?.some((conflict) => conflict.target.type === "column-order")) {
    const baseOrder = model.orderChoices.column?.base ?? model.headerDescriptors.base?.order ?? [];
    if (!arrayEquals(baseOrder, model.columnOrder)) {
      push({
        id: "column-order",
        kind: "column-order",
        source: sourceForOrder(model.orderChoices.column, model.columnOrder),
        base: baseOrder,
        a: model.orderChoices.column?.a ?? [],
        b: model.orderChoices.column?.b ?? [],
        result: model.columnOrder
      });
    }
  }

  for (const conflict of file.conflicts ?? []) appendConflictProjection(push, file, conflict, model);
  return items;
}

function appendConflictProjection(push, file, conflict, model) {
  const target = conflict.target ?? {};
  const rowKey = target.rowKey;
  const columnId = target.columnId;
  const row = model?.rows.get(rowKey);
  const column = model?.columns.get(columnId);
  const resultRow = conflict.row ?? null;
  const resultColumn = conflict.column ?? null;
  let result = MERGE_MISSING;
  if (target.type === "cell") result = row?.values.get(columnId) ?? MERGE_MISSING;
  else if (target.type === "row") result = row?.values ?? MERGE_MISSING;
  else if (target.type === "header" || target.type === "column") result = column?.name ?? MERGE_MISSING;
  else if (target.type === "file") result = file.result?.rows ?? MERGE_MISSING;
  else if (target.type === "row-order") result = model?.rowOrder ?? MERGE_MISSING;
  else if (target.type === "column-order") result = model?.columnOrder ?? MERGE_MISSING;
  push({
    id: `conflict:${conflict.id}`,
    kind: "conflict",
    source: "conflict",
    rowLabel: conflict.rowKey || (rowKey && model ? displayRowKeyForModel(rowKey, model) : ""),
    columnLabel: conflict.columnName || column?.name || "",
    resultRow,
    resultColumn,
    base: conflict.values?.base ?? MERGE_MISSING,
    a: conflict.values?.a ?? MERGE_MISSING,
    b: conflict.values?.b ?? MERGE_MISSING,
    result,
    conflictId: conflict.id,
    conflictKind: conflict.kind,
    resolution: conflict.resolution
  });
}

function projectionRowsForSide(model, rowKey) {
  const row = model.rows.get(rowKey);
  const values = row?.sourceRows ?? {};
  return {
    base: values.base ?? rowValuesForSide("base", model.rowIndexes.base?.byKey.get(rowKey), model),
    a: values.a ?? rowValuesForSide("a", model.rowIndexes.a?.byKey.get(rowKey), model),
    b: values.b ?? rowValuesForSide("b", model.rowIndexes.b?.byKey.get(rowKey), model)
  };
}

function sourceForState(state) {
  if (state === MERGE_CELL_STATES.AUTO_A || state === MERGE_CELL_STATES.ADDED_A) return "a";
  if (state === MERGE_CELL_STATES.AUTO_B || state === MERGE_CELL_STATES.ADDED_B) return "b";
  if (state === MERGE_CELL_STATES.AUTO_BOTH || state === MERGE_CELL_STATES.ADDED_BOTH) return "both";
  return "base";
}

function sourceForOrder(choices, result) {
  if (arrayEquals(choices?.a ?? [], result ?? [])) return "a";
  if (arrayEquals(choices?.b ?? [], result ?? [])) return "b";
  if (arrayEquals(choices?.base ?? [], result ?? [])) return "base";
  return "both";
}

function deletedRowSource(values) {
  if (values.a?.size === 0 && values.b?.size > 0) return "a";
  if (values.a?.size > 0 && values.b?.size === 0) return "b";
  return "both";
}

function wholeFileResultMarker(source) {
  if (source === "a") return "A file selected";
  if (source === "b") return "B file selected";
  return "Merged file";
}

function rowProjectionValue(value) {
  return value instanceof Map && value.size === 0 ? MERGE_MISSING : value ?? MERGE_MISSING;
}

function isAddedRowState(state) {
  return state === MERGE_CELL_STATES.ADDED_A
    || state === MERGE_CELL_STATES.ADDED_B
    || state === MERGE_CELL_STATES.ADDED_BOTH;
}

function isAddedColumnState(state) {
  return isAddedRowState(state);
}

function displayProjectionValue(value) {
  if (value === MERGE_MISSING) return "<missing>";
  if (value instanceof Map) {
    const result = {};
    for (const [key, entry] of value) result[String(key)] = displayProjectionValue(entry);
    return result;
  }
  if (Array.isArray(value)) return value.map((entry) => displayProjectionValue(entry));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) result[key] = displayProjectionValue(entry);
    return result;
  }
  return value == null ? "" : String(value);
}

export function refreshMergeFileStatus(file) {
  if (!file) return "unchanged";
  const unresolved = unresolvedMergeConflicts(file).length;
  const blockedSchema = file.warnings.some((warning) => warning.blockingUntilAcknowledged && !file.schemaAcknowledged);
  if (unresolved) file.status = "conflict";
  else if (blockedSchema) file.status = "schema-mismatch";
  else if (file.custom) {
    if (file.sidePresence?.a && file.sidePresence?.b) file.status = "custom-both";
    else file.status = file.sidePresence?.a ? "custom-a" : "custom-b";
  } else if (file.conflicts.length) file.status = "resolved";
  else if (file.metrics.changedCells || file.metrics.addedRows || file.metrics.deletedRows || file.metrics.addedColumns || file.metrics.deletedColumns || file.metrics.movedRows || file.metrics.changedFiles) file.status = "auto-merged";
  else file.status = "unchanged";
  return file.status;
}

function createStructuredModel({ descriptor, headerDescriptors, rowIndexes, keySpec }) {
  return {
    descriptor,
    headerDescriptors,
    rowIndexes,
    keySpec,
    columns: new Map(),
    columnOrder: [],
    rows: new Map(),
    rowOrder: [],
    cellStates: new Map(),
    rowStates: new Map(),
    headerStates: new Map(),
    deletedRows: [],
    deletedColumns: [],
    orderChoices: { row: null, column: null }
  };
}

function mergeColumns(file, model) {
  const { headerDescriptors, rowIndexes } = model;
  const union = orderedUnion(
    headerDescriptors.base?.order ?? [],
    headerDescriptors.a?.order ?? [],
    headerDescriptors.b?.order ?? []
  );
  for (const columnId of union) {
    const entries = {
      base: headerDescriptors.base?.byId.get(columnId) ?? null,
      a: headerDescriptors.a?.byId.get(columnId) ?? null,
      b: headerDescriptors.b?.byId.get(columnId) ?? null
    };
    const column = {
      id: columnId,
      name: entries.a?.name ?? entries.b?.name ?? entries.base?.name ?? "",
      indices: { base: entries.base?.index ?? -1, a: entries.a?.index ?? -1, b: entries.b?.index ?? -1 },
      enabled: true,
      structuralConflict: false,
      sourcePresence: { base: Boolean(entries.base), a: Boolean(entries.a), b: Boolean(entries.b) }
    };
    model.columns.set(columnId, column);

    if (entries.base) {
      if (!entries.a && !entries.b) {
        column.enabled = false;
        model.deletedColumns.push(columnId);
        model.headerStates.set(columnId, MERGE_CELL_STATES.STRUCTURE);
        continue;
      }
      if (!entries.a || !entries.b) {
        const missingSide = !entries.a ? "a" : "b";
        const presentSide = missingSide === "a" ? "b" : "a";
        const unchanged = columnUnchangedFromBase(columnId, presentSide, model);
        if (unchanged) {
          column.enabled = false;
          model.deletedColumns.push(columnId);
          model.headerStates.set(columnId, missingSide === "a" ? MERGE_CELL_STATES.AUTO_A : MERGE_CELL_STATES.AUTO_B);
        } else {
          column.structuralConflict = true;
          model.headerStates.set(columnId, MERGE_CELL_STATES.CONFLICT);
          file.conflicts.push(createConflict(file, {
            kind: MERGE_CONFLICT_KINDS.COLUMN_DELETE_MODIFY,
            message: `${missingSide.toUpperCase()} deleted column '${entries.base.name}' while ${presentSide.toUpperCase()} modified it.`,
            columnName: entries.base.name,
            values: { base: entries.base.name, a: entries.a?.name ?? MERGE_MISSING, b: entries.b?.name ?? MERGE_MISSING },
            target: { type: "column", columnId }
          }));
        }
      }
    } else {
      model.headerStates.set(columnId, entries.a && entries.b ? MERGE_CELL_STATES.ADDED_BOTH : entries.a ? MERGE_CELL_STATES.ADDED_A : MERGE_CELL_STATES.ADDED_B);
    }

    if (entries.a && entries.b) {
      const mergedName = mergeScalar(entries.base?.name ?? MERGE_MISSING, entries.a.name, entries.b.name);
      if (mergedName.conflict) {
        model.headerStates.set(columnId, MERGE_CELL_STATES.CONFLICT);
        file.conflicts.push(createConflict(file, {
          kind: MERGE_CONFLICT_KINDS.HEADER_NAME,
          message: `A and B use different header text for '${columnId}'.`,
          columnName: entries.base?.name ?? entries.a.name,
          values: { base: entries.base?.name ?? MERGE_MISSING, a: entries.a.name, b: entries.b.name },
          target: { type: "header", columnId }
        }));
      } else {
        column.name = mergedName.value;
        if (!model.headerStates.has(columnId)) model.headerStates.set(columnId, mergedName.state);
      }
    }
  }

  const enabled = new Set([...model.columns].filter(([, column]) => column.enabled).map(([id]) => id));
  const orderResult = mergeSequenceOrder({
    base: (headerDescriptors.base?.order ?? []).filter((id) => enabled.has(id)),
    a: (headerDescriptors.a?.order ?? []).filter((id) => enabled.has(id)),
    b: (headerDescriptors.b?.order ?? []).filter((id) => enabled.has(id)),
    all: [...enabled]
  });
  model.columnOrder = orderResult.order;
  model.orderChoices.column = orderResult.choices;
  if (orderResult.conflict) {
    file.conflicts.push(createConflict(file, {
      kind: MERGE_CONFLICT_KINDS.COLUMN_ORDER,
      message: "A and B reordered columns differently.",
      values: { base: orderResult.choices.base, a: orderResult.choices.a, b: orderResult.choices.b },
      target: { type: "column-order" }
    }));
  }
}

function mergeRows(file, model) {
  const { rowIndexes } = model;
  const allKeys = orderedUnion(rowIndexes.base?.order ?? [], rowIndexes.a?.order ?? [], rowIndexes.b?.order ?? []);
  for (const rowKey of allKeys) {
    const rowLabel = displayRowKeyForModel(rowKey, model);
    const baseIndex = rowIndexes.base?.byKey.get(rowKey);
    const aIndex = rowIndexes.a?.byKey.get(rowKey);
    const bIndex = rowIndexes.b?.byKey.get(rowKey);
    const hasBase = baseIndex != null;
    const hasA = aIndex != null;
    const hasB = bIndex != null;
    const sourceRows = {
      base: rowValuesForSide("base", baseIndex, model),
      a: rowValuesForSide("a", aIndex, model),
      b: rowValuesForSide("b", bIndex, model)
    };

    if (hasBase && !hasA && !hasB) {
      model.deletedRows.push(rowKey);
      continue;
    }
    if (hasBase && (!hasA || !hasB)) {
      const missingSide = !hasA ? "a" : "b";
      const presentSide = missingSide === "a" ? "b" : "a";
      const presentRow = sourceRows[presentSide];
      if (rowMapsEqual(presentRow, sourceRows.base, model.columnOrder)) {
        model.deletedRows.push(rowKey);
        continue;
      }
      const row = { key: rowKey, values: new Map(presentRow), sourceRows, deleted: false };
      model.rows.set(rowKey, row);
      model.rowStates.set(rowKey, MERGE_CELL_STATES.CONFLICT);
      file.conflicts.push(createConflict(file, {
        kind: MERGE_CONFLICT_KINDS.DELETE_MODIFY,
        message: `${missingSide.toUpperCase()} deleted row '${rowLabel}' while ${presentSide.toUpperCase()} modified it.`,
        rowKey: rowLabel,
        values: { base: sourceRows.base, a: hasA ? sourceRows.a : MERGE_MISSING, b: hasB ? sourceRows.b : MERGE_MISSING },
        target: { type: "row", rowKey }
      }));
      continue;
    }

    const row = { key: rowKey, values: new Map(), sourceRows, deleted: false };
    model.rows.set(rowKey, row);
    if (!hasBase) {
      model.rowStates.set(rowKey, hasA && hasB ? MERGE_CELL_STATES.ADDED_BOTH : hasA ? MERGE_CELL_STATES.ADDED_A : MERGE_CELL_STATES.ADDED_B);
    }
    for (const columnId of model.columnOrder) {
      const column = model.columns.get(columnId);
      if (!column?.enabled) continue;
      const baseValue = hasBase ? sourceRows.base.get(columnId) ?? MERGE_MISSING : MERGE_MISSING;
      const aValue = hasA ? sourceRows.a.get(columnId) ?? MERGE_MISSING : MERGE_MISSING;
      const bValue = hasB ? sourceRows.b.get(columnId) ?? MERGE_MISSING : MERGE_MISSING;
      if (column.structuralConflict) {
        const previewValue = baseValue !== MERGE_MISSING
          ? baseValue
          : aValue !== MERGE_MISSING
            ? aValue
            : bValue;
        row.values.set(columnId, previewValue);
        model.cellStates.set(cellKey(rowKey, columnId), MERGE_CELL_STATES.CONFLICT);
        continue;
      }
      const merged = mergeScalar(baseValue, aValue, bValue);
      row.values.set(columnId, merged.value);
      let state = merged.state;
      if (!hasBase && !merged.conflict) {
        state = hasA && hasB ? MERGE_CELL_STATES.ADDED_BOTH : hasA ? MERGE_CELL_STATES.ADDED_A : MERGE_CELL_STATES.ADDED_B;
      }
      model.cellStates.set(cellKey(rowKey, columnId), state);
      if (merged.conflict) {
        file.conflicts.push(createConflict(file, {
          kind: hasBase ? MERGE_CONFLICT_KINDS.VALUE : MERGE_CONFLICT_KINDS.ADD_ADD,
          message: hasBase
            ? `A and B changed '${column.name}' differently for row '${rowLabel}'.`
            : `A and B added the same row key with different '${column.name}' values.`,
          rowKey: rowLabel,
          columnName: column.name,
          values: { base: baseValue, a: aValue, b: bValue },
          target: { type: "cell", rowKey, columnId }
        }));
      }
    }
  }
}

function mergeResultOrder(file, model) {
  const resultKeys = new Set(model.rows.keys());
  const orderResult = mergeSequenceOrder({
    base: (model.rowIndexes.base?.order ?? []).filter((key) => resultKeys.has(key)),
    a: (model.rowIndexes.a?.order ?? []).filter((key) => resultKeys.has(key)),
    b: (model.rowIndexes.b?.order ?? []).filter((key) => resultKeys.has(key)),
    all: [...resultKeys]
  });
  model.rowOrder = orderResult.order;
  model.orderChoices.row = orderResult.choices;
  if (orderResult.changedBy === "a" || orderResult.changedBy === "b") {
    const basePositions = new Map((model.rowIndexes.base?.order ?? []).map((key, index) => [key, index]));
    model.rowOrder.forEach((key, index) => {
      if (basePositions.has(key) && basePositions.get(key) !== index) {
        if (!model.rowStates.has(key)) model.rowStates.set(key, MERGE_CELL_STATES.MOVED);
      }
    });
  }
  if (orderResult.conflict) {
    file.conflicts.push(createConflict(file, {
      kind: MERGE_CONFLICT_KINDS.ROW_ORDER,
      message: "A and B reordered rows differently.",
      values: { base: orderResult.choices.base, a: orderResult.choices.a, b: orderResult.choices.b },
      target: { type: "row-order" }
    }));
  }
}

function inferRowKeySpec(fileName, docs, headers) {
  const presentSides = ["base", "a", "b"].filter((side) => docs[side]);
  const candidates = uniqueKeyCandidates([
    ...(DUPLICATE_KEYS[fileName] ?? []).map((name) => ({ names: [name], schemaDefined: true })),
    ...(FILE_KEY_CANDIDATES[fileName] ?? []).map((names) => ({ names, schemaDefined: false })),
    ...DEFAULT_KEY_CANDIDATES.map((names) => ({ names, schemaDefined: false }))
  ]);
  for (const candidate of candidates) {
    const { names } = candidate;
    const ids = names.map(normalizeHeaderName);
    if (!presentSides.every((side) => ids.every((id) => headers[side]?.byId.has(id)))) continue;
    const comparisons = ids.map((id) => {
      const configured = DUPLICATE_KEY_COMPARISONS[fileName]?.[id];
      if (configured) return configured;
      return candidate.schemaDefined ? "raw" : "exact";
    });
    const spec = {
      ids,
      names,
      comparisons,
      strategy: comparisons.every((comparison) => comparison === "exact") ? "exact-text" : "schema-aware"
    };
    if (presentSides.every((side) => rowKeyCandidateIsUnique(docs[side], headers[side], spec))) return spec;
  }
  return null;
}

function rowKeyCandidateIsUnique(doc, headers, spec) {
  if (!doc) return true;
  const seen = new Set();
  for (let rowIndex = 1; rowIndex < doc.rows.length; rowIndex += 1) {
    const row = doc.rows[rowIndex] ?? [];
    if (specialRowKey(row, new Map()) != null) continue;
    const key = keyForDataRow(row, headers, spec);
    if (!key || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function buildRowIndex(doc, headers, spec) {
  if (!doc) return null;
  const byKey = new Map();
  const displayByKey = new Map();
  const order = [];
  const errors = [];
  const specialCounts = new Map();
  for (let rowIndex = 1; rowIndex < doc.rows.length; rowIndex += 1) {
    const row = doc.rows[rowIndex] ?? [];
    const special = specialRowKey(row, specialCounts);
    const key = special ?? keyForDataRow(row, headers, spec);
    if (!key) {
      errors.push(`row ${rowIndex + 1} has an empty key`);
      continue;
    }
    if (byKey.has(key)) {
      errors.push(`duplicate key '${displayKeyForDataRow(row, headers, spec) || displayRowKey(key)}'`);
      continue;
    }
    byKey.set(key, rowIndex);
    displayByKey.set(key, special ? displayRowKey(special) : displayKeyForDataRow(row, headers, spec));
    order.push(key);
  }
  return { byKey, displayByKey, order, errors };
}

function keyForDataRow(row, headers, spec) {
  const values = [];
  for (let keyIndex = 0; keyIndex < spec.ids.length; keyIndex += 1) {
    const id = spec.ids[keyIndex];
    const index = headers.byId.get(id)?.index ?? -1;
    const value = rawCell(row, index);
    if (value === MERGE_MISSING || value === "") return "";
    const comparison = spec.comparisons?.[keyIndex] ?? "exact";
    const identity = comparison === "exact" ? String(value) : duplicateIdentity(value, comparison);
    if (identity === "") return "";
    values.push(escapeKeyPart(identity));
  }
  return `data:${values.join("\u001f")}`;
}

function displayKeyForDataRow(row, headers, spec) {
  const values = [];
  for (const id of spec.ids) {
    const index = headers.byId.get(id)?.index ?? -1;
    const value = rawCell(row, index);
    if (value === MERGE_MISSING || value === "") return "";
    values.push(String(value));
  }
  return values.join(" / ");
}

function displayRowKeyForModel(rowKey, model) {
  for (const side of ["base", "a", "b"]) {
    const label = model.rowIndexes[side]?.displayByKey?.get(rowKey);
    if (label) return label;
  }
  return displayRowKey(rowKey);
}

function specialRowKey(row, counts) {
  const values = Array.from({ length: row.length }, (_, index) => rawCell(row, index));
  const allEmpty = values.every((value) => value === MERGE_MISSING || value === "");
  const comment = String(values.find((value) => value !== MERGE_MISSING) ?? "").trimStart().startsWith("*");
  if (!allEmpty && !comment) return null;
  const payload = values.map((value) => value === MERGE_MISSING ? "<missing>" : value).join("\u001e");
  const type = allEmpty ? "blank" : "comment";
  const token = `${type}:${payload}`;
  const occurrence = (counts.get(token) ?? 0) + 1;
  counts.set(token, occurrence);
  return `special:${token}:${occurrence}`;
}

function describeHeaders(doc) {
  if (!doc) return null;
  const header = doc.rows?.[0] ?? [];
  const byId = new Map();
  const order = [];
  const invalidReasons = [];
  for (let index = 0; index < header.length; index += 1) {
    const name = String(header[index] ?? "");
    const id = normalizeHeaderName(name);
    if (!id) {
      invalidReasons.push(`empty header at column ${index + 1}`);
      continue;
    }
    if (byId.has(id)) {
      invalidReasons.push(`duplicate header '${name}'`);
      continue;
    }
    byId.set(id, { id, name, index });
    order.push(id);
  }
  if (!order.length) invalidReasons.push("no usable headers");
  const overflowRows = [];
  for (let rowIndex = 1; rowIndex < (doc.rows?.length ?? 0); rowIndex += 1) {
    const row = doc.rows[rowIndex] ?? [];
    if (row.length > header.length) overflowRows.push(rowIndex + 1);
    if (overflowRows.length >= 3) break;
  }
  if (overflowRows.length) {
    invalidReasons.push(`data rows exceed the header width (line${overflowRows.length === 1 ? "" : "s"} ${overflowRows.join(", ")})`);
  }
  return { byId, order, invalidReasons };
}

function headerSimilarity(base, side) {
  if (!base || !side) return 0;
  const baseIds = new Set(base.order);
  const sideIds = new Set(side.order);
  const intersection = [...baseIds].filter((id) => sideIds.has(id)).length;
  return intersection / Math.max(baseIds.size, sideIds.size, 1);
}

function columnUnchangedFromBase(columnId, side, model) {
  const baseIndex = model.rowIndexes.base;
  const sideIndex = model.rowIndexes[side];
  if (!baseIndex || !sideIndex) return true;
  const column = model.columns.get(columnId);
  for (const [rowKey, baseRowIndex] of baseIndex.byKey) {
    const sideRowIndex = sideIndex.byKey.get(rowKey);
    if (sideRowIndex == null) continue;
    const baseValue = rawCell(model.descriptor.docs.base.rows[baseRowIndex], column.indices.base);
    const sideValue = rawCell(model.descriptor.docs[side].rows[sideRowIndex], column.indices[side]);
    if (!sameMergeValue(baseValue, sideValue)) return false;
  }
  for (const [rowKey, sideRowIndex] of sideIndex.byKey) {
    if (baseIndex.byKey.has(rowKey)) continue;
    const sideValue = rawCell(model.descriptor.docs[side].rows[sideRowIndex], column.indices[side]);
    if (sideValue !== MERGE_MISSING && sideValue !== "") return false;
  }
  return true;
}

function rowValuesForSide(side, rowIndex, model) {
  const values = new Map();
  const doc = model.descriptor.docs[side];
  if (!doc || rowIndex == null) return values;
  const row = doc.rows[rowIndex] ?? [];
  for (const [columnId, column] of model.columns) {
    values.set(columnId, rawCell(row, column.indices[side]));
  }
  return values;
}

function applyRowConflictChoice(model, conflict, choice) {
  if (choice === "custom") throw new Error("Row conflicts require A, B, or the built-in original.");
  const source = conflict.values[choice];
  if (source === MERGE_MISSING) {
    model.rows.delete(conflict.target.rowKey);
    model.rowOrder = model.rowOrder.filter((key) => key !== conflict.target.rowKey);
    if (!model.deletedRows.includes(conflict.target.rowKey)) model.deletedRows.push(conflict.target.rowKey);
    model.rowStates.set(conflict.target.rowKey, MERGE_CELL_STATES.RESOLVED);
    return;
  }
  model.deletedRows = model.deletedRows.filter((key) => key !== conflict.target.rowKey);
  const current = model.rows.get(conflict.target.rowKey) ?? {
    key: conflict.target.rowKey,
    values: new Map(),
    sourceRows: conflict.values,
    deleted: false
  };
  current.values = new Map(source);
  current.deleted = false;
  model.rows.set(conflict.target.rowKey, current);
  if (!model.rowOrder.includes(conflict.target.rowKey)) {
    insertByReferenceOrder(model.rowOrder, conflict.target.rowKey, model.rowIndexes[choice]?.order ?? []);
  }
  model.rowStates.set(conflict.target.rowKey, MERGE_CELL_STATES.RESOLVED);
}

function applyColumnConflictChoice(model, conflict, choice) {
  if (choice === "custom") throw new Error("Column conflicts require A, B, or the built-in original.");
  const columnId = conflict.target.columnId;
  const column = model.columns.get(columnId);
  if (!column) return;
  const sourceEntry = model.headerDescriptors[choice]?.byId.get(columnId);
  if (!sourceEntry) {
    column.enabled = false;
    column.structuralConflict = false;
    model.columnOrder = model.columnOrder.filter((id) => id !== columnId);
    if (!model.deletedColumns.includes(columnId)) model.deletedColumns.push(columnId);
    for (const rowKey of model.rows.keys()) {
      model.cellStates.set(cellKey(rowKey, columnId), MERGE_CELL_STATES.RESOLVED);
    }
    model.headerStates.set(columnId, MERGE_CELL_STATES.RESOLVED);
    return;
  }
  column.enabled = true;
  column.structuralConflict = false;
  model.deletedColumns = model.deletedColumns.filter((id) => id !== columnId);
  column.name = sourceEntry.name;
  if (!model.columnOrder.includes(columnId)) {
    insertByReferenceOrder(model.columnOrder, columnId, model.headerDescriptors[choice]?.order ?? []);
  }
  const sourceIndex = model.rowIndexes[choice];
  for (const [rowKey, row] of model.rows) {
    const sourceRowIndex = sourceIndex?.byKey.get(rowKey);
    const value = sourceRowIndex == null
      ? MERGE_MISSING
      : rawCell(model.descriptor.docs[choice].rows[sourceRowIndex], sourceEntry.index);
    row.values.set(columnId, value);
    model.cellStates.set(cellKey(rowKey, columnId), MERGE_CELL_STATES.RESOLVED);
  }
  model.headerStates.set(columnId, MERGE_CELL_STATES.RESOLVED);
}

function insertByReferenceOrder(targetOrder, key, referenceOrder) {
  const referenceIndex = referenceOrder.indexOf(key);
  if (referenceIndex < 0) {
    targetOrder.push(key);
    return targetOrder;
  }
  for (let index = referenceIndex - 1; index >= 0; index -= 1) {
    const previousIndex = targetOrder.indexOf(referenceOrder[index]);
    if (previousIndex >= 0) {
      targetOrder.splice(previousIndex + 1, 0, key);
      return targetOrder;
    }
  }
  for (let index = referenceIndex + 1; index < referenceOrder.length; index += 1) {
    const nextIndex = targetOrder.indexOf(referenceOrder[index]);
    if (nextIndex >= 0) {
      targetOrder.splice(nextIndex, 0, key);
      return targetOrder;
    }
  }
  targetOrder.push(key);
  return targetOrder;
}

function resolveOrderChoice(model, conflict, choice, kind) {
  if (choice === "custom") throw new Error("Order conflicts require A, B, or the built-in original.");
  const available = kind === "row" ? new Set(model.rows.keys()) : new Set([...model.columns].filter(([, column]) => column.enabled).map(([id]) => id));
  const selected = (conflict.values[choice] ?? []).filter((key) => available.has(key));
  return [...selected, ...[...available].filter((key) => !selected.includes(key))];
}

function mergeSequenceOrder({ base, a, b, all }) {
  const universe = new Set(all);
  const baseFiltered = base.filter((key) => universe.has(key));
  const aFiltered = a.filter((key) => universe.has(key));
  const bFiltered = b.filter((key) => universe.has(key));
  const baseSet = new Set(baseFiltered);
  const baseCore = baseFiltered;
  const aCore = aFiltered.filter((key) => baseSet.has(key));
  const bCore = bFiltered.filter((key) => baseSet.has(key));
  const baseForA = baseCore.filter((key) => aCore.includes(key));
  const baseForB = baseCore.filter((key) => bCore.includes(key));
  const changedA = !arrayEquals(aCore, baseForA);
  const changedB = !arrayEquals(bCore, baseForB);
  let core;
  let conflict = false;
  let changedBy = "none";
  if (arrayEquals(aCore, bCore)) {
    core = aCore;
    changedBy = changedA ? "both" : "none";
  } else if (!changedA) {
    core = bCore;
    changedBy = "b";
  } else if (!changedB) {
    core = aCore;
    changedBy = "a";
  } else {
    core = aCore;
    conflict = true;
    changedBy = "conflict";
  }
  const inserted = integrateAddedSequence(core, baseSet, aFiltered, bFiltered, universe);
  conflict ||= inserted.conflict;
  const order = orderedUnion(inserted.order, [...universe]);
  return {
    order,
    conflict,
    changedBy,
    choices: {
      base: integrateAddedSequence(baseCore, baseSet, aFiltered, bFiltered, universe).order,
      a: orderedUnion(aFiltered, bFiltered, [...universe]),
      b: orderedUnion(bFiltered, aFiltered, [...universe])
    }
  };
}

function integrateAddedSequence(core, baseSet, a, b, universe) {
  const slotsA = insertionSlots(core, baseSet, a, universe);
  const slotsB = insertionSlots(core, baseSet, b, universe);
  const result = [];
  let conflict = false;
  for (let slot = 0; slot <= core.length; slot += 1) {
    const merged = mergeSlotSequences(slotsA.get(slot) ?? [], slotsB.get(slot) ?? []);
    result.push(...merged.order);
    conflict ||= merged.conflict;
    if (slot < core.length) result.push(core[slot]);
  }
  return { order: orderedUnion(result, [...universe]), conflict };
}

function insertionSlots(core, baseSet, sideOrder, universe) {
  const coreIndex = new Map(core.map((key, index) => [key, index]));
  const slots = new Map();
  let lastCoreSlot = 0;
  for (const key of sideOrder) {
    if (!universe.has(key)) continue;
    if (baseSet.has(key)) {
      if (coreIndex.has(key)) lastCoreSlot = coreIndex.get(key) + 1;
      continue;
    }
    const values = slots.get(lastCoreSlot) ?? [];
    if (!values.includes(key)) values.push(key);
    slots.set(lastCoreSlot, values);
  }
  return slots;
}

function mergeSlotSequences(a, b) {
  if (!a.length) return { order: [...b], conflict: false };
  if (!b.length || arrayEquals(a, b)) return { order: [...a], conflict: false };
  const nodes = orderedUnion(a, b);
  const edges = new Map(nodes.map((node) => [node, new Set()]));
  addAdjacentEdges(edges, a);
  addAdjacentEdges(edges, b);
  const indegree = new Map(nodes.map((node) => [node, 0]));
  for (const targets of edges.values()) for (const target of targets) indegree.set(target, indegree.get(target) + 1);
  const rank = new Map(nodes.map((node, index) => [node, index]));
  const queue = nodes.filter((node) => indegree.get(node) === 0);
  const order = [];
  while (queue.length) {
    queue.sort((left, right) => rank.get(left) - rank.get(right));
    const node = queue.shift();
    order.push(node);
    for (const target of edges.get(node)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return order.length === nodes.length
    ? { order, conflict: false }
    : { order: orderedUnion(a, b), conflict: true };
}

function addAdjacentEdges(edges, sequence) {
  for (let index = 1; index < sequence.length; index += 1) {
    if (sequence[index - 1] !== sequence[index]) edges.get(sequence[index - 1])?.add(sequence[index]);
  }
}

function safeWholeTableFallback(file, { kind, message }) {
  const base = file.docs.base;
  const a = file.docs.a;
  const b = file.docs.b;
  if (a && b && tablesEqual(a, b)) return fallbackFile(file, "A and B are identical.", null, "a");
  if (base && a && tablesEqual(base, a) && b) return fallbackFile(file, "Only B changed the whole table.", null, "b");
  if (base && b && tablesEqual(base, b) && a) return fallbackFile(file, "Only A changed the whole table.", null, "a");
  return fallbackFile(file, message, kind, a ? "a" : b ? "b" : "base");
}

function fallbackFile(file, message, conflictKind, source = "base") {
  file.overrideSource = source;
  file._model = null;
  if (conflictKind) {
    file.conflicts.push(createConflict(file, {
      kind: conflictKind,
      message,
      values: { base: file.docs.base ? "built-in original file" : MERGE_MISSING, a: file.docs.a ? "A file" : MERGE_MISSING, b: file.docs.b ? "B file" : MERGE_MISSING },
      target: { type: "file" }
    }));
  }
  materializeMergeFile(file);
  file.metrics = tablesEqual(file.docs.base, file.docs[source]) ? emptyMetrics() : { ...emptyMetrics(), changedFiles: 1 };
  refreshMergeFileStatus(file);
  return file;
}

function createConflict(file, details) {
  nextConflictSequence += 1;
  return {
    id: `${file.id}:conflict:${nextConflictSequence}`,
    fileId: file.id,
    fileName: file.name,
    relativePath: file.relativePath,
    kind: details.kind,
    message: details.message,
    rowKey: details.rowKey ?? "",
    columnName: details.columnName ?? "",
    values: details.values,
    target: details.target,
    resolution: null,
    row: null,
    column: null
  };
}

function refreshConflictCoordinates(file) {
  for (const conflict of file.conflicts) {
    const target = conflict.target;
    if (!file._coordinates) {
      conflict.row = 0;
      conflict.column = 0;
      continue;
    }
    if (target.type === "cell") {
      conflict.row = file._coordinates.rowIndexByKey.get(target.rowKey) ?? null;
      conflict.column = file._coordinates.columnIndexById.get(target.columnId) ?? null;
    } else if (target.type === "row") {
      conflict.row = file._coordinates.rowIndexByKey.get(target.rowKey) ?? null;
      conflict.column = 0;
    } else if (target.type === "column" || target.type === "header") {
      conflict.row = 0;
      conflict.column = file._coordinates.columnIndexById.get(target.columnId) ?? null;
    } else {
      conflict.row = 0;
      conflict.column = 0;
    }
  }
}

function calculateMetrics(file) {
  const model = file._model;
  const metrics = emptyMetrics();
  metrics.deletedRows = model.deletedRows.length;
  metrics.deletedColumns = model.deletedColumns.length;
  for (const state of model.cellStates.values()) {
    if (state !== MERGE_CELL_STATES.UNCHANGED) metrics.changedCells += 1;
    if (state === MERGE_CELL_STATES.AUTO_A) metrics.autoA += 1;
    if (state === MERGE_CELL_STATES.AUTO_B) metrics.autoB += 1;
    if (state === MERGE_CELL_STATES.AUTO_BOTH) metrics.autoBoth += 1;
  }
  for (const state of model.rowStates.values()) {
    if (state === MERGE_CELL_STATES.ADDED_A || state === MERGE_CELL_STATES.ADDED_B || state === MERGE_CELL_STATES.ADDED_BOTH) metrics.addedRows += 1;
    if (state === MERGE_CELL_STATES.MOVED) metrics.movedRows += 1;
  }
  for (const [columnId, state] of model.headerStates) {
    const column = model.columns.get(columnId);
    if (column?.sourcePresence.base === false && column.enabled) metrics.addedColumns += 1;
    if (state === MERGE_CELL_STATES.STRUCTURE && column?.enabled === false) metrics.deletedColumns += 0;
  }
  metrics.conflicts = unresolvedMergeConflicts(file).length;
  metrics.resolvedConflicts = file.conflicts.length - metrics.conflicts;
  return metrics;
}

function emptyMetrics() {
  return {
    changedCells: 0,
    autoA: 0,
    autoB: 0,
    autoBoth: 0,
    addedRows: 0,
    deletedRows: 0,
    movedRows: 0,
    addedColumns: 0,
    deletedColumns: 0,
    conflicts: 0,
    resolvedConflicts: 0,
    changedFiles: 0
  };
}

function selectedFormat(file) {
  const source = eligibleFormatSource(file, file.formatSource) ? file.formatSource : automaticFormatSource(file);
  const selected = file.formats[source] ?? file.formats.base ?? file.formats.a ?? file.formats.b ?? formatFromDocument(null);
  return { ...selected };
}

function automaticFormatSource(file) {
  if (file?.docs?.a && file?.sidePresence?.a !== false) return "a";
  if (file?.docs?.b && file?.sidePresence?.b !== false) return "b";
  if (file?.docs?.base && (file.baseAvailable || verifiedBuiltInBase(file))) return "base";
  return "a";
}

function eligibleFormatSource(file, source) {
  if (!source || !file?.docs?.[source] || !file?.formats?.[source]) return false;
  return source === "base" || file.sidePresence?.[source] !== false;
}

function verifiedBuiltInBase(file) {
  if (!file?.baseAvailable || !file?.docs?.base) return false;
  // Reference-dataset entries are dataset-relative. Absolute paths identify
  // workspace inputs and must not be treated as verified built-in metadata.
  const path = String(file.docs.base.path ?? "").replaceAll("\\", "/");
  return !path || (!path.startsWith("/") && !/^[A-Za-z]:\//.test(path));
}

function formatFromDocument(doc) {
  return {
    lineEnding: doc?.lineEnding ?? "\n",
    finalNewline: Boolean(doc?.finalNewline),
    encoding: doc?.encoding ?? "utf-8"
  };
}

function coordinatesForRows(rows) {
  return {
    rowKeyByIndex: new Map(),
    rowIndexByKey: new Map(),
    columnIndexById: new Map(),
    columnIdByIndex: new Map(Array.from({ length: rows?.[0]?.length ?? 0 }, (_, index) => [index, `column:${index}`]))
  };
}

function sparseResultRow(values) {
  let last = values.length - 1;
  while (last >= 0 && values[last] === MERGE_MISSING) last -= 1;
  const row = [];
  row.length = last + 1;
  for (let index = 0; index <= last; index += 1) {
    if (values[index] !== MERGE_MISSING) row[index] = String(values[index]);
  }
  return row;
}

function tablesEqual(left, right) {
  if (!left || !right) return left === right;
  if (left.rows.length !== right.rows.length) return false;
  return left.rows.every((row, index) => sparseRowsEqual(row, right.rows[index]));
}

function sparseRowsEqual(left = [], right = []) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if ((index in left) !== (index in right)) return false;
    if ((index in left) && String(left[index] ?? "") !== String(right[index] ?? "")) return false;
  }
  return true;
}

function cloneRows(rows) {
  return (rows ?? []).map((row) => {
    const clone = [];
    clone.length = row?.length ?? 0;
    for (let index = 0; index < clone.length; index += 1) if (index in row) clone[index] = String(row[index] ?? "");
    return clone;
  });
}

function rawCell(row, index) {
  if (!row || index < 0 || index >= row.length || !(index in row)) return MERGE_MISSING;
  return String(row[index] ?? "");
}

function rowMapsEqual(left, right, columnOrder) {
  return columnOrder.every((columnId) => sameMergeValue(left.get(columnId) ?? MERGE_MISSING, right.get(columnId) ?? MERGE_MISSING));
}

function sameMergeValue(left, right) {
  return left === MERGE_MISSING ? right === MERGE_MISSING : right !== MERGE_MISSING && String(left) === String(right);
}

function normalizeHeaderName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeRelativePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizedFileId(value) {
  return normalizeRelativePath(value).toLowerCase() || `merge-file-${Date.now()}`;
}

function cellKey(rowKey, columnId) {
  return `${rowKey}\u001d${columnId}`;
}

function escapeKeyPart(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\u001f", "\\u001f");
}

function displayRowKey(value) {
  const text = String(value ?? "");
  if (text.startsWith("data:")) return text.slice(5).replaceAll("\u001f", " / ");
  if (text.startsWith("special:comment:")) return "comment row";
  if (text.startsWith("special:blank:")) return "blank row";
  return text;
}

function orderedUnion(...sequences) {
  const seen = new Set();
  const result = [];
  for (const sequence of sequences) {
    for (const value of sequence ?? []) {
      if (seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function uniqueKeyCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.names.map(normalizeHeaderName).join("\u001f");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function arrayEquals(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function highlightIdForState(state) {
  if (state === MERGE_CELL_STATES.CONFLICT) return "red";
  if (state === MERGE_CELL_STATES.RESOLVED) return "purple";
  if (state === MERGE_CELL_STATES.AUTO_A || state === MERGE_CELL_STATES.ADDED_A) return "sky";
  if (state === MERGE_CELL_STATES.AUTO_B || state === MERGE_CELL_STATES.ADDED_B) return "lime";
  if (state === MERGE_CELL_STATES.AUTO_BOTH || state === MERGE_CELL_STATES.ADDED_BOTH) return "blue";
  if (state === MERGE_CELL_STATES.MOVED || state === MERGE_CELL_STATES.STRUCTURE) return "orange";
  return null;
}

const MERGE_RESOLUTION_CHOICES = new Set(["a", "b", "base", "custom"]);
