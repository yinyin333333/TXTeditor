import { diagnosticsForDocument, groupDiagnosticsByCell } from "./lint-diagnostics.js";
import { basicLintRules } from "./lint-basic-rules.js";
import { CUBE_LINT_RULES } from "./lint-cube-rules.js";
import { ITEM_LINT_RULES } from "./lint-item-rules.js";
import { LEVEL_LINT_RULES } from "./lint-level-rules.js";
import { MONSTER_LINT_RULES, SKILL_LINT_RULES, STRING_LINT_RULES } from "./lint-misc-rules.js";
import { TREASURE_LINT_RULES } from "./lint-treasure-rules.js";
import { baseName, documentKey, normalizePath } from "./lint-paths.js";
import {
  PROFILE_OPTIONS,
  createDefaultLintSettingsForRules,
  flattenRuleGroups,
  normalizeLintSettingsForRules,
  ruleGroupsForProfile,
  rulesForProfileFromRules
} from "./lint-rule-registry.js";
import { runLintRulesWithWorkspaceIndex } from "./lint-runner.js";
import {
  clean,
  normalizeHeader,
  normalizeToken,
  rowLabelFor,
  uniqueDocuments
} from "./lint-table.js";
import { buildWorkspaceFileStates, buildWorkspaceIndex } from "./lint-workspace-index.js";

export { diagnosticsForDocument, groupDiagnosticsByCell };
export { baseName as lintBaseName, documentKey as lintDocumentKey, normalizePath as lintNormalizePath };
export { clean as lintClean, normalizeHeader as lintNormalizeHeader, normalizeToken as lintNormalizeToken };
export { buildWorkspaceFileStates, buildWorkspaceIndex };
export { DEFAULT_PROFILE as LINT_DEFAULT_PROFILE, PROFILE_OPTIONS as LINT_PROFILE_OPTIONS } from "./lint-rule-registry.js";

// D2R lint rule behavior is ported/adapted from d2rlint by eezstreet (GPLv3).
export const LINT_RULE_GROUPS = [
  {
    group: "Basic",
    rules: basicLintRules()
  },
  { group: "Cube", rules: CUBE_LINT_RULES },
  { group: "Items", rules: ITEM_LINT_RULES },
  { group: "Level", rules: LEVEL_LINT_RULES },
  { group: "Monsters", rules: MONSTER_LINT_RULES },
  { group: "Skills", rules: SKILL_LINT_RULES },
  { group: "String", rules: STRING_LINT_RULES },
  { group: "TC", rules: TREASURE_LINT_RULES }
];

export const LINT_RULES = flattenRuleGroups(LINT_RULE_GROUPS);

export function createDefaultLintSettings() {
  return createDefaultLintSettingsForRules(LINT_RULES);
}

export function normalizeLintSettings(value = {}) {
  return normalizeLintSettingsForRules(LINT_RULES, value);
}

export function lintProfileOptions() {
  return [...PROFILE_OPTIONS];
}

export function rulesForProfile(profile) {
  return rulesForProfileFromRules(LINT_RULES, profile);
}

export function lintRuleGroupsForProfile(profile) {
  return ruleGroupsForProfile(LINT_RULE_GROUPS, LINT_RULES, profile);
}

export function runLint(documents, settings = createDefaultLintSettings()) {
  const normalized = normalizeLintSettings(settings);
  if (!normalized.enabled) return [];
  const docs = uniqueDocuments(documents);
  const index = buildWorkspaceIndex(docs, normalized.profile);
  return runLintWithWorkspaceIndex(index, normalized);
}

export function runLintWithWorkspaceIndex(index, settings = createDefaultLintSettings()) {
  const normalized = normalizeLintSettings(settings);
  return runLintRulesWithWorkspaceIndex(index, normalized, { rulesForProfile, rowLabelFor });
}
