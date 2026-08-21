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
    'data-command="close-all" data-i18n="toolbar.closeAll"',
    'data-i18n-aria-label="aria.tableEditor"',
    'data-i18n-placeholder="palette.placeholder"',
    'data-i18n="dialog.saveChanges"',
    'data-i18n="merge.title"',
    'data-i18n="merge.stage.setup"',
    'data-i18n-placeholder="merge.placeholder.output"',
    'data-i18n="merge.analyze"',
    'data-i18n="merge.description"',
    'data-i18n="merge.changesTab"'
  ]],
  ["src/ui/controllers/command-surface-controller.js", [
    'tText("menu.columnOperations")', 'tText("menu.rowOperations")',
    'tText("menu.goToDefinition")', 'tText("command.mergeWithFile")', 'txteditor-locale-changed'
  ]],
  ["src/ui/controllers/merge-controller.js", [
    'tText("merge.status.noChangedFiles")',
    'tText("merge.error.folderDirty"',
    '"merge.conflict.message.generic"',
    'tText("merge.change.result"',
    'tText("merge.overwrite.text"',
    'tText("merge.status.existingCancelled")'
  ]],
  ["src/app.js", [
    'tText("merge.error.readOnly")',
    'tText("merge.error.saveResultPath")'
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
  assert.doesNotMatch(source("src/ui/controllers/merge-controller.js"), /merge-change-basis|merge\.base/);
  assert.match(source("src/styles.css"), /\.merge-status\s*\{/);
});

test("merge catalog keys are assigned only once in source", () => {
  const contents = source("src/core/i18n.js");
  const counts = new Map();
  const keyPattern = /^\s*,?\s*"(merge\.[^"]+)"\s*:/gm;
  for (const match of contents.matchAll(keyPattern)) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
  assert.deepEqual(duplicates, []);
});

test("Merge sidebar contracts prevent narrow-layout overflow and picker text overflow", () => {
  const html = source("index.html");
  const css = source("src/styles.css");
  assert.match(html, /data-merge-action="pick-a"[^>]*>…<\/button>/);
  assert.match(html, /data-merge-action="pick-b"[^>]*>…<\/button>/);
  assert.match(html, /data-merge-action="pick-output"[^>]*>…<\/button>/);
  assert.match(css, /\.merge-view\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.merge-path-row input\s*\{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(css, /\.merge-path-row button\s*\{[^}]*min-width:\s*30px[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.merge-file-list\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.merge-conflicts-panel\s*\{[^}]*minmax\(0, \.86fr\)/s);
});
