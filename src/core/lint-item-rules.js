import { STAT_PARAMETER_TUPLES } from "./lint-stat-data.js";
import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { exactOuterUnquote, fixed4Key, propertyGroupsEnabled, referenceTable } from "./lint-reference-semantics.js";
import { clean, normalizeToken, rowLabelFor } from "./lint-table.js";
import { legacyMessage, legacyTerm } from "./legacy-lint-i18n.js";

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
  const propertyGroups = rowsByKey(referenceTable(index, "propertygroups.txt"), "code");
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
        const values = tupleValues(row, tuple, tupleLayout(table));
        const property = properties.get(normalizeToken(propertyCode));
        if (property) {
          analyzeProperty(ctx, table, row, property, values, itemStatCost, skillContext, usesItemSerialization);
          continue;
        }
        if (propertyGroupsEnabledForValidStats(index) && propertyGroups.has(normalizeToken(propertyCode))) {
          analyzePropertyGroup(ctx, table, row, tuple.property, values, propertyGroups.get(normalizeToken(propertyCode)), properties, propertyGroups, itemStatCost, skillContext, usesItemSerialization);
        }
      }
    });
  }
}

function propertyGroupsEnabledForValidStats(index) {
  const version = String(index?.referenceVersion ?? "").trim();
  return index?.profile === "RotW" && (version === "3.1" || version === "3.2") && propertyGroupsEnabled(index);
}

function analyzeProperty(ctx, table, row, property, values, itemStatCost, skillContext, usesItemSerialization) {
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

const MAX_PROPERTY_GROUP_DEPTH = 8;
// Eight levels are accepted by the data model; 256 distinct semantic states keeps
// malformed branching graphs bounded without affecting ordinary nested groups.
const MAX_PROPERTY_GROUP_STATES = 256;

function analyzePropertyGroup(ctx, table, row, propertyColumn, consumerValues, group, properties, groups, itemStatCost, skillContext, usesItemSerialization, visited = new Set(), depth = 0, seenDiagnostics = new Set(), traversal = { states: new Set(), count: 0 }) {
  if (depth >= MAX_PROPERTY_GROUP_DEPTH || traversal.count >= MAX_PROPERTY_GROUP_STATES) return;
  const groupCode = normalizeToken(rowValue(group, "code"));
  if (!groupCode || visited.has(groupCode)) return;
  const stateKey = JSON.stringify([groupCode, consumerValues.param.value, consumerValues.min.value, consumerValues.max.value]);
  if (traversal.states.has(stateKey)) return;
  traversal.states.add(stateKey);
  traversal.count += 1;
  const nextVisited = new Set(visited);
  nextVisited.add(groupCode);
  const slots = possiblePropertyGroupSlots(group);
  const outerLocation = { table, rowIndex: row.rowIndex, columnName: propertyColumn };
  for (const slot of slots) {
    const memberCode = clean(rowValue(group, `prop${slot}`));
    if (!memberCode) continue;
    const memberParams = [
      callbackTupleInteger(rowValue(group, `parmin${slot}`), `parmin${slot}`),
      callbackTupleInteger(rowValue(group, `parmax${slot}`), `parmax${slot}`)
    ];
    const memberValues = {
      param: memberParams[0],
      min: numericTupleInteger(rowValue(group, `modmin${slot}`), `modmin${slot}`),
      max: numericTupleInteger(rowValue(group, `modmax${slot}`), `modmax${slot}`)
    };
    const variants = possiblePropertyGroupParameterValues(memberParams).map((param) => ({ ...memberValues, param }));
    const memberContext = createPropertyGroupContext(ctx, outerLocation, group, memberCode, seenDiagnostics);
    const property = properties.get(normalizeToken(memberCode));
    if (property) {
      for (const variant of variants) analyzeProperty(memberContext, table, row, property, variant, itemStatCost, skillContext, usesItemSerialization);
    }
    else if (groups.has(normalizeToken(memberCode))) {
      for (const variant of variants) {
        analyzePropertyGroup(ctx, table, row, propertyColumn, variant, groups.get(normalizeToken(memberCode)), properties, groups, itemStatCost, skillContext, usesItemSerialization, nextVisited, depth + 1, seenDiagnostics, traversal);
      }
    }
  }
}

function uniqueParsedValues(values) {
  const unique = new Map();
  for (const value of values) {
    const key = `${value.columnName}:${value.raw}`;
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()];
}

function possiblePropertyGroupParameterValues(values) {
  const unique = uniqueParsedValues(values);
  const lower = Math.min(...unique.map(({ value }) => value));
  const upper = Math.max(...unique.map(({ value }) => value));
  if (lower <= 0 && upper >= 0 && !unique.some(({ value, raw }) => value === 0 && raw === "0")) {
    unique.push({ ...unique[0], raw: "0", value: 0, blank: false, canonical: true, numericPrefix: false });
  }
  return unique;
}

function possiblePropertyGroupSlots(group) {
  const members = [];
  for (let slot = 1; slot <= 8; slot += 1) {
    const code = clean(rowValue(group, `prop${slot}`));
    if (!code) continue;
    members.push(slot);
  }
  return members;
}

function createPropertyGroupContext(ctx, outerLocation, group, memberCode, seenDiagnostics) {
  return {
    add(_table, _rowIndex, columnName, message, meta = {}) {
      const groupField = columnName || "";
      const groupValue = groupField ? rowValue(group, groupField) : "";
      const detailKey = message?.legacyKey ?? String(message ?? "");
      const detailArgs = message?.params ?? {};
      const dedupeArgs = { ...detailArgs };
      delete dedupeArgs.column;
      const dedupeKey = JSON.stringify([outerLocation.table.fileKey, outerLocation.rowIndex, outerLocation.columnName, memberCode, detailKey, dedupeArgs]);
      if (seenDiagnostics.has(dedupeKey)) return;
      seenDiagnostics.add(dedupeKey);
      const wrapped = legacyMessage("items.propertyGroupMemberIssue", {
        memberCode,
        groupField,
        groupValue,
        detail: message,
        detailKey,
        detailArgs
      });
      ctx.add(outerLocation.table, outerLocation.rowIndex, outerLocation.columnName, wrapped, {
        ...meta,
        propertyGroupMemberCode: memberCode,
        propertyGroupField: groupField,
        propertyGroupValue: groupValue,
        d2rMessage: `${outerLocation.table.displayName}, line ${outerLocation.rowIndex + 1}: PropertyGroups member '${memberCode}' uses ${groupField} value '${groupValue}'; ${String(message)}`
      });
    }
  };
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
    if (!isReachablePropertyFunction(func)) break;
    const explicitStat = clean(rowValue(propertyRow, `stat${index}`));
    const implicitStats = implicitStatsByFunction[func];
    const slotStats = implicitStats ?? (explicitStat ? [explicitStat] : []);
    if (slotStats.length) stats.push({ func, stats: slotStats });
  }
  return stats;
}

function isReachablePropertyFunction(func) {
  const value = Number(func);
  return Number.isInteger(value) && ((value >= 1 && value <= 25) || value === 36);
}

function tupleLayout(table) {
  if (table.fileName === "cubemain.txt") return "cubemain-i16";
  if (table.fileName === "qualityitems.txt" || table.fileName === "monprop.txt") return "numeric-param-i32";
  return "callback-param-i32";
}

function tupleValues(row, tuple, layout) {
  return {
    param: tupleInteger(row, tuple.param, layout === "callback-param-i32" ? "callback" : layout),
    min: tupleInteger(row, tuple.min, layout === "cubemain-i16" ? layout : "numeric-param-i32"),
    max: tupleInteger(row, tuple.max, layout === "cubemain-i16" ? layout : "numeric-param-i32")
  };
}

function tupleInteger(row, columnName, layout) {
  return parsedTupleInteger(columnName ? String(rowValue(row, columnName) ?? "") : "", columnName, layout);
}

function callbackTupleInteger(raw, columnName) {
  return parsedTupleInteger(String(raw ?? ""), columnName, "callback");
}

function numericTupleInteger(raw, columnName) {
  return parsedTupleInteger(String(raw ?? ""), columnName, "numeric-param-i32");
}

function parsedTupleInteger(raw, columnName, layout) {
  const blank = raw === "";
  const callback = layout === "callback";
  const match = callback ? /^-?\d+/.exec(raw) : null;
  let value = callback ? callbackInt32(match?.[0] ?? "") : numericInt32(raw);
  if (layout === "cubemain-i16") value = signed16(value);
  return {
    columnName,
    raw,
    blank,
    value,
    canonical: blank || /^-?\d+$/.test(raw),
    numericPrefix: callback && Boolean(match),
    callback
  };
}

function callbackInt32(text) {
  if (!text) return 0;
  const parsed = BigInt(text);
  if (parsed > 2147483647n) return 2147483647;
  if (parsed < -2147483648n) return -2147483648;
  return Number(parsed);
}

function numericInt32(raw) {
  const text = String(raw ?? "");
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  let value = 0n;
  for (const character of digits) value = BigInt.asUintN(32, value * 10n + BigInt(character.charCodeAt(0) - 48));
  if (negative) value = BigInt.asUintN(32, -value);
  return Number(BigInt.asIntN(32, value));
}

function signed16(value) {
  return Number(BigInt.asIntN(16, BigInt.asUintN(16, BigInt(value))));
}

function warnNoncanonicalNumeric(ctx, table, row, parsed, { namedToken = false } = {}) {
  if (!parsed.columnName || parsed.blank || parsed.canonical) return;
  const callbackSkillFallback = namedToken && parsed.callback;
  const numericOnly = !parsed.callback;
  const behavior = parsed.numericPrefix
    ? `the game reads the initial integer as ${parsed.value}`
    : callbackSkillFallback
      ? "the game tries it as a skill name and uses 0 if no name matches"
      : `the game reads it as ${parsed.value}`;
  const message = parsed.numericPrefix
    ? legacyMessage(numericOnly ? "items.statParameterNumericPrefixNumeric" : "items.statParameterNumericPrefix", { column: parsed.columnName, value: parsed.raw, effective: parsed.value })
    : callbackSkillFallback
      ? legacyMessage("items.statParameterSkillFallback", { column: parsed.columnName, value: parsed.raw })
      : legacyMessage(numericOnly ? "items.statParameterIntegerNumeric" : "items.statParameterInteger", numericOnly
        ? { column: parsed.columnName, value: parsed.raw, effective: parsed.value }
        : { column: parsed.columnName, value: parsed.raw, behavior });
  const guidance = numericOnly || !callbackSkillFallback ? "Use a plain whole number." : "Use a plain whole number or valid skill name.";
  ctx.add(table, row.rowIndex, parsed.columnName, message, {
    severity: "warning",
    d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${parsed.columnName}' value '${parsed.raw}' is not a normal integer; ${behavior}. ${guidance}`
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
  if (funcValue === "11") {
    const effectiveMin = values.min.value <= 0 ? { ...values.min, value: 5 } : values.min;
    sources = [{ lower: effectiveMin, upper: effectiveMin }];
  } else if (funcValue === "15") sources = [{ lower: values.min, upper: values.min }];
  else if (funcValue === "12") sources = [{ lower: values.param, upper: values.param }];
  else if (funcValue === "16") sources = [{ lower: values.max, upper: values.max }];
  else if (funcValue === "17") sources = values.param.value !== 0
    ? [{ lower: values.param, upper: values.param }]
    : [{ lower: values.min, upper: values.max }];
  else sources = [{ lower: values.min, upper: values.max }];
  const bounds = savedStatBounds(statRows);
  if (!bounds.length) return;
  for (const source of sources) validatePossibleSavedRange(ctx, table, row, source, bounds);
}

function validatePossibleSavedRange(ctx, table, row, source, bounds) {
  const lowerValue = Math.min(source.lower.value, source.upper.value);
  const upperValue = Math.max(source.lower.value, source.upper.value);
  if (lowerValue === 0 && upperValue === 0) return;
  const merged = mergeRanges(bounds);
  const gap = firstNonzeroGap(lowerValue, upperValue, merged);
  if (gap === null) return;
  const endpoints = [source.lower, source.upper]
    .filter((value, index, all) => value.value !== 0 && all.findIndex((other) => other.columnName === value.columnName) === index)
    .filter((value) => !valueFitsAnyRange(value.value, merged));
  if (endpoints.length) {
    for (const endpoint of endpoints) validateValueAgainstSavedRanges(ctx, table, row, endpoint, merged);
    return;
  }
  validateValueAgainstSavedRanges(ctx, table, row, { ...source.lower, value: gap }, merged);
}

function mergeRanges(bounds) {
  const sorted = [...bounds].sort((left, right) => left.min - right.min || left.max - right.max);
  const merged = [];
  for (const bound of sorted) {
    const previous = merged.at(-1);
    if (previous && bound.min <= previous.max + 1) previous.max = Math.max(previous.max, bound.max);
    else merged.push({ ...bound });
  }
  return merged;
}

function firstNonzeroGap(lower, upper, ranges) {
  let cursor = lower;
  for (const range of ranges) {
    if (range.max < cursor) continue;
    if (range.min > cursor) {
      const candidate = cursor === 0 ? 1 : cursor;
      if (candidate < range.min && candidate <= upper) return candidate;
    }
    cursor = Math.max(cursor, range.max + 1);
    if (cursor === 0) cursor = 1;
    if (cursor > upper) return null;
  }
  if (cursor === 0) cursor = 1;
  return cursor <= upper ? cursor : null;
}

function valueFitsAnyRange(value, bounds) {
  return bounds.some((bound) => value >= bound.min && value <= bound.max);
}

function validateValueAgainstSavedRanges(ctx, table, row, source, bounds) {
  if (!source.columnName || source.value === 0 || valueFitsAnyRange(source.value, bounds)) return;
  const lower = Math.min(...bounds.map((bound) => bound.min));
  const upper = Math.max(...bounds.map((bound) => bound.max));
  const label = rowLabelFor(table, row.rowIndex);
  const direction = source.value < lower ? `below the minimum ${lower}` : `above the maximum ${upper}`;
  const message = source.value < lower
    ? legacyMessage("items.statParameterBelowRange", { column: source.columnName, value: source.value, lower, upper })
    : legacyMessage("items.statParameterAboveRange", { column: source.columnName, value: source.value, lower, upper });
  ctx.add(table, row.rowIndex, source.columnName, message, {
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

function validateSkillReference(ctx, table, row, parsed, statRows, skillContext, { packedLevel = false, levelBits = 0, warnNumeric = true } = {}) {
  if (!parsed.columnName) return null;
  if (!parsed.callback) {
    validateNumericSkillReference(ctx, table, row, parsed, statRows, skillContext, { packedLevel, levelBits });
    return parsed.value;
  }
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
    ctx.add(table, row.rowIndex, parsed.columnName, legacyMessage("items.unknownSkill", { column: parsed.columnName, value: raw }), { severity: "error" });
    return null;
  }
  const bits = saveParamBits(statRows);
  const layoutBits = packedLevel ? levelBits : 0;
  const storedMax = bits === null ? Number.POSITIVE_INFINITY : bits > layoutBits ? (2 ** (bits - layoutBits)) - 1 : 0;
  const rowMax = Math.max(-1, skillContext.count - 1);
  const maximum = Math.min(rowMax, storedMax);
  if (skillId < 0 || skillId > maximum) {
    ctx.add(table, row.rowIndex, parsed.columnName, legacyMessage("items.skillOutOfRange", { column: parsed.columnName, skillId, maximum }), { severity: "error" });
  }
  return skillId;
}

function validateDirectSkill(ctx, table, row, param, statRows, skillContext) {
  validateSkillReference(ctx, table, row, param, statRows, skillContext);
}

function validateEventSkill(ctx, table, row, values, statRows, skillContext) {
  const levelBits = 6;
  const skillId = validateSkillReference(ctx, table, row, values.param, statRows, skillContext, { packedLevel: true, levelBits });
  validatePackedLevel(ctx, table, row, values.max, levelBits, saveParamBits(statRows), "eventSkillLevel");
  validatePackedSkill(ctx, table, row, values, skillId, levelBits, saveParamBits(statRows));
}

function validateRandomSkill(ctx, table, row, values, statRows, skillContext) {
  warnNoncanonicalNumeric(ctx, table, row, values.param);
  validateNumericSkillReference(ctx, table, row, values.min, statRows, skillContext);
  validateNumericSkillReference(ctx, table, row, values.max, statRows, skillContext);
}

function validateNumericSkillReference(ctx, table, row, parsed, statRows, skillContext, { packedLevel = false, levelBits = 0 } = {}) {
  if (!parsed.columnName) return;
  const bits = saveParamBits(statRows);
  const storedMax = bits === null
    ? Number.POSITIVE_INFINITY
    : packedLevel
      ? (bits > levelBits ? (2 ** (bits - levelBits)) - 1 : 0)
      : (2 ** bits) - 1;
  const maximum = Math.min(Math.max(-1, skillContext.count - 1), storedMax);
  if (parsed.value < 0 || parsed.value > maximum) {
    ctx.add(table, row.rowIndex, parsed.columnName, legacyMessage("items.skillOutOfRange", {
      column: parsed.columnName,
      skillId: parsed.value,
      maximum
    }), { severity: "error" });
  }
}

function validateChargedSkill(ctx, table, row, values, statRows, skillContext) {
  const levelBits = skillContext.levelBits;
  const skillId = validateSkillReference(ctx, table, row, values.param, statRows, skillContext, { packedLevel: true, levelBits });
  validatePackedLevel(ctx, table, row, values.max, levelBits, saveParamBits(statRows), "chargedSkillLevel");
  validatePackedSkill(ctx, table, row, values, skillId, levelBits, saveParamBits(statRows));
  if (values.min.value > 255) {
    ctx.add(table, row.rowIndex, values.min.columnName, legacyMessage("items.chargeCap", { column: values.min.columnName, value: values.min.value }), { severity: "error" });
  }
}

function validatePackedLevel(ctx, table, row, parsed, levelBits, parameterBits, labelTermKey) {
  const storedBits = parameterBits === null ? levelBits : Math.min(levelBits, Math.max(0, parameterBits));
  const maximum = (2 ** storedBits) - 1;
  if (parsed.value > maximum) ctx.add(table, row.rowIndex, parsed.columnName, legacyMessage("items.valueMaximum", {
    column: parsed.columnName,
    label: legacyTerm(labelTermKey),
    value: parsed.value,
    maximum
  }), { severity: "error" });
}

function validatePackedSkill(ctx, table, row, values, skillId, levelBits, parameterBits) {
  if (skillId === null || parameterBits === null || parameterBits < 0) return;
  if (values.max.value > (2 ** Math.min(levelBits, Math.max(0, parameterBits))) - 1) return;
  const level = Math.max(0, values.max.value);
  const maximum = (2 ** parameterBits) - 1;
  const packed = skillId * (2 ** levelBits) + level;
  if (packed <= maximum) return;
  ctx.add(table, row.rowIndex, values.param.columnName, legacyMessage("items.skillOutOfRange", {
    column: values.param.columnName,
    skillId,
    maximum: parameterBits > levelBits ? (2 ** (parameterBits - levelBits)) - 1 : 0
  }), { severity: "error" });
}

function validateByTimePackedValue(ctx, table, row, values) {
  validateSemanticRange(ctx, table, row, values.param, 0, 3, "byTimeParameter");
  validateSemanticRange(ctx, table, row, values.min, -256, 767, "byTimeMinimum");
  validateSemanticRange(ctx, table, row, values.max, -256, 767, "byTimeMaximum");
}

function validateSemanticRange(ctx, table, row, parsed, minimum, maximum, labelTermKey) {
  if (!parsed.columnName || parsed.value >= minimum && parsed.value <= maximum) return;
  ctx.add(table, row.rowIndex, parsed.columnName, legacyMessage("items.valueRange", {
    column: parsed.columnName,
    label: legacyTerm(labelTermKey),
    value: parsed.value,
    minimum,
    maximum
  }), { severity: "error" });
}

function isIntegerText(value) {
  return /^-?\d+$/.test(clean(value));
}
