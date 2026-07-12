import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createInitialAppState } from "../src/ui/app-startup-state.js";
import { createGridCommandController } from "../src/ui/controllers/grid-command-controller.js";
import { createShellController } from "../src/ui/controllers/shell-controller.js";
import { installFakeAppStartupDom } from "./helpers/fake-dom-app-startup.mjs";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pathKey(path) {
  return String(path || "").replace(/\\/g, "/").toLowerCase();
}

test("startup ignores previously persisted freeze state", () => {
  installFakeAppStartupDom();
  localStorage.setItem("txteditor.freeze", JSON.stringify({ row: true, column: true }));

  const { state } = createInitialAppState({ storage: localStorage });

  assert.equal(state.freezeRow, false);
  assert.equal(state.freezeColumn, false);
});

test("Freeze toolbar buttons are inactive and disabled until a document is open", () => {
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const { document } = installFakeAppStartupDom({ indexHtml });
  const state = {
    docs: [],
    active: -1,
    workspace: {
      path: "E:/Game/Data",
      files: [{ name: "armor.txt", path: "E:/Game/Data/armor.txt" }]
    },
    sidebarVisible: true,
    problemsVisible: false,
    bottomTab: "problems",
    lint: { diagnostics: [], enabled: true },
    freezeRow: true,
    freezeColumn: true,
    colorizeColumns: false,
    theme: "dark",
    selection: { set: () => {} }
  };
  const ids = [
    "sidebar",
    "problemsPanel",
    "problemsList",
    "logList",
    "emptyState",
    "lintSummary",
    "tabs",
    "fileList",
    "explorerFilter",
    "explorerSearchResults",
    "gridHost"
  ];
  const els = {
    shell: document.getElementById("app"),
    ...Object.fromEntries(ids.map((id) => [id === "gridHost" ? "host" : id, document.getElementById(id)]))
  };
  const controller = createShellController({
    state,
    els,
    grid: { setDocument: () => {} },
    activeDoc: () => state.docs[state.active],
    hasOpenDocument: () => state.docs.length > 0 && state.active >= 0,
    applyFreezeToDoc: () => {},
    closeTab: async () => {},
    openDroppedNativePaths: async () => {},
    updateGridDiagnostics: () => {},
    renderProblemsPanelIfNeeded: () => {},
    scrollProblemsToActiveFile: () => {},
    docDiagnosticSeverity: () => "",
    lintSummaryText: () => "",
    problemBadgeForPath: () => "",
    lintNotificationCount: () => 0,
    renderLintControls: () => {},
    syncDockLayout: () => {},
    syncProblemsHeaderLayout: () => {},
    scheduleHoverPrewarm: () => {},
    recordUiPerf: () => {},
    perfNow: () => 0,
    showError: (error) => { throw error; },
    lintPathKey: pathKey,
    escapeHtml,
    documentRef: document
  });
  const rowButton = document.querySelector("[data-command='toggle-freeze-row']");
  const columnButton = document.querySelector("[data-command='toggle-freeze-column']");

  controller.renderChrome();
  assert.equal(rowButton.disabled, true);
  assert.equal(columnButton.disabled, true);
  assert.equal(rowButton.classList.contains("active"), false);
  assert.equal(columnButton.classList.contains("active"), false);

  state.docs = [{ name: "armor.txt", path: "E:/Game/Data/armor.txt", dirty: false }];
  state.active = 0;
  controller.renderChrome();
  assert.equal(rowButton.disabled, false);
  assert.equal(columnButton.disabled, false);
  assert.equal(rowButton.classList.contains("active"), true);
  assert.equal(columnButton.classList.contains("active"), true);
});

test("Freeze toggles update only the current session and active document", () => {
  installFakeAppStartupDom();
  const state = { freezeRow: false, freezeColumn: false };
  const doc = { freezeFirstRow: false, freezeFirstColumn: false };
  let layouts = 0;
  let renders = 0;
  const controller = createGridCommandController({
    state,
    grid: { layout: () => { layouts += 1; } },
    activeDoc: () => doc,
    hasOpenDocument: () => true,
    execute: () => {},
    saveSelectionState: () => {},
    renderChrome: () => { renders += 1; },
    showError: (error) => { throw error; },
    applyFreezeToDoc: (target) => {
      target.freezeFirstRow = state.freezeRow;
      target.freezeFirstColumn = state.freezeColumn;
    },
    rowsForContextOperation: () => [],
    columnsFromSelection: () => []
  });

  controller.toggleFreeze("row");

  assert.equal(state.freezeRow, true);
  assert.equal(doc.freezeFirstRow, true);
  assert.equal(localStorage.getItem("txteditor.freeze"), null);
  assert.equal(layouts, 1);
  assert.equal(renders, 1);
});
