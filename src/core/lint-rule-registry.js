export const PROFILE_OPTIONS = ["RotW", "2.4"];
export const DEFAULT_PROFILE = "RotW";
import { tTextOr } from "./i18n.js";
import { legacyRuleGroupLabel, legacyRuleMetadata, normalizeLegacyLintLocale } from "./legacy-lint-i18n.js";

export function rule(id, label, runner, defaultEnabled = true, profiles = PROFILE_OPTIONS, note = "") {
  if (typeof label === "function") {
    note = profiles ?? "";
    profiles = defaultEnabled ?? PROFILE_OPTIONS;
    defaultEnabled = runner ?? true;
    runner = label;
    ({ label, note } = legacyRuleMetadata(id));
  }
  return {
    id,
    label,
    implemented: typeof runner === "function",
    defaultEnabled,
    profiles,
    runner,
    note
  };
}

export function flattenRuleGroups(ruleGroups) {
  return ruleGroups.flatMap((group) =>
    group.rules.map((entry) => ({ ...entry, group: group.group }))
  );
}

export function rulesForProfileFromRules(rules, profile) {
  const normalized = PROFILE_OPTIONS.includes(profile) ? profile : DEFAULT_PROFILE;
  return rules.filter((entry) => entry.profiles.includes(normalized));
}

export function ruleGroupsForProfile(ruleGroups, rules, profile, locale) {
  const normalizedLocale = normalizeLegacyLintLocale(locale);
  const profileRules = rulesForProfileFromRules(rules, profile);
  return ruleGroups.map((group) => ({
    group: legacyRuleGroupLabel(group.group, normalizedLocale),
    rules: profileRules.filter((entry) => entry.group === group.group).map((entry) => ({
      ...entry,
      label: legacyRuleMetadata(entry.id, normalizedLocale).label || tTextOr(`lint.rule.${entry.id}.label`, entry.label),
      note: legacyRuleMetadata(entry.id, normalizedLocale).note || (entry.note ? tTextOr(`lint.rule.${entry.id}.note`, entry.note) : "")
    }))
  })).filter((group) => group.rules.length);
}

export function createDefaultLintSettingsForRules(rules) {
  return {
    enabled: true,
    profile: DEFAULT_PROFILE,
    profiles: Object.fromEntries(PROFILE_OPTIONS.map((profile) => [profile, createDefaultProfileSettings(rules, profile)]))
  };
}

export function normalizeLintSettingsForRules(rules, value = {}) {
  const defaults = createDefaultLintSettingsForRules(rules);
  const profile = PROFILE_OPTIONS.includes(value.profile) ? value.profile : defaults.profile;
  const profiles = {};
  for (const profileOption of PROFILE_OPTIONS) {
    profiles[profileOption] = { rules: {} };
    for (const entry of rulesForProfileFromRules(rules, profileOption)) {
      const current = value.profiles?.[profileOption]?.rules?.[entry.id] ?? value.rules?.[entry.id] ?? {};
      const defaultRule = defaults.profiles[profileOption].rules[entry.id];
      profiles[profileOption].rules[entry.id] = {
        enabled: Boolean(entry.implemented && (current.enabled ?? defaultRule.enabled)),
        severity: ["error", "warning", "info"].includes(current.severity) ? current.severity : defaultRule.severity
      };
    }
  }
  return {
    enabled: value.enabled !== false,
    profile,
    profiles
  };
}

function createDefaultProfileSettings(rules, profile) {
  return {
    rules: Object.fromEntries(rulesForProfileFromRules(rules, profile).map((entry) => [
      entry.id,
      {
        enabled: Boolean(entry.implemented && entry.defaultEnabled),
        severity: "warning"
      }
    ]))
  };
}
