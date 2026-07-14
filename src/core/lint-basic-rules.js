import { duplicateRowPairs } from "./lint-duplicates.js";
import { acceptedColumnsForProfile, nonStandardColumnsForProfile, numericBoundsForProfile } from "./lint-profile-data.js";
import { BOOLEAN_FIELDS, DUPLICATE_KEYS, DUPLICATE_KEY_COMPARISONS, REQUIRED_COLUMNS, TYPE29_BOOLEAN_FIELDS, VERSION_CHECKS } from "./lint-rule-data.js";
import { asciiCaseInsensitiveValues, asciiLower, fixed4cc, fixed4ccValues, fixed4Key, propertyGroupsEnabled, referenceTable } from "./lint-reference-semantics.js";
import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { numberedFields } from "./lint-stat-data.js";
import { clean, normalizeHeader, normalizeToken, rowLabelFor } from "./lint-table.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export function basicLintRules(options = {}) {
  const linkedExcelRunner = options.lintLinkedExcel ?? lintLinkedExcel;
  return [
    rule("Basic/NoDuplicateExcel", "No duplicate Excel IDs", lintNoDuplicateExcel, true, PROFILE_OPTIONS, "Checks duplicate IDs using each field's actual comparison rules, including four-character codes, numbers, case-insensitive names, and exact text."),
    rule("Basic/ExcelColumns", "Required Excel columns", lintExcelColumns, true, PROFILE_OPTIONS, "Reports missing columns and distinguishes fields required by the game from fields used only by TXTEditor."),
    rule("Basic/LinkedExcel", "Linked Excel references", linkedExcelRunner, true, PROFILE_OPTIONS, "Checks linked TXT values with the matching rules used by each field. Four-character item-type codes are case-sensitive; letter case does not matter for verified name fields."),
    rule("Basic/MissileRangeFieldSemantics", "Missile range field semantics", lintMissileRangeFieldSemantics, true, ["2.4"], "Checks that missiles.txt range values use the plain integer format expected by D2R 2.4."),
    rule("Basic/MonstatsDesecratedTreasureClassSemantics", "Desecrated treasure class semantics", lintMonstatsDesecratedTreasureClassSemantics, true, ["2.4"], "Checks that desecrated champion or unique treasure classes also have the matching base desecrated treasure class in D2R 2.4."),
    rule("Basic/MonEquipLevelOrder", "Monster equipment level order", lintMonEquipLevelOrder, true, ["2.4"], "Checks that monequip.txt rows for the same monster are ordered from higher level to lower level in D2R 2.4."),
    rule("Basic/StringCheck", "String references", lintStringCheck, true, PROFILE_OPTIONS, "Warns when different keys reuse one string ID. This is an editor consistency check when the game's behavior is not confirmed."),
    rule("Basic/NumericBounds", "Numeric bounds", lintNumericBounds, true, PROFILE_OPTIONS, "Checks plain integer spelling and the allowed range for the selected profile."),
    rule("Basic/BooleanFields", "Boolean fields", lintBooleanFields, true, PROFILE_OPTIONS, "Uses 0=false and nonzero=true for the confirmed missile fields, and recommends 0 or 1 for other boolean fields.")
  ];
}

export function lintLinkedExcel(index, ctx) {
  const optional = { allowNull: true };
  const propertyOptional = { allowNull: true, comparison: "ascii-ci" };
  const usePropertyGroups = propertyGroupsEnabled(index);
  const allProperties = asciiCaseInsensitiveValues(
    index,
    usePropertyGroups ? ["properties.txt", "propertygroups.txt"] : ["properties.txt"],
    "code"
  );
  const itemStats = asciiCaseInsensitiveValues(index, ["itemstatcost.txt"], "stat");
  const skillsLookup = mergeSets(
    asciiCaseInsensitiveValues(index, ["skills.txt"], "skill"),
    asciiCaseInsensitiveValues(index, ["skills.txt"], "id")
  );
  const monSounds = asciiCaseInsensitiveValues(index, ["monsounds.txt"], "id");
  const missiles = asciiCaseInsensitiveValues(index, ["missiles.txt"], "missile");
  const skillDescs = asciiCaseInsensitiveValues(index, ["skilldesc.txt"], "skilldesc");
  const monModes = asciiCaseInsensitiveValues(index, ["monmode.txt"], "code");
  const propertiesAvailable = (usePropertyGroups
    ? ["properties.txt", "propertygroups.txt"]
    : ["properties.txt"]
  ).every((fileName) => referenceTable(index, fileName)?.hasColumn("code"));
  const itemStatsAvailable = Boolean(referenceTable(index, "itemstatcost.txt")?.hasColumn("stat"));
  const skillsTarget = referenceTable(index, "skills.txt");
  const skillsAvailable = Boolean(skillsTarget?.hasColumn("skill") || skillsTarget?.hasColumn("id"));
  const monSoundsAvailable = Boolean(referenceTable(index, "monsounds.txt")?.hasColumn("id"));
  const missilesAvailable = Boolean(referenceTable(index, "missiles.txt")?.hasColumn("missile"));
  const skillDescsAvailable = Boolean(referenceTable(index, "skilldesc.txt")?.hasColumn("skilldesc"));

  for (const table of [index.tablesByName.get("armor.txt"), index.tablesByName.get("misc.txt"), index.tablesByName.get("weapons.txt")]) {
    for (const field of ["stat1", "stat2", "stat3"]) {
      mustExist(index, ctx, table, field, "code", itemStats, { ...optional, comparison: "ascii-ci", targetsAvailable: itemStatsAvailable });
    }
  }

  validatePropertiesStatReferences(
    ctx,
    index.tablesByName.get("properties.txt"),
    itemStats,
    itemStatsAvailable
  );
  validateMonPetConsumeStatReferences(
    ctx,
    index.tablesByName.get("monpet.txt"),
    itemStats,
    itemStatsAvailable
  );

  for (const table of [index.tablesByName.get("magicprefix.txt"), index.tablesByName.get("magicsuffix.txt")]) {
    for (const field of numberedFields("mod", "code", 3)) {
      mustExist(index, ctx, table, field, "name", allProperties, { ...propertyOptional, targetsAvailable: propertiesAvailable });
    }
    const itemTypesFixed4 = index.itemTypesFixed4 instanceof Set
      ? index.itemTypesFixed4
      : fixed4ccValues(index, ["itemtypes.txt"], "code");
    const itemTypeTargetsAvailable = Boolean(referenceTable(index, "itemtypes.txt")?.hasColumn("code"));
    for (const field of [...numberedFields("itype", "", 7), ...numberedFields("etype", "", 5)]) {
      mustExist(index, ctx, table, field, "name", itemTypesFixed4, {
        ...optional,
        comparison: "fixed4cc",
        targetsAvailable: itemTypeTargetsAvailable
      });
    }
  }

  if (usePropertyGroups) {
    const propertyGroups = index.tablesByName.get("propertygroups.txt");
    for (const field of numberedFields("prop", "", 8)) {
      mustExist(index, ctx, propertyGroups, field, "code", allProperties, { ...propertyOptional, targetsAvailable: propertiesAvailable });
    }
  }

  const setItems = index.tablesByName.get("setitems.txt");
  for (const field of [...numberedFields("prop", "", 9), ...numberedFields("aprop", "a", 5), ...numberedFields("aprop", "b", 5)]) {
    mustExist(index, ctx, setItems, field, "index", allProperties, { ...propertyOptional, targetsAvailable: propertiesAvailable });
  }

  const uniqueItems = index.tablesByName.get("uniqueitems.txt");
  for (const field of numberedFields("prop", "", 12)) {
    mustExist(index, ctx, uniqueItems, field, "index", allProperties, { ...propertyOptional, targetsAvailable: propertiesAvailable });
  }

  mustExist(index, ctx, index.tablesByName.get("missiles.txt"), "skill", "missile", skillsLookup, { ...optional, comparison: "ascii-ci", targetsAvailable: skillsAvailable });

  const monStats = index.tablesByName.get("monstats.txt");
  mustExist(index, ctx, monStats, "monsound", "id", monSounds, { ...optional, comparison: "ascii-ci", targetsAvailable: monSoundsAvailable });
  mustExist(index, ctx, monStats, "umonsound", "id", monSounds, { ...optional, comparison: "ascii-ci", targetsAvailable: monSoundsAvailable });

  const skills = index.tablesByName.get("skills.txt");
  mustExist(index, ctx, skills, "skilldesc", "skill", skillDescs, { ...optional, comparison: "ascii-ci", targetsAvailable: skillDescsAvailable });
  for (const field of ["srvmissile", "srvmissilea", "srvmissileb", "srvmissilec", "cltmissile", "cltmissilea", "cltmissileb", "cltmissilec", "cltmissiled"]) {
    mustExist(index, ctx, skills, field, "skill", missiles, { ...optional, comparison: "ascii-ci", targetsAvailable: missilesAvailable });
  }
  validateSkillSummode(index, ctx, skills, monModes, {
    targetsAvailable: Boolean(referenceTable(index, "monmode.txt")?.hasColumn("code"))
  });

  requiredString(index, ctx, index.tablesByName.get("armor.txt"), "namestr", "name");
  requiredString(index, ctx, index.tablesByName.get("misc.txt"), "namestr", "name");
  requiredString(index, ctx, index.tablesByName.get("weapons.txt"), "namestr", "name");
}

export function lintExcelColumns(index, ctx) {
  for (const table of index.tables) {
    const required = REQUIRED_COLUMNS[table.fileName];
    if (required) {
      for (const columnName of required) {
        if (!table.hasColumn(columnName)) {
          const evidence = requiredColumnEvidence(table.fileName, columnName);
          const message = evidence === "editor-policy"
            ? `Column "${columnName}" is missing. TXTEditor uses it to label recipes, but the game does not require it.`
            : evidence === "runtime-semantic"
              ? `Column "${columnName}" is missing. The game uses this field when present; add it, although a missing header is not known to reject the whole table.`
              : `Column "${columnName}" is missing from the selected profile. Add the column; the exact effect of omitting the header is not confirmed.`;
          ctx.add(table, 0, 0, message, {
            severity: "warning",
            d2rMessage: `${table.displayName} - ${message}`
          });
        }
      }
    }
    const accepted = acceptedColumnsForProfile(index.profile, table.fileName);
    const nonStandard = nonStandardColumnsForProfile(index.profile, table.fileName);
    for (const header of table.headers) {
      const normalized = normalizeHeader(header);
      if (accepted.has(normalized)) continue;
      if (nonStandard.has(normalized)) {
        ctx.add(table, 0, header, `Non-standard column "${header}" found.`, {
          d2rMessage: `${table.displayName} - non-standard column '${normalized}' found`
        });
      }
    }
  }
}

export function lintNoDuplicateExcel(index, ctx) {
  for (const table of index.tables) {
    const keys = DUPLICATE_KEYS[table.fileName] ?? [];
    for (const key of keys) {
      if (!table.hasColumn(key)) continue;
      const comparison = DUPLICATE_KEY_COMPARISONS[table.fileName]?.[key] ?? "raw";
      for (const { rowIndex, previousRow, value } of duplicateRowPairs(table, key, { comparison })) {
        const policyOnly = comparison === "raw";
        const message = policyOnly
          ? `Potential duplicate ${key} "${value}" also appears on row ${previousRow + 1}. Check whether these rows should share the same value; the game's handling of duplicates for this field is not confirmed.`
          : `Duplicate ${key} "${value}" also appears on row ${previousRow + 1}.`;
        ctx.add(table, rowIndex, key, message, {
          ...(policyOnly ? { severity: "warning" } : {}),
          d2rMessage: policyOnly
            ? `${table.displayName}, lines ${previousRow + 1} and ${rowIndex + 1}: ${message}`
            : `${table.displayName} - duplicate detected on lines ${previousRow + 1} and ${rowIndex + 1} for field '${key}' (${value})`,
          d2rSortLine: previousRow + 1
        });
      }
    }
  }
}

export function lintMissileRangeFieldSemantics(index, ctx) {
  if (index.profile !== "2.4") return;
  const table = index.tablesByName.get("missiles.txt");
  if (!table?.hasColumn("range")) return;
  table.eachRow((row) => {
    const value = clean(row.get("range"));
    if (value && !isIntegerText(value)) ctx.add(table, row.rowIndex, "range", "D2R 2.4 expects missiles.range to be a plain integer.");
  });
}

export function lintMonstatsDesecratedTreasureClassSemantics(index, ctx) {
  if (index.profile !== "2.4") return;
  const table = index.tablesByName.get("monstats.txt");
  if (!table) return;
  const groups = [
    ["Normal", "treasureclassdesecrated", "treasureclassdesecratedchamp", "treasureclassdesecratedunique"],
    ["Nightmare", "treasureclassdesecrated(n)", "treasureclassdesecratedchamp(n)", "treasureclassdesecratedunique(n)"],
    ["Hell", "treasureclassdesecrated(h)", "treasureclassdesecratedchamp(h)", "treasureclassdesecratedunique(h)"]
  ];
  table.eachRow((row) => {
    for (const [label, base, champ, unique] of groups) {
      if (!table.hasColumn(base) || !table.hasColumn(champ) || !table.hasColumn(unique)) continue;
      const filled = [champ, unique].filter((columnName) => clean(row.get(columnName)));
      if (filled.length && !clean(row.get(base))) {
        ctx.add(table, row.rowIndex, base, `${filled.join(" / ")} is populated but ${base} is blank; ${label} desecrated drops require the base desecrated treasure class in 2.4.`);
      }
    }
  });
}

export function lintMonEquipLevelOrder(index, ctx) {
  const table = index.tablesByName.get("monequip.txt");
  if (!table?.hasColumn("monster") || !table.hasColumn("level")) return;
  let currentMonster = "";
  let previousLevel = null;
  let previousRow = -1;
  table.eachRow((row) => {
    const monster = clean(row.get("monster"));
    if (!monster || monster === "*end*  do not remove") {
      currentMonster = "";
      previousLevel = null;
      previousRow = -1;
      return;
    }
    const rawLevel = clean(row.get("level"));
    const level = rawLevel ? integerValue(rawLevel) : 0;
    if (level === null) {
      ctx.add(table, row.rowIndex, "level", `Invalid level "${rawLevel}" for "${monster}".`);
      return;
    }
    if (monster !== currentMonster) {
      currentMonster = monster;
      previousLevel = level;
      previousRow = row.rowIndex;
      return;
    }
    if (previousLevel !== null && level > previousLevel) {
      ctx.add(table, row.rowIndex, "level", `Level ${level} for "${monster}" appears after lower level ${previousLevel} on row ${previousRow + 1}; rows for the same monster should be ordered highest to lowest.`);
    }
    previousLevel = level;
    previousRow = row.rowIndex;
  });
}

export function lintStringCheck(index, ctx) {
  const seenIds = new Map();
  for (const table of index.tables.filter(isStringLikeTable)) {
    table.eachRow((row) => {
      const id = clean(row.get("id"));
      const key = clean(row.get("key")) || clean(row.get("Key"));
      if (!id || !key) return;
      const normalizedId = normalizeToken(id);
      const found = seenIds.get(normalizedId);
      if (found && normalizeToken(found.key) !== normalizeToken(key)) {
        const message = `Potential string-ID reuse: "${key}" shares "${id}" with "${found.key}" in ${found.fileName}. Check whether both keys should use the same text; the game's behavior is not confirmed.`;
        ctx.add(table, row.rowIndex, "id", message, {
          severity: "warning",
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${message}`
        });
      } else if (!found) {
        seenIds.set(normalizedId, { key, fileName: table.displayName });
      }
    });
  }
}

export function lintNumericBounds(index, ctx) {
  for (const [fileName, labelColumn, versionColumn] of VERSION_CHECKS) {
    validVersion(index.tablesByName.get(fileName), ctx, labelColumn, versionColumn);
  }
  validVersion(index.tablesByName.get("cubemain.txt"), ctx, "description", "version", (row) => clean(row.get("enabled")) === "1");

  lintHitSummonMode(index, ctx);

  for (const table of index.tables) {
    const rules = numericBoundsForProfile(index.profile, table.fileName);
    if (!rules) continue;
    for (const [columnName, [min, max]] of Object.entries(rules)) {
      if (!table.hasColumn(columnName)) continue;
      table.eachRow((row) => {
        if (table.fileName === "monstats.txt" && ["colossal1", "colossal2", "colossal3"].includes(clean(row.get("id")))) return;
        const value = clean(row.get(columnName));
        if (!value) return;
        const label = numericBoundsLabel(table, row);
        if (!isIntegerText(value)) {
          const message = integerPolicyMessage(table.fileName, columnName, value);
          ctx.add(table, row.rowIndex, columnName, message, {
            severity: "warning",
            d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${message} Row '${label}'.`
          });
          return;
        }
        const number = Number(value);
        if (number < min || number > max) {
          const engineStorageBound = table.fileName === "levels.txt" && normalizeHeader(columnName) === "intensity";
          ctx.add(
            table,
            row.rowIndex,
            columnName,
            engineStorageBound
              ? `"${columnName}" must be from ${formatBound(min)} through ${formatBound(max)}. Enter a value in that range.`
              : `"${columnName}" is outside the recommended range ${formatBound(min)} through ${formatBound(max)} for this profile.`,
            {
              severity: "warning",
              d2rMessage: engineStorageBound
                ? `${table.displayName}, line ${row.rowIndex + 1}: '${columnName}' for '${label}' must be ${min}..${max}, found ${number}`
                : `${table.displayName}, line ${row.rowIndex + 1}: '${columnName}' is outside the recommended range for this profile for '${label}', expected ${min}..${max}, found ${number}`
            }
          );
        }
      });
    }
  }
}

const HIT_SUMMON_MODE_CODES = ["DT", "NU", "WL", "GH", "A1", "A2", "BL", "SC", "S1", "S2", "S3", "S4", "DD", "KB", "xx", "RN"];

function lintHitSummonMode(index, ctx) {
  if (index.profile !== "RotW") return;
  const table = index.tablesByName.get("missiles.txt");
  if (!table?.hasColumn("pSrvHitFunc") || !table.hasColumn("sHitPar2")) return;

  table.eachRow((row) => {
    if (String(row.get("pSrvHitFunc") ?? "") !== "6") return;
    const rawValue = String(row.get("sHitPar2") ?? "");
    const result = hitSummonModeResult(rawValue);
    if (!result.message) return;
    ctx.add(table, row.rowIndex, "sHitPar2", result.message, {
      severity: "warning",
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${result.message}`,
      hitSummonMode: {
        parsedUint32: result.parsed,
        effectiveMode: result.effective,
        modeCode: HIT_SUMMON_MODE_CODES[result.effective],
        fallbackApplied: result.fallbackApplied
      }
    });
  });
}

export function parseType2Uint32(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  const negative = bytes[0] === 0x2d;
  let parsed = 0;
  for (let index = negative ? 1 : 0; index < bytes.length; index += 1) {
    parsed = (Math.imul(parsed, 10) + bytes[index] - 0x30) >>> 0;
  }
  return negative ? (-parsed) >>> 0 : parsed;
}

export function hitSummonModeResult(rawValue) {
  const value = String(rawValue ?? "");
  const shownValue = value.replaceAll(" ", "␠").replaceAll("\t", "⇥");
  const parsed = parseType2Uint32(value);
  if (value === "") return { parsed, effective: 0, fallbackApplied: false, message: null };

  const digitsOnly = /^[0-9]+$/.test(value);
  const normalizedDigits = digitsOnly ? value.replace(/^0+(?=\d)/, "") : "";
  const canonicalMode = digitsOnly
    && (normalizedDigits.length < 2 || (normalizedDigits.length === 2 && normalizedDigits <= "15"));
  if (canonicalMode) return { parsed, effective: parsed, fallbackApplied: false, message: null };

  const fallbackApplied = parsed > 15;
  const effective = fallbackApplied ? 1 : parsed;
  if (digitsOnly || /^-[0-9]+$/.test(value)) {
    return {
      parsed,
      effective,
      fallbackApplied,
      message: fallbackApplied
        ? `'${shownValue}' is outside the HitSummon mode range 0 through 15. The game uses 1 (NU). Enter a value from 0 through 15.`
        : `'${shownValue}' does not directly name a HitSummon mode from 0 through 15. The game reads it as ${effective} (${HIT_SUMMON_MODE_CODES[effective]}). Replace it with the mode number you actually want.`
    };
  }
  return {
    parsed,
    effective,
    fallbackApplied,
    message: value === "NU"
      ? "'NU' is not a numeric mode ID here. The game replaces it with 1 (NU). Use 1 for neutral mode."
      : fallbackApplied
        ? `'${shownValue}' is not a numeric mode ID here. The game replaces it with 1 (NU). Enter a value from 0 through 15.`
        : `'${shownValue}' is not a numeric mode ID here. The game reads it as ${effective} (${HIT_SUMMON_MODE_CODES[effective]}). Replace it with the mode number you actually want from 0 through 15.`
  };
}

export function lintBooleanFields(index, ctx) {
  for (const table of index.tables) {
    const type29Fields = new Set(TYPE29_BOOLEAN_FIELDS[table.fileName] ?? []);
    const fields = [...new Set([...(BOOLEAN_FIELDS[table.fileName] ?? []), ...type29Fields])];
    for (const columnName of fields) {
      if (!table.hasColumn(columnName)) continue;
      table.eachRow((row) => {
        if (type29Fields.has(columnName)) {
          const rawValue = String(row.get(columnName) ?? "");
          if (rawValue.trim() && !isSignedDecimalText(rawValue)) {
            const message = `'${rawValue}' is not a number for '${columnName}'. Use 0 for false or any nonzero integer for true.`;
            ctx.add(table, row.rowIndex, columnName, message, {
              severity: "warning",
              d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${message}`
            });
          }
          return;
        }
        const value = clean(row.get(columnName));
        if (value && value !== "0" && value !== "1") {
          const message = `'${value}' is not a standard boolean value for '${columnName}'. Use 0 for false or 1 for true.`;
          ctx.add(table, row.rowIndex, columnName, message, {
            severity: "warning",
            d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${message}`
          });
        }
      });
    }
  }
}

export function integerPolicyMessage(fileName, columnName, value) {
  return fileName === "missiles.txt"
    && normalizeHeader(columnName) === "cltparam5"
    && value === "`"
    ? "'`' is not written as a normal integer. The game converts it to 48. Replace it with the number you actually want."
    : `'${value}' is not a standard integer for '${columnName}'. Use a plain whole number; the game may read a different value.`;
}

function mustExist(index, ctx, table, fieldName, labelColumn, targetValues, options = {}) {
  if (!table?.hasColumn(fieldName) || !table.hasColumn(labelColumn)) return;
  if (!(targetValues instanceof Set) || options.targetsAvailable === false
    || (targetValues.size === 0 && options.targetsAvailable !== true)) return;
  const allowNull = options.allowNull === true;
  const nullChecker = options.nullChecker ?? ((value) => clean(value) === "" || value === undefined);
  const comparison = options.comparison ?? (options.caseSensitive ? "raw" : "ascii-ci");
  const normalizeReference = comparison === "fixed4cc"
    ? fixed4Key
    : comparison === "ascii-ci"
      ? (value) => asciiLower(String(value ?? ""))
      : clean;
  const normalizedTargets = comparison === "fixed4cc"
    ? targetValues
    : new Set([...targetValues].map(normalizeReference));
  table.eachRow((row) => {
    const label = clean(row.get(labelColumn));
    if (!label || label === "Expansion" || label === "*end*  do not remove" || label.startsWith("@")) return;
    const rawValue = row.get(fieldName);
    const value = comparison === "fixed4cc" || comparison === "ascii-ci"
      ? String(rawValue ?? "")
      : clean(rawValue);
    const isNull = comparison === "fixed4cc" || comparison === "ascii-ci"
      ? rawValue === undefined || value === ""
      : nullChecker(value);
    if (allowNull && isNull) return;
    const normalizedValue = normalizeReference(value);
    if (!normalizedTargets.has(normalizedValue)) {
      if (comparison === "fixed4cc") {
        const message = fixed4UnknownMessage(value);
        ctx.add(table, row.rowIndex, fieldName, message, {
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${message}`
        });
        return;
      }
      ctx.add(table, row.rowIndex, fieldName, `${fieldName} "${value}" not found for "${label}".`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${fieldName} '${value}' not found for '${label}'`
      });
    }
  });
}

function validatePropertiesStatReferences(ctx, table, itemStats, targetsAvailable) {
  if (!table || !targetsAvailable || !(itemStats instanceof Set)) return;
  table.eachRow((row) => {
    for (let slot = 1; slot <= 7; slot += 1) {
      const statColumn = `stat${slot}`;
      if (!table.hasColumn(statColumn)) continue;
      const func = propertyDispatchFunc(table, row, slot);
      if (func === null) continue;
      const value = String(row.get(statColumn) ?? "");
      if (!value || itemStats.has(asciiLower(value))) continue;
      const message = func === 17
        ? `Unknown stat name '${value}'. This property has no effect. Use the exact Stat name from itemstatcost.txt.`
        : `Unknown stat name '${value}'. Use the exact Stat name from itemstatcost.txt.`;
      ctx.add(table, row.rowIndex, statColumn, message, {
        severity: "warning",
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${message}`
      });
    }
  });
}

function propertyDispatchFunc(table, row, slot) {
  let func = null;
  for (let current = 1; current <= slot; current += 1) {
    const funcColumn = `func${current}`;
    if (!table.hasColumn(funcColumn)) return null;
    const rawFunc = String(row.get(funcColumn) ?? "");
    if (!/^\d+$/.test(rawFunc)) return null;
    func = Number(rawFunc);
    if (!((func >= 1 && func <= 25) || func === 36)) return null;
  }
  return func;
}

function validateMonPetConsumeStatReferences(ctx, table, itemStats, targetsAvailable) {
  if (!table || !targetsAvailable || !(itemStats instanceof Set)) return;
  table.eachRow((row) => {
    for (let slot = 1; slot <= 5; slot += 1) {
      const statColumn = `consumestat${slot}`;
      if (!table.hasColumn(statColumn)) continue;
      const value = String(row.get(statColumn) ?? "");
      if (!value || itemStats.has(asciiLower(value))) continue;
      const message = `Unknown stat name '${value}'. This Consume bonus is not applied; other Consume slots still work. Use the exact Stat name from itemstatcost.txt.`;
      ctx.add(table, row.rowIndex, statColumn, message, {
        severity: "warning",
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${message}`
      });
    }
  });
}

function requiredString(index, ctx, table, fieldName, labelColumn) {
  if (!table?.hasColumn(fieldName) || !table.hasColumn(labelColumn)) return;
  table.eachRow((row) => {
    const label = clean(row.get(labelColumn));
    if (!label || label === "Expansion" || label === "Null" || label === "Elite Uniques" || label.startsWith("@")) return;
    if (!clean(row.get(fieldName))) {
      const message = `${fieldName} is blank for "${label}". Add the localization key so TXTEditor and other tools can display the intended name.`;
      ctx.add(table, row.rowIndex, fieldName, message, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${message}`
      });
    }
  });
}

function validateSkillSummode(index, ctx, table, monModes = index.monModes, options = {}) {
  if (!table?.hasColumn("summon") || !table.hasColumn("summode") || !table.hasColumn("skill")) return;
  if (!(monModes instanceof Set) || options.targetsAvailable === false
    || (monModes.size === 0 && options.targetsAvailable !== true)) return;
  table.eachRow((row) => {
    const summon = clean(row.get("summon"));
    if (!summon) return;
    const summode = String(row.get("summode") ?? "");
    const skill = clean(row.get("skill"));
    if (!monModes.has(asciiLower(summode))) {
      const message = `Unknown summode "${summode}" for "${skill}". Choose a valid code from monmode.txt.`;
      ctx.add(table, row.rowIndex, "summode", message, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${message}`
      });
    }
  });
}

function mergeSets(...sets) {
  return new Set(sets.flatMap((set) => [...set]));
}

function requiredColumnEvidence(fileName, columnName) {
  const identity = `${fileName}:${columnName}`;
  if (identity === "cubemain.txt:description") return "editor-policy";
  if (new Set([
    "cubemain.txt:enabled",
    "cubemain.txt:numinputs",
    "cubemain.txt:input 1",
    "cubemain.txt:output",
    "cubemain.txt:op",
    "cubemain.txt:param",
    "cubemain.txt:value",
    "treasureclassex.txt:picks",
    "treasureclassex.txt:prob1"
  ]).has(identity)) return "runtime-semantic";
  return "loader-descriptor";
}

function validVersion(table, ctx, labelColumn, versionColumn, shouldConsider = null) {
  if (!table?.hasColumn(labelColumn) || !table.hasColumn(versionColumn)) return;
  table.eachRow((row) => {
    const label = clean(row.get(labelColumn));
    const version = clean(row.get(versionColumn));
    if (!label || label === "Expansion" || label === "Armor" || label === "Elite Uniques" || label === "Rings" || label === "Class Specific" || label.startsWith("@")) return;
    if (version === "0" || version === "1" || version === "100") return;
    if (shouldConsider && !shouldConsider(row)) return;
    if (isDummyVersionRow(table, row, labelColumn, versionColumn)) return;
    const message = `Unusual version value "${version}" for "${label}". Use 0, 1, or 100 for this profile.`;
    ctx.add(table, row.rowIndex, versionColumn, message, {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${message}`
    });
  });
}

function fixed4UnknownMessage(value) {
  const effective = fixed4cc(value);
  const shownValue = markWhitespace(value);
  const shownEffective = markWhitespace(effective);
  const markers = [];
  if (String(value).includes(" ") || effective.includes(" ")) markers.push("␠ = space");
  if (String(value).includes("\t") || effective.includes("\t")) markers.push("⇥ = tab");
  const legend = markers.length ? ` ${markers.join(", ")}.` : "";
  return `Unknown code '${shownValue}'. The game reads this code as '${shownEffective}'.${legend} Check the four-character code and letter case.`;
}

function markWhitespace(value) {
  return String(value ?? "").replaceAll(" ", "␠").replaceAll("\t", "⇥");
}

function isDummyVersionRow(table, row, labelColumn, versionColumn) {
  const label = clean(row.get(labelColumn));
  const version = clean(row.get(versionColumn));
  if (!label || label.startsWith("@") || version) return false;
  const ignoredColumns = new Set([normalizeHeader(labelColumn), normalizeHeader(versionColumn), "skipindocs"]);
  const values = table.rows[row.rowIndex] ?? [];
  for (let columnIndex = 0; columnIndex < table.headers.length; columnIndex += 1) {
    const header = normalizeHeader(table.headers[columnIndex]);
    if (ignoredColumns.has(header) || header.startsWith("*")) continue;
    if (clean(values[columnIndex])) return false;
  }
  return true;
}

function numericBoundsLabel(table, row) {
  const labels = {
    "levels.txt": "name",
    "missiles.txt": "missile",
    "monstats.txt": "id",
    "treasureclassex.txt": "treasure class",
    "itemstatcost.txt": "stat"
  };
  return clean(row.get(labels[table.fileName] ?? "name")) || rowLabelFor(table, row.rowIndex);
}

function isStringLikeTable(table) {
  return table?.hasColumn("id") && table.hasColumn("key");
}

function integerValue(value) {
  const text = clean(value);
  return text && isIntegerText(text) ? Number(text) : null;
}

function isIntegerText(value) {
  return /^-?\d+$/.test(clean(value));
}

function isSignedDecimalText(value) {
  return /^-?\d+$/.test(String(value ?? ""));
}

function formatBound(value) {
  if (value === Number.NEGATIVE_INFINITY) return "-infinity";
  if (value === Number.POSITIVE_INFINITY) return "infinity";
  return String(value);
}
