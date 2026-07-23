import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { asciiCaseInsensitiveValues, asciiLower, exactOuterUnquote, fitsFixed4cc, fixed4ccValues, fixed4Key, referenceTable } from "./lint-reference-semantics.js";
import { clean } from "./lint-table.js";
import { legacyMessage, legacyTerm } from "./legacy-lint-i18n.js";

const TREASURE_MODIFIERS = new Set(["mul", "cu", "cs", "cr", "cm", "ce", "cg", "ma", "mg"]);

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const TREASURE_LINT_RULES = [
  rule("TC/ValidTreasure", lintTreasureReferences, true, PROFILE_OPTIONS),
  rule("TC/ValidNegativePicks", lintTreasureNegativePicks, true, PROFILE_OPTIONS),
  rule("TC/ValidProbs", lintTreasureProbabilities, true, PROFILE_OPTIONS)
];

export function lintTreasureReferences(index, ctx) {
  const table = index.tablesByName.get("treasureclassex.txt");
  if (!table) return;
  const itemCodes = index.itemCodesFixed4 instanceof Set
    ? index.itemCodesFixed4
    : fixed4ccValues(index, ["armor.txt", "misc.txt", "weapons.txt"], "code");
  const uniqueItems = asciiCaseInsensitiveValues(index, ["uniqueitems.txt"], "index");
  const setItems = asciiCaseInsensitiveValues(index, ["setitems.txt"], "index");
  // The Item# callback does not query ItemTypes directly. A prior loader stage
  // populates the named-TC map with this finite equipment-TC family; model that
  // map population separately so arbitrary `prefix + digits` values are not
  // accepted as generated classes.
  const generatedTreasureClasses = generatedTreasureClassNames(index);
  const hasReferences = [
    ["armor.txt", "code"],
    ["misc.txt", "code"],
    ["weapons.txt", "code"],
    ["uniqueitems.txt", "index"],
    ["setitems.txt", "index"],
    ["itemtypes.txt", "code"],
    ["itemtypes.txt", "treasureclass"]
  ].every(([fileName, columnName]) => referenceTable(index, fileName)?.hasColumn(columnName));
  const availableTreasureClasses = new Set();
  table.eachRow((row) => {
    const className = String(row.get("treasure class") ?? "");
    if (className) availableTreasureClasses.add(asciiLower(className));
    for (let indexNo = 1; indexNo <= 10; indexNo += 1) {
      const columnName = `item${indexNo}`;
      if (!table.hasColumn(columnName)) break;
      const value = String(row.get(columnName) ?? "");
      const parsed = parseTreasureItem(value);
      if (!parsed.base) break;
      if (!hasReferences) continue;
      const named = asciiLower(parsed.base);
      const valid = (fitsFixed4cc(parsed.base) && itemCodes.has(fixed4Key(parsed.base)))
        || generatedTreasureClasses.has(named)
        || availableTreasureClasses.has(named)
        || uniqueItems.has(named)
        || setItems.has(named);
      if (!valid) {
        ctx.add(table, row.rowIndex, columnName, legacyMessage("treasure.unknownReference", {
          value,
          className: className || legacyTerm("treasureClass")
        }), {
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: can't find '${parsed.base}' for '${columnName}' in TC '${className}'`
        });
        continue;
      }
      validateTreasureModifier(ctx, table, row.rowIndex, columnName, parsed, className);
      validateTreasureFieldWidth(ctx, table, row.rowIndex, columnName, parsed, className);
    }
  });
}

export function lintTreasureNegativePicks(index, ctx) {
  const table = index.tablesByName.get("treasureclassex.txt");
  if (!table) return;
  table.eachRow((row) => {
    const picks = clean(row.get("picks"));
    if (!picks || !isIntegerText(picks) || Number(picks) >= 0) return;
    for (let indexNo = 1; indexNo <= 10; indexNo += 1) {
      const columnName = `prob${indexNo}`;
      if (!table.hasColumn(columnName)) continue;
      const value = clean(row.get(columnName));
      if (!value) continue;
      if (!isIntegerText(value)) {
        ctx.add(table, row.rowIndex, columnName, legacyMessage("treasure.negativePickProbability", { column: columnName }));
      }
    }
  });
}

export function lintTreasureProbabilities(index, ctx) {
  const table = index.tablesByName.get("treasureclassex.txt");
  if (!table) return;
  table.eachRow((row) => {
    let terminated = false;
    for (let indexNo = 1; indexNo <= 10; indexNo += 1) {
      const itemColumn = `item${indexNo}`;
      const probColumn = `prob${indexNo}`;
      if (!table.hasColumn(itemColumn)) {
        terminated = true;
        continue;
      }
      const item = String(row.get(itemColumn) ?? "");
      const hasProbabilityColumn = table.hasColumn(probColumn);
      const probability = hasProbabilityColumn ? clean(row.get(probColumn)) : "";
      const itemPresent = exactOuterUnquote(item) !== "";
      if (terminated) {
        if (itemPresent) {
          ctx.add(table, row.rowIndex, itemColumn, legacyMessage("treasure.ignoredAfterEmptyItem", { column: itemColumn }), {
            severity: "warning",
            d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${itemColumn}' is ignored after the first empty Item slot.`
          });
        }
        if (hasProbabilityColumn && probability) {
          ctx.add(table, row.rowIndex, probColumn, legacyMessage("treasure.ignoredAfterEmptyItem", { column: probColumn }), {
            severity: "warning",
            d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${probColumn}' is ignored after the first empty Item slot.`
          });
        }
        continue;
      }
      if (!itemPresent) {
        terminated = true;
        if (hasProbabilityColumn && probability) {
          ctx.add(table, row.rowIndex, probColumn, legacyMessage("treasure.orphanProbability", { column: probColumn, itemColumn }), {
            severity: "warning",
            d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${probColumn}' is ignored because '${itemColumn}' is empty.`
          });
        }
        continue;
      }
      if (!hasProbabilityColumn) {
        continue;
      }
      if (!probability) {
        ctx.add(table, row.rowIndex, probColumn, legacyMessage("treasure.blankProbability", { column: probColumn }), {
          severity: "warning",
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: This Treasure Class entry is skipped because '${probColumn}' is blank ('${itemColumn}').`
        });
      } else if (!isIntegerText(probability)) {
        ctx.add(table, row.rowIndex, probColumn, legacyMessage("treasure.nonIntegerProbability", { column: probColumn }), {
          severity: "warning",
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: '${probColumn}' is not a whole number and may cause '${itemColumn}' to be skipped.`
        });
      } else if (Number(probability) <= 0) {
        ctx.add(table, row.rowIndex, probColumn, legacyMessage("treasure.nonPositiveProbability", { column: probColumn }), {
          severity: "warning",
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: This Treasure Class entry is skipped because '${probColumn}' is ${probability} ('${itemColumn}').`
        });
      }
    }
  });
}

function parseTreasureItem(value) {
  const raw = String(value ?? "");
  const formula = exactOuterUnquote(raw);
  const parts = formula.split(",");
  const base = parts[0] ?? "";
  const modifiers = [];
  let ignoredSuffix = null;
  for (let index = 1; index < parts.length; index += 1) {
    const token = parts[index];
    const equals = token.indexOf("=");
    const name = equals >= 0 ? token.slice(0, equals) : token;
    const parameter = equals >= 0 ? token.slice(equals + 1) : "";
    if (!TREASURE_MODIFIERS.has(name) || equals < 0 || parameter === "") {
      ignoredSuffix = parts.slice(index).join(",");
      break;
    }
    modifiers.push({ raw: token, name, parameter });
  }
  return { raw, formula, base, modifiers, ignoredSuffix };
}

function validateTreasureModifier(ctx, table, rowIndex, columnName, parsed, className) {
  for (const modifier of parsed.modifiers) {
    if (/^[0-9]+$/.test(modifier.parameter) && BigInt(modifier.parameter) <= 65535n) continue;
    const numeric = /^-?\d+$/.test(modifier.parameter) ? BigInt(modifier.parameter) : 0n;
    const wrapped = numeric % 65536n;
    const stored = Number(wrapped < 0n ? wrapped + 65536n : wrapped);
    ctx.add(table, rowIndex, columnName, legacyMessage("treasure.modifierRange", { modifier: modifier.raw, stored }), {
      severity: "warning",
      d2rMessage: `${table.displayName}, line ${rowIndex + 1}: Modifier '${modifier.raw}' for '${columnName}' in TC '${className}' is outside 0..65535. The game converts it to ${stored}. Replace it with the number you actually want.`
    });
  }
  if (parsed.ignoredSuffix !== null) {
    const stoppedAt = parsed.ignoredSuffix.split(",")[0] || "(empty modifier)";
    ctx.add(table, rowIndex, columnName, legacyMessage("cube.stopsAfterModifier", { stoppedAt }), {
      severity: "warning",
      d2rMessage: `${table.displayName}, line ${rowIndex + 1}: The game stops at '${stoppedAt}' for '${columnName}' in TC '${className}'. The base and modifiers before it still work; '${stoppedAt}' and everything after it are ignored.`
    });
  }
}

function validateTreasureFieldWidth(ctx, table, rowIndex, columnName, parsed, className) {
  if (new TextEncoder().encode(parsed.raw).length < 64) return;
  ctx.add(table, rowIndex, columnName, legacyMessage("treasure.textTooLong"), {
    severity: "warning",
    d2rMessage: `${table.displayName}, line ${rowIndex + 1}: '${columnName}' in TC '${className}' is too long. Keep it under 64 UTF-8 bytes.`
  });
}

function generatedTreasureClassNames(index) {
  const table = referenceTable(index, "itemtypes.txt");
  const names = new Set();
  if (!table?.hasColumn("code") || !table.hasColumn("treasureclass")) return names;
  table.eachRow((row) => {
    const code = String(row.get("code") ?? "");
    const rawFlag = clean(row.get("treasureclass"));
    if (!code || !/^-?\d+$/.test(rawFlag) || Number(rawFlag) === 0) return;
    for (let level = 3; level <= 96; level += 3) {
      names.add(asciiLower(`${code}${level}`));
    }
  });
  return names;
}

function isIntegerText(value) {
  return /^-?\d+$/.test(clean(value));
}
