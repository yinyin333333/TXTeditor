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

function makeSettingsController({ config = {}, lspStarted = false } = {}) {
  const { document, window } = installFakeAppStartupDom();
  const invoke = async (command) => {
    if (command === "get_config") return config;
    if (command === "save_config") return undefined;
    if (command === "open_folder_dialog") return "E:\\PickedFolder";
    if (command === "pick_file_path") return "E:\\Tools\\vector-lsp.exe";
    return undefined;
  };
  window.__TAURI__ = { core: { invoke }, event: { listen: async () => () => {} } };
  const state = {
    theme: "dark",
    colorizeColumns: true,
    vectorLspHover: true,
    gridFont: DEFAULT_GRID_FONT,
    dockLayout: DEFAULT_DOCK_LAYOUT,
    workspace: null,
    lint: {
      engine: LINT_ENGINE_VECTOR,
      enabled: true,
      diagnostics: [],
      legacy: {
        settings: createDefaultLintSettings(),
        rulesOpen: false
      }
    },
    lsp: {
      started: lspStarted
    }
  };
  const calls = [];
  const controller = createSettingsController({
    state,
    els: { host: document.createElement("section"), lintControls: document.createElement("div"), lintRulesPanel: document.createElement("div") },
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
  return { controller, document, calls };
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
