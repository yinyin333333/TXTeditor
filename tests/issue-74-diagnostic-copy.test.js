import assert from "node:assert/strict";
import test from "node:test";

import { LINT_ENGINE_VECTOR } from "../src/core/lint-controller-policy.js";
import { createDiagnosticsController } from "../src/ui/controllers/diagnostics-controller.js";
import {
  DIAGNOSTIC_COPY_FULL,
  DIAGNOSTIC_COPY_MESSAGE,
  diagnosticCopyText,
  isDiagnosticCopyShortcut
} from "../src/ui/diagnostic-copy-policy.js";
import { groupDiagnosticsByFile, problemsPanelHtml } from "../src/ui/problems-policy.js";

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

const rawMessage = "한글 <tag> & value\r\nsecond\tline 😀";
const diagnostic = {
  id: "diag-1",
  fileName: "skills.txt",
  fileKey: "workspace-a/data/skills.txt",
  filePath: "",
  rowIndex: 7,
  columnIndex: 2,
  columnName: "calc value / raw",
  recordKey: "Fire Ball",
  severity: "error",
  message: rawMessage,
  ruleId: "calc/check",
  profile: "RotW",
  offendingValue: "min(1,<2>)\r\nraw\tcell 😀"
};

test("#74 message copy preserves the diagnostic text byte-for-byte at the string boundary", () => {
  assert.equal(diagnosticCopyText(diagnostic, DIAGNOSTIC_COPY_MESSAGE), rawMessage);
});

test("#74 full copy includes stable file identity and raw structured fields", () => {
  const copied = diagnosticCopyText(diagnostic, DIAGNOSTIC_COPY_FULL);
  assert.match(copied, /^File: skills\.txt$/m);
  assert.match(copied, /^Path: workspace-a\/data\/skills\.txt$/m);
  assert.match(copied, /^Row ID: Fire Ball$/m);
  assert.match(copied, /^Column: calc value \/ raw$/m);
  assert.doesNotMatch(copied, /Record key:/);
  assert.ok(copied.includes(`Message:\n${rawMessage}`));
  assert.match(copied, /^Rule ID: calc\/check$/m);
  assert.match(copied, /^Rule profile: RotW$/m);
  assert.ok(copied.includes(`Cell value:\n${diagnostic.offendingValue}`));
});

test("#74 panel shows the row identifier and column name together without record jargon", () => {
  const html = problemsPanelHtml({ lintEnabled: true, diagnostics: [diagnostic] });
  assert.match(html, /class="problem-row-location">Row ID: Fire Ball<\/span>/);
  assert.match(html, /class="problem-column-location">Column: calc value \/ raw<\/span>/);
  assert.doesNotMatch(html, /Record Fire Ball/);
});

test("#74 Ctrl/Cmd+C recognizes the focused diagnostic copy shortcut", () => {
  assert.equal(isDiagnosticCopyShortcut({ key: "c", ctrlKey: true }), true);
  assert.equal(isDiagnosticCopyShortcut({ key: "C", metaKey: true }), true);
  assert.equal(isDiagnosticCopyShortcut({ key: "c", ctrlKey: true, altKey: true }), false);
  assert.equal(isDiagnosticCopyShortcut({ key: "v", ctrlKey: true }), false);
});

test("#74 clipboard integration writes full diagnostic text without HTML conversion", async () => {
  let written = null;
  const restoreWindow = replaceGlobal("window", {});
  const restoreNavigator = replaceGlobal("navigator", {
    clipboard: { writeText: async (value) => { written = value; } }
  });
  const state = {
    docs: [],
    active: -1,
    selection: { focus: { row: 0, column: 0 } },
    problemsVisible: true,
    bottomTab: "problems",
    lint: {
      diagnostics: [diagnostic],
      enabled: true,
      engine: LINT_ENGINE_VECTOR,
      status: "",
      version: 0,
      legacy: { status: "", rulesOpen: false, settings: { profile: "" }, workspaceDocs: [], workspaceLoad: {} }
    },
    lsp: { started: true, openFileCount: 0 }
  };
  const controller = createDiagnosticsController({
    state,
    els: { overviewRuler: null, problemsList: null, host: null },
    grid: { editingCell: () => null, setDiagnostics() {} },
    activeDoc: () => null,
    hasOpenDocument: () => false,
    addDocument: async () => {},
    renderChrome: () => {},
    recordUiPerf: () => {},
    showError: (error) => { throw error; },
    lintDocKey: () => "",
    lintPathKey: (path) => path,
    escapeHtml: (value) => String(value),
    storage: { setItem() {} }
  });

  try {
    assert.equal(await controller.copyDiagnostic(diagnostic.id, DIAGNOSTIC_COPY_FULL), true);
    assert.equal(written, diagnosticCopyText(diagnostic, DIAGNOSTIC_COPY_FULL));
  } finally {
    restoreNavigator();
    restoreWindow();
  }
});

test("#74 same-named files remain separate, sorted groups with distinct identities", () => {
  const diagnostics = [
    { ...diagnostic, id: "b", fileKey: "workspace-b/data/skills.txt" },
    { ...diagnostic, id: "a", fileKey: "workspace-a/data/skills.txt" }
  ];
  const groups = groupDiagnosticsByFile(diagnostics);
  assert.deepEqual(groups.map(([name, items, key]) => [name, items.length, key]), [
    ["skills.txt", 1, "workspace-a/data/skills.txt"],
    ["skills.txt", 1, "workspace-b/data/skills.txt"]
  ]);
  const html = problemsPanelHtml({ lintEnabled: true, diagnostics, collapsedFiles: new Set(["workspace-a/data/skills.txt"]) });
  assert.match(html, /data-file-key="workspace-a\/data\/skills\.txt">/);
  assert.match(html, /data-file-key="workspace-b\/data\/skills\.txt" open>/);
});

test("#74 non-navigable diagnostics remain focusable for keyboard and context-menu copying", () => {
  const html = problemsPanelHtml({
    lintEnabled: true,
    diagnostics: [{ ...diagnostic, navigationDisabled: true }]
  });
  assert.match(html, /aria-disabled="true"/);
  assert.doesNotMatch(html, /\sdisabled(?:\s|>)/);
});
