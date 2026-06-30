import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isTextLikeFile,
  isTextLikePath
} from "../src/core/text-file-policy.js";
import { createCommandController } from "../src/ui/controllers/command-controller.js";
import { createShellController } from "../src/ui/controllers/shell-controller.js";
import { renderWorkspaceFileList } from "../src/ui/workspace-file-list-policy.js";
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

test("workspace Explorer rendering preserves open-file suppression, grouping, badges, and escaping", () => {
  const workspace = {
    path: "E:/Game/Data",
    files: [
      { name: "armor.txt", path: "E:/Game/Data/armor.txt" },
      { name: "weapons.txt", path: "E:/Game/Data/weapons.txt" },
      { name: "skills<bad>.txt", path: "E:/Game/Data/skills<bad>.txt" },
      { name: "fallen.txt", path: "E:/Game/Data/monsters/fallen.txt" },
      { name: "quote.txt", path: "E:/Game/Data/quoted\"dir/quote.txt" }
    ]
  };
  const docs = [{ name: "armor.txt", path: "E:/Game/Data/armor.txt" }];
  const html = renderWorkspaceFileList({
    workspace,
    docs,
    collapsedFileGroups: new Set(["monsters"]),
    pathKey,
    escapeHtml,
    problemBadgeForPath: (path) => path.endsWith("weapons.txt") ? ` <span class="file-problem-badge">2</span>` : ""
  });

  assert.doesNotMatch(html, /data-open-path="E:\/Game\/Data\/armor\.txt"/);
  assert.match(html, /<details class="file-group" open data-file-group="Data Files">/);
  assert.match(html, /data-open-path="E:\/Game\/Data\/weapons\.txt">weapons\.txt <span class="file-problem-badge">2<\/span>/);
  assert.match(html, /data-open-path="E:\/Game\/Data\/skills&lt;bad&gt;\.txt">skills&lt;bad&gt;\.txt/);
  assert.match(html, /<details class="file-group" data-file-group="monsters">/);
  assert.match(html, /data-file-group="quoted&quot;dir"/);
  assert.ok(html.indexOf("Data Files") < html.indexOf("monsters"));
  assert.ok(html.indexOf("monsters") < html.indexOf("quoted&quot;dir"));
});

test("Explorer search Enter opens the best matching workspace file and clears the query", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const { document } = installFakeAppStartupDom({ indexHtml });
  const opened = [];
  const state = {
    docs: [{ name: "armor.txt", path: "E:/Game/Data/armor.txt", dirty: false }],
    active: 0,
    workspace: {
      path: "E:/Game/Data",
      files: [
        { name: "armor.txt", path: "E:/Game/Data/armor.txt" },
        { name: "CubeMain.txt", path: "E:/Game/Data/CubeMain.txt" },
        { name: "cubetype.txt", path: "E:/Game/Data/cubetype.txt" }
      ]
    },
    sidebarVisible: true,
    problemsVisible: false,
    bottomTab: "problems",
    lint: { diagnostics: [], enabled: true },
    freezeRow: false,
    freezeColumn: false,
    colorizeColumns: false,
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
    "explorerSearchResults"
  ];
  const els = {
    shell: document.getElementById("app"),
    ...Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]))
  };
  const controller = createShellController({
    state,
    els,
    grid: { setDocument: () => {} },
    activeDoc: () => state.docs[state.active],
    hasOpenDocument: () => state.docs.length > 0,
    applyFreezeToDoc: () => {},
    closeTab: async () => {},
    openDroppedNativePaths: async (paths) => opened.push(paths),
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

  try {
    controller.renderChrome();
    els.explorerFilter.value = "cube";
    els.explorerFilter.dispatchEvent({ type: "input" });

    assert.match(els.fileList.textContent, /armor\.txt/);
    assert.match(els.fileList.textContent, /CubeMain\.txt/);
    assert.match(els.explorerSearchResults.textContent, /CubeMain\.txt/);
    els.explorerFilter.dispatchEvent({ type: "keydown", key: "Enter" });
    await Promise.resolve();

    assert.deepEqual(opened, [["E:/Game/Data/CubeMain.txt"]]);
    assert.equal(els.explorerFilter.value, "");
    assert.equal(els.explorerSearchResults.textContent, "");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Explorer search prefers prefix matches over contains matches", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const { document } = installFakeAppStartupDom({ indexHtml });
  const opened = [];
  const state = {
    docs: [],
    active: 0,
    workspace: {
      path: "E:/Game/Data",
      files: [
        { name: "mycube.txt", path: "E:/Game/Data/mycube.txt" },
        { name: "cubemain.txt", path: "E:/Game/Data/cubemain.txt" }
      ]
    },
    sidebarVisible: true,
    problemsVisible: false,
    bottomTab: "problems",
    lint: { diagnostics: [], enabled: true },
    freezeRow: false,
    freezeColumn: false,
    colorizeColumns: false,
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
    "explorerSearchResults"
  ];
  const els = {
    shell: document.getElementById("app"),
    ...Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]))
  };
  const controller = createShellController({
    state,
    els,
    grid: { setDocument: () => {} },
    activeDoc: () => state.docs[state.active],
    hasOpenDocument: () => state.docs.length > 0,
    applyFreezeToDoc: () => {},
    closeTab: async () => {},
    openDroppedNativePaths: async (paths) => opened.push(paths),
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

  try {
    controller.renderChrome();
    els.explorerFilter.value = "cube";
    els.explorerFilter.dispatchEvent({ type: "keydown", key: "Enter" });
    await Promise.resolve();

    assert.deepEqual(opened, [["E:/Game/Data/cubemain.txt"]]);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Explorer search dropdown uses literal matches and keyboard selection", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const { document } = installFakeAppStartupDom({ indexHtml });
  const opened = [];
  const state = {
    docs: [],
    active: 0,
    workspace: {
      path: "E:/Game/Data",
      files: [
        { name: "levels.txt", path: "E:/Game/Data/levels.txt" },
        { name: "lvlprest.txt", path: "E:/Game/Data/lvlprest.txt" },
        { name: "lvlwarp.txt", path: "E:/Game/Data/lvlwarp.txt" }
      ]
    },
    sidebarVisible: true,
    problemsVisible: false,
    bottomTab: "problems",
    lint: { diagnostics: [], enabled: true },
    freezeRow: false,
    freezeColumn: false,
    colorizeColumns: false,
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
    "explorerSearchResults"
  ];
  const els = {
    shell: document.getElementById("app"),
    ...Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]))
  };
  const controller = createShellController({
    state,
    els,
    grid: { setDocument: () => {} },
    activeDoc: () => state.docs[state.active],
    hasOpenDocument: () => state.docs.length > 0,
    applyFreezeToDoc: () => {},
    closeTab: async () => {},
    openDroppedNativePaths: async (paths) => opened.push(paths),
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

  try {
    controller.renderChrome();
    els.explorerFilter.value = "lvl";
    els.explorerFilter.dispatchEvent({ type: "input" });

    assert.match(els.explorerSearchResults.textContent, /lvlprest\.txt/);
    assert.match(els.explorerSearchResults.textContent, /lvlwarp\.txt/);
    assert.doesNotMatch(els.explorerSearchResults.textContent, /levels\.txt/);

    els.explorerFilter.dispatchEvent({ type: "keydown", key: "ArrowDown" });
    els.explorerFilter.dispatchEvent({ type: "keydown", key: "Enter" });
    await Promise.resolve();

    assert.deepEqual(opened, [["E:/Game/Data/lvlwarp.txt"]]);
    assert.equal(els.explorerFilter.value, "");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Explorer search dropdown opens clicked matches", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const { document } = installFakeAppStartupDom({ indexHtml });
  const opened = [];
  const state = {
    docs: [],
    active: 0,
    workspace: {
      path: "E:/Game/Data",
      files: [
        { name: "lvlprest.txt", path: "E:/Game/Data/lvlprest.txt" },
        { name: "lvlwarp.txt", path: "E:/Game/Data/lvlwarp.txt" }
      ]
    },
    sidebarVisible: true,
    problemsVisible: false,
    bottomTab: "problems",
    lint: { diagnostics: [], enabled: true },
    freezeRow: false,
    freezeColumn: false,
    colorizeColumns: false,
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
    "explorerSearchResults"
  ];
  const els = {
    shell: document.getElementById("app"),
    ...Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]))
  };
  const controller = createShellController({
    state,
    els,
    grid: { setDocument: () => {} },
    activeDoc: () => state.docs[state.active],
    hasOpenDocument: () => state.docs.length > 0,
    applyFreezeToDoc: () => {},
    closeTab: async () => {},
    openDroppedNativePaths: async (paths) => opened.push(paths),
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

  try {
    controller.renderChrome();
    els.explorerFilter.value = "lvl";
    els.explorerFilter.dispatchEvent({ type: "input" });
    els.explorerSearchResults.querySelector("[data-explorer-search-index='1']").click();
    await Promise.resolve();

    assert.deepEqual(opened, [["E:/Game/Data/lvlwarp.txt"]]);
    assert.equal(els.explorerFilter.value, "");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Explorer search preserves open document tab indexes", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const { document } = installFakeAppStartupDom({ indexHtml });
  const state = {
    docs: [
      { name: "armor.txt", path: "E:/Game/Data/armor.txt", dirty: false },
      { name: "CubeMain.txt", path: "E:/Game/Data/CubeMain.txt", dirty: false }
    ],
    active: 0,
    workspace: null,
    sidebarVisible: true,
    problemsVisible: false,
    bottomTab: "problems",
    lint: { diagnostics: [], enabled: true },
    freezeRow: false,
    freezeColumn: false,
    colorizeColumns: false,
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
    "explorerSearchResults"
  ];
  const els = {
    shell: document.getElementById("app"),
    ...Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]))
  };
  const controller = createShellController({
    state,
    els,
    grid: { setDocument: () => {} },
    activeDoc: () => state.docs[state.active],
    hasOpenDocument: () => state.docs.length > 0,
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

  try {
    controller.renderChrome();
    els.explorerFilter.value = "cube";
    els.explorerFilter.dispatchEvent({ type: "keydown", key: "Enter" });

    assert.equal(state.active, 1);
    assert.equal(els.explorerFilter.value, "");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("text-like path policy is shared by document loading and legacy workspace lint", () => {
  assert.equal(isTextLikePath("E:/Game/Data/armor.TXT"), true);
  assert.equal(isTextLikePath("skills.tsv"), true);
  assert.equal(isTextLikePath("levels.tbl"), true);
  assert.equal(isTextLikePath("inventory.csv"), true);
  assert.equal(isTextLikePath("notes.txt.bak"), false);
  assert.equal(isTextLikePath("config.json"), false);
  assert.equal(isTextLikeFile({ name: "misc.CSV" }), true);

  const documentController = readFileSync(new URL("../src/ui/controllers/document-controller.js", import.meta.url), "utf8");
  const legacyLintController = readFileSync(new URL("../src/ui/controllers/legacy-lint-controller.js", import.meta.url), "utf8");
  assert.match(documentController, /core\/text-file-policy\.js/);
  assert.match(legacyLintController, /core\/text-file-policy\.js/);
  assert.doesNotMatch(documentController, /function isTextLikePath/);
  assert.doesNotMatch(legacyLintController, /function isTextLikePath/);
});

test("Explorer, Problems, and sidebar commands dispatch to available handlers without an open document", () => {
  const calls = [];
  const controller = createCommandController({
    isDevelopmentMode: false,
    state: { selection: { rect: { top: 0, bottom: 0, left: 0, right: 0 } } },
    activeDoc: () => ({}),
    hasOpenDocument: () => false,
    execute: () => calls.push("execute"),
    rowsFromSelection: () => [],
    columnsFromSelection: () => [],
    showError: (message) => calls.push(`error:${message}`),
    handlers: {
      toggleExplorerPane: () => calls.push("explorer"),
      toggleProblemsPanel: () => calls.push("problems"),
      toggleSidebar: () => calls.push("sidebar")
    }
  });

  controller.runCommand("show-explorer");
  controller.runCommand("show-problems");
  controller.runCommand("toggle-sidebar");
  assert.deepEqual(calls, ["explorer", "problems", "sidebar"]);
});
