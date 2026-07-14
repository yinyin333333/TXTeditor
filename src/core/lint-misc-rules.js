import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { clean, normalizeHeader, normalizeToken } from "./lint-table.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const MONSTER_LINT_RULES = [
  rule("Monsters/ValidChains", "Valid monster chains", lintMonsterChains, true, PROFILE_OPTIONS, "Checks exact monstats.txt BaseId and NextInClass references and follows their resolved graph without relying on physical row order.")
];

export const SKILL_LINT_RULES = [
  rule("Skills/EqualSkills", "Equal skills", lintEqualSkills, true, PROFILE_OPTIONS, "Checks whether a class has fewer skill entries than the largest class. Equal counts are not required by the game.")
];

export const STRING_LINT_RULES = [
  rule("String/NoUntranslated", "No untranslated strings", lintNoUntranslatedStrings, true, PROFILE_OPTIONS, "Checks for blank translations and asks you to add the intended text.")
];

export function lintMonsterChains(index, ctx) {
  const table = index.tablesByName.get("monstats.txt");
  if (!table?.hasColumn("id") || !table.hasColumn("baseid") || !table.hasColumn("nextinclass")) return;
  const entries = [];
  const entriesById = new Map();
  table.eachRow((row) => {
    const id = clean(row.get("id"));
    if (!id) return;
    const entry = {
      id,
      baseId: clean(row.get("baseid")),
      nextInClass: clean(row.get("nextinclass")),
      rowIndex: row.rowIndex
    };
    entries.push(entry);
    const matches = entriesById.get(id);
    if (matches) {
      matches.push(entry);
    } else {
      entriesById.set(id, [entry]);
    }
  });

  const traversalStarts = new Map();
  for (const entry of entries) {
    if (entry.baseId) {
      const baseMatches = entriesById.get(entry.baseId);
      if (!baseMatches) {
        ctx.add(table, entry.rowIndex, "baseid", `baseId "${entry.baseId}" does not exist for "${entry.id}".`, {
          d2rMessage: `${table.displayName}, line ${entry.rowIndex + 1}: baseId '${entry.baseId}' doesn't exist for '${entry.id}'.`
        });
      } else if (baseMatches.length === 1) {
        traversalStarts.set(entry.baseId, baseMatches[0]);
      }
    }
    if (entry.nextInClass && !entriesById.has(entry.nextInClass)) {
      ctx.add(table, entry.rowIndex, "nextinclass", `nextInClass for "${entry.id}" (${entry.nextInClass}) does not exist.`, {
        d2rMessage: `${table.displayName}, line ${entry.rowIndex + 1}: nextInClass for '${entry.id}' (${entry.nextInClass}) doesn't exist.`
      });
    }
  }

  const maximumHops = 255;
  const reportedCycles = new Set();
  for (const start of traversalStarts.values()) {
    const path = [];
    const positions = new Map();
    let current = start;
    let hops = 0;
    while (current) {
      positions.set(current.id, path.length);
      path.push(current);
      if (!current.nextInClass) break;
      const nextMatches = entriesById.get(current.nextInClass);
      if (!nextMatches || nextMatches.length !== 1) break;
      const next = nextMatches[0];
      const nextHop = hops + 1;
      if (nextHop > maximumHops) {
        const nodeCount = nextHop + 1;
        const message = `nextInClass chain from "${start.id}" exceeds ${maximumHops} hops: "${current.id}" -> "${next.id}" reaches hop ${nextHop} (node ${nodeCount}).`;
        ctx.add(table, current.rowIndex, "nextinclass", message, {
          d2rMessage: `${table.displayName}, line ${current.rowIndex + 1}: nextInClass chain from '${start.id}' exceeds ${maximumHops} hops; '${current.id}' -> '${next.id}' reaches hop ${nextHop} (node ${nodeCount}).`
        });
        break;
      }
      const cycleStart = positions.get(next.id);
      if (cycleStart !== undefined) {
        const cycle = path.slice(cycleStart);
        const cycleKey = cycle.map((entry) => entry.rowIndex).sort((left, right) => left - right).join(":");
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          const labels = [...cycle.map((entry) => entry.id), next.id];
          const chain = labels.map((label) => `"${label}"`).join(" -> ");
          const hopLabel = nextHop === 1 ? "hop" : "hops";
          ctx.add(table, current.rowIndex, "nextinclass", `nextInClass cycle detected after ${nextHop} ${hopLabel} from "${start.id}": ${chain}.`, {
            d2rMessage: `${table.displayName}, line ${current.rowIndex + 1}: nextInClass cycle detected after ${nextHop} ${hopLabel} from '${start.id}': ${labels.map((label) => `'${label}'`).join(" -> ")}.`
          });
        }
        break;
      }
      hops = nextHop;
      current = next;
    }
  }
}

export function lintEqualSkills(index, ctx) {
  const skills = index.tablesByName.get("skills.txt");
  const playerClass = index.tablesByName.get("playerclass.txt");
  if (!skills?.hasColumn("charclass") || !playerClass?.hasColumn("code")) return;
  const counts = new Map();
  skills.eachRow((row) => {
    const code = normalizeToken(row.get("charclass"));
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  });
  const expected = Math.max(...counts.values(), 0);
  playerClass.eachRow((row) => {
    const code = normalizeToken(row.get("code"));
    if (!code) return;
    const count = counts.get(code) ?? 0;
    if (count !== expected) {
      const message = `This class has ${count} skills while the largest class has ${expected}. Check whether entries are missing; equal counts are not required by the game.`;
      ctx.add(playerClass, row.rowIndex, "code", message, {
        severity: "warning",
        d2rMessage: `${playerClass.displayName}, line ${row.rowIndex + 1}: ${message}`
      });
    }
  });
}

export function lintNoUntranslatedStrings(index, ctx) {
  const languageColumns = ["enus", "eng", "dede", "frfr", "eses", "itit", "plpl", "ruru", "kokr", "zhcn", "zhtw"];
  for (const table of index.tables.filter(isStringLikeTable)) {
    const presentLanguages = table.headers.filter((header) => languageColumns.includes(normalizeHeader(header)));
    if (!presentLanguages.length) continue;
    table.eachRow((row) => {
      const key = clean(row.get("key")) || clean(row.get("Key")) || clean(row.get("id"));
      if (!key) return;
      for (const columnName of presentLanguages) {
        if (!clean(row.get(columnName))) {
          const message = `Translation for "${key}" is blank in column ${columnName}. Add the intended text.`;
          ctx.add(table, row.rowIndex, columnName, message, {
            severity: "warning",
            d2rMessage: `${table.displayName}, line ${row.rowIndex + 1}: ${message}`
          });
        }
      }
    });
  }
}

function isStringLikeTable(table) {
  return table?.hasColumn("id") && table.hasColumn("key");
}
