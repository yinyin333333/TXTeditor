import { compareDiagnostics, createRuleContext } from "./lint-diagnostics.js";

export function runLintRulesWithWorkspaceIndex(index, settings, { rulesForProfile, rowLabelFor, locale = "enUS" }) {
  if (!settings.enabled) return [];
  const diagnostics = [];
  for (const entry of rulesForProfile(settings.profile, locale)) {
    const ruleSetting = settings.profiles[settings.profile]?.rules?.[entry.id];
    const runner = entry.runner;
    if (!entry.implemented || !ruleSetting?.enabled || !runner) continue;
    const before = diagnostics.length;
    runner(index, createRuleContext({
      ruleId: entry.id,
      severity: ruleSetting.severity,
      diagnostics,
      profile: index.profile,
      rowLabelFor,
      locale
    }));
    labelRuleDiagnostics(diagnostics, before, entry, locale);
  }
  finalizeDiagnostics(diagnostics);
  return diagnostics;
}

export function labelRuleDiagnostics(diagnostics, startIndex, ruleEntry) {
  for (let i = startIndex; i < diagnostics.length; i += 1) {
    diagnostics[i].ruleLabel = ruleEntry.label;
    diagnostics[i].group = ruleEntry.group;
  }
}

export function finalizeDiagnostics(diagnostics) {
  diagnostics.sort(compareDiagnostics);
  diagnostics.forEach((diagnostic) => {
    const identityMessage = diagnostic.messageKey
      ? `${diagnostic.messageKey}:${stableMessageArgs(diagnostic.messageArgs)}`
      : diagnostic.message;
    diagnostic.id = `${diagnostic.profile}:${diagnostic.ruleId}:${diagnostic.fileName}:${diagnostic.rowIndex}:${diagnostic.columnIndex}:${identityMessage}`;
  });
  return diagnostics;
}

function stableMessageArgs(args = {}) {
  return Object.keys(args).sort().map((key) => `${key}=${String(args[key])}`).join("|");
}
