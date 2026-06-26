import { duplicateRowPairs } from "./lint-duplicates.js";
import { acceptedColumnsForProfile, nonStandardColumnsForProfile, numericBoundsForProfile } from "./lint-profile-data.js";
import { BOOLEAN_FIELDS, DUPLICATE_KEYS, REQUIRED_COLUMNS, VERSION_CHECKS } from "./lint-rule-data.js";
import { rule } from "./lint-rule-registry.js";
import { numberedFields } from "./lint-stat-data.js";
import { clean, normalizeHeader, normalizeToken, rowLabelFor } from "./lint-table.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export function basicLintRules(options = {}) {
  const linkedExcelRunner = options.lintLinkedExcel ?? lintLinkedExcel;
  return [
    rule("Basic/NoDuplicateExcel", "No duplicate Excel IDs", lintNoDuplicateExcel),
    rule("Basic/ExcelColumns", "Required Excel columns", lintExcelColumns),
    rule("Basic/LinkedExcel", "Linked Excel references", linkedExcelRunner),
    rule("Basic/MissileRangeFieldSemantics", "Missile range field semantics", lintMissileRangeFieldSemantics, true, ["2.4"]),
    rule("Basic/MonstatsDesecratedTreasureClassSemantics", "Desecrated treasure class semantics", lintMonstatsDesecratedTreasureClassSemantics, true, ["2.4"]),
    rule("Basic/MonEquipLevelOrder", "Monster equipment level order", lintMonEquipLevelOrder, true, ["2.4"]),
    rule("Basic/StringCheck", "String references", lintStringCheck),
    rule("Basic/NumericBounds", "Numeric bounds", lintNumericBounds),
    rule("Basic/BooleanFields", "Boolean fields", lintBooleanFields)
  ];
}

export function lintLinkedExcel(index, ctx) {
  const optional = { allowNull: true };
  const propertyOptional = { allowNull: true, caseSensitive: true };
  const allProperties = index.allProperties;

  for (const table of [index.tablesByName.get("armor.txt"), index.tablesByName.get("misc.txt"), index.tablesByName.get("weapons.txt")]) {
    for (const field of ["stat1", "stat2", "stat3"]) {
      mustExist(index, ctx, table, field, "code", index.itemStats, optional);
    }
  }

  for (const table of [index.tablesByName.get("magicprefix.txt"), index.tablesByName.get("magicsuffix.txt")]) {
    for (const field of numberedFields("mod", "code", 3)) {
      mustExist(index, ctx, table, field, "name", allProperties, propertyOptional);
    }
    for (const field of [...numberedFields("itype", "", 7), ...numberedFields("etype", "", 5)]) {
      mustExist(index, ctx, table, field, "name", index.itemTypes, optional);
    }
  }

  if (index.profile === "RotW") {
    const propertyGroups = index.tablesByName.get("propertygroups.txt");
    for (const field of numberedFields("prop", "", 8)) {
      mustExist(index, ctx, propertyGroups, field, "code", allProperties, propertyOptional);
    }
  }

  const setItems = index.tablesByName.get("setitems.txt");
  for (const field of [...numberedFields("prop", "", 9), ...numberedFields("aprop", "a", 5), ...numberedFields("aprop", "b", 5)]) {
    mustExist(index, ctx, setItems, field, "index", allProperties, propertyOptional);
  }

  const uniqueItems = index.tablesByName.get("uniqueitems.txt");
  for (const field of numberedFields("prop", "", 12)) {
    mustExist(index, ctx, uniqueItems, field, "index", allProperties, propertyOptional);
  }

  mustExist(index, ctx, index.tablesByName.get("missiles.txt"), "skill", "missile", index.skills, optional);

  const monStats = index.tablesByName.get("monstats.txt");
  mustExist(index, ctx, monStats, "monsound", "id", index.monSounds, optional);
  mustExist(index, ctx, monStats, "umonsound", "id", index.monSounds, optional);

  const skills = index.tablesByName.get("skills.txt");
  mustExist(index, ctx, skills, "skilldesc", "skill", index.skillDescs, optional);
  for (const field of ["srvmissile", "srvmissilea", "srvmissileb", "srvmissilec", "cltmissile", "cltmissilea", "cltmissileb", "cltmissilec", "cltmissiled"]) {
    mustExist(index, ctx, skills, field, "skill", index.missiles, optional);
  }
  validateSkillSummode(index, ctx, skills);

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
          ctx.add(table, 0, 0, `Missing required column "${columnName}".`, {
            d2rMessage: `${table.displayName} - missing column '${columnName}'`
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
      for (const { rowIndex, previousRow, value } of duplicateRowPairs(table, key)) {
        ctx.add(table, rowIndex, key, `Duplicate ${key} "${value}" also appears on row ${previousRow + 1}.`, {
          d2rMessage: `${table.displayName} - duplicate detected on lines ${previousRow + 1} and ${rowIndex + 1} for field '${key}' (${value})`,
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
        ctx.add(table, row.rowIndex, "id", `String "${key}" shares ID "${id}" with string "${found.key}" in ${found.fileName}.`);
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

  for (const table of index.tables) {
    const rules = numericBoundsForProfile(index.profile, table.fileName);
    if (!rules) continue;
    for (const [columnName, [min, max]] of Object.entries(rules)) {
      if (!table.hasColumn(columnName)) continue;
      table.eachRow((row) => {
        if (table.fileName === "monstats.txt" && ["colossal1", "colossal2", "colossal3"].includes(clean(row.get("id")))) return;
        const value = clean(row.get(columnName));
        if (!value) return;
        const number = Number.parseInt(value, 10);
        const label = numericBoundsLabel(table, row);
        if (Number.isNaN(number)) {
          ctx.add(table, row.rowIndex, columnName, `"${columnName}" must be an integer.`, {
            d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${columnName}' is not a number for '${label}'`
          });
          return;
        }
        if (number < min || number > max) {
          ctx.add(table, row.rowIndex, columnName, `"${columnName}" must be between ${formatBound(min)} and ${formatBound(max)}.`, {
            d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${columnName}' is out of range for '${label}', expected number between ${min} and ${max} (inclusive), found ${number}`
          });
        }
      });
    }
  }
}

export function lintBooleanFields(index, ctx) {
  for (const table of index.tables) {
    const fields = BOOLEAN_FIELDS[table.fileName] ?? [];
    for (const columnName of fields) {
      if (!table.hasColumn(columnName)) continue;
      table.eachRow((row) => {
        const value = clean(row.get(columnName));
        if (value && value !== "0" && value !== "1") ctx.add(table, row.rowIndex, columnName, `"${columnName}" must be 0 or 1.`);
      });
    }
  }
}

function mustExist(index, ctx, table, fieldName, labelColumn, targetValues, options = {}) {
  if (!table?.hasColumn(fieldName) || !table.hasColumn(labelColumn)) return;
  if (!(targetValues instanceof Set) || targetValues.size === 0) return;
  const allowNull = options.allowNull === true;
  const nullChecker = options.nullChecker ?? ((value) => clean(value) === "" || value === undefined);
  const normalizeReference = options.caseSensitive ? clean : normalizeToken;
  table.eachRow((row) => {
    const label = clean(row.get(labelColumn));
    if (!label || label === "Expansion" || label === "*end*  do not remove" || label.startsWith("@")) return;
    const value = clean(row.get(fieldName));
    if (allowNull && nullChecker(value)) return;
    if (!targetValues.has(normalizeReference(value))) {
      ctx.add(table, row.rowIndex, fieldName, `${fieldName} "${value}" not found for "${label}".`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${fieldName} '${value}' not found for '${label}'`
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
      ctx.add(table, row.rowIndex, fieldName, `${fieldName} is blank but required for "${label}".`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${fieldName} for '${label}' is blank but required`
      });
    }
  });
}

function validateSkillSummode(index, ctx, table) {
  if (!table?.hasColumn("summon") || !table.hasColumn("summode") || !table.hasColumn("skill")) return;
  if (!(index.monModes instanceof Set) || index.monModes.size === 0) return;
  table.eachRow((row) => {
    const summon = clean(row.get("summon"));
    if (!summon) return;
    const summode = clean(row.get("summode"));
    const skill = clean(row.get("skill"));
    if (!index.monModes.has(normalizeToken(summode))) {
      ctx.add(table, row.rowIndex, "summode", `Invalid summode "${summode}" for "${skill}".`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid summode '${summode}' for '${skill}'`
      });
    }
  });
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
    ctx.add(table, row.rowIndex, versionColumn, `Invalid version "${version}" for "${label}".`, {
      d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: invalid 'version' (${version}) for '${label}'`
    });
  });
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

function formatBound(value) {
  if (value === Number.NEGATIVE_INFINITY) return "-infinity";
  if (value === Number.POSITIVE_INFINITY) return "infinity";
  return String(value);
}
