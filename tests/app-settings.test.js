import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultLintSettings } from "../src/core/lint-engine.js";
import { LINT_ENGINE_VECTOR } from "../src/core/lint-controller-policy.js";
import { DEFAULT_GRID_FONT } from "../src/ui/app-settings-policy.js";
import { DEFAULT_DOCK_LAYOUT } from "../src/ui/dock-layout-policy.js";
import { createSettingsController } from "../src/ui/controllers/settings-controller.js";
import { installFakeAppStartupDom } from "./helpers/fake-dom-app-startup.mjs";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function makeSettingsController({
  config = {},
  diagnostics = [],
  lspStarted = false,
  saveConfigError = null,
  workspace = null
} = {}) {
  const { document, window } = installFakeAppStartupDom();
  const calls = [];
  const invoke = async (command) => {
    calls.push(["invoke", command]);
    if (command === "get_config") return config;
    if (command === "save_config") {
      if (saveConfigError) throw saveConfigError;
      return undefined;
    }
    if (command === "open_folder_dialog") return "E:\\PickedFolder";
    if (command === "pick_file_path") return "E:\\Tools\\vector-lsp.exe";
    return undefined;
  };
  window.__TAURI__ = { core: { invoke }, event: { listen: async () => () => {} } };
  const host = document.createElement("section");
  const state = {
    theme: "dark",
    colorizeColumns: true,
    vectorLspHover: true,
    gridFont: DEFAULT_GRID_FONT,
    dockLayout: DEFAULT_DOCK_LAYOUT,
    workspace,
    lint: {
      engine: LINT_ENGINE_VECTOR,
      enabled: true,
      diagnostics: [...diagnostics],
      legacy: {
        settings: createDefaultLintSettings(),
        rulesOpen: false
      }
    },
    lsp: {
      started: lspStarted
    },
    config: { ...config }
  };
  const controller = createSettingsController({
    state,
    els: { host, lintControls: document.createElement("div"), lintRulesPanel: document.createElement("div") },
    grid: {
      syncTheme: () => calls.push("sync-theme"),
      draw: () => calls.push("draw"),
      setColorizeColumns: (enabled) => calls.push(["colorize", enabled]),
      setFontFamily: (font) => calls.push(["font", font]),
      setVectorLspHoverEnabled: (enabled) => calls.push(["hover", enabled])
    },
    dockForPanel: (panel) => state.dockLayout[panel],
    setPanelDock: (panel, edge) => { state.dockLayout = { ...state.dockLayout, [panel]: edge }; },
    resetDockLayout: () => { state.dockLayout = DEFAULT_DOCK_LAYOUT; },
    isLegacyLintEngine: () => false,
    isVectorLintEngine: () => true,
    effectiveVectorLspHoverEnabled: () => true,
    cancelLegacyLintJobs: () => calls.push("cancel-legacy"),
    scheduleLegacyLintFull: () => calls.push("schedule-legacy"),
    legacyLintDisplayActive: () => false,
    currentLegacyProfileRules: () => ({}),
    invalidateLspHover: () => calls.push("invalidate-hover"),
    setLintDiagnostics: (diagnostics) => { state.lint.diagnostics = diagnostics; },
    updateGridDiagnostics: () => calls.push("update-grid-diagnostics"),
    lspStartWorkspace: async () => calls.push("lsp-start"),
    syncOpenDocsToVectorLsp: async () => calls.push("lsp-sync"),
    recordLintEngineEvent: (name) => calls.push(["lint-event", name]),
    renderChrome: () => calls.push("render"),
    reportBackgroundFailure: (label) => calls.push(["background-failure", label]),
    showError: (error) => calls.push(["error", String(error)]),
    escapeHtml
  });
  return { controller, document, calls, host, state };
}

async function waitForSelector(document, selector) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const element = document.body.querySelector(selector);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return null;
}

test("App Settings modal renders visual controls in the controller behavior path", () => {
  const { controller, document } = makeSettingsController();

  controller.showAppSettings();

  assert.equal(document.body.querySelector("#settingsColorizeColumns")?.tagName, "INPUT");
  assert.equal(document.body.querySelector("#settingsVectorLspHover")?.tagName, "INPUT");
  assert.equal(document.body.querySelector("#settingsGridFont")?.tagName, "SELECT");
  assert.equal(document.body.querySelector("[data-settings-lint-engine='vector-lsp']")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-settings-lint-engine='legacy']")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-settings-theme='dark']")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-settings-theme='light']")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-settings-reset-layout]")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-settings-close]")?.tagName, "BUTTON");
});

test("App Settings closes on Escape and removes its temporary key listener", () => {
  const { controller, document, host } = makeSettingsController();

  controller.showAppSettings();
  assert.ok(document.body.querySelector(".settings-modal"));
  assert.equal(document.listeners.get("keydown")?.length, 1);

  let prevented = false;
  let stopped = false;
  document.listeners.get("keydown")[0]({
    key: "Escape",
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; }
  });

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(document.body.querySelector(".settings-modal"), null);
  assert.equal(document.activeElement, host);
  assert.equal(document.listeners.get("keydown")?.length, 0);
});

test("Tauri Lint Options modal renders valid Vector-LSP Browse buttons and actions", async () => {
  const { controller, document } = makeSettingsController({
    lspStarted: true,
    config: {
      lintMode: "advanced",
      pluginPath: "E:\\Plugins",
      schemaPath: "E:\\Schema",
      vectorLspPath: "E:\\Tools\\vector-lsp.exe",
      debugLogging: true
    }
  });

  const pending = controller.showSettings();
  const modal = await waitForSelector(document, ".settings-modal");
  const backdrop = document.body.querySelector(".modal-backdrop");

  assert.ok(modal);
  assert.ok(backdrop);
  for (const id of ["settingsBrowsePluginBtn", "settingsBrowseSchemaBtn", "settingsBrowseLspBtn"]) {
    const button = document.body.querySelector(`#${id}`);
    assert.equal(button?.tagName, "BUTTON", `${id} should render as a button`);
    assert.equal(button.textContent, "Browse...");
    assert.match(backdrop.innerHTML, new RegExp(`id="${id}">Browse&hellip;</button>`));
  }
  assert.doesNotMatch(backdrop.innerHTML, /Browse\?\?/);
  assert.doesNotMatch(backdrop.innerHTML, /\?\?\/button/);
  assert.doesNotMatch(backdrop.innerHTML, /\uFFFD/);
  assert.equal(document.body.querySelector("[data-settings-choice='save']")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-settings-choice='restart-lsp']")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-settings-choice='cancel']")?.tagName, "BUTTON");

  document.body.querySelector("[data-settings-choice='cancel']").click();
  await pending;
});

test("Lint Options Escape behaves like Cancel without saving or restarting LSP", async () => {
  const { controller, document, calls, host } = makeSettingsController({
    lspStarted: true,
    config: {
      lintMode: "advanced",
      pluginPath: "E:\\Plugins",
      schemaPath: "E:\\Schema",
      vectorLspPath: "E:\\Tools\\vector-lsp.exe",
      debugLogging: true
    }
  });

  const pending = controller.showSettings();
  assert.ok(await waitForSelector(document, ".settings-modal"));
  document.body.querySelector("#settingsPluginPath").value = "E:\\Unsaved";

  document.listeners.get("keydown")[0]({
    key: "Escape",
    preventDefault: () => {},
    stopPropagation: () => {}
  });
  await pending;

  assert.equal(document.body.querySelector(".settings-modal"), null);
  assert.equal(document.activeElement, host);
  assert.equal(calls.some((entry) => entry[0] === "invoke" && entry[1] === "save_config"), false);
  assert.equal(calls.includes("lsp-start"), false);
  assert.equal(document.listeners.get("keydown")?.length, 0);
});

test("V-TXT-14 keeps config, diagnostics, modal, and LSP session unchanged when config write fails", async () => {
  const originalConfig = {
    lintMode: "advanced",
    pluginPath: "E:\\Plugins",
    schemaPath: "E:\\Schema",
    vectorLspPath: "E:\\Tools\\vector-lsp.exe",
    debugLogging: true
  };
  const originalDiagnostics = [{ id: "existing-diagnostic" }];
  const { controller, document, calls, state } = makeSettingsController({
    config: originalConfig,
    diagnostics: originalDiagnostics,
    lspStarted: true,
    saveConfigError: new Error("disk denied"),
    workspace: { path: "E:\\Workspace" }
  });
  const pending = controller.showSettings();
  let settled = false;
  pending.then(() => {
    settled = true;
  });
  assert.ok(await waitForSelector(document, ".settings-modal"));
  document.body.querySelector("#settingsPluginPath").value = "E:\\NewPlugins";
  const saveButton = document.body.querySelector("[data-settings-choice='save']");
  const cancelButton = document.body.querySelector("[data-settings-choice='cancel']");

  try {
    saveButton.click();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const observed = {
      config: state.config,
      diagnostics: state.lint.diagnostics,
      errorCount: calls.filter((entry) => Array.isArray(entry) && entry[0] === "error").length,
      gridUpdateCount: calls.filter((entry) => entry === "update-grid-diagnostics").length,
      lspRestartCount: calls.filter((entry) => entry === "lsp-start").length,
      modalOpen: Boolean(document.body.querySelector(".settings-modal")),
      saveButtonReusable: saveButton.disabled !== true,
      saveCallCount: calls.filter((entry) => Array.isArray(entry) && entry[0] === "invoke" && entry[1] === "save_config").length,
      settled
    };
    assert.deepEqual(observed, {
      config: originalConfig,
      diagnostics: originalDiagnostics,
      errorCount: 1,
      gridUpdateCount: 0,
      lspRestartCount: 0,
      modalOpen: true,
      saveButtonReusable: true,
      saveCallCount: 1,
      settled: false
    });
  } finally {
    if (document.body.querySelector(".settings-modal")) cancelButton.click();
  }
});
