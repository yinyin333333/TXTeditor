import { PROFILE_OPTIONS, rule } from "./lint-rule-registry.js";
import { clean, normalizeHeader, normalizeToken } from "./lint-table.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const MONSTER_LINT_RULES = [
  rule("Monsters/ValidChains", "Valid monster chains", lintMonsterChains, true, PROFILE_OPTIONS, "Checks monstats.txt baseid and nextinclass chains so non-boss monster variants link in the expected order.")
];

export const SKILL_LINT_RULES = [
  rule("Skills/EqualSkills", "Equal skills", lintEqualSkills, true, PROFILE_OPTIONS, "Checks that each player class has the same number of skills in skills.txt.")
];

export const STRING_LINT_RULES = [
  rule("String/NoUntranslated", "No untranslated strings", lintNoUntranslatedStrings, true, PROFILE_OPTIONS, "Checks string tables for missing language translations on rows with a string key.")
];

export function lintMonsterChains(index, ctx) {
  const table = index.tablesByName.get("monstats.txt");
  if (!table?.hasColumn("id") || !table.hasColumn("baseid") || !table.hasColumn("nextinclass")) return;
  const chains = [];
  table.eachRow((row) => {
    const boss = clean(row.get("boss"));
    const primeevil = clean(row.get("primeevil"));
    if (boss && boss !== "0" || primeevil && primeevil !== "0") return;
    const baseId = clean(row.get("baseid"));
    const id = clean(row.get("id"));
    const nextInChain = clean(row.get("nextinclass"));
    const foundIndex = chains.findIndex((chain) => chain.baseId === baseId);
    if (foundIndex < 0) {
      chains.push({ baseId, id, nextInChain, rowIndex: row.rowIndex });
      return;
    }
    const found = chains[foundIndex];
    if (found.nextInChain !== id) {
      ctx.add(table, found.rowIndex, "nextinclass", `Broken baseId chain "${baseId}".`, {
        d2rMessage: `${table.displayName}, line ${found.rowIndex + 1}: broken baseId chain '${baseId}', nextInClass for '${found.id}' should point to '${id}' but it points to '${found.nextInChain}' instead`
      });
    }
    chains.splice(foundIndex, 1, { baseId, id, nextInChain, rowIndex: row.rowIndex });
  });
  for (const chain of chains) {
    if (!chain.nextInChain) continue;
    ctx.add(table, chain.rowIndex, "nextinclass", `nextInClass for "${chain.id}" (${chain.nextInChain}) does not exist.`, {
      d2rMessage: `${table.displayName}, line ${chain.rowIndex + 1}: nextInClass for '${chain.id}' (${chain.nextInChain}) doesn't exist.`
    });
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
    if (count !== expected) ctx.add(playerClass, row.rowIndex, "code", `Player class "${clean(row.get("code"))}" has ${count} skills; expected ${expected} to match the other classes.`);
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
        if (!clean(row.get(columnName))) ctx.add(table, row.rowIndex, columnName, `String "${key}" is missing a ${columnName} translation.`);
      }
    });
  }
}

function isStringLikeTable(table) {
  return table?.hasColumn("id") && table.hasColumn("key");
}
