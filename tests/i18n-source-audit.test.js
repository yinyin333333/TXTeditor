import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// This is deliberately an explicit location audit, not a broad English-word regex:
// game identifiers, command IDs, protocol strings, and developer diagnostics remain allowed.
const PRODUCT_SURFACE_AUDIT = [
  ["index.html", [
    'data-command="open-file" data-i18n="toolbar.openFile"',
    'data-command="open-folder" data-i18n="toolbar.openFolder"',
    'data-i18n-aria-label="aria.tableEditor"',
    'data-i18n-placeholder="palette.placeholder"',
    'data-i18n="dialog.saveChanges"'
  ]],
  ["src/ui/controllers/command-surface-controller.js", [
    'tText("menu.columnOperations")', 'tText("menu.rowOperations")',
    'tText("menu.goToDefinition")', 'txteditor-locale-changed'
  ]],
  ["src/ui/controllers/shell-controller.js", [
    'tText("lint.on")', 'tText("theme.lightMode")', 'tText("activity.explorer")',
    'tText("tab.unsavedChanges")', 'tText("common.close")'
  ]],
  ["src/ui/problems-policy.js", [
    't("problems.jsonReadOnly")', 'tText("lint.summaryCountsProfile"',
    '"lint.noProblemsFiles"'
  ]],
  ["src/ui/controllers/document-controller.js", [
    't("error.openFolderDesktop")', 't("error.noOpenFile")'
  ]],
  ["src/ui/controllers/edit-command-controller.js", [
    't("error.clipboardCopy"', 't("error.clipboardPaste"'
  ]],
  ["src/ui/controllers/grid-command-controller.js", [
    't("error.cloneRows")', 't("error.cloneColumns")'
  ]],
  ["src/ui/controllers/settings-controller.js", [
    'translate("settings.pluginFolder")', 'translate("settings.jsonDiagnostics")',
    'translate("settings.restartLsp")', 'txteditor-locale-changed',
    'lintRuleGroupsForProfile(state.lint.legacy.settings.profile, state.locale)'
  ]],
  ["src/ui/controllers/legacy-lint-controller.js", [
    'runLintWithWorkspaceIndex(index, state.lint.legacy.settings, { locale: state.locale })'
  ]],
  ["src/ui/controllers/shortcut-settings-controller.js", [
    'tText("shortcut.hint")', 'data-shortcut-i18n',
    'txteditor-locale-changed'
  ]],
  ["src/ui/shortcut-policy.js", [
    'tText("shortcut.validationNonModifier")',
    'tText("shortcut.validationReserved", { key })',
    'tText("shortcut.validationModifier")'
  ]],
  ["src/ui/codemirror-json-editor-entry.js", [
    'EditorState.phrases.of(jsonEditorPhrases())',
    'refreshJsonEditorLocale', 'tText("json.goToLine")'
  ]],
  ["src/ui/controllers/locale-controller.js", [
    'refreshJsonEditorLocale();'
  ]],
  ["src/core/lint-basic-rules.js", [
    'legacyMessage("basic.missileRangeInteger")',
    'legacyMessage("basic.invalidLevel"',
    'legacyMessage("basic.levelOrder"',
    'legacyMessage("basic.referenceNotFound"'
  ]]
];

test("product-facing source audit requires stable i18n keys at audited UI and lint locations", () => {
  for (const [path, required] of PRODUCT_SURFACE_AUDIT) {
    const contents = source(path);
    for (const token of required) assert.ok(contents.includes(token), `${path} must contain ${token}`);
  }
  const i18n = source("src/core/i18n.js");
  assert.doesNotMatch(i18n, /sidebar-actions \[data-command/);
  assert.match(i18n, /data-i18n-aria-label/);
  assert.match(i18n, /"settings\.jsonDiagnostics"/);
  assert.match(i18n, /"shortcut\.validationReserved"/);
  assert.match(i18n, /"json\.goToLine"/);
  assert.doesNotMatch(source("src/ui/controllers/settings-controller.js"), />Lint Options</);
  assert.doesNotMatch(source("src/ui/controllers/settings-controller.js"), />Restart LSP</);
});
