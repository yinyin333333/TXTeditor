import { cubeInputCount, inputColumns, parseCubeItem } from "./lint-cube.js";
import { CUBE_OUTPUT_MOD_COLUMNS } from "./lint-stat-data.js";
import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { clean, normalizeToken } from "./lint-table.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const CUBE_LINT_RULES = [
  rule("Cube/ValidInputs", "Valid cube inputs", lintCubeInputs, true, PROFILE_OPTIONS, "Checks enabled cubemain recipes for valid input item references, input qualifiers, and matching numinputs values."),
  rule("Cube/ValidOutputs", "Valid cube outputs", lintCubeOutputs, true, PROFILE_OPTIONS, "Checks cubemain output item references, output qualifiers, and output property codes."),
  rule("Cube/ValidOp", "Valid cube op", lintCubeOp, true, PROFILE_OPTIONS, "Checks cubemain op values and related parameters for supported cube operation rules.")
];

export function lintCubeInputs(index, ctx) {
  const table = index.tablesByName.get("cubemain.txt");
  if (!table) return;
  table.eachRow((row) => {
    if (!isEnabled(row.get("enabled"))) return;
    const inputs = inputColumns(row, table).map((columnName) => ({ columnName, parsed: parseCubeItem(row.get(columnName)) })).filter((entry) => entry.parsed.raw);
    const declared = clean(row.get("numinputs"));
    const description = rawRowValue(table, row.rowIndex, "description");
    if (!declared || declared === "0") {
      ctx.add(table, row.rowIndex, "numinputs", `No inputs for recipe "${clean(row.get("description"))}".`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: no inputs for recipe '${description}'`
      });
      return;
    }
    const declaredNumber = Number.parseInt(declared, 10);
    if (Number.isNaN(declaredNumber)) {
      ctx.add(table, row.rowIndex, "numinputs", `Invalid numinputs value "${declared}".`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid value for 'numinputs' for recipe '${description}'`
      });
      return;
    }
    const actual = inputs.reduce((sum, entry) => sum + cubeInputCount(entry.parsed.raw), 0);
    if (declaredNumber !== actual) {
      ctx.add(table, row.rowIndex, "numinputs", `numinputs is ${declared}, but the recipe contains ${actual} input item(s).`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: wrong numinputs. expected ${actual}, found ${declaredNumber} in recipe '${description}'`
      });
    }
    for (const input of inputs) {
      validateCubeItemReference(index, ctx, table, row.rowIndex, input.columnName, input.parsed, "input");
      validateInputQualifiers(ctx, table, row.rowIndex, input.columnName, input.parsed);
    }
  });
}

export function lintCubeOutputs(index, ctx) {
  const table = index.tablesByName.get("cubemain.txt");
  if (!table || !index.tablesByName.has("cubemod.txt")) return;
  table.eachRow((row) => {
    if (!isEnabled(row.get("enabled"))) return;
    for (const columnName of ["output", "output b", "output c"]) {
      if (!table.hasColumn(columnName)) continue;
      const parsed = parseCubeItem(row.get(columnName));
      if (!parsed.raw) continue;
      validateCubeItemReference(index, ctx, table, row.rowIndex, columnName, parsed, "output");
      validateOutputQualifiers(ctx, table, row.rowIndex, columnName, parsed);
    }
    for (const propColumn of CUBE_OUTPUT_MOD_COLUMNS) {
      if (!table.hasColumn(propColumn)) continue;
      const property = clean(row.get(propColumn));
      if (property && index.hasWorkspace && index.tablesByName.has("properties.txt") && !index.properties.has(property) && !index.propertyGroups.has(property)) {
        ctx.add(table, row.rowIndex, propColumn, `Unknown cube output property "${property}".`, {
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
    const opNumber = Number.parseInt(op, 10);
    if (Number.isNaN(opNumber) || opNumber < 0 || opNumber > 28) {
      ctx.add(table, row.rowIndex, "op", "Cube op must be an integer from 0 through 28.", {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid opcode for '${description}'`
      });
      return;
    }
    if (opNumber === 27 || opNumber === 2) return;
    const param = clean(row.get("param"));
    const value = clean(row.get("value"));
    if (!param) {
      ctx.add(table, row.rowIndex, "param", "Cube op requires a param value.", {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: opcode '${opNumber}' for recipe '${description}' requires a param, but none set`
      });
    } else {
      const paramNumber = Number.parseInt(param, 10);
      if (Number.isNaN(paramNumber) || paramNumber < 0 || paramNumber >= itemStatCostRowCount(index)) {
        ctx.add(table, row.rowIndex, "param", `Cube op param "${param}" is not a valid item stat index.`, {
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid param for recipe '${description}'`
        });
      }
    }
    if (!value) {
      ctx.add(table, row.rowIndex, "value", "Cube op requires a value.", {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: opcode '${opNumber}' for recipe '${description}' requires a value, but none set`
      });
    }
  });
}

function validateCubeItemReference(index, ctx, table, rowIndex, columnName, parsed, kind) {
  if (!index.hasWorkspace) return;
  if (!index.tablesByName.has("armor.txt") || !index.tablesByName.has("misc.txt") || !index.tablesByName.has("weapons.txt") || !index.tablesByName.has("setitems.txt") || !index.tablesByName.has("uniqueitems.txt") || !index.tablesByName.has("itemtypes.txt")) return;
  const token = normalizeToken(parsed.code);
  const compact = token.replace(/\s+/g, "");
  if (!token) return;
  if (kind === "input" && token === "any") return;
  if (token === "useitem" || token === "usetype") {
    if (kind === "output" && columnName !== "output") {
      ctx.add(table, rowIndex, columnName, `${parsed.code} is only valid for the first cube output.`, {
        d2rMessage: `${table.displayName}, line ${rowIndex + 1}: ${parsed.code} is not valid in '${columnName}', it is only valid for the first output`
      });
    }
    return;
  }
  if (compact === "cowportal" || compact === "redportal" || compact === "pandemoniumportal" || compact === "pandemoniumfinaleportal" || token === "pandportal") return;
  const valid = index.itemCodes.has(token) || index.itemTypes.has(token) || index.setItems.has(token) || index.uniqueItems.has(token);
  if (!valid) {
    ctx.add(table, rowIndex, columnName, `Unknown cube ${kind} "${parsed.code}".`, {
      d2rMessage: kind === "output"
        ? `${table.displayName}, line ${rowIndex + 1}: could not find '${parsed.code}' for ${columnName} in recipe '${rawRowValue(table, rowIndex, "description")}'`
        : `${table.displayName}, line ${rowIndex + 1}: couldn't find '${parsed.code}' for ${columnName} in recipe '${rawRowValue(table, rowIndex, "description")}'`
    });
  }
}

function validateInputQualifiers(ctx, table, rowIndex, columnName, parsed) {
  const allowed = new Set(["low", "nor", "hiq", "mag", "rar", "set", "uni", "crf", "tmp", "eth", "noe", "nos", "upg", "nru", "bas", "exc", "eli"]);
  for (const qualifier of parsed.qualifiers) {
    if (/^qty=\d+$/.test(qualifier)) continue;
    const name = qualifier.split("=")[0];
    if (name.startsWith("sock")) continue;
    if (!allowed.has(name)) {
      ctx.add(table, rowIndex, columnName, `Unknown cube input qualifier "${qualifier}".`, {
        d2rMessage: `${table.displayName}, line ${rowIndex + 1}: unknown input qualifier '${qualifier}' for ${columnName} in recipe '${rawRowValue(table, rowIndex, "description")}'`
      });
    }
  }
}

function validateOutputQualifiers(ctx, table, rowIndex, columnName, parsed) {
  const allowed = new Set(["low", "nor", "hiq", "mag", "rar", "set", "uni", "crf", "tmp", "eth", "noe", "sock", "nos", "pre", "suf", "lvl", "plvl", "ilvl", "upg", "bas", "exc", "eli", "uns", "rem", "rep", "rch", "reg", "mod"]);
  for (const qualifier of parsed.qualifiers) {
    if (/^(qty|pre|suf|sock|lvl|plvl|ilvl)=.+$/.test(qualifier)) continue;
    const name = qualifier.split("=")[0];
    if (!allowed.has(name)) ctx.add(table, rowIndex, columnName, `Unknown cube output qualifier "${qualifier}".`);
  }
}

function itemStatCostRowCount(index) {
  return Math.max(0, (index.tablesByName.get("itemstatcost.txt")?.rows.length ?? 1) - 1);
}

function rawRowValue(table, rowIndex, columnName) {
  if (!table?.hasColumn(columnName)) return "";
  return String(table.rows[rowIndex]?.[table.columnIndex(columnName)] ?? "");
}

function isEnabled(value) {
  const cleanValue = clean(value);
  return cleanValue !== "" && cleanValue !== "0";
}
