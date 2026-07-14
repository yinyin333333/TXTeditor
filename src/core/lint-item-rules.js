import { STAT_PARAMETER_TUPLES } from "./lint-stat-data.js";
import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { exactOuterUnquote, fixed4Key, referenceTable } from "./lint-reference-semantics.js";
import { clean, normalizeToken, rowLabelFor } from "./lint-table.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const ITEM_LINT_RULES = [
  rule("Items/ValidSockets", "Valid sockets", lintItemSockets, true, PROFILE_OPTIONS, "Checks socket limits from item type, inventory size, level thresholds, and the allowed GemApplyType values 0 through 2."),
  rule("Items/NoIllegalGambling", "No illegal gambling", lintNoIllegalGambling, true, PROFILE_OPTIONS, "Checks four-character gamble item codes and warns when an item belongs to the character-only type tree."),
  rule("Items/ValidStatParameters", "Valid stat parameters", lintValidStatParameters, true, PROFILE_OPTIONS, "Checks each property function's value and parameter fields, skill references, charge and time limits, and saved item stat ranges. Unusual number spelling remains a policy warning.")
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
      ctx.add(itemTypes, row.rowIndex, "maxsocketslevelthreshold1", "Socket thresholds decrease at the next tier. Use ascending thresholds unless this is intentional.", {
        severity: "warning",
        d2rMessage: `${itemTypes.displayName}, line ${row.rowIndex + 1}: socket thresholds decrease at the next tier (${threshold1} > ${threshold2}). Use ascending thresholds unless this is intentional.`
      });
    }
    for (let socketIndex = 0; socketIndex < sockets.length; socketIndex += 1) {
      const [columnName, value] = sockets[socketIndex];
      if (value === null) continue;
      if (value < 0 || value > 6) {
        ctx.add(itemTypes, row.rowIndex, columnName, `${columnName} is ${value}. Use a value from 0 through 6; the game applies its own socket limit.`, {
          severity: "warning",
          d2rMessage: `${itemTypes.displayName}, line ${row.rowIndex + 1}: '${columnName}' is ${value}. Use a value from 0 through 6; the game applies its own socket limit.`
        });
      }
      const next = sockets[socketIndex + 1]?.[1];
      if (next !== undefined && next !== null && value > next) {
        ctx.add(itemTypes, row.rowIndex, columnName, `Socket thresholds decrease at the next tier (${value} > ${next}). Use ascending thresholds unless this is intentional.`, {
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
        ctx.add(table, row.rowIndex, "gemsockets", `gemsockets (${gemSockets}) exceeds the direct Type socket cap (${typeLimit}); the game clamps the effective socket count.`, {
          severity: "warning",
          d2rMessage: `${table.displayName}, line ${d2rLine}: gemsockets (${gemSockets}) for '${name}' exceeds direct Type's socket cap (${typeLimit}); the game clamps the effective socket count.`
        });
      }
      if (gemApplyType !== null && (gemApplyType < 0 || gemApplyType > 2)) {
        ctx.add(table, row.rowIndex, "gemapplytype", "GemApplyType supports 0, 1, or 2. Choose one of those values.", {
          d2rMessage: `${table.displayName}, line ${d2rLine}: GemApplyType (${gemApplyType}) for '${name}' is unsupported. Choose 0, 1, or 2.`
        });
      }
      if (gemSockets !== null && invWidth > 0 && invHeight > 0 && gemSockets > invWidth * invHeight) {
        ctx.add(table, row.rowIndex, "gemsockets", `gemsockets (${gemSockets}) exceeds inventory size ${invWidth} x ${invHeight}; the game clamps the effective socket count.`, {
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
      ctx.add(gamble, row.rowIndex, columnName, `Unknown item code "${code}". Check the four-character code and letter case.`, {
        d2rMessage: `${gamble.displayName}, line ${row.rowIndex + 1}: unknown item code '${code}'; check the four-character code and letter case.`
      });
      return;
    }
    if (itemTypeReaches(itemTypes, item.type, "char") || itemTypeReaches(itemTypes, item.type2, "char")) {
      ctx.add(gamble, row.rowIndex, columnName, `Item "${code}" belongs to the character-only item type tree. Remove it from gamble.txt unless this is intentional.`, {
        severity: "warning",
        d2rMessage: `${gamble.displayName}, line ${row.rowIndex + 1}: '${code}' belongs to the character-only item type tree; remove it unless intentional.`
      });
    }
  });
}

export function lintValidStatParameters(index, ctx) {
  const properties = rowsByKey(referenceTable(index, "properties.txt"), "code");
  const itemStatCostTable = referenceTable(index, "itemstatcost.txt");
  const itemStatCost = rowsByKey(itemStatCostTable, "stat");
  const skillsTable = referenceTable(index, "skills.txt");
  if (!properties.size || !itemStatCost.size || !skillsTable) return;
  const skillContext = buildSkillContext(skillsTable, itemStatCostTable);
  for (const table of index.tables) {
    const columns = propertyTupleColumns(table);
    if (!columns.length) continue;
    const usesItemSerialization = table.fileName !== "monprop.txt";
    table.eachRow((row) => {
      for (const tuple of columns) {
        const propertyCode = clean(row.get(tuple.property));
        if (!propertyCode) continue;
        const property = properties.get(normalizeToken(propertyCode));
        if (!property) continue;
        const values = tupleValues(row, tuple);
        warnNoncanonicalNumeric(ctx, table, row, values.min);
        warnNoncanonicalNumeric(ctx, table, row, values.max);
        for (const stat of propertyStats(property)) {
          const statRows = stat.stats.map((name) => itemStatCost.get(normalizeToken(name))).filter(Boolean);
          if (!statRows.length) continue;
          if (stat.func === "17") warnNoncanonicalNumeric(ctx, table, row, values.param, { namedToken: true });
          if (stat.func === "18") warnNoncanonicalNumeric(ctx, table, row, values.param);
          if (stat.func === "11") validateEventSkill(ctx, table, row, values, statRows, skillContext);
          if (stat.func === "12") validateRandomSkill(ctx, table, row, values, statRows, skillContext);
          if (stat.func === "18") validateByTimePackedValue(ctx, table, row, values);
          if (stat.func === "19") validateChargedSkill(ctx, table, row, values, statRows, skillContext);
          if (stat.func === "22") validateDirectSkill(ctx, table, row, values.param, statRows, skillContext);
          const completeImplicitLanes = !["5", "6", "7"].includes(stat.func) || statRows.length === stat.stats.length;
          if (usesItemSerialization && completeImplicitLanes) validateSavedStatSources(ctx, table, row, values, statRows, stat.func);
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
  const implicitStatsByFunction = {
    "5": ["mindamage", "secondary_mindamage", "item_throw_mindamage"],
    "6": ["maxdamage", "secondary_maxdamage", "item_throw_maxdamage"],
    "7": ["item_maxdamage_percent", "item_mindamage_percent"],
    "19": ["item_charged_skill"]
  };
  for (let index = 1; index <= 7; index += 1) {
    const func = clean(rowValue(propertyRow, `func${index}`));
    const explicitStat = clean(rowValue(propertyRow, `stat${index}`));
    const implicitStats = implicitStatsByFunction[func];
    const slotStats = implicitStats ?? (explicitStat ? [explicitStat] : []);
    if (slotStats.length) stats.push({ func, stats: slotStats });
  }
  return stats;
}

function tupleValues(row, tuple) {
  return {
    param: parsedTupleInteger(row, tuple.param),
    min: parsedTupleInteger(row, tuple.min),
    max: parsedTupleInteger(row, tuple.max)
  };
}

function parsedTupleInteger(row, columnName) {
  const raw = columnName ? String(rowValue(row, columnName) ?? "") : "";
  const blank = raw === "";
  const match = /^-?\d+/.exec(raw);
  let value = 0;
  if (match) {
    const parsed = BigInt(match[0]);
    if (parsed > 2147483647n) value = 2147483647;
    else if (parsed < -2147483648n) value = -2147483648;
    else value = Number(parsed);
  }
  return {
    columnName,
    raw,
    blank,
    value,
    canonical: blank || /^-?\d+$/.test(raw),
    numericPrefix: Boolean(match)
  };
}

function warnNoncanonicalNumeric(ctx, table, row, parsed, { namedToken = false } = {}) {
  if (!parsed.columnName || parsed.blank || parsed.canonical) return;
  const behavior = parsed.numericPrefix
    ? `the game reads the initial integer as ${parsed.value}`
    : namedToken
      ? "the game tries it as a skill name and uses 0 if no name matches"
      : "the game reads it as 0";
  ctx.add(table, row.rowIndex, parsed.columnName, `${parsed.columnName} value "${parsed.raw}" is not a normal integer; ${behavior}. Use a plain whole number or valid skill name.`, {
    severity: "warning",
    d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${parsed.columnName}' value '${parsed.raw}' is not a normal integer; ${behavior}. Use a plain whole number or valid skill name.`
  });
}

function savedStatBounds(statRows) {
  return statRows.map((statRow) => {
    const saveBits = integerFromRow(statRow, "save bits");
    const saveAdd = integerFromRow(statRow, "save add") ?? 0;
    if (saveBits === null || saveBits <= 0) return null;
    return { min: -saveAdd, max: (2 ** saveBits - 1) - saveAdd };
  }).filter(Boolean);
}

function validateSavedStatSources(ctx, table, row, values, statRows, funcValue) {
  if (["18", "19", "20", "23", "36"].includes(funcValue)) return;
  let sources;
  if (funcValue === "11") sources = [values.min.value === 0 ? { ...values.min, value: 5 } : values.min];
  else if (funcValue === "15") sources = [values.min];
  else if (funcValue === "12") sources = [values.param];
  else if (funcValue === "16") sources = [values.max];
  else if (funcValue === "17") sources = values.param.value !== 0 ? [values.param] : [values.min, values.max];
  else sources = [values.min, values.max];
  const bounds = savedStatBounds(statRows);
  if (!bounds.length) return;
  for (const source of sources) validateValueAgainstAnySavedRange(ctx, table, row, source, bounds);
}

function validateValueAgainstAnySavedRange(ctx, table, row, source, bounds) {
  if (!source.columnName || bounds.some((bound) => source.value >= bound.min && source.value <= bound.max)) return;
  const lower = Math.min(...bounds.map((bound) => bound.min));
  const upper = Math.max(...bounds.map((bound) => bound.max));
  const label = rowLabelFor(table, row.rowIndex);
  const direction = source.value < lower ? `below the minimum ${lower}` : `above the maximum ${upper}`;
  ctx.add(table, row.rowIndex, source.columnName, `${source.columnName} value ${source.value} is ${direction} for saved item data. Use ${lower} through ${upper}.`, {
    severity: "error",
    d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${source.columnName}': value (${source.value}) ${direction} for '${label}'`
  });
}

function buildSkillContext(skillsTable, itemStatCostTable) {
  const idsByName = new Map();
  let skillCount = 0;
  skillsTable.eachRow((row) => {
    const rawName = String(rowValue(row, skillsTable.hasColumn("skill") ? "skill" : "id") ?? "");
    if (rawName && !idsByName.has(rawName.toLowerCase())) idsByName.set(rawName.toLowerCase(), skillCount);
    skillCount += 1;
  });
  let levelBits = 6;
  if (itemStatCostTable?.hasColumn("stuff") && itemStatCostTable.rows?.length > 1) {
    const candidate = integerValue(itemStatCostTable.rows[1]?.[itemStatCostTable.columnIndex("stuff")]);
    if (candidate !== null && candidate >= 1 && candidate <= 8) levelBits = candidate;
  }
  return { count: skillCount, idsByName, levelBits };
}

function saveParamBits(statRows) {
  const bits = statRows.map((row) => integerFromRow(row, "save param bits")).find((value) => value !== null);
  return bits === undefined ? null : bits;
}

function validateSkillReference(ctx, table, row, parsed, statRows, skillContext, { packedLevel = false, warnNumeric = true } = {}) {
  if (!parsed.columnName) return;
  const raw = parsed.raw;
  let skillId;
  if (!raw) skillId = 0;
  else if (parsed.numericPrefix) {
    if (warnNumeric) warnNoncanonicalNumeric(ctx, table, row, parsed);
    skillId = parsed.value;
  } else if (/^\s|\s$|^\+\d/.test(raw)) {
    warnNoncanonicalNumeric(ctx, table, row, parsed, { namedToken: true });
    skillId = 0;
  } else if (skillContext.idsByName.has(raw.toLowerCase())) {
    skillId = skillContext.idsByName.get(raw.toLowerCase());
  } else {
    ctx.add(table, row.rowIndex, parsed.columnName, `${parsed.columnName} "${raw}" is not a known skill. The game uses skill 0 instead; choose a valid skill name.`, { severity: "error" });
    return;
  }
  const bits = saveParamBits(statRows);
  const layoutBits = packedLevel ? skillContext.levelBits : 0;
  const storedMax = bits === null ? Number.POSITIVE_INFINITY : bits > layoutBits ? (2 ** (bits - layoutBits)) - 1 : 0;
  const rowMax = Math.max(-1, skillContext.count - 1);
  const maximum = Math.min(rowMax, storedMax);
  if (skillId < 0 || skillId > maximum) {
    ctx.add(table, row.rowIndex, parsed.columnName, `${parsed.columnName} resolves to skill id ${skillId}, outside the allowed range 0..${maximum}. Choose a skill from skills.txt within this range.`, { severity: "error" });
  }
}

function validateDirectSkill(ctx, table, row, param, statRows, skillContext) {
  validateSkillReference(ctx, table, row, param, statRows, skillContext);
}

function validateEventSkill(ctx, table, row, values, statRows, skillContext) {
  validateSkillReference(ctx, table, row, values.param, statRows, skillContext, { packedLevel: true });
  validatePackedLevel(ctx, table, row, values.max, skillContext.levelBits, "event-skill level");
}

function validateRandomSkill(ctx, table, row, values, statRows, skillContext) {
  warnNoncanonicalNumeric(ctx, table, row, values.param);
  validateSkillReference(ctx, table, row, values.min, statRows, skillContext, { warnNumeric: false });
  validateSkillReference(ctx, table, row, values.max, statRows, skillContext, { warnNumeric: false });
}

function validateChargedSkill(ctx, table, row, values, statRows, skillContext) {
  validateSkillReference(ctx, table, row, values.param, statRows, skillContext, { packedLevel: true });
  validatePackedLevel(ctx, table, row, values.max, skillContext.levelBits, "charged-skill level");
  if (values.min.value > 255) {
    ctx.add(table, row.rowIndex, values.min.columnName, `${values.min.columnName} maximum charges ${values.min.value} exceeds 255. The game limits it to 255; enter 255 or less.`, { severity: "error" });
  }
}

function validatePackedLevel(ctx, table, row, parsed, levelBits, label) {
  const maximum = (2 ** levelBits) - 1;
  if (parsed.value > maximum) ctx.add(table, row.rowIndex, parsed.columnName, `${parsed.columnName} ${label} ${parsed.value} exceeds the maximum ${maximum}. Enter ${maximum} or less.`, { severity: "error" });
}

function validateByTimePackedValue(ctx, table, row, values) {
  validateSemanticRange(ctx, table, row, values.param, 0, 3, "by-time parameter");
  validateSemanticRange(ctx, table, row, values.min, -256, 767, "by-time minimum");
  validateSemanticRange(ctx, table, row, values.max, -256, 767, "by-time maximum");
}

function validateSemanticRange(ctx, table, row, parsed, minimum, maximum, label) {
  if (!parsed.columnName || parsed.value >= minimum && parsed.value <= maximum) return;
  ctx.add(table, row.rowIndex, parsed.columnName, `${parsed.columnName} ${label} ${parsed.value} is outside ${minimum}..${maximum}. The game limits it to that range; enter a value within it.`, { severity: "error" });
}

function isIntegerText(value) {
  return /^-?\d+$/.test(clean(value));
}
