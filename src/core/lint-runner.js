import { compareDiagnostics, createRuleContext } from "./lint-diagnostics.js";

export function runLintRulesWithWorkspaceIndex(index, settings, { rulesForProfile, rowLabelFor }) {
  if (!settings.enabled) return [];
  const diagnostics = [];
  for (const entry of rulesForProfile(settings.profile)) {
    const ruleSetting = settings.profiles[settings.profile]?.rules?.[entry.id];
    const runner = entry.runner;
    if (!entry.implemented || !ruleSetting?.enabled || !runner) continue;
    const before = diagnostics.length;
    runner(index, createRuleContext({
      ruleId: entry.id,
      severity: ruleSetting.severity,
      diagnostics,
      profile: index.profile,
      rowLabelFor
    }));
    labelRuleDiagnostics(diagnostics, before, entry);
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
    diagnostic.id = `${diagnostic.profile}:${diagnostic.ruleId}:${diagnostic.fileName}:${diagnostic.rowIndex}:${diagnostic.columnIndex}:${diagnostic.message}`;
  });
  return diagnostics;
}
