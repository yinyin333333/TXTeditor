import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { clean, rowLabelFor } from "./lint-table.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const LEVEL_LINT_RULES = [
  rule("Level/ValidWarp", "Valid warps", lintValidWarp, true, PROFILE_OPTIONS, "Checks levels.txt vis and warp links for valid targets, valid lvlwarp rows, and matching backlink connections."),
  rule("Level/ValidWPs", "Valid waypoints", lintValidWaypoints, true, PROFILE_OPTIONS, "Checks that waypoint IDs in levels.txt are not reused by multiple levels.")
];

export function lintValidWarp(index, ctx) {
  const levels = index.tablesByName.get("levels.txt");
  const lvlWarp = index.tablesByName.get("lvlwarp.txt");
  if (!levels || !lvlWarp) return;
  levels.eachRow((row) => {
    if (clean(row.get("name")) === "Expansion") return;
    const id = integerFromRow(row, "id");
    const line = row.rowIndex - 1;
    for (let slot = 0; slot <= 7; slot += 1) {
      const visColumn = `vis${slot}`;
      const warpColumn = `warp${slot}`;
      if (!levels.hasColumn(visColumn)) continue;
      const vis = integerFromRow(row, visColumn);
      const warp = levels.hasColumn(warpColumn) ? integerFromRow(row, warpColumn) : 0;
      if (vis === null || vis <= 0) continue;
      if (isHardcodedWarpException(id, warpColumn)) continue;
      if (vis >= levels.rows.length - 1) {
        ctx.add(levels, row.rowIndex, visColumn, `${visColumn} points to missing level index ${vis}.`, {
          d2rMessage: `${levels.displayName}, line ${row.rowIndex + 1}: invalid ${visColumn} for level '${clean(row.get("name"))}'`
        });
      }
      if (warp !== null && (warp < 0 || warp >= lvlWarp.rows.length - 1)) {
        ctx.add(levels, row.rowIndex, warpColumn, `${warpColumn} points outside lvlwarp.txt.`, {
          d2rMessage: `${levels.displayName}, line ${row.rowIndex + 1}: invalid ${warpColumn} for level '${clean(row.get("name"))}'`
        });
      }
      if (clean(row.get("act")) === "4") continue;
      const targetRow = levels.rows[vis + 1];
      if (!targetRow) {
        ctx.add(levels, row.rowIndex, visColumn, `Invalid level index ${vis}.`, {
          d2rMessage: `${levels.displayName}, line ${row.rowIndex + 1}: invalid level '${vis}' for level '${clean(row.get("name"))}'`
        });
        continue;
      }
      const target = {
        table: levels,
        rowIndex: vis + 1,
        get: (columnName) => levels.rows[vis + 1]?.[levels.columnIndex(columnName)] ?? ""
      };
      const backlink = Array.from({ length: 8 }, (_, backlinkSlot) => `vis${backlinkSlot}`).some((columnName) => levels.hasColumn(columnName) && clean(target.get(columnName)) === String(line));
      if (!backlink) {
        ctx.add(levels, row.rowIndex, visColumn, `Target level ${vis} does not link back to ${line}.`, {
          d2rMessage: `${levels.displayName}, line ${row.rowIndex + 1}: level '${clean(target.get("name"))}' doesn't have a vis field pointing at us for level '${clean(row.get("name"))}'`
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
    const waypoint = clean(row.get("waypoint"));
    if (!waypoint || waypoint === "255") return;
    if (seen.has(waypoint)) {
      ctx.add(table, row.rowIndex, "waypoint", `Waypoint ${waypoint} is also used by ${seen.get(waypoint).label}.`);
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

function isHardcodedWarpException(id, warpColumn) {
  return (id === 26 && warpColumn === "warp1") ||
    (id === 27 && warpColumn === "warp0") ||
    (id === 27 && warpColumn === "warp1") ||
    (id === 28 && warpColumn === "warp0") ||
    (id === 32 && warpColumn === "warp1") ||
    (id === 33 && warpColumn === "warp0") ||
    (id === 107 && warpColumn === "warp1") ||
    (id === 108 && warpColumn === "warp0");
}

function isIntegerText(value) {
  return /^-?\d+$/.test(clean(value));
}
