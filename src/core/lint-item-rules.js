import { STAT_PARAMETER_TUPLES } from "./lint-stat-data.js";
import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { exactOuterUnquote, fixed4Key, referenceTable } from "./lint-reference-semantics.js";
import { clean, normalizeToken, rowLabelFor } from "./lint-table.js";
import { legacyMessage } from "./legacy-lint-i18n.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const ITEM_LINT_RULES = [
  rule("Items/ValidSockets", lintItemSockets, true, PROFILE_OPTIONS),
  rule("Items/NoIllegalGambling", lintNoIllegalGambling, true, PROFILE_OPTIONS),
  rule("Items/ValidStatParameters", lintValidStatParameters, true, PROFILE_OPTIONS)
];

export function lintItemSockets(index, ctx) {
  const itemTypes = referenceTable(index, "itemtypes.txt");
  const armor = index.tablesByName.get("armor.txt");
  const misc = index.tablesByName.get("misc.txt");
  const weapons = index.tablesByName.get("weapons.txt");
  if (!itemTypes) return;
  const itemTypeRows = rowsByFixed4cc(itemTypes, "code");
  if (index.tables?.includes(itemTypes)) itemTypes.eachRow((row) => {
    const threshold1 = integerFromRow(row, "maxsocketslevelthreshold1");
    const threshold2 = integerFromRow(row, "maxsocketslevelthreshold2");
    const sockets = ["maxsockets1", "maxsockets2", "maxsockets3"].map((columnName) => [columnName, integerFromRow(row, columnName)]);
    if (threshold1 !== null && threshold2 !== null && threshold1 > threshold2) {
      ctx.add(itemTypes, row.rowIndex, "maxsocketslevelthreshold1", legacyMessage("items.socketThresholdOrder"), {
        severity: "warning",
        d2rMessage: `${itemTypes.displayName}, line ${row.rowIndex + 1}: socket thresholds decrease at the next tier (${threshold1} > ${threshold2}). Use ascending thresholds unless this is intentional.`
      });
    }
    for (let socketIndex = 0; socketIndex < sockets.length; socketIndex += 1) {
      const [columnName, value] = sockets[socketIndex];
      if (value === null) continue;
      if (value < 0 || value > 6) {
        ctx.add(itemTypes, row.rowIndex, columnName, legacyMessage("items.socketLimit", { column: columnName, value }), {
          severity: "warning",
          d2rMessage: `${itemTypes.displayName}, line ${row.rowIndex + 1}: '${columnName}' is ${value}. Use a value from 0 through 6; the game applies its own socket limit.`
        });
      }
      const next = sockets[socketIndex + 1]?.[1];
      if (next !== undefined && next !== null && value > next) {
        ctx.add(itemTypes, row.rowIndex, columnName, legacyMessage("items.socketThresholdPair", { value, next }), {
          severity: "warning",
          d2rMessage: `${itemTypes.displayName}, line ${row.rowIndex + 1}: socket thresholds decrease at the next tier for '${columnName}' (${value} > ${next}). Use ascending thresholds unless this is intentional.`
        });
      }
    }
  });
  for (const table of [misc, armor, weapons].filter(Boolean)) {
    table.eachRow((row) => {
      const hasInv = integerFromRow(row, "hasinv");
      if (hasInv !== 1) return;
      const gemSockets = integerFromRow(row, "gemsockets");
      const gemApplyType = integerFromRow(row, "gemapplytype");
      const invWidth = integerFromRow(row, "invwidth") ?? 0;
      const invHeight = integerFromRow(row, "invheight") ?? 0;
      const typeLimit = maxSocketsForType(itemTypeRows.get(fixed4Key(rowValue(row, "type"))));
      const name = clean(row.get("name")) || rowLabelFor(table, row.rowIndex);
      const d2rLine = row.rowIndex + 1;
      if (gemSockets !== null && typeLimit !== null && gemSockets > typeLimit) {
        ctx.add(table, row.rowIndex, "gemsockets", legacyMessage("items.typeSocketCap", { gemsockets: gemSockets, typeLimit }), {
          severity: "warning",
          d2rMessage: `${table.displayName}, line ${d2rLine}: gemsockets (${gemSockets}) for '${name}' exceeds direct Type's socket cap (${typeLimit}); the game clamps the effective socket count.`
        });
      }
      if (gemApplyType !== null && (gemApplyType < 0 || gemApplyType > 2)) {
        ctx.add(table, row.rowIndex, "gemapplytype", legacyMessage("items.gemApplyType"), {
          d2rMessage: `${table.displayName}, line ${d2rLine}: GemApplyType (${gemApplyType}) for '${name}' is unsupported. Choose 0, 1, or 2.`
        });
      }
      if (gemSockets !== null && invWidth > 0 && invHeight > 0 && gemSockets > invWidth * invHeight) {
        ctx.add(table, row.rowIndex, "gemsockets", legacyMessage("items.inventorySocketCap", { gemsockets: gemSockets, width: invWidth, height: invHeight }), {
          severity: "warning",
          d2rMessage: `${table.displayName}, line ${d2rLine}: '${name}' has more gemsockets (${gemSockets}) than inventory spaces (${invWidth} x ${invHeight} = ${invWidth * invHeight}); the game clamps the effective socket count.`
        });
      }
    });
  }
}

export function lintNoIllegalGambling(index, ctx) {
  const gamble = index.tablesByName.get("gamble.txt");
  const itemTypes = rowsByFixed4cc(referenceTable(index, "itemtypes.txt"), "code");
  if (!gamble || !itemTypes.size) return;
  const items = new Map();
  let hasCompleteItemReferences = true;
  for (const fileName of ["armor.txt", "misc.txt", "weapons.txt"]) {
    const table = referenceTable(index, fileName);
    if (!table?.hasColumn("code")) {
      hasCompleteItemReferences = false;
      continue;
    }
    table.eachRow((row) => items.set(fixed4Key(rowValue(row, "code")), { type: rowValue(row, "type"), type2: rowValue(row, "type2") }));
  }
  if (!items.size) return;
  gamble.eachRow((row) => {
    const codeCell = gamble.hasColumn("code") ? rowValue(row, "code") : "";
    const rawCode = String(codeCell ?? "") !== "" ? codeCell : rowValue(row, "item");
    const code = exactOuterUnquote(rawCode);
    if (!code) return;
    const columnName = gamble.hasColumn("code") ? "code" : "item";
    const item = items.get(fixed4Key(code));
    if (!item) {
      if (!hasCompleteItemReferences) return;
      ctx.add(gamble, row.rowIndex, columnName, legacyMessage("items.unknownGambleCode", { code }), {
        d2rMessage: `${gamble.displayName}, line ${row.rowIndex + 1}: unknown item code '${code}'; check the four-character code and letter case.`
      });
      return;
    }
    if (itemTypeReaches(itemTypes, item.type, "char") || itemTypeReaches(itemTypes, item.type2, "char")) {
      ctx.add(gamble, row.rowIndex, columnName, legacyMessage("items.characterOnlyGamble", { code }), {
        severity: "warning",
        d2rMessage: `${gamble.displayName}, line ${row.rowIndex + 1}: '${code}' belongs to the character-only item type tree; remove it unless intentional.`
      });
    }
  });
}

export function lintValidStatParameters(index, ctx) {
  const properties = rowsByKey(referenceTable(index, "properties.txt"), "code");
  const itemStatCost = rowsByKey(referenceTable(index, "itemstatcost.txt"), "stat");
  const skillsTable = referenceTable(index, "skills.txt");
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
        const min = tuple.min ? legacyInteger(rowValue(row, tuple.min)) : 0;
        const max = tuple.max ? legacyInteger(rowValue(row, tuple.max)) : 0;
        for (const stat of propertyStats(property)) {
          const statRow = itemStatCost.get(normalizeToken(stat.stat));
          if (!statRow) continue;
          if (tuple.param && isEncodedSkillStat(statRow)) {
            validateLegacySkillParameter(skillsTable, ctx, table, row, tuple, propertyCode, skillRows);
            if (normalizeToken(propertyCode) === "skill-rand") continue;
          }
          if (table.fileName !== "monprop.txt") validateLegacySavedStatRange(ctx, table, row, tuple, statRow, min, max, stat.func);
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

function rowsByFixed4cc(table, columnName) {
  const rows = new Map();
  if (!table?.hasColumn(columnName)) return rows;
  table.eachRow((row) => {
    const raw = row.get(columnName);
    if (String(raw ?? "")) {
      const key = fixed4Key(raw);
      if (!rows.has(key)) rows.set(key, row);
    }
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
  if (!row) return null;
  const modern = ["maxsockets1", "maxsockets2", "maxsockets3"].map((columnName) => integerFromRow(row, columnName));
  const classic = ["maxsock1", "maxsock25", "maxsock40"].map((columnName) => integerFromRow(row, columnName));
  const values = [...modern, ...classic].filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

function itemTypeReaches(itemTypes, code, target, seen = new Set()) {
  return itemTypeReachesKey(itemTypes, code, fixed4Key(target), seen);
}

function itemTypeReachesKey(itemTypes, code, targetKey, seen) {
  if (!clean(code)) return false;
  const token = fixed4Key(code);
  if (!token || seen.has(token)) return false;
  if (token === targetKey) return true;
  seen.add(token);
  const row = itemTypes.get(token);
  if (!row) return false;
  return itemTypeReachesKey(itemTypes, rowValue(row, "equiv1"), targetKey, seen)
    || itemTypeReachesKey(itemTypes, rowValue(row, "equiv2"), targetKey, seen);
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

function legacyInteger(value) {
  const text = String(value ?? "");
  return text === "" ? 0 : Number.parseInt(text, 10);
}

function isEncodedSkillStat(itemStatRow) {
  const encode = clean(rowValue(itemStatRow, "encode"));
  return encode === "1" || encode === "2" || encode === "3";
}

function validateLegacySkillParameter(skillsTable, ctx, table, row, tuple, propertyCode, skillRows) {
  if (normalizeToken(propertyCode) === "skill-rand") return;
  const parameter = String(rowValue(row, tuple.param) ?? "");
  if (!parameter) return;
  let skillId = Number.parseInt(parameter, 10);
  if (Number.isNaN(skillId)) {
    let found = false;
    skillsTable.eachRow((skill, id) => {
      if (found) return;
      const name = String(rowValue(skill, skillsTable.hasColumn("skill") ? "skill" : "id") ?? "");
      if (name === parameter || name.toLocaleLowerCase() === parameter) {
        skillId = id;
        found = true;
      }
    });
    if (!found) {
      ctx.add(table, row.rowIndex, tuple.param, legacyMessage("items.unknownSkill", { column: tuple.param, value: parameter }));
      return;
    }
  }
  if (skillRows < skillId) {
    ctx.add(table, row.rowIndex, tuple.param, legacyMessage("items.skillOutOfRange", { column: tuple.param, skillId, maximum: skillRows }));
  }
}

function validateLegacySavedStatRange(ctx, table, row, tuple, itemStatRow, min, max, funcValue) {
  const saveBits = legacyInteger(rowValue(itemStatRow, "save bits"));
  const saveAdd = legacyInteger(rowValue(itemStatRow, "save add"));
  if (Number.isNaN(saveBits) || Number.isNaN(saveAdd) || saveBits <= 0) return;
  const maximum = 2 ** saveBits - saveAdd;
  const label = rowLabelFor(table, row.rowIndex);
  if (tuple.min && min > maximum && funcValue !== "16") {
    ctx.add(table, row.rowIndex, tuple.min, legacyMessage("items.statParameterAboveRange", { column: tuple.min, value: min, lower: -saveAdd, upper: maximum }), {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.min}': value (${min}) above save bits maximum (${maximum}) for '${label}'`
    });
  }
  if (tuple.max && max > maximum && funcValue !== "15") {
    ctx.add(table, row.rowIndex, tuple.max, legacyMessage("items.statParameterAboveRange", { column: tuple.max, value: max, lower: -saveAdd, upper: maximum }), {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.max}': value (${max}) above save bits maximum (${maximum}) for '${label}'`
    });
  }
  if (clean(rowValue(itemStatRow, "signed")) !== "1" || funcValue === "18" || funcValue === "19") return;
  if (tuple.min && min < -saveAdd && funcValue !== "16") {
    ctx.add(table, row.rowIndex, tuple.min, legacyMessage("items.statParameterBelowRange", { column: tuple.min, value: min, lower: -saveAdd, upper: maximum }), {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.min}': value (${min}) below save add minimum (${-saveAdd}) for '${label}'`
    });
  }
  if (tuple.max && max < -saveAdd && funcValue !== "15") {
    ctx.add(table, row.rowIndex, tuple.max, legacyMessage("items.statParameterBelowRange", { column: tuple.max, value: max, lower: -saveAdd, upper: maximum }), {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${tuple.max}': value (${max}) below save add minimum (${-saveAdd}) for '${label}'`
    });
  }
}

function isIntegerText(value) {
  return /^-?\d+$/.test(clean(value));
}
