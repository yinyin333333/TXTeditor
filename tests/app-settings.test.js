import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultLintSettings } from "../src/core/lint-engine.js";
import { LINT_ENGINE_VECTOR } from "../src/core/lint-controller-policy.js";
import { DEFAULT_GRID_FONT } from "../src/ui/app-settings-policy.js";
import { createInitialAppState } from "../src/ui/app-startup-state.js";
import { DEFAULT_DOCK_LAYOUT } from "../src/ui/dock-layout-policy.js";
import { createSettingsController } from "../src/ui/controllers/settings-controller.js";
import { t } from "../src/core/i18n.js";
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
  lintEnabled = true,
  saveConfigError = null,
  saveConfigHandler = null,
  workspace = null,
  legacy = false,
  listWorkspaceHandler = null
} = {}) {
  const { document, window } = installFakeAppStartupDom();
  const calls = [];
  const lspStarts = [];
  const invoke = async (command, args) => {
    calls.push(["invoke", command, args]);
    if (command === "get_config") return config;
    if (command === "save_config") {
      if (saveConfigError) throw saveConfigError;
      if (saveConfigHandler) return saveConfigHandler(args);
      return undefined;
    }
    if (command === "open_folder_dialog") return "E:\\PickedFolder";
    if (command === "pick_file_path") return "E:\\Tools\\vector-lsp.exe";
    if (command === "list_workspace_files") {
      if (listWorkspaceHandler) return listWorkspaceHandler(args);
      return {
        path: args.path,
        files: args.includeSubfolders === false
          ? [{ path: `${args.path}\\direct.txt`, name: "direct.txt" }]
          : [
            { path: `${args.path}\\direct.txt`, name: "direct.txt" },
            { path: `${args.path}\\base\\nested.txt`, name: "nested.txt" }
          ]
      };
    }
    return undefined;
  };
  window.__TAURI__ = { core: { invoke }, event: { listen: async () => () => {} } };
  const host = document.createElement("section");
  const state = {
    theme: "dark",
    locale: "enUS",
    colorizeColumns: true,
    mouseResizeLocked: false,
    autoResizeToFitOnOpen: false,
    keepZoomLevel: false,
    rememberedZoomLevel: 1,
    excludeWorkspaceSubfolders: false,
    vectorLspHover: true,
    gridFont: DEFAULT_GRID_FONT,
    scrollMode: "pixel",
    dockLayout: DEFAULT_DOCK_LAYOUT,
    workspace,
    lint: {
      engine: legacy ? "legacy" : LINT_ENGINE_VECTOR,
      enabled: lintEnabled,
      diagnostics: [...diagnostics],
      legacy: {
        settings: createDefaultLintSettings(),
        rulesOpen: false,
        referenceDataset: {
          status: "ready",
          selectedVersion: "3.2",
          digest: "old-digest",
          documents: [{ name: "hidden-reference.txt" }]
        },
        workspaceIndexCache: { signature: "old", profile: "RotW", index: {} }
      }
    },
    lsp: {
      started: lspStarted,
      includeSubfolders: true
    },
    config: { ...config }
  };
  const lintControls = document.createElement("div");
  const lintRulesPanel = document.createElement("div");
  const controller = createSettingsController({
    state,
    els: { host, lintControls, lintRulesPanel },
    grid: {
      syncTheme: () => calls.push("sync-theme"),
      draw: () => calls.push("draw"),
      setColorizeColumns: (enabled) => calls.push(["colorize", enabled]),
      setMouseResizeLocked: (locked) => calls.push(["mouse-resize-locked", locked]),
      setFontFamily: (font) => calls.push(["font", font]),
      setScrollMode: (mode) => calls.push(["scroll-mode", mode]),
      setVectorLspHoverEnabled: (enabled) => calls.push(["hover", enabled])
    },
    dockForPanel: (panel) => state.dockLayout[panel],
    setPanelDock: (panel, edge) => { state.dockLayout = { ...state.dockLayout, [panel]: edge }; },
    resetDockLayout: () => { state.dockLayout = DEFAULT_DOCK_LAYOUT; },
    isLegacyLintEngine: () => state.lint.engine === "legacy",
    isVectorLintEngine: () => state.lint.engine === LINT_ENGINE_VECTOR,
    effectiveVectorLspHoverEnabled: () => state.lint.enabled && state.lint.engine === LINT_ENGINE_VECTOR,
    cancelLegacyLintJobs: () => calls.push("cancel-legacy"),
    scheduleLegacyLintFull: (reason, delay) => calls.push(["schedule-legacy", reason, delay]),
    legacyLintDisplayActive: () => state.lint.engine === "legacy",
    currentLegacyProfileRules: () => ({}),
    invalidateLspHover: () => calls.push("invalidate-hover"),
    setLintDiagnostics: (diagnostics) => { state.lint.diagnostics = diagnostics; },
    updateGridDiagnostics: () => calls.push("update-grid-diagnostics"),
    lspStartWorkspace: async (...args) => {
      lspStarts.push(args);
      calls.push("lsp-start");
    },
    stopVectorSession: async (reason) => calls.push(["stop-vector-session", reason]),
    ensureDocumentSession: async (options) => calls.push(["ensure-document-session", options]),
    resetLegacyWorkspaceIndex: () => calls.push("reset-legacy-workspace-index"),
    recordLintEngineEvent: (name) => calls.push(["lint-event", name]),
    renderChrome: () => calls.push("render"),
    reportBackgroundFailure: (label) => calls.push(["background-failure", label]),
    showError: (error) => calls.push(["error", String(error)]),
    t,
    setLocale: async (locale) => {
      state.locale = locale;
      calls.push(["locale", locale]);
      return locale;
    },
    escapeHtml
  });
  return { controller, document, calls, host, lintControls, lintRulesPanel, lspStarts, state };
}

async function waitForSelector(document, selector) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const element = document.body.querySelector(selector);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return null;
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail("Timed out waiting for the expected async operation.");
}

test("App Settings modal renders visual controls in the controller behavior path", () => {
  const { controller, document } = makeSettingsController();

  controller.showAppSettings();

  assert.equal(document.body.querySelector("#settingsColorizeColumns")?.tagName, "INPUT");
  assert.equal(document.body.querySelector("#settingsMouseResizeLocked")?.tagName, "INPUT");
  assert.equal(document.body.querySelector("#settingsAutoResizeToFitOnOpen")?.tagName, "INPUT");
  assert.equal(document.body.querySelector("#settingsExcludeWorkspaceSubfolders")?.tagName, "INPUT");
  assert.equal(document.body.querySelector("#settingsVectorLspHover"), null);
  assert.equal(document.body.querySelector("#settingsGridFont")?.tagName, "SELECT");
  assert.equal(document.body.querySelector("#settingsScrollMode")?.tagName, "SELECT");
  assert.equal(document.body.querySelector("#settingsLocale")?.tagName, "SELECT");
  assert.equal(document.body.querySelector("[data-settings-lint-engine='vector-lsp']"), null);
  assert.equal(document.body.querySelector("[data-settings-lint-engine='legacy']"), null);
  assert.equal(document.body.querySelector("[data-settings-theme='dark']")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-settings-theme='light']")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-settings-reset-layout]")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-settings-close]")?.tagName, "BUTTON");
});

test("scrolling mode applies immediately and persists as a normalized preference", () => {
  const { controller, document, calls, state } = makeSettingsController();
  controller.showAppSettings();
  const scrollMode = document.body.querySelector("#settingsScrollMode");
  scrollMode.value = "cell";
  scrollMode.dispatchEvent({ type: "change" });
  assert.equal(state.scrollMode, "cell");
  assert.equal(localStorage.getItem("txteditor.scrollMode"), "cell");
  assert.deepEqual(calls.filter((call) => Array.isArray(call) && call[0] === "scroll-mode"), [["scroll-mode", "cell"]]);
  localStorage.setItem("txteditor.scrollMode", "broken");
  assert.equal(createInitialAppState({ storage: localStorage }).state.scrollMode, "pixel");
});

test("App Settings changes the language immediately", async () => {
  const { controller, document, calls, state } = makeSettingsController();
  controller.showAppSettings();
  const locale = document.body.querySelector("#settingsLocale");
  locale.value = "koKR";
  locale.dispatchEvent({ type: "change" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(state.locale, "koKR");
  assert.deepEqual(calls.filter((call) => Array.isArray(call) && call[0] === "locale"), [["locale", "koKR"]]);
  assert.equal(document.body.querySelector("[data-settings-i18n='settings.language']")?.textContent, "언어");
});

test("workspace subfolder exclusion persists, relists Explorer, and restarts Vector-LSP", async () => {
  const workspace = {
    path: "E:\\Workspace",
    files: [
      { path: "E:\\Workspace\\direct.txt", name: "direct.txt" },
      { path: "E:\\Workspace\\base\\nested.txt", name: "nested.txt" }
    ]
  };
  const { controller, calls, lspStarts, state } = makeSettingsController({ workspace });
  assert.equal(createInitialAppState({ storage: localStorage }).state.excludeWorkspaceSubfolders, false);

  assert.equal(await controller.setExcludeWorkspaceSubfolders(true), true);

  assert.equal(state.excludeWorkspaceSubfolders, true);
  assert.equal(localStorage.getItem("txteditor.excludeWorkspaceSubfolders"), "on");
  assert.deepEqual(state.workspace.files.map((file) => file.name), ["direct.txt"]);
  assert.equal(calls.includes("reset-legacy-workspace-index"), true);
  assert.deepEqual(lspStarts, []);
  assert.equal(calls.some((entry) => Array.isArray(entry)
    && entry[0] === "ensure-document-session"
    && entry[1]?.forceRestart === true), true);
  assert.equal(createInitialAppState({ storage: localStorage }).state.excludeWorkspaceSubfolders, true);
});

test("rapid workspace subfolder changes apply only the latest listing", async () => {
  const pending = [];
  const workspace = {
    path: "E:\\Workspace",
    files: [{ path: "E:\\Workspace\\old.txt", name: "old.txt" }]
  };
  const { controller, calls, state } = makeSettingsController({
    workspace,
    listWorkspaceHandler: (args) => new Promise((resolve) => pending.push({ args, resolve }))
  });

  const exclude = controller.setExcludeWorkspaceSubfolders(true);
  const include = controller.setExcludeWorkspaceSubfolders(false);
  for (let attempt = 0; attempt < 10 && pending.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(pending.length, 2);
  pending[1].resolve({
    path: "E:\\Workspace",
    files: [
      { path: "E:\\Workspace\\direct.txt", name: "direct.txt" },
      { path: "E:\\Workspace\\base\\nested.txt", name: "nested.txt" }
    ]
  });
  assert.equal(await include, true);
  pending[0].resolve({
    path: "E:\\Workspace",
    files: [{ path: "E:\\Workspace\\stale.txt", name: "stale.txt" }]
  });
  assert.equal(await exclude, false);

  assert.equal(state.excludeWorkspaceSubfolders, false);
  assert.deepEqual(state.workspace.files.map((file) => file.name), ["direct.txt", "nested.txt"]);
  assert.equal(calls.filter((entry) => Array.isArray(entry)
    && entry[0] === "ensure-document-session").length, 1);
});

test("workspace subfolder exclusion is not committed when the Explorer relist fails", async () => {
  const workspace = {
    path: "E:\\Workspace",
    files: [
      { path: "E:\\Workspace\\direct.txt", name: "direct.txt" },
      { path: "E:\\Workspace\\base\\nested.txt", name: "nested.txt" }
    ]
  };
  const { controller, calls, state } = makeSettingsController({
    workspace,
    listWorkspaceHandler: async () => {
      throw new Error("workspace relist failed");
    }
  });
  localStorage.setItem("txteditor.excludeWorkspaceSubfolders", "off");
  const previousStored = localStorage.getItem("txteditor.excludeWorkspaceSubfolders");

  await assert.rejects(
    controller.setExcludeWorkspaceSubfolders(true),
    /workspace relist failed/
  );

  assert.equal(state.excludeWorkspaceSubfolders, false);
  assert.equal(localStorage.getItem("txteditor.excludeWorkspaceSubfolders"), previousStored);
  assert.equal(state.workspace, workspace);
  assert.equal(calls.includes("reset-legacy-workspace-index"), false);
  assert.equal(calls.some((entry) => Array.isArray(entry)
    && entry[0] === "ensure-document-session"), false);
});

test("mouse resize lock defaults off, applies immediately, and is restored from storage", () => {
  const { controller, document, calls, state } = makeSettingsController();
  assert.equal(createInitialAppState({ storage: localStorage }).state.mouseResizeLocked, false);

  controller.showAppSettings();
  const input = document.body.querySelector("#settingsMouseResizeLocked");
  assert.equal(input.checked, false);

  input.checked = true;
  input.dispatchEvent({ type: "change", bubbles: true });

  assert.equal(state.mouseResizeLocked, true);
  assert.equal(localStorage.getItem("txteditor.mouseResizeLocked"), "on");
  assert.deepEqual(calls.filter((entry) => Array.isArray(entry) && entry[0] === "mouse-resize-locked"), [
    ["mouse-resize-locked", true]
  ]);
  assert.equal(createInitialAppState({ storage: localStorage }).state.mouseResizeLocked, true);
});

test("automatic Resize To Fit on open defaults off and is restored from storage", () => {
  const { controller, document, calls, state } = makeSettingsController();
  assert.equal(createInitialAppState({ storage: localStorage }).state.autoResizeToFitOnOpen, false);

  controller.showAppSettings();
  const input = document.body.querySelector("#settingsAutoResizeToFitOnOpen");
  assert.equal(input.checked, false);

  input.checked = true;
  input.dispatchEvent({ type: "change", bubbles: true });

  assert.equal(state.autoResizeToFitOnOpen, true);
  assert.equal(localStorage.getItem("txteditor.autoResizeToFitOnOpen"), "on");
  assert.equal(calls.includes("render"), true);
  assert.equal(createInitialAppState({ storage: localStorage }).state.autoResizeToFitOnOpen, true);
});

test("Keep zoom level defaults off, persists independently, and records only while enabled", () => {
  const { controller, document, state } = makeSettingsController();
  assert.equal(createInitialAppState({ storage: localStorage }).state.keepZoomLevel, false);
  assert.equal(createInitialAppState({ storage: localStorage }).state.rememberedZoomLevel, 1);

  controller.recordZoomLevel(1.5);
  assert.equal(localStorage.getItem("txteditor.zoomLevel"), null);
  controller.showAppSettings();
  const input = document.body.querySelector("#settingsKeepZoomLevel");
  assert.equal(input.checked, false);
  assert.equal(input.parentElement.textContent.trim(), "Keep zoom level");

  input.checked = true;
  input.dispatchEvent({ type: "change", bubbles: true });
  assert.equal(state.keepZoomLevel, true);
  assert.equal(localStorage.getItem("txteditor.keepZoomLevel"), "on");
  controller.recordZoomLevel(1.5);
  assert.equal(state.rememberedZoomLevel, 1.5);
  assert.equal(localStorage.getItem("txteditor.zoomLevel"), "1.5");

  input.checked = false;
  input.dispatchEvent({ type: "change", bubbles: true });
  controller.recordZoomLevel(1.8);
  assert.equal(localStorage.getItem("txteditor.keepZoomLevel"), "off");
  assert.equal(localStorage.getItem("txteditor.zoomLevel"), "1.5");
  assert.equal(createInitialAppState({ storage: localStorage }).state.keepZoomLevel, false);
  assert.equal(createInitialAppState({ storage: localStorage }).state.rememberedZoomLevel, 1.5);
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
      debugLogging: true,
      jsonDiagnostics: true,
      jsonDiagnosticRules: {
        duplicateIds: { action: "error" },
        stringFormat: { action: "ignore" },
        keyUsage: { action: "warn", idStart: 51566 }
      }
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
  assert.equal(document.body.querySelector("#settingsJsonDiagnostics")?.tagName, "INPUT");
  assert.equal(document.body.querySelector("#settingsJsonDiagnostics")?.checked, true);
  assert.equal(document.body.querySelector("#settingsJsonDuplicateIdsAction")?.value, "warn");
  assert.equal(document.body.querySelector("#settingsJsonStringFormatAction")?.value, "ignore");
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageAction")?.value, "warn");
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageIdStart")?.value, "51566");
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageIdStart")?.disabled, false);
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageOptions")?.classList.contains("hidden"), false);
  assert.doesNotMatch(backdrop.innerHTML, /<option value="error"/);
  assert.match(backdrop.innerHTML, /modal-actions settings-lint-actions/);
  const keyUsageAction = document.body.querySelector("#settingsJsonKeyUsageAction");
  keyUsageAction.value = "ignore";
  keyUsageAction.dispatchEvent({ type: "change", bubbles: true });
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageIdStart")?.disabled, true);
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageOptions")?.classList.contains("hidden"), true);
  keyUsageAction.value = "warn";
  keyUsageAction.dispatchEvent({ type: "change", bubbles: true });
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageIdStart")?.disabled, false);
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageOptions")?.classList.contains("hidden"), false);

  const jsonDiagnostics = document.body.querySelector("#settingsJsonDiagnostics");
  jsonDiagnostics.checked = false;
  jsonDiagnostics.dispatchEvent({ type: "change", bubbles: true });
  assert.equal(document.body.querySelector("#settingsJsonDuplicateIdsAction")?.disabled, true);
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageIdStart")?.disabled, true);
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageOptions")?.classList.contains("hidden"), true);

  document.body.querySelector("[data-settings-choice='cancel']").click();
  await pending;
});

test("Lint Options recreates itself in the new locale without discarding an open draft", async () => {
  const { controller, document, state } = makeSettingsController({
    config: { pluginPath: "E:\\Original" }
  });
  const pending = controller.showSettings();
  assert.ok(await waitForSelector(document, ".settings-modal"));
  document.body.querySelector("#settingsPluginPath").value = "E:\\Unsaved draft";
  state.locale = "koKR";
  document.listeners.get("txteditor-locale-changed").at(-1)({ type: "txteditor-locale-changed" });

  const refreshed = await waitForSelector(document, ".settings-modal");
  assert.equal(refreshed?.querySelector("h2")?.textContent, "Lint 옵션");
  assert.equal(document.body.querySelector("#settingsPluginPath")?.value, "E:\\Unsaved draft");
  await pending;
  document.body.querySelector("[data-settings-choice='cancel']").click();
});

test("Vector Lint Options retain diagnostics settings while Game Version is toolbar-only", async () => {
  const { controller, document, calls, state } = makeSettingsController({
    lspStarted: true,
    diagnostics: [{ id: "old" }],
    config: { schemaVersion: "3.2", referenceVersion: "3.2" }
  });

  const savePending = controller.showSettings();
  assert.ok(await waitForSelector(document, ".settings-modal"));
  assert.equal(document.body.querySelectorAll("#settingsGameVersion").length, 0);
  assert.equal(document.body.querySelector("#settingsBasicSection")?.classList.contains("hidden"), false);
  assert.equal(document.body.querySelector("#settingsSchemaVersion"), null);
  assert.equal(document.body.querySelector("#settingsReferenceVersion"), null);
  const jsonDiagnostics = document.body.querySelector("#settingsJsonDiagnostics");
  assert.equal(jsonDiagnostics.checked, false);
  assert.equal(document.body.querySelector("#settingsJsonDuplicateIdsAction").disabled, true);
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageAction").value, "ignore");
  assert.equal(document.body.querySelector("#settingsJsonKeyUsageOptions").classList.contains("hidden"), true);
  jsonDiagnostics.checked = true;
  jsonDiagnostics.dispatchEvent({ type: "change", bubbles: true });
  document.body.querySelector("#settingsJsonDuplicateIdsAction").value = "warn";
  document.body.querySelector("#settingsJsonStringFormatAction").value = "ignore";
  document.body.querySelector("#settingsJsonKeyUsageAction").value = "warn";
  document.body.querySelector("#settingsJsonKeyUsageIdStart").value = "56000.5";
  document.body.querySelector("[data-settings-choice='save']").click();
  await savePending;

  assert.equal(state.config.schemaVersion, "3.2");
  assert.equal(state.config.referenceVersion, "3.2");
  assert.equal(state.config.gameVersion, "3.2");
  assert.equal(state.config.jsonDiagnostics, true);
  assert.deepEqual(state.config.jsonDiagnosticRules, {
    duplicateIds: { action: "warn" },
    stringFormat: { action: "ignore" },
    keyUsage: { action: "warn", idStart: 56000.5 }
  });
  assert.deepEqual(state.lint.diagnostics, []);
  assert.deepEqual(calls.filter((entry) => Array.isArray(entry) && entry[0] === "ensure-document-session"), [
    ["ensure-document-session", { forceRestart: true }]
  ]);
  assert.equal(calls.includes("lsp-start"), false);
  assert.equal(calls.includes("update-grid-diagnostics"), true);

  const restartPending = controller.showSettings();
  assert.ok(await waitForSelector(document, ".settings-modal"));
  document.body.querySelector("[data-settings-choice='restart-lsp']").click();
  await restartPending;

  assert.deepEqual(calls.filter((entry) => Array.isArray(entry) && entry[0] === "ensure-document-session"), [
    ["ensure-document-session", { forceRestart: true }],
    ["ensure-document-session", { forceRestart: true }]
  ]);
});

test("Legacy game-version changes force a fresh Vector session while lint reactivation ensures one", async () => {
  const engineSwitch = makeSettingsController({
    legacy: true,
    config: { schemaVersion: "3.2", referenceVersion: "3.2" }
  });
  assert.equal(await engineSwitch.controller.setLegacyGameVersion("3.1"), true);
  engineSwitch.controller.setLintEngine(LINT_ENGINE_VECTOR);
  assert.equal(engineSwitch.state.lint.engine, LINT_ENGINE_VECTOR);
  assert.equal(engineSwitch.state.config.referenceVersion, "3.1");
  assert.equal(engineSwitch.state.config.gameVersion, "3.1");
  assert.deepEqual(engineSwitch.calls.filter((entry) => Array.isArray(entry) && entry[0] === "ensure-document-session"), [
    ["ensure-document-session", { forceRestart: true }]
  ]);
  assert.equal(engineSwitch.calls.includes("lsp-start"), false);

  const lintEnable = makeSettingsController({ lintEnabled: false });
  await lintEnable.controller.toggleLint();
  assert.equal(lintEnable.state.lint.enabled, true);
  assert.deepEqual(lintEnable.calls.filter((entry) => Array.isArray(entry) && entry[0] === "ensure-document-session"), [
    ["ensure-document-session", { forceRestart: true }]
  ]);

  const workspaceSwitch = makeSettingsController({
    legacy: true,
    workspace: { path: "E:\\Workspace" }
  });
  workspaceSwitch.controller.setLintEngine(LINT_ENGINE_VECTOR);
  assert.equal(workspaceSwitch.calls.includes("lsp-start"), false);
  assert.deepEqual(workspaceSwitch.lspStarts, []);
  assert.deepEqual(workspaceSwitch.calls.filter((entry) => Array.isArray(entry)
    && entry[0] === "ensure-document-session"), [
    ["ensure-document-session", { forceRestart: true }]
  ]);
});

test("Lint Off stops Vector-LSP and Lint On rebuilds the workspace session", async () => {
  const disabled = makeSettingsController({
    lintEnabled: true,
    lspStarted: true,
    workspace: { path: "E:\\Workspace" },
    diagnostics: [{ id: "old" }]
  });

  await disabled.controller.toggleLint();
  assert.equal(disabled.state.lint.enabled, false);
  assert.deepEqual(disabled.state.lint.diagnostics, []);
  assert.deepEqual(disabled.calls.filter((entry) => Array.isArray(entry)
    && entry[0] === "stop-vector-session"), [
    ["stop-vector-session", "lint-disabled"]
  ]);
  assert.equal(disabled.calls.includes("lsp-start"), false);

  await disabled.controller.toggleLint();
  assert.equal(disabled.state.lint.enabled, true);
  assert.deepEqual(disabled.lspStarts, [["E:\\Workspace", { includeSubfolders: true }]]);
});

test("rapid Legacy game-version selections persist latest-wins and schedule one immediate re-lint", async () => {
  const { controller, calls, state } = makeSettingsController({
    legacy: true,
    diagnostics: [{ id: "old" }],
    workspace: { path: "E:\\Workspace" },
    config: { lintMode: "basic", schemaVersion: "3.2" }
  });

  const first = controller.setLegacyGameVersion("3.1");
  const latest = controller.setLegacyGameVersion("2.4");
  assert.equal(await first, false);
  assert.equal(await latest, true);

  assert.equal(state.config.referenceVersion, "2.4");
  assert.equal(state.config.gameVersion, "2.4");
  assert.equal(state.config.schemaVersion, "2.4");
  assert.deepEqual(state.lint.diagnostics, []);
  assert.equal(state.lint.legacy.referenceDataset.status, "not-started");
  assert.deepEqual(state.lint.legacy.referenceDataset.documents, []);
  assert.deepEqual(state.lint.legacy.workspaceIndexCache, { signature: "", profile: "", index: null });
  assert.equal(calls.some((entry) => entry === "lsp-start"), false);
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "schedule-legacy" && entry[1] === "game-version-changed" && entry[2] === 0).length, 1);
  assert.deepEqual(calls
    .filter((entry) => Array.isArray(entry) && entry[0] === "invoke" && entry[1] === "save_config")
    .map((entry) => entry[2].config.referenceVersion), ["3.1", "2.4"]);
});

test("cross-engine game-version selections share one latest-wins save queue", async () => {
  const pendingSaves = [];
  const { controller, calls, state } = makeSettingsController({
    config: { gameVersion: "3.2", schemaVersion: "3.2", referenceVersion: "3.2" },
    saveConfigHandler: () => new Promise((resolve) => pendingSaves.push(resolve))
  });

  const stale = controller.setVectorGameVersion("3.1");
  await waitFor(() => pendingSaves.length === 1);
  controller.setLintEngine("legacy");
  const latest = controller.setLegacyGameVersion("2.4");
  pendingSaves.shift()();
  await waitFor(() => pendingSaves.length === 1);
  pendingSaves.shift()();

  assert.equal(await stale, false);
  assert.equal(await latest, true);
  assert.deepEqual(
    { gameVersion: state.config.gameVersion, schemaVersion: state.config.schemaVersion, referenceVersion: state.config.referenceVersion },
    { gameVersion: "2.4", schemaVersion: "2.4", referenceVersion: "2.4" }
  );
  assert.equal(state.lint.legacy.settings.profile, "2.4");
  assert.equal(state.lint.legacy.referenceDataset.status, "not-started");
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "schedule-legacy" && entry[1] === "game-version-changed").length, 1);
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "ensure-document-session").length, 0);
});

test("a pending Legacy version applies one Vector rebind after an engine switch", async () => {
  const pendingSaves = [];
  const { controller, calls, state } = makeSettingsController({
    legacy: true,
    config: { gameVersion: "3.2", schemaVersion: "3.2", referenceVersion: "3.2" },
    saveConfigHandler: () => new Promise((resolve) => pendingSaves.push(resolve))
  });

  const selection = controller.setLegacyGameVersion("3.1");
  await waitFor(() => pendingSaves.length === 1);
  controller.setLintEngine(LINT_ENGINE_VECTOR);
  pendingSaves.shift()();

  assert.equal(await selection, true);
  assert.equal(state.config.gameVersion, "3.1");
  assert.equal(state.lint.engine, LINT_ENGINE_VECTOR);
  assert.deepEqual(calls.filter((entry) => Array.isArray(entry) && entry[0] === "ensure-document-session"), [
    ["ensure-document-session", { forceRestart: true }]
  ]);
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "schedule-legacy").length, 0);
});

test("a pending Vector version applies one Legacy reference refresh after an engine switch", async () => {
  const pendingSaves = [];
  const { controller, calls, state } = makeSettingsController({
    config: { gameVersion: "3.2", schemaVersion: "3.2", referenceVersion: "3.2" },
    saveConfigHandler: () => new Promise((resolve) => pendingSaves.push(resolve))
  });

  const selection = controller.setVectorGameVersion("1.13c");
  await waitFor(() => pendingSaves.length === 1);
  controller.setLintEngine("legacy");
  pendingSaves.shift()();

  assert.equal(await selection, true);
  assert.equal(state.config.gameVersion, "1.13c");
  assert.equal(state.lint.legacy.settings.profile, "1.13c");
  assert.equal(state.lint.legacy.referenceDataset.status, "not-started");
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "schedule-legacy" && entry[1] === "game-version-changed").length, 1);
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "ensure-document-session").length, 0);
});

test("toolbar game-version changes keep Vector coherent and latest selection wins", async () => {
  const { controller, calls, lintControls, state } = makeSettingsController({
    diagnostics: [{ id: "old" }],
    config: { gameVersion: "3.2", schemaVersion: "3.2", referenceVersion: "3.2" }
  });

  controller.renderLintControls();
  assert.equal(lintControls.querySelectorAll("#lintEngineSelect").length, 1);
  assert.equal(lintControls.querySelectorAll("#lintGameVersionSelect").length, 1);
  assert.equal(lintControls.querySelectorAll("[data-command='toggle-vector-lsp-hover']").length, 1);
  assert.equal(lintControls.querySelectorAll("[data-command='open-settings']").length, 1);

  const first = controller.setVectorGameVersion("3.1");
  const latest = controller.setVectorGameVersion("1.13c");
  assert.equal(await first, false);
  assert.equal(await latest, true);
  assert.deepEqual(
    { gameVersion: state.config.gameVersion, schemaVersion: state.config.schemaVersion, referenceVersion: state.config.referenceVersion },
    { gameVersion: "1.13c", schemaVersion: "1.13", referenceVersion: "1.13c" }
  );
  assert.deepEqual(calls.filter((entry) => Array.isArray(entry) && entry[0] === "ensure-document-session"), [
    ["ensure-document-session", { forceRestart: true }]
  ]);
  assert.equal(state.lint.legacy.settings.profile, "1.13c");
});

test("toolbar changes engine immediately, preserves hover, and only shows it for Vector-LSP", () => {
  const { controller, lintControls, state, calls } = makeSettingsController();
  controller.renderLintControls();
  assert.match(lintControls.innerHTML, /data-command="toggle-vector-lsp-hover"/);
  controller.toggleVectorLspHover();
  assert.equal(state.vectorLspHover, false);

  controller.setLintEngine("legacy");
  controller.renderLintControls();
  assert.doesNotMatch(lintControls.innerHTML, /data-command="toggle-vector-lsp-hover"/);
  assert.match(lintControls.innerHTML, /data-command="toggle-lint-rules"/);
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === "schedule-legacy"), true);
});

test("Advanced Vector options preserve custom paths while Game Version stays toolbar-only", async () => {
  const { controller, document, calls, state } = makeSettingsController({
    lspStarted: true,
    config: {
      lintMode: "advanced",
      gameVersion: "3.2",
      schemaVersion: "3.2",
      referenceVersion: "3.2",
      pluginPath: "E:\\Plugins",
      schemaPath: "E:\\Schemas",
      vectorLspPath: "E:\\Tools\\vector-lsp.exe"
    }
  });
  const pending = controller.showSettings();
  assert.ok(await waitForSelector(document, ".settings-modal"));
  assert.equal(document.body.querySelectorAll("#settingsGameVersion").length, 0);
  assert.equal(document.body.querySelector("#settingsAdvancedSection")?.classList.contains("hidden"), false);
  assert.equal(document.body.querySelector("#settingsPluginPath")?.value, "E:\\Plugins");
  document.body.querySelector("[data-settings-choice='save']").click();
  await pending;

  assert.deepEqual(
    { gameVersion: state.config.gameVersion, schemaVersion: state.config.schemaVersion, referenceVersion: state.config.referenceVersion },
    { gameVersion: "3.2", schemaVersion: "3.2", referenceVersion: "3.2" }
  );
  assert.equal(state.config.pluginPath, "E:\\Plugins");
  assert.equal(state.config.schemaPath, "E:\\Schemas");
  assert.equal(state.config.vectorLspPath, "E:\\Tools\\vector-lsp.exe");
  assert.deepEqual(calls.filter((entry) => Array.isArray(entry) && entry[0] === "ensure-document-session"), [
    ["ensure-document-session", { forceRestart: true }]
  ]);
});

test("switching from Vector to Legacy remaps stale Legacy families from the unified version", async () => {
  for (const [gameVersion, staleProfile, family] of [
    ["3.1", "2.4", "RotW"],
    ["3.2", "1.13c", "RotW"],
    ["1.13c", "RotW", "1.13c"]
  ]) {
    const { controller, calls, state } = makeSettingsController({
      config: {
        gameVersion,
        schemaVersion: gameVersion === "1.13c" ? "1.13" : gameVersion,
        referenceVersion: gameVersion
      }
    });
    state.lint.legacy.settings.profile = staleProfile;
    await controller.loadConfig();
    assert.equal(state.lint.legacy.settings.profile, family);
    state.lint.legacy.settings.profile = staleProfile;
    controller.setLintEngine("legacy");

    assert.equal(state.lint.legacy.settings.profile, family);
    assert.equal(state.config.referenceVersion, gameVersion);
    assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "schedule-legacy" && entry[1] === "engine-switched-legacy").length, 1);
  }
});

test("one Legacy game version selection atomically maps its rule family and bundled reference", async () => {
  const { controller, calls, state } = makeSettingsController({
    legacy: true,
    config: { schemaVersion: "3.2", referenceVersion: "3.2" }
  });
  state.lint.legacy.settings.profile = "RotW";

  assert.equal(await controller.setLegacyGameVersion("1.13c"), true);
  assert.equal(state.lint.legacy.settings.profile, "1.13c");
  assert.deepEqual(
    { gameVersion: state.config.gameVersion, schemaVersion: state.config.schemaVersion, referenceVersion: state.config.referenceVersion },
    { gameVersion: "1.13c", schemaVersion: "1.13", referenceVersion: "1.13c" }
  );
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "schedule-legacy").length, 1);
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

test("rapid Lint Options Save clicks persist JSON diagnostics and restart one latest session", async () => {
  const { controller, document, calls, state } = makeSettingsController({
    lspStarted: true,
    diagnostics: [{ id: "stale-json" }],
    config: { schemaVersion: "3.2", jsonDiagnostics: false }
  });
  const pending = controller.showSettings();
  assert.ok(await waitForSelector(document, ".settings-modal"));
  document.body.querySelector("#settingsJsonDiagnostics").checked = true;
  const saveButton = document.body.querySelector("[data-settings-choice='save']");

  saveButton.click();
  saveButton.click();
  await pending;

  assert.equal(state.config.jsonDiagnostics, true);
  assert.deepEqual(state.config.jsonDiagnosticRules, {
    duplicateIds: { action: "warn" },
    stringFormat: { action: "warn" },
    keyUsage: { action: "ignore", idStart: 40000 }
  });
  assert.deepEqual(state.lint.diagnostics, []);
  assert.equal(calls.filter((entry) => Array.isArray(entry)
    && entry[0] === "invoke" && entry[1] === "save_config").length, 1);
  assert.deepEqual(calls.filter((entry) => Array.isArray(entry)
    && entry[0] === "ensure-document-session"), [
    ["ensure-document-session", { forceRestart: true }]
  ]);
});

test("Lint Options rejects an invalid Key Usage ID threshold without saving or restarting", async () => {
  const { controller, document, calls, state } = makeSettingsController({
    lspStarted: true,
    config: { schemaVersion: "3.2", jsonDiagnostics: true }
  });
  const pending = controller.showSettings();
  assert.ok(await waitForSelector(document, ".settings-modal"));
  const keyUsageAction = document.body.querySelector("#settingsJsonKeyUsageAction");
  keyUsageAction.value = "warn";
  keyUsageAction.dispatchEvent({ type: "change", bubbles: true });
  document.body.querySelector("#settingsJsonKeyUsageIdStart").value = "";
  document.body.querySelector("[data-settings-choice='save']").click();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(state.config, { schemaVersion: "3.2", jsonDiagnostics: true });
  assert.equal(document.body.querySelector(".settings-modal") !== null, true);
  assert.equal(calls.filter((entry) => Array.isArray(entry)
    && entry[0] === "invoke" && entry[1] === "save_config").length, 0);
  assert.equal(calls.filter((entry) => Array.isArray(entry)
    && entry[0] === "ensure-document-session").length, 0);
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "error").length, 1);
  assert.equal(document.body.querySelector("[data-settings-choice='save']").disabled, false);

  document.body.querySelector("[data-settings-choice='cancel']").click();
  await pending;
});

test("Lint Options can disable JSON diagnostics without validating an inactive Key Usage threshold", async () => {
  const { controller, document, calls, state } = makeSettingsController({
    lspStarted: true,
    config: {
      schemaVersion: "3.2",
      jsonDiagnostics: true,
      jsonDiagnosticRules: {
        duplicateIds: { action: "warn" },
        stringFormat: { action: "warn" },
        keyUsage: { action: "warn", idStart: 51566 }
      }
    }
  });
  const pending = controller.showSettings();
  assert.ok(await waitForSelector(document, ".settings-modal"));
  document.body.querySelector("#settingsJsonKeyUsageIdStart").value = "";
  document.body.querySelector("#settingsJsonDiagnostics").checked = false;
  document.body.querySelector("[data-settings-choice='save']").click();
  await pending;

  assert.equal(state.config.jsonDiagnostics, false);
  assert.equal(state.config.jsonDiagnosticRules.keyUsage.idStart, 51566);
  assert.equal(calls.filter((entry) => Array.isArray(entry) && entry[0] === "error").length, 0);
  assert.equal(calls.filter((entry) => Array.isArray(entry)
    && entry[0] === "invoke" && entry[1] === "save_config").length, 1);
});

test("V-TXT-14 keeps config, diagnostics, modal, and LSP session unchanged when config write fails", async () => {
  const originalConfig = {
    lintMode: "advanced",
    pluginPath: "E:\\Plugins",
    schemaPath: "E:\\Schema",
    vectorLspPath: "E:\\Tools\\vector-lsp.exe",
    debugLogging: true,
    jsonDiagnostics: false
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
  document.body.querySelector("#settingsJsonDiagnostics").checked = true;
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
