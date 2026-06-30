import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { clean, normalizeToken } from "./lint-table.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const TREASURE_LINT_RULES = [
  rule("TC/ValidTreasure", "Valid treasure references", lintTreasureReferences, true, PROFILE_OPTIONS, "Checks treasureclassex.txt item entries against item codes, item types, set items, unique items, and treasure classes."),
  rule("TC/ValidNegativePicks", "Valid negative picks", lintTreasureNegativePicks, true, PROFILE_OPTIONS, "Checks that negative picks values match the total probability sum for the treasure class row."),
  rule("TC/ValidProbs", "Valid probabilities", lintTreasureProbabilities, true, PROFILE_OPTIONS, "Checks that each treasure class item entry has a numeric probability value.")
];

export function lintTreasureReferences(index, ctx) {
  const table = index.tablesByName.get("treasureclassex.txt");
  if (!table) return;
  table.eachRow((row) => {
    const className = clean(row.get("treasure class"));
    for (let indexNo = 1; indexNo <= 10; indexNo += 1) {
      const columnName = `item${indexNo}`;
      if (!table.hasColumn(columnName)) continue;
      const value = clean(row.get(columnName));
      const tokenValue = treasureFormulaItem(value);
      if (!tokenValue || isAutoTreasureClass(tokenValue) || normalizeToken(tokenValue) === "gld") continue;
      if (!index.hasWorkspace) continue;
      const token = normalizeToken(tokenValue);
      const valid = index.itemCodes.has(token) || index.itemTypes.has(token) || index.setItems.has(token) || index.uniqueItems.has(token) || index.treasureClasses.has(token);
      if (!valid) {
        ctx.add(table, row.rowIndex, columnName, `Unknown treasure reference "${value}" in ${className || "Treasure Class"}.`, {
          d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: can't find '${tokenValue}' for '${columnName}' in TC '${className}'`
        });
      }
    }
  });
}

export function lintTreasureNegativePicks(index, ctx) {
  const table = index.tablesByName.get("treasureclassex.txt");
  if (!table) return;
  table.eachRow((row) => {
    const picks = clean(row.get("picks"));
    if (!picks || !isIntegerText(picks) || Number(picks) >= 0) return;
    let total = 0;
    for (let indexNo = 1; indexNo <= 10; indexNo += 1) {
      const columnName = `prob${indexNo}`;
      if (!table.hasColumn(columnName)) continue;
      const value = clean(row.get(columnName));
      if (!value) continue;
      if (!isIntegerText(value)) {
        ctx.add(table, row.rowIndex, columnName, `Probability ${columnName} must be numeric when picks is negative.`);
      } else {
        total += Number(value);
      }
    }
    if (Math.abs(Number(picks)) !== total) {
      ctx.add(table, row.rowIndex, "picks", `Negative picks expects probability total ${Math.abs(Number(picks))}, but found ${total}.`, {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: 'picks' (${Number(picks)}) doesn't match negative sum of probs (${-total}) for '${clean(row.get("treasure class"))}'`
      });
    }
  });
}

export function lintTreasureProbabilities(index, ctx) {
  const table = index.tablesByName.get("treasureclassex.txt");
  if (!table) return;
  table.eachRow((row) => {
    for (let indexNo = 1; indexNo <= 10; indexNo += 1) {
      const itemColumn = `item${indexNo}`;
      const probColumn = `prob${indexNo}`;
      if (!table.hasColumn(itemColumn) || !table.hasColumn(probColumn)) continue;
      const item = clean(row.get(itemColumn));
      const probability = clean(row.get(probColumn));
      if (item && !probability) ctx.add(table, row.rowIndex, probColumn, `${probColumn} is required when ${itemColumn} is set.`);
      if (probability && !isIntegerText(probability)) ctx.add(table, row.rowIndex, probColumn, `${probColumn} must be numeric.`);
    }
  });
}

function treasureFormulaItem(value) {
  const raw = clean(value);
  const quoted = raw.match(/"(.+)"/);
  const formula = quoted ? quoted[1] : raw;
  return clean(formula.split(",")[0]);
}

function isAutoTreasureClass(value) {
  const token = normalizeToken(value);
  return /^Act\s+\d+\s+/.test(value) || /^Act\s+\d+\s*\(/.test(value) || /^(armo|weap|junk|good|mele|bow|misc|armo|weap)\d+$/.test(token) || /^gld,mul=\d+$/.test(token);
}

function isIntegerText(value) {
  return /^-?\d+$/.test(clean(value));
}
