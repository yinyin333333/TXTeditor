import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { referenceTable } from "./lint-reference-semantics.js";
import { clean, rowLabelFor } from "./lint-table.js";
import { legacyMessage } from "./legacy-lint-i18n.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const LEVEL_LINT_RULES = [
  rule("Level/ValidWarp", lintValidWarp, true, PROFILE_OPTIONS),
  rule("Level/ValidWPs", lintValidWaypoints, true, PROFILE_OPTIONS),
];

export function lintValidWarp(index, ctx) {
  const levels = index.tablesByName.get("levels.txt");
  const lvlWarp = referenceTable(index, "lvlwarp.txt");
  if (!levels || !lvlWarp) return;
  const canValidateWarp = lvlWarp.hasColumn("id");
  const warpIds = new Set();
  if (canValidateWarp) lvlWarp.eachRow((row) => {
    const id = integerFromRow(row, "id");
    if (id !== null) warpIds.add(id);
  });
  levels.eachRow((row) => {
    if (clean(row.get("name")) === "Expansion") return;
    for (let slot = 0; slot <= 7; slot += 1) {
      const visColumn = `vis${slot}`;
      const warpColumn = `warp${slot}`;
      if (!levels.hasColumn(visColumn)) continue;
      const vis = integerFromRow(row, visColumn);
      const warpRaw = levels.hasColumn(warpColumn) ? clean(row.get(warpColumn)) : "0";
      const warp = warpRaw ? integerValue(warpRaw) : 0;
      if (vis === null || vis <= 0) continue;
      if (vis >= levels.rows.length - 1) {
        ctx.add(levels, row.rowIndex, visColumn, legacyMessage("level.missingVis", { column: visColumn, vis }), {
          d2rMessage: `${levels.displayName}, line ${row.rowIndex + 1}: invalid ${visColumn} for level '${clean(row.get("name"))}'`
        });
      }
      if (canValidateWarp && (warp === null || (warp >= 0 && !warpIds.has(warp)))) {
        ctx.add(levels, row.rowIndex, warpColumn, legacyMessage("level.missingWarp", { column: warpColumn }), {
          d2rMessage: `${levels.displayName}, line ${row.rowIndex + 1}: invalid ${warpColumn} for level '${clean(row.get("name"))}'`
        });
      }
    }
  });
}

export function lintValidWaypoints(index, ctx) {
  const table = index.tablesByName.get("levels.txt");
  if (!table?.hasColumn("waypoint")) return;
  const seen = new Map();
  table.eachRow((row) => {
    const rawWaypoint = clean(row.get("waypoint"));
    if (!rawWaypoint) return;
    const waypoint = storedUnsignedByte(rawWaypoint);
    if (waypoint === null || waypoint === 255) return;
    if (seen.has(waypoint)) {
      ctx.add(table, row.rowIndex, "waypoint", legacyMessage("level.duplicateWaypoint", { waypoint, label: seen.get(waypoint).label }), {
        d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: waypoint ${waypoint} is already used by '${seen.get(waypoint).label}'. Choose a unique number.`
      });
    } else {
      seen.set(waypoint, { label: rowLabelFor(table, row.rowIndex) });
    }
  });
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

function isIntegerText(value) {
  return /^-?\d+$/.test(clean(value));
}

function storedUnsignedByte(value) {
  const text = clean(value);
  if (!isIntegerText(text)) return null;
  const wrapped = BigInt(text) % 256n;
  return Number(wrapped < 0n ? wrapped + 256n : wrapped);
}
