import { cubeInputCount, inputColumns, parseCubeInput, parseCubeOutput } from "./lint-cube.js";
import { CUBE_OUTPUT_MOD_COLUMNS } from "./lint-stat-data.js";
import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { asciiLower, fitsFixed4cc, fixed4ccValues, fixed4Key, propertyGroupsEnabled, referenceTable } from "./lint-reference-semantics.js";
import { clean } from "./lint-table.js";
import { legacyMessage } from "./legacy-lint-i18n.js";

const CUBE_OUTPUT_BYTE_MODIFIERS = new Set(["qty", "sock", "lvl"]);

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const CUBE_LINT_RULES = [
  rule("Cube/ValidInputs", lintCubeInputs, true, PROFILE_OPTIONS),
  rule("Cube/ValidOutputs", lintCubeOutputs, true, PROFILE_OPTIONS),
  rule("Cube/ValidOp", lintCubeOp, true, PROFILE_OPTIONS)
];

export function lintCubeInputs(index, ctx) {
  const table = index.tablesByName.get("cubemain.txt");
  if (!table) return;
  const lookup = buildCubeItemLookup(index);
  table.eachRow((row) => {
    if (!isEnabled(row.get("enabled"))) return;
    const inputs = inputColumns(row, table).map((columnName) => ({ columnName, parsed: parseCubeInput(row.get(columnName)) })).filter((entry) => entry.parsed.raw);
    const declared = clean(row.get("numinputs"));
    const description = rawRowValue(table, row.rowIndex, "description");
    if (!declared || declared === "0") {
      ctx.add(table, row.rowIndex, "numinputs", legacyMessage("cube.noInputs", { description: clean(row.get("description")) }), {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: no inputs for recipe '${description}'`
      });
      return;
    }
    if (!isUnsignedDecimal(declared)) {
      ctx.add(table, row.rowIndex, "numinputs", legacyMessage("cube.invalidNumInputs", { value: declared }), {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid value for 'numinputs' for recipe '${description}'`
      });
      return;
    }
    const declaredNumber = Number(declared);
    const actual = inputs.reduce((sum, entry) => sum + cubeInputCount(entry.parsed.raw), 0);
    if (declaredNumber !== actual) {
      ctx.add(table, row.rowIndex, "numinputs", legacyMessage("cube.numInputsMismatch", { declared, actual }), {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: wrong numinputs. expected ${actual}, found ${declaredNumber} in recipe '${description}'`
      });
    }
    for (const input of inputs) {
      const baseState = validateCubeInputReference(lookup, ctx, table, row.rowIndex, input.columnName, input.parsed);
      if (baseState !== false) {
        validateInputQualifiers(ctx, table, row.rowIndex, input.columnName, input.parsed);
        validateInputStorage(ctx, table, row.rowIndex, input.columnName, input.parsed);
      }
    }
  });
}

export function lintCubeOutputs(index, ctx) {
  const table = index.tablesByName.get("cubemain.txt");
  if (!table) return;
  const lookup = buildCubeOutputLookup(index);
  table.eachRow((row) => {
    if (!isEnabled(row.get("enabled"))) return;
    for (const columnName of ["output", "output b", "output c"]) {
      if (!table.hasColumn(columnName)) continue;
      const parsed = parseCubeOutput(row.get(columnName));
      if (!parsed.raw) continue;
      const baseState = validateCubeOutputReference(lookup, ctx, table, row, columnName, parsed);
      validateOutputQualifiers(ctx, table, row.rowIndex, columnName, parsed, baseState);
      if (baseState !== false) validateOutputStorageColumns(ctx, table, row, columnName);
    }
    for (const propColumn of CUBE_OUTPUT_MOD_COLUMNS) {
      if (!table.hasColumn(propColumn)) continue;
      const property = String(row.get(propColumn) ?? "");
      const propertyExists = lookup.properties.has(asciiLower(property));
      if (property && lookup.hasPropertyReferences && !propertyExists) {
        ctx.add(table, row.rowIndex, propColumn, legacyMessage("cube.unknownOutputProperty", { property }), {
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid property '${property}' for '${propColumn}' in recipe '${rawRowValue(table, row.rowIndex, "description")}'`
        });
      }
    }
  });
}

export function lintCubeOp(index, ctx) {
  const table = index.tablesByName.get("cubemain.txt");
  if (!table) return;
  table.eachRow((row) => {
    const op = clean(row.get("op"));
    const description = rawRowValue(table, row.rowIndex, "description");
    if (!op || op === "0" || op === "28") return;
    if (!isUnsignedDecimal(op)) {
      ctx.add(table, row.rowIndex, "op", legacyMessage("cube.invalidOp"), {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid opcode for '${description}'`
      });
      return;
    }
    const opNumber = Number(op);
    if (opNumber < 0 || opNumber > 28) {
      ctx.add(table, row.rowIndex, "op", legacyMessage("cube.invalidOp"), {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid opcode for '${description}'`
      });
      return;
    }
    if (opNumber === 0 || opNumber === 28) return;
    const param = clean(row.get("param"));
    const value = clean(row.get("value"));
    const needsParam = opNumber === 1 || (opNumber >= 3 && opNumber <= 26);
    if (needsParam && !param) {
      ctx.add(table, row.rowIndex, "param", legacyMessage("cube.opRequiresParam"), {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: opcode '${opNumber}' for recipe '${description}' requires a param, but none set`
      });
    } else if (needsParam && validCubeStatParam(index, param) === false) {
        ctx.add(table, row.rowIndex, "param", legacyMessage("cube.invalidOpParam", { param }), {
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid param for recipe '${description}'`
        });
    }
    if (!value) {
      ctx.add(table, row.rowIndex, "value", legacyMessage("cube.opRequiresValue"), {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: opcode '${opNumber}' for recipe '${description}' requires a value, but none set`
      });
    }
  });
}

function validateCubeInputReference(lookup, ctx, table, rowIndex, columnName, parsed) {
  const code = parsed.code;
  if (!code) {
    ctx.add(table, rowIndex, columnName, legacyMessage("cube.emptyInput"), {
      d2rMessage: `${table.displayName}, line ${rowIndex + 1}: empty base for ${columnName} in recipe '${rawRowValue(table, rowIndex, "description")}'`
    });
    return false;
  }
  if (code === "any") return true;
  if (!lookup.hasReferences) return null;
  const valid = lookup.exactItems.has(fixed4Key(code)) || lookup.namedItems.has(asciiLower(code));
  if (valid) return true;
  ctx.add(table, rowIndex, columnName, legacyMessage("cube.unknownInput", { code }), {
    d2rMessage: `${table.displayName}, line ${rowIndex + 1}: couldn't find '${code}' for ${columnName} in recipe '${rawRowValue(table, rowIndex, "description")}'`
  });
  return false;
}

function validateCubeOutputReference(lookup, ctx, table, row, columnName, parsed) {
  const code = parsed.code;
  if (!code) {
    ctx.add(table, row.rowIndex, columnName, legacyMessage("cube.emptyOutput"), {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: empty base for ${columnName} in recipe '${rawRowValue(table, row.rowIndex, "description")}'`
    });
    return false;
  }

  if (code === "useitem" || code === "usetype") {
    const inputColumn = outputInputColumn(columnName);
    if (!inputColumn || !table.hasColumn(inputColumn) || !String(row.get(inputColumn) ?? "")) {
      ctx.add(table, row.rowIndex, columnName, legacyMessage("cube.outputNeedsInput", { code, inputColumn: inputColumn ?? "input" }), {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${code}' for '${columnName}' has no matching '${inputColumn ?? "input"}' in recipe '${rawRowValue(table, row.rowIndex, "description")}'`
      });
    }
    return true;
  }

  if (isExactCubePortal(code)) return true;
  if (!lookup.hasReferences) return null;

  if ((fitsFixed4cc(code) && lookup.exactItems.has(fixed4Key(code))) || lookup.namedItems.has(asciiLower(code))) return true;

  ctx.add(table, row.rowIndex, columnName, legacyMessage("cube.unknownOutput", { code }), {
    d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: could not find '${code}' for ${columnName} in recipe '${rawRowValue(table, row.rowIndex, "description")}'`
  });
  return false;
}

function validateInputQualifiers(ctx, table, rowIndex, columnName, parsed) {
  if (parsed.ignoredSuffix) {
    const stoppedAt = parsed.ignoredSuffix.raw || "(empty modifier)";
    ctx.add(table, rowIndex, columnName, legacyMessage("cube.stopsAfterModifier", { stoppedAt }), {
      severity: "warning",
      d2rMessage: `${table.displayName}, line ${rowIndex + 1}: The game stops at '${stoppedAt}' for '${columnName}' in recipe '${rawRowValue(table, rowIndex, "description")}'. The base and modifiers before it still work; '${stoppedAt}' and everything after it are ignored.`
    });
  }
}

function validateInputStorage(ctx, table, rowIndex, columnName, parsed) {
  if (parsed.qty === null || isUnsignedByte(parsed.qty)) return;
  ctx.add(table, rowIndex, columnName, legacyMessage("cube.inputQtyRange", { qty: parsed.qty, storedQty: parsed.storedQty || 0, effectiveQty: parsed.effectiveQty }), {
    severity: "warning",
    d2rMessage: `${table.displayName}, line ${rowIndex + 1}: input quantity '${parsed.qty}' for '${columnName}' is outside 0..255; the game reads it as ${parsed.storedQty || 0} and uses ${parsed.effectiveQty} item(s) in recipe '${rawRowValue(table, rowIndex, "description")}'. Enter 0..255.`
  });
}

function validateOutputQualifiers(ctx, table, rowIndex, columnName, parsed, baseState) {
  if (baseState === false) return;
  for (const modifier of parsed.modifiers) {
    if (!CUBE_OUTPUT_BYTE_MODIFIERS.has(modifier.name)) continue;
    if (isUnsignedByte(modifier.value)) continue;
    ctx.add(table, rowIndex, columnName, legacyMessage("cube.outputModifierRange", { modifier: modifier.raw }), {
      severity: "warning",
      d2rMessage: `${table.displayName}, line ${rowIndex + 1}: '${modifier.raw}' for '${columnName}' is outside 0..255, so the game truncates it. Enter 0..255 in recipe '${rawRowValue(table, rowIndex, "description")}'`
    });
  }
  if (parsed.ignoredSuffix) {
    const suffixLabel = parsed.ignoredSuffix.token === "" ? "an empty modifier" : `'${parsed.ignoredSuffix.raw}'`;
    const stoppedAt = parsed.ignoredSuffix.raw || "(empty modifier)";
    const message = baseState === true
      ? legacyMessage("cube.stopsAfterModifier", { stoppedAt })
      : legacyMessage("cube.stopsAfterModifierConditional", { suffixLabel });
    ctx.add(table, rowIndex, columnName, message, {
      severity: "warning",
      d2rMessage: `${table.displayName}, line ${rowIndex + 1}: ${message} Column '${columnName}', recipe '${rawRowValue(table, rowIndex, "description")}'.`
    });
  }
}

function validateOutputStorageColumns(ctx, table, row, columnName) {
  for (const storageColumn of outputStorageColumns(columnName)) {
    if (!table.hasColumn(storageColumn)) continue;
    const value = String(row.get(storageColumn) ?? "");
    if (!value || isUnsignedByte(value)) continue;
    ctx.add(table, row.rowIndex, storageColumn, legacyMessage("cube.storageRange", { column: columnName, storageColumn, value }), {
      severity: "warning",
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${storageColumn}' value '${value}' for '${columnName}' is outside 0..255, so the game truncates it. Enter 0..255 in recipe '${rawRowValue(table, row.rowIndex, "description")}'`
    });
  }
}

function outputInputColumn(columnName) {
  if (columnName === "output") return "input 1";
  if (columnName === "output b") return "input 2";
  if (columnName === "output c") return "input 3";
  return "";
}

function outputStorageColumns(columnName) {
  if (columnName === "output") return ["lvl", "plvl", "ilvl"];
  if (columnName === "output b") return ["b lvl", "b plvl", "b ilvl"];
  if (columnName === "output c") return ["c lvl", "c plvl", "c ilvl"];
  return [];
}

function rawColumnValues(index, fileNames, columnName) {
  const values = new Set();
  for (const fileName of fileNames) {
    const table = referenceTable(index, fileName);
    if (!table?.hasColumn(columnName)) continue;
    table.eachRow((row) => {
      const value = String(row.get(columnName) ?? "");
      if (value) values.add(value);
    });
  }
  return values;
}

function asciiCaseInsensitiveColumnValues(index, fileNames, columnName) {
  return new Set([...rawColumnValues(index, fileNames, columnName)].map(asciiLower));
}

function buildCubeOutputLookup(index) {
  return buildCubeItemLookup(index);
}

function buildCubeItemLookup(index) {
  const exactItems = index.itemCodesFixed4 instanceof Set && index.itemTypesFixed4 instanceof Set
    ? new Set([...index.itemCodesFixed4, ...index.itemTypesFixed4])
    : fixed4ccValues(index, ["armor.txt", "misc.txt", "weapons.txt", "itemtypes.txt"], "code");
  const namedItems = asciiCaseInsensitiveColumnValues(index, ["setitems.txt", "uniqueitems.txt"], "index");
  const usePropertyGroups = propertyGroupsEnabled(index);
  const propertyFiles = usePropertyGroups ? ["properties.txt", "propertygroups.txt"] : ["properties.txt"];
  const properties = asciiCaseInsensitiveColumnValues(index, propertyFiles, "code");
  return {
    exactItems,
    namedItems,
    properties,
    hasPropertyReferences: propertyFiles
      .every((fileName) => referenceTable(index, fileName)?.hasColumn("code")),
    hasReferences: [
      ["armor.txt", "code"],
      ["misc.txt", "code"],
      ["weapons.txt", "code"],
      ["setitems.txt", "index"],
      ["uniqueitems.txt", "index"],
      ["itemtypes.txt", "code"]
    ].every(([fileName, columnName]) => referenceTable(index, fileName)?.hasColumn(columnName))
  };
}

function isExactCubePortal(value) {
  const folded = asciiLower(value);
  return folded === "cow portal"
    || folded === "red portal"
    || folded === "pandemonium portal"
    || folded === "pandemonium finale portal";
}

function isUnsignedByte(value) {
  return /^[0-9]+$/.test(String(value ?? "")) && Number(value) <= 255;
}

function itemStatCostRowCount(index) {
  return Math.max(0, (referenceTable(index, "itemstatcost.txt")?.rows.length ?? 1) - 1);
}

function validCubeStatParam(index, value) {
  const table = referenceTable(index, "itemstatcost.txt");
  if (!table?.hasColumn("stat")) return null;
  if (isUnsignedDecimal(value)) return Number(value) < itemStatCostRowCount(index);
  const target = asciiLower(value);
  let found = false;
  table.eachRow((row) => {
    if (asciiLower(clean(row.get("stat"))) === target) found = true;
  });
  return found;
}

function isUnsignedDecimal(value) {
  return /^[0-9]+$/.test(String(value ?? ""));
}

function rawRowValue(table, rowIndex, columnName) {
  if (!table?.hasColumn(columnName)) return "";
  return String(table.rows[rowIndex]?.[table.columnIndex(columnName)] ?? "");
}

function isEnabled(value) {
  const cleanValue = clean(value);
  return cleanValue !== "" && cleanValue !== "0";
}
