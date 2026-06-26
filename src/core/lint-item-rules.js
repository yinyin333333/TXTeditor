import { STAT_PARAMETER_TUPLES } from "./lint-stat-data.js";
import { rule } from "./lint-rule-registry.js";
import { clean, normalizeToken, rowLabelFor } from "./lint-table.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const ITEM_LINT_RULES = [
  rule("Items/ValidSockets", "Valid sockets", lintItemSockets),
  rule("Items/NoIllegalGambling", "No illegal gambling", lintNoIllegalGambling),
  rule("Items/ValidStatParameters", "Valid stat parameters", lintValidStatParameters)
];

export function lintItemSockets(index, ctx) {
  const itemTypes = index.tablesByName.get("itemtypes.txt");
  const armor = index.tablesByName.get("armor.txt");
  const misc = index.tablesByName.get("misc.txt");
  const weapons = index.tablesByName.get("weapons.txt");
  if (!armor || !misc || !weapons || !itemTypes) return;
  const itemTypeRows = rowsByKey(itemTypes, "code");
  itemTypes.eachRow((row) => {
    const threshold1 = integerFromRow(row, "maxsocketslevelthreshold1");
    const threshold2 = integerFromRow(row, "maxsocketslevelthreshold2");
    const sockets = ["maxsockets1", "maxsockets2", "maxsockets3"].map((columnName) => [columnName, integerFromRow(row, columnName)]);
    if (threshold1 !== null && threshold2 !== null && threshold1 > threshold2) ctx.add(itemTypes, row.rowIndex, "maxsocketslevelthreshold1", "MaxSocketsLevelThreshold1 must be less than or equal to MaxSocketsLevelThreshold2.");
    for (let socketIndex = 0; socketIndex < sockets.length; socketIndex += 1) {
      const [columnName, value] = sockets[socketIndex];
      if (value === null) continue;
      if (value < 0 || value > 6) ctx.add(itemTypes, row.rowIndex, columnName, `${columnName} must be between 0 and 6.`);
      const next = sockets[socketIndex + 1]?.[1];
      if (next !== undefined && next !== null && value > next) ctx.add(itemTypes, row.rowIndex, columnName, `${columnName} must be less than or equal to ${sockets[socketIndex + 1][0]}.`);
    }
  });
  for (const table of [misc, armor, weapons]) {
    table.eachRow((row) => {
      const hasInv = integerFromRow(row, "hasinv");
      if (hasInv !== 1) return;
      const gemSockets = integerFromRow(row, "gemsockets");
      const gemApplyType = integerFromRow(row, "gemapplytype");
      const invWidth = integerFromRow(row, "invwidth") ?? 0;
      const invHeight = integerFromRow(row, "invheight") ?? 0;
      const typeLimit = Math.max(maxSocketsForType(itemTypeRows.get(normalizeToken(rowValue(row, "type")))), maxSocketsForType(itemTypeRows.get(normalizeToken(rowValue(row, "type2")))));
      const name = clean(row.get("name")) || rowLabelFor(table, row.rowIndex);
      const d2rLine = row.rowIndex + 3;
      if (gemSockets !== null && gemSockets > typeLimit) {
        ctx.add(table, row.rowIndex, "gemsockets", `gemsockets (${gemSockets}) exceeds the socket limit (${typeLimit}) from type/type2.`, {
          d2rMessage: `${table.displayName}, line ${d2rLine}: gemsockets (${gemSockets}) won't spawn on '${name}' because its type(s) won't allow more than ${typeLimit} sockets.`
        });
      }
      if (gemApplyType !== null && (gemApplyType < 0 || gemApplyType > 3)) ctx.add(table, row.rowIndex, "gemapplytype", "gemapplytype must be between 0 and 3.");
      if (gemSockets !== null && invWidth > 0 && invHeight > 0 && gemSockets > invWidth * invHeight) {
        ctx.add(table, row.rowIndex, "gemsockets", `gemsockets (${gemSockets}) exceeds inventory size ${invWidth} x ${invHeight}.`, {
          d2rMessage: `${table.displayName}, line ${d2rLine}: '${name}' has more gemsockets (${gemSockets}) than inventory spaces used (${invWidth} x ${invHeight} = ${invWidth * invHeight})`
        });
      }
    });
  }
}

export function lintNoIllegalGambling(index, ctx) {
  const gamble = index.tablesByName.get("gamble.txt");
  const itemTypes = rowsByKey(index.tablesByName.get("itemtypes.txt"), "code");
  if (!gamble || !itemTypes.size) return;
  const items = new Map();
  for (const fileName of ["armor.txt", "misc.txt", "weapons.txt"]) {
    const table = index.tablesByName.get(fileName);
    if (!table) continue;
    table.eachRow((row) => items.set(normalizeToken(rowValue(row, "code")), { type: rowValue(row, "type"), type2: rowValue(row, "type2") }));
  }
  gamble.eachRow((row) => {
    const code = clean(rowValue(row, "code")) || clean(rowValue(row, "item"));
    if (!code) return;
    const item = items.get(normalizeToken(code));
    if (!item) return;
    if (itemTypeReaches(itemTypes, item.type, "char") || itemTypeReaches(itemTypes, item.type2, "char")) {
      ctx.add(gamble, row.rowIndex, gamble.hasColumn("code") ? "code" : "item", `Item "${code}" belongs to the char item type tree and cannot be gambled.`);
    }
  });
}

export function lintValidStatParameters(index, ctx) {
  const properties = rowsByKey(index.tablesByName.get("properties.txt"), "code");
  const itemStatCost = rowsByKey(index.tablesByName.get("itemstatcost.txt"), "stat");
  const skillsTable = index.tablesByName.get("skills.txt");
  if (!properties.size || !itemStatCost.size || !skillsTable) return;
  const skillRows = skillsTable.rows?.length ?? 0;
  for (const table of index.tables) {
    const columns = propertyTupleColumns(table);
    if (!columns.length) continue;
    table.eachRow((row) => {
      for (const tuple of columns) {
        const propertyCode = clean(row.get(tuple.property));
        if (!propertyCode) continue;
        const property = properties.get(normalizeToken(propertyCode));
        if (!property) continue;
        const min = tuple.min ? integerFromRow(row, tuple.min) : null;
        const max = tuple.max ? integerFromRow(row, tuple.max) : null;
        if (tuple.min && clean(row.get(tuple.min)) && min === null) ctx.add(table, row.rowIndex, tuple.min, `${tuple.min} must be an integer.`);
        if (tuple.max && clean(row.get(tuple.max)) && max === null) ctx.add(table, row.rowIndex, tuple.max, `${tuple.max} must be an integer.`);
        for (const stat of propertyStats(property)) {
          const statRow = itemStatCost.get(normalizeToken(stat.stat));
          if (!statRow) continue;
          if (tuple.param && isEncodedSkillStat(statRow)) {
            validateSkillParameter(index, ctx, table, row, tuple, propertyCode, skillRows);
            if (normalizeToken(propertyCode) === "skill-rand") continue;
          }
          validateSavedStatRange(ctx, table, row, tuple, statRow, min ?? 0, max ?? 0, stat.func);
        }
      }
    });
  }
}

function rowsByKey(table, columnName) {
  const rows = new Map();
  if (!table?.hasColumn(columnName)) return rows;
  table.eachRow((row) => {
    const key = normalizeToken(row.get(columnName));
    if (key && !rows.has(key)) rows.set(key, row);
  });
  return rows;
}

function rowValue(row, columnName) {
  if (row?.table && !row.table.hasColumn(columnName)) return "";
  return row?.get(columnName) ?? "";
}

function integerValue(value) {
  const text = clean(value);
  return text && isIntegerText(text) ? Number(text) : null;
}

function integerFromRow(row, columnName) {
  const value = rowValue(row, columnName);
  if (!clean(value)) return null;
  return integerValue(value);
}

function maxSocketsForType(row) {
  if (!row) return 0;
  return Math.max(integerFromRow(row, "maxsockets1") ?? 0, integerFromRow(row, "maxsockets2") ?? 0, integerFromRow(row, "maxsockets3") ?? 0);
}

function itemTypeReaches(itemTypes, code, target, seen = new Set()) {
  const token = normalizeToken(code);
  const targetToken = normalizeToken(target);
  if (!token || seen.has(token)) return false;
  if (token === targetToken) return true;
  seen.add(token);
  const row = itemTypes.get(token);
  if (!row) return false;
  return itemTypeReaches(itemTypes, rowValue(row, "equiv1"), targetToken, seen) || itemTypeReaches(itemTypes, rowValue(row, "equiv2"), targetToken, seen);
}

function propertyTupleColumns(table) {
  const tuples = STAT_PARAMETER_TUPLES.get(table?.fileName);
  if (!table || !tuples) return [];
  return tuples.map((tuple) => ({
    property: table.hasColumn(tuple.property) ? tuple.property : "",
    param: table.hasColumn(tuple.param) ? tuple.param : "",
    min: table.hasColumn(tuple.min) ? tuple.min : "",
    max: table.hasColumn(tuple.max) ? tuple.max : ""
  })).filter((tuple) => tuple.property && (tuple.param || tuple.min || tuple.max));
}

function propertyStats(propertyRow) {
  const stats = [];
  const implicitStatByFunction = {
    "5": "mindamage",
    "6": "maxdamage",
    "7": "item_mindamage_percent"
  };
  for (let index = 1; index <= 7; index += 1) {
    const func = clean(rowValue(propertyRow, `func${index}`));
    let stat = clean(rowValue(propertyRow, `stat${index}`));
    if (!stat && implicitStatByFunction[func]) stat = implicitStatByFunction[func];
    if (stat && func !== "17") stats.push({ func, stat });
  }
  return stats;
}

function isEncodedSkillStat(itemStatRow) {
  const encode = clean(rowValue(itemStatRow, "encode"));
  return encode === "1" || encode === "2" || encode === "3";
}

function validateSkillParameter(index, ctx, table, row, tuple, propertyCode, skillRows) {
  if (normalizeToken(propertyCode) === "skill-rand") return;
  const param = clean(rowValue(row, tuple.param));
  if (!param) return;
  if (isIntegerText(param)) {
    if (skillRows > 1 && Number(param) >= skillRows - 1) ctx.add(table, row.rowIndex, tuple.param, `${tuple.param} points to skill id ${param}, but skills.txt only has ${skillRows - 1} skill row(s).`);
    return;
  }
  if (index.skills.size && !index.skills.has(normalizeToken(param))) ctx.add(table, row.rowIndex, tuple.param, `${tuple.param} "${param}" is not a known skill.`);
}

function validateSavedStatRange(ctx, table, row, tuple, itemStatRow, min, max, funcValue = "") {
  const saveBits = integerFromRow(itemStatRow, "save bits");
  const saveAdd = integerFromRow(itemStatRow, "save add") ?? 0;
  if (saveBits === null || saveBits <= 0) return;
  const saveBitsMax = 2 ** saveBits - saveAdd;
  const signed = clean(rowValue(itemStatRow, "signed")) === "1";
  const label = rowLabelFor(table, row.rowIndex);
  if (tuple.min && min > saveBitsMax && funcValue !== "16") {
    ctx.add(table, row.rowIndex, tuple.min, `${tuple.min} value ${min} is above save bits maximum ${saveBitsMax}.`, {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.min}': value (${min}) above save bits maximum (${saveBitsMax}) for '${label}'`
    });
  }
  if (tuple.max && max > saveBitsMax && funcValue !== "15") {
    ctx.add(table, row.rowIndex, tuple.max, `${tuple.max} value ${max} is above save bits maximum ${saveBitsMax}.`, {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.max}': value (${max}) above save bits maximum (${saveBitsMax}) for '${label}'`
    });
  }
  if (signed && funcValue !== "18" && funcValue !== "19") {
    if (tuple.min && min < -saveAdd && funcValue !== "16") {
      ctx.add(table, row.rowIndex, tuple.min, `${tuple.min} value ${min} is below save add minimum ${-saveAdd}.`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.min}': value (${min}) below save add minimum (${-saveAdd}) for '${label}'`
      });
    }
    if (tuple.max && max < -saveAdd && funcValue !== "15") {
      ctx.add(table, row.rowIndex, tuple.max, `${tuple.max} value ${max} is below save add minimum ${-saveAdd}.`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.max}': value (${max}) below save add minimum (${-saveAdd}) for '${label}'`
      });
    }
  }
}

function isIntegerText(value) {
  return /^-?\d+$/.test(clean(value));
}
