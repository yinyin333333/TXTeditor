import {
  getConfig,
  isTauriRuntime,
  listWorkspaceNative,
  pickFilePath,
  pickFolderPath,
  saveConfig
} from "../../core/io.js";
import {
  lintProfileOptions,
  lintRuleGroupsForProfile
} from "../../core/lint-engine.js";
import {
  LINT_ENGINE_VECTOR,
  legacyLintImmediateSchedule,
  lintEngineStorageValue,
  legacyLintSettingsStorageValue,
  lintSettingsStorageValue,
  normalizeLintEngine,
  vectorLspHoverStorageValue
} from "../../core/lint-controller-policy.js";
import {
  appSettingsVisualControls,
  normaliseGridFont
} from "../app-settings-policy.js";
import { dockSettingsControls } from "../dock-layout-policy.js";
import { lintControlsModel } from "../lint-controls-policy.js";
import { LOCALE_OPTIONS, tText } from "../../core/i18n.js";

export function shouldCloseSettingsKey(key) {
  return key === "Escape";
}

const JSON_RULE_ACTIONS = [
  ["ignore", "settings.jsonActionOff"],
  ["warn", "settings.jsonActionWarning"]
];
const DEFAULT_JSON_KEY_USAGE_ID_START = 40000;

function normalizeJsonRuleAction(value, fallback = "warn") {
  if (value === "error") return "warn";
  return JSON_RULE_ACTIONS.some(([action]) => action === value) ? value : fallback;
}

function normalizeJsonDiagnosticRules(value) {
  return {
    duplicateIds: { action: normalizeJsonRuleAction(value?.duplicateIds?.action) },
    stringFormat: { action: normalizeJsonRuleAction(value?.stringFormat?.action) },
    keyUsage: {
      action: normalizeJsonRuleAction(value?.keyUsage?.action, "ignore"),
      idStart: Number.isFinite(value?.keyUsage?.idStart)
        ? value.keyUsage.idStart
        : DEFAULT_JSON_KEY_USAGE_ID_START
    }
  };
}

function jsonRuleActionOptions(selected, translate = tText) {
  return JSON_RULE_ACTIONS.map(([value, labelKey]) =>
    `<option value="${value}"${selected === value ? " selected" : ""}>${translate(labelKey)}</option>`
  ).join("");
}

function parseJsonKeyUsageIdStart(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function bindEscapeToClose(close) {
  const onKeydown = (event) => {
    if (!shouldCloseSettingsKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  document.addEventListener("keydown", onKeydown, true);
  return () => document.removeEventListener("keydown", onKeydown, true);
}

export function createSettingsController({
  state,
  els,
  grid,
  dockForPanel,
  setPanelDock,
  resetDockLayout,
  isLegacyLintEngine,
  isVectorLintEngine,
  effectiveVectorLspHoverEnabled,
  cancelLegacyLintJobs,
  scheduleLegacyLintFull,
  legacyLintDisplayActive,
  currentLegacyProfileRules,
  invalidateLspHover,
  setLintDiagnostics,
  updateGridDiagnostics,
  lspStartWorkspace,
  ensureDocumentSession = async () => {},
  resetLegacyWorkspaceIndex = () => {},
  refreshJsonEditorAppearance = () => {},
  recordLintEngineEvent,
  renderChrome,
  reportBackgroundFailure,
  showError,
  t = tText,
  setLocale = async (locale) => locale,
  escapeHtml
}) {
  let legacyReferenceSelectionRequest = 0;
  let workspaceScopeRequest = 0;
  let legacyReferenceSaveQueue = Promise.resolve();
  let configLoaded = Object.keys(state.config ?? {}).length > 0;
  let configSnapshot = { ...(state.config ?? {}) };

  async function loadConfig() {
    const config = await getConfig();
    state.config = config ?? {};
    configSnapshot = { ...state.config };
    configLoaded = true;
    renderLintControls();
  }

  function toggleTheme() {
    setTheme(state.theme === "dark" ? "light" : "dark");
  }

  function setTheme(theme) {
    state.theme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    localStorage.setItem("txteditor.theme", state.theme);
    grid.syncTheme();
    grid.draw();
    refreshJsonEditorAppearance();
    renderChrome();
  }

  function toggleColorize() {
    setColorizeColumns(!state.colorizeColumns);
  }

  function setColorizeColumns(enabled) {
    state.colorizeColumns = Boolean(enabled);
    localStorage.setItem("txteditor.colorize", state.colorizeColumns ? "on" : "off");
    grid.setColorizeColumns(state.colorizeColumns);
    renderChrome();
  }

  function setMouseResizeLocked(locked) {
    state.mouseResizeLocked = Boolean(locked);
    localStorage.setItem("txteditor.mouseResizeLocked", state.mouseResizeLocked ? "on" : "off");
    grid.setMouseResizeLocked(state.mouseResizeLocked);
    renderChrome();
  }

  async function setExcludeWorkspaceSubfolders(excluded) {
    const next = Boolean(excluded);
    const request = ++workspaceScopeRequest;
    const workspace = state.workspace;
    if (!workspace?.path || !isTauriRuntime()) {
      state.excludeWorkspaceSubfolders = next;
      localStorage.setItem("txteditor.excludeWorkspaceSubfolders", next ? "on" : "off");
      renderChrome();
      return true;
    }

    const includeSubfolders = !next;
    const refreshed = await listWorkspaceNative(workspace.path, null, { includeSubfolders });
    if (request !== workspaceScopeRequest || state.workspace !== workspace) return false;
    if (!refreshed || !Array.isArray(refreshed.files)) {
      throw new Error("Workspace refresh returned an invalid file list.");
    }
    state.excludeWorkspaceSubfolders = next;
    localStorage.setItem("txteditor.excludeWorkspaceSubfolders", next ? "on" : "off");
    state.workspace = refreshed;
    resetLegacyWorkspaceIndex();
    setLintDiagnostics([]);
    updateGridDiagnostics();
    if (isVectorLintEngine()) {
      await ensureDocumentSession({ forceRestart: true });
    } else {
      const schedule = legacyLintImmediateSchedule("workspace-subfolders-changed");
      scheduleLegacyLintFull(schedule.reason, schedule.delay);
    }
    renderChrome();
    return true;
  }

  function toggleVectorLspHover() {
    setVectorLspHover(!state.vectorLspHover);
  }

  function setVectorLspHover(enabled) {
    state.vectorLspHover = Boolean(enabled);
    localStorage.setItem("txteditor.vectorLspHover", vectorLspHoverStorageValue(state.vectorLspHover));
    invalidateLspHover(!state.vectorLspHover, state.vectorLspHover ? "hover-enabled" : "hover-disabled");
    grid.setVectorLspHoverEnabled(effectiveVectorLspHoverEnabled());
    renderChrome();
  }

  function setLintEngine(engine) {
    const next = normalizeLintEngine(engine);
    if (state.lint.engine === next) return;
    const previous = state.lint.engine;
    state.lint.engine = next;
    localStorage.setItem("txteditor.lint.engine", lintEngineStorageValue(state.lint.engine));
    cancelLegacyLintJobs({ clearDiagnostics: false });
    invalidateLspHover(next !== LINT_ENGINE_VECTOR, `lint-engine-${next}`);
    setLintDiagnostics([]);
    updateGridDiagnostics();
    grid.setVectorLspHoverEnabled(effectiveVectorLspHoverEnabled());
    recordLintEngineEvent("engine-switch", { previous, next });
    if (isLegacyLintEngine()) {
      const schedule = legacyLintImmediateSchedule("engine-switched-legacy");
      scheduleLegacyLintFull(schedule.reason, schedule.delay);
    } else {
      ensureDocumentSession({ forceRestart: true }).catch(showError);
    }
    renderChrome();
  }

  function toggleLint() {
    state.lint.enabled = !state.lint.enabled;
    if (!state.lint.enabled) {
      cancelLegacyLintJobs({ clearDiagnostics: false });
      setLintDiagnostics([]);
      updateGridDiagnostics();
    } else if (isLegacyLintEngine() && state.problemsVisible) {
      const schedule = legacyLintImmediateSchedule("lint-enabled");
      scheduleLegacyLintFull(schedule.reason, schedule.delay);
    } else if (isVectorLintEngine() && !state.lsp.started) {
      ensureDocumentSession({}).catch(showError);
    }
    saveLintSettings();
    renderChrome();
  }

  function toggleLintRules() {
    if (!isLegacyLintEngine()) return;
    state.lint.legacy.rulesOpen = !state.lint.legacy.rulesOpen;
    renderChrome();
  }

  function setLegacyLintProfile(profile) {
    state.lint.legacy.settings.profile = lintProfileOptions().includes(profile) ? profile : "RotW";
    setLintDiagnostics([]);
    updateGridDiagnostics();
    saveLegacyLintSettings();
    if (legacyLintDisplayActive()) {
      const schedule = legacyLintImmediateSchedule("profile-changed");
      scheduleLegacyLintFull(schedule.reason, schedule.delay);
    }
    renderChrome();
  }

  async function setLegacyLintReferenceVersion(value) {
    const supported = new Set(["", "3.2", "3.1", "2.4", "1.13c"]);
    const referenceVersion = supported.has(String(value ?? "")) ? String(value ?? "") : "";
    const request = ++legacyReferenceSelectionRequest;
    const save = legacyReferenceSaveQueue
      .catch(() => {})
      .then(async () => {
        if (!configLoaded) {
          configSnapshot = { ...((await getConfig()) ?? {}) };
          configLoaded = true;
        }
        const updated = {
          ...configSnapshot,
          referenceVersion: referenceVersion || undefined
        };
        await saveConfig(updated);
        configSnapshot = updated;
        return updated;
      });
    legacyReferenceSaveQueue = save;
    try {
      const updated = await save;
      if (request !== legacyReferenceSelectionRequest) return false;
      state.config = updated;
    } catch (error) {
      if (request === legacyReferenceSelectionRequest) {
        showError(tText("error.referenceSave", { error }, state.locale));
        renderChrome();
      }
      return false;
    }
    invalidateLegacyReferenceData("reference-version-changed");
    renderChrome();
    return true;
  }

  function invalidateLegacyReferenceData(reason) {
    state.lint.legacy.referenceDataset = {
      status: "not-started",
      selectedVersion: "",
      gameVersion: "",
      schemaVariant: "",
      digest: "",
      documents: [],
      error: "",
      loadMs: 0
    };
    state.lint.legacy.workspaceIndexCache = { signature: "", profile: "", index: null };
    setLintDiagnostics([]);
    updateGridDiagnostics();
    if (legacyLintDisplayActive()) {
      const schedule = legacyLintImmediateSchedule(reason);
      scheduleLegacyLintFull(schedule.reason, schedule.delay);
    }
  }

  function setLegacyLintRuleEnabled(ruleId, enabled) {
    const rule = currentLegacyProfileRules()[ruleId];
    if (!rule) return;
    rule.enabled = Boolean(enabled);
    saveLegacyLintSettings();
    if (legacyLintDisplayActive()) scheduleLegacyLintFull("settings-changed", 120);
    renderChrome();
  }

  function changeGridFont(value) {
    state.gridFont = normaliseGridFont(value);
    localStorage.setItem("txteditor.gridFont", state.gridFont);
    document.documentElement.style.setProperty("--grid-font", state.gridFont);
    grid.setFontFamily(state.gridFont);
    refreshJsonEditorAppearance();
    renderChrome();
  }

  function showAppSettings() {
    const translate = (key, params = {}) => t(key, params, state.locale);
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const visualControls = appSettingsVisualControls({
      colorizeColumns: state.colorizeColumns,
      mouseResizeLocked: state.mouseResizeLocked,
      excludeWorkspaceSubfolders: state.excludeWorkspaceSubfolders,
      vectorLspHover: state.vectorLspHover,
      legacyLintEngine: isLegacyLintEngine(),
      theme: state.theme,
      gridFont: state.gridFont
    });
    const fontOptions = visualControls.font.options.map(([label, value]) =>
      `<option value="${escapeHtml(value)}"${visualControls.font.value === value ? " selected" : ""}>${escapeHtml(label)}</option>`
    ).join("");
    const themeControls = visualControls.themes.map((option) =>
      `<button class="${option.active ? "active" : ""}" data-settings-theme="${option.theme}">${option.label}</button>`
    ).join("");
    const dockControls = dockSettingsControls({ layout: state.dockLayout }).map((control) => `
      <div>
        <div class="settings-label">${control.label}</div>
        <div class="settings-segmented" role="group" aria-label="${control.label}">
          ${control.options.map((option) => `<button class="${option.active ? "active" : ""}" data-settings-dock-panel="${control.panel}" data-settings-dock-edge="${option.edge}">${option.label}</button>`).join("")}
        </div>
      </div>
    `).join("");
    const localeOptions = LOCALE_OPTIONS.map(([value, label]) =>
      `<option value="${value}"${state.locale === value ? " selected" : ""}>${escapeHtml(label)}</option>`
    ).join("");
    backdrop.innerHTML = `
      <div class="modal settings-modal">
        <h2 data-settings-i18n="toolbar.settings">${translate("toolbar.settings")}</h2>
        <div class="settings-stack">
          <label class="settings-label" for="settingsLocale" data-settings-i18n="settings.language">${translate("settings.language")}</label>
          <select class="modal-input settings-font-select" id="settingsLocale">${localeOptions}</select>
          <label class="settings-checkbox-label">
            <input type="checkbox" id="${visualControls.colorize.id}"${visualControls.colorize.checked ? " checked" : ""} />
            ${visualControls.colorize.label}
          </label>
          <label class="settings-checkbox-label">
            <input type="checkbox" id="${visualControls.mouseResize.id}"${visualControls.mouseResize.checked ? " checked" : ""} />
            ${visualControls.mouseResize.label}
          </label>
          <label class="settings-checkbox-label">
            <input type="checkbox" id="${visualControls.workspaceSubfolders.id}"${visualControls.workspaceSubfolders.checked ? " checked" : ""} />
            ${visualControls.workspaceSubfolders.label}
          </label>
          <div class="settings-label" data-settings-i18n="settings.lintEngine">${translate("settings.lintEngine")}</div>
          <div class="settings-segmented" role="group" aria-label="${translate("settings.lintEngine")}">
            <button class="${isVectorLintEngine() ? "active" : ""}" data-settings-lint-engine="vector-lsp">${translate("settings.vectorEngine")}</button>
            <button class="${isLegacyLintEngine() ? "active" : ""}" data-settings-lint-engine="legacy">${translate("settings.legacyEngine")}</button>
          </div>
          <label class="settings-checkbox-label">
            <input type="checkbox" id="${visualControls.vectorHover.id}"${visualControls.vectorHover.checked ? " checked" : ""}${visualControls.vectorHover.disabled ? " disabled" : ""} />
            ${visualControls.vectorHover.label}
          </label>
          <div class="settings-hint${visualControls.vectorHover.hintHidden ? " hidden" : ""}" id="${visualControls.vectorHover.hintId}">${visualControls.vectorHover.hintText}</div>
          <label class="settings-label" for="${visualControls.font.id}">${visualControls.font.label}</label>
          <select class="modal-input settings-font-select" id="${visualControls.font.id}">${fontOptions}</select>
          <div class="settings-label" data-settings-i18n="settings.theme">${translate("settings.theme")}</div>
          <div class="settings-segmented" role="group" aria-label="${translate("settings.theme")}">
            ${themeControls}
          </div>
          <div class="settings-dock-row">
            ${dockControls}
          </div>
          <div class="settings-reset-row">
            <button data-settings-reset-layout data-settings-i18n="settings.resetLayout">${translate("settings.resetLayout")}</button>
          </div>
        </div>
        <div class="modal-actions">
          <button data-settings-close data-settings-i18n="common.close">${translate("common.close")}</button>
        </div>
      </div>`;
    document.body.append(backdrop);

    const colorizeInput = backdrop.querySelector("#settingsColorizeColumns");
    const mouseResizeInput = backdrop.querySelector("#settingsMouseResizeLocked");
    const workspaceSubfoldersInput = backdrop.querySelector("#settingsExcludeWorkspaceSubfolders");
    const hoverInput = backdrop.querySelector("#settingsVectorLspHover");
    const hoverHint = backdrop.querySelector("#settingsVectorLspHoverHint");
    const fontInput = backdrop.querySelector("#settingsGridFont");
    const localeInput = backdrop.querySelector("#settingsLocale");
    const lintEngineButtons = [...backdrop.querySelectorAll("[data-settings-lint-engine]")];
    const themeButtons = [...backdrop.querySelectorAll("[data-settings-theme]")];
    const dockButtons = [...backdrop.querySelectorAll("[data-settings-dock-panel]")];
    const refresh = () => {
      colorizeInput.checked = state.colorizeColumns;
      mouseResizeInput.checked = state.mouseResizeLocked;
      workspaceSubfoldersInput.checked = state.excludeWorkspaceSubfolders;
      hoverInput.checked = state.vectorLspHover;
      hoverInput.disabled = isLegacyLintEngine();
      hoverHint?.classList.toggle("hidden", !isLegacyLintEngine());
      fontInput.value = state.gridFont;
      localeInput.value = state.locale;
      for (const button of lintEngineButtons) button.classList.toggle("active", button.dataset.settingsLintEngine === state.lint.engine);
      for (const button of themeButtons) button.classList.toggle("active", button.dataset.settingsTheme === state.theme);
      for (const button of dockButtons) button.classList.toggle("active", dockForPanel(button.dataset.settingsDockPanel) === button.dataset.settingsDockEdge);
    };
    const refreshLocaleLabels = () => {
      for (const element of backdrop.querySelectorAll("[data-settings-i18n]")) {
        element.textContent = translate(element.dataset.settingsI18n);
      }
    };
    colorizeInput.addEventListener("change", () => { setColorizeColumns(colorizeInput.checked); refresh(); });
    mouseResizeInput.addEventListener("change", () => { setMouseResizeLocked(mouseResizeInput.checked); refresh(); });
    workspaceSubfoldersInput.addEventListener("change", () => {
      setExcludeWorkspaceSubfolders(workspaceSubfoldersInput.checked)
        .then((applied) => {
          if (applied) refresh();
        })
        .catch((error) => {
          refresh();
          showError(error);
        });
    });
    hoverInput.addEventListener("change", () => { setVectorLspHover(hoverInput.checked); refresh(); });
    fontInput.addEventListener("change", () => { changeGridFont(fontInput.value); refresh(); });
    localeInput.addEventListener("change", () => {
      setLocale(localeInput.value).then(() => {
        refresh();
        refreshLocaleLabels();
      }).catch(showError);
    });
    for (const button of lintEngineButtons) {
      button.addEventListener("click", () => { setLintEngine(button.dataset.settingsLintEngine); refresh(); });
    }
    for (const button of themeButtons) {
      button.addEventListener("click", () => { setTheme(button.dataset.settingsTheme); refresh(); });
    }
    for (const button of dockButtons) {
      button.addEventListener("click", () => { setPanelDock(button.dataset.settingsDockPanel, button.dataset.settingsDockEdge); refresh(); });
    }
    backdrop.querySelector("[data-settings-reset-layout]")?.addEventListener("click", () => { resetDockLayout(); refresh(); });

    let closed = false;
    let unbindEscape = null;
    const close = () => {
      if (closed) return;
      closed = true;
      unbindEscape?.();
      document.removeEventListener("txteditor-locale-changed", refreshForLocale);
      backdrop.remove();
      els.host.focus();
    };
    const refreshForLocale = () => {
      if (closed) return;
      close();
      showAppSettings();
    };
    document.addEventListener("txteditor-locale-changed", refreshForLocale);
    unbindEscape = bindEscapeToClose(close);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.closest("[data-settings-close]")) close();
    });
  }

  async function showSettings(draftConfig = null) {
    if (isLegacyLintEngine()) {
      state.lint.legacy.rulesOpen = true;
      renderChrome();
      return;
    }
    const config = draftConfig ?? await getConfig().catch((error) => {
      reportBackgroundFailure("Configuration load", error, "settings");
      return {};
    });
    const translate = (key, params = {}) => t(key, params, state.locale);
    const mode = config.lintMode ?? "basic";
    const schemaVersion = config.schemaVersion ?? "3.2";
    const VERSIONS = ["3.2", "3.1", "2.4", "1.13"];
    const versionOptions = VERSIONS.map((v) =>
      `<option value="${escapeHtml(v)}"${schemaVersion === v ? " selected" : ""}>${escapeHtml(v)}</option>`
    ).join("");
    const referenceVersion = config.referenceVersion ?? "";
    const referenceVersionOptions = [
      ["", translate("settings.useSchemaProfileVersion")],
      ["3.2", "3.2"],
      ["3.1", "3.1"],
      ["2.4", "2.4"],
      ["1.13c", "1.13c"]
    ].map(([value, label]) =>
      `<option value="${escapeHtml(value)}"${referenceVersion === value ? " selected" : ""}>${escapeHtml(label)}</option>`
    ).join("");
    const jsonRules = normalizeJsonDiagnosticRules(config.jsonDiagnosticRules);

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal settings-modal">
        <h2>${translate("lint.optionsTitle")}</h2>
        <div class="settings-tabs">
          <button class="settings-tab${mode === "basic" ? " active" : ""}" data-settings-tab="basic">${translate("settings.basic")}</button>
          <button class="settings-tab${mode === "advanced" ? " active" : ""}" data-settings-tab="advanced">${translate("settings.advanced")}</button>
        </div>
        <div id="settingsBasicSection" class="settings-tab-panel${mode !== "basic" ? " hidden" : ""}">
          <label class="settings-label">${translate("settings.schemaVersion")}</label>
          <select class="modal-input settings-version-select" id="settingsSchemaVersion">${versionOptions}</select>
        </div>
        <div id="settingsAdvancedSection" class="settings-tab-panel${mode !== "advanced" ? " hidden" : ""}">
          <label class="settings-label">${translate("settings.pluginFolder")}</label>
          <div class="settings-row">
            <input class="modal-input" id="settingsPluginPath"
              value="${escapeHtml(config.pluginPath ?? "")}"
              placeholder="${translate("settings.pluginFolderPlaceholder")}" />
            ${isTauriRuntime() ? `<button class="settings-browse-btn" id="settingsBrowsePluginBtn">${translate("common.browse")}&hellip;</button>` : ""}
          </div>
          <label class="settings-label">${translate("settings.schemaFolder")}</label>
          <div class="settings-row">
            <input class="modal-input" id="settingsSchemaPath"
              value="${escapeHtml(config.schemaPath ?? "")}"
              placeholder="${translate("settings.schemaFolderPlaceholder")}" />
            ${isTauriRuntime() ? `<button class="settings-browse-btn" id="settingsBrowseSchemaBtn">${translate("common.browse")}&hellip;</button>` : ""}
          </div>
          <label class="settings-label">${translate("settings.vectorLspPath")}</label>
          <div class="settings-row">
            <input class="modal-input" id="settingsLspPath"
              value="${escapeHtml(config.vectorLspPath ?? "")}"
              placeholder="${translate("settings.vectorLspPathPlaceholder")}" />
            ${isTauriRuntime() ? `<button class="settings-browse-btn" id="settingsBrowseLspBtn">${translate("common.browse")}&hellip;</button>` : ""}
          </div>
        </div>
        <label class="settings-label">${translate("settings.bundledReferenceData")}</label>
        <select class="modal-input settings-version-select" id="settingsReferenceVersion">${referenceVersionOptions}</select>
        <div class="settings-hint">${translate("settings.referenceVersionHint")}</div>
        <div class="settings-debug-row">
          <label class="settings-checkbox-label">
            <input type="checkbox" id="settingsJsonDiagnostics" aria-controls="settingsJsonDiagnosticRules"${config.jsonDiagnostics ? " checked" : ""} />
            ${translate("settings.jsonDiagnostics")}
          </label>
          <div class="settings-hint">${translate("settings.jsonDiagnosticsHint")}</div>
          <div class="settings-json-rules" id="settingsJsonDiagnosticRules">
            <div class="settings-json-rule">
              <label for="settingsJsonDuplicateIdsAction">
                <span>${translate("settings.jsonDuplicateIds")}</span>
                <span class="settings-json-rule-code">Json/DuplicateIds</span>
              </label>
              <select class="modal-input" id="settingsJsonDuplicateIdsAction">${jsonRuleActionOptions(jsonRules.duplicateIds.action, translate)}</select>
            </div>
            <div class="settings-json-rule">
              <label for="settingsJsonStringFormatAction">
                <span>${translate("settings.jsonStringFormat")}</span>
                <span class="settings-json-rule-code">Json/StringFormat</span>
              </label>
              <select class="modal-input" id="settingsJsonStringFormatAction">${jsonRuleActionOptions(jsonRules.stringFormat.action, translate)}</select>
            </div>
            <div class="settings-json-rule">
              <label for="settingsJsonKeyUsageAction">
                <span>${translate("settings.jsonKeyUsage")}</span>
                <span class="settings-json-rule-code">Json/KeyUsage</span>
              </label>
              <select class="modal-input" id="settingsJsonKeyUsageAction">${jsonRuleActionOptions(jsonRules.keyUsage.action, translate)}</select>
            </div>
            <div class="settings-json-key-usage-options${config.jsonDiagnostics && jsonRules.keyUsage.action !== "ignore" ? "" : " hidden"}" id="settingsJsonKeyUsageOptions">
              <div class="settings-json-id-start">
                <label for="settingsJsonKeyUsageIdStart">${translate("settings.jsonKeyUsageIdStart")}</label>
                <input class="modal-input" type="number" id="settingsJsonKeyUsageIdStart"
                  step="any" value="${jsonRules.keyUsage.idStart}" />
              </div>
              <div class="settings-hint">${translate("settings.jsonKeyUsageHint", { id: jsonRules.keyUsage.idStart })}</div>
            </div>
          </div>
        </div>
        <div class="settings-debug-row">
          <label class="settings-checkbox-label">
            <input type="checkbox" id="settingsDebugLogging"${config.debugLogging ? " checked" : ""} />
            ${translate("settings.debugLogging")}
          </label>
        </div>
        <div class="modal-actions settings-lint-actions">
          <button data-settings-choice="save">${translate("common.save")}</button>
          <button data-settings-choice="cancel">${translate("common.cancel")}</button>
          ${state.lsp.started ? `<button data-settings-choice="restart-lsp" style="margin-left:auto">${translate("settings.restartLsp")}</button>` : ""}
        </div>
      </div>`;
    document.body.append(backdrop);

    const basicSection = backdrop.querySelector("#settingsBasicSection");
    const advancedSection = backdrop.querySelector("#settingsAdvancedSection");
    const tabs = backdrop.querySelectorAll(".settings-tab");
    const lspInput = backdrop.querySelector("#settingsLspPath");
    const schemaInput = backdrop.querySelector("#settingsSchemaPath");
    const pluginInput = backdrop.querySelector("#settingsPluginPath");
    const versionSelect = backdrop.querySelector("#settingsSchemaVersion");
    const referenceVersionSelect = backdrop.querySelector("#settingsReferenceVersion");
    const jsonDiagnosticsEl = backdrop.querySelector("#settingsJsonDiagnostics");
    const jsonDuplicateIdsActionEl = backdrop.querySelector("#settingsJsonDuplicateIdsAction");
    const jsonStringFormatActionEl = backdrop.querySelector("#settingsJsonStringFormatAction");
    const jsonKeyUsageActionEl = backdrop.querySelector("#settingsJsonKeyUsageAction");
    const jsonKeyUsageOptionsEl = backdrop.querySelector("#settingsJsonKeyUsageOptions");
    const jsonKeyUsageIdStartEl = backdrop.querySelector("#settingsJsonKeyUsageIdStart");
    const jsonActionControls = [
      jsonDuplicateIdsActionEl,
      jsonStringFormatActionEl,
      jsonKeyUsageActionEl
    ].filter(Boolean);

    if (jsonDuplicateIdsActionEl) jsonDuplicateIdsActionEl.value = jsonRules.duplicateIds.action;
    if (jsonStringFormatActionEl) jsonStringFormatActionEl.value = jsonRules.stringFormat.action;
    if (jsonKeyUsageActionEl) jsonKeyUsageActionEl.value = jsonRules.keyUsage.action;
    const syncJsonRuleControls = () => {
      const masterDisabled = !(jsonDiagnosticsEl?.checked ?? false);
      for (const control of jsonActionControls) control.disabled = masterDisabled;
      const keyUsageDisabled = masterDisabled || jsonKeyUsageActionEl?.value === "ignore";
      jsonKeyUsageOptionsEl?.classList.toggle("hidden", keyUsageDisabled);
      if (jsonKeyUsageIdStartEl) {
        jsonKeyUsageIdStartEl.disabled = keyUsageDisabled;
      }
    };
    jsonDiagnosticsEl?.addEventListener("change", syncJsonRuleControls);
    jsonKeyUsageActionEl?.addEventListener("change", syncJsonRuleControls);
    syncJsonRuleControls();

    tabs.forEach((tab) => tab.addEventListener("click", () => {
      const isBasic = tab.dataset.settingsTab === "basic";
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      basicSection.classList.toggle("hidden", !isBasic);
      advancedSection.classList.toggle("hidden", isBasic);
    }));

    backdrop.querySelector("#settingsBrowsePluginBtn")?.addEventListener("click", async () => {
      const picked = await pickFolderPath().catch((error) => {
        reportBackgroundFailure("Plugin folder picker", error, "settings");
        return null;
      });
      if (picked) pluginInput.value = picked;
    });

    backdrop.querySelector("#settingsBrowseSchemaBtn")?.addEventListener("click", async () => {
      const picked = await pickFolderPath().catch((error) => {
        reportBackgroundFailure("Schema folder picker", error, "settings");
        return null;
      });
      if (picked) schemaInput.value = picked;
    });

    backdrop.querySelector("#settingsBrowseLspBtn")?.addEventListener("click", async () => {
      const picked = await pickFilePath().catch((error) => {
        reportBackgroundFailure("Vector-LSP path picker", error, "settings");
        return null;
      });
      if (picked) lspInput.value = picked;
    });

    return new Promise((resolve) => {
      let closed = false;
      let saving = false;
      let unbindEscape = null;
      let refreshForLocale = null;
      const finish = () => {
        if (closed) return;
        closed = true;
        unbindEscape?.();
        document.removeEventListener("txteditor-locale-changed", refreshForLocale);
        backdrop.remove();
        els.host.focus();
        resolve();
      };
      refreshForLocale = () => {
        if (closed) return;
        const draft = {
          ...config,
          lintMode: backdrop.querySelector(".settings-tab.active")?.dataset.settingsTab ?? mode,
          schemaVersion: versionSelect?.value || schemaVersion,
          referenceVersion: referenceVersionSelect?.value || undefined,
          pluginPath: pluginInput?.value ?? config.pluginPath,
          schemaPath: schemaInput?.value ?? config.schemaPath,
          vectorLspPath: lspInput?.value ?? config.vectorLspPath,
          debugLogging: backdrop.querySelector("#settingsDebugLogging")?.checked ?? config.debugLogging,
          jsonDiagnostics: jsonDiagnosticsEl?.checked ?? config.jsonDiagnostics,
          jsonDiagnosticRules: {
            duplicateIds: { action: normalizeJsonRuleAction(jsonDuplicateIdsActionEl?.value) },
            stringFormat: { action: normalizeJsonRuleAction(jsonStringFormatActionEl?.value) },
            keyUsage: {
              action: normalizeJsonRuleAction(jsonKeyUsageActionEl?.value, "ignore"),
              idStart: parseJsonKeyUsageIdStart(jsonKeyUsageIdStartEl?.value) ?? jsonRules.keyUsage.idStart
            }
          }
        };
        finish();
        void showSettings(draft);
      };
      document.addEventListener("txteditor-locale-changed", refreshForLocale);
      unbindEscape = bindEscapeToClose(finish);
      backdrop.addEventListener("click", async (event) => {
        const choice = event.target.closest("[data-settings-choice]")?.dataset.settingsChoice;
        if (choice === "save") {
          if (saving) return;
          saving = true;
          const saveButton = backdrop.querySelector('[data-settings-choice="save"]');
          if (saveButton) saveButton.disabled = true;
          const selectedMode = backdrop.querySelector(".settings-tab.active")?.dataset.settingsTab ?? "basic";
          const debugLoggingEl = backdrop.querySelector("#settingsDebugLogging");
          const jsonDiagnosticsEnabled = jsonDiagnosticsEl?.checked ?? false;
          const jsonKeyUsageAction = normalizeJsonRuleAction(jsonKeyUsageActionEl?.value);
          const parsedJsonKeyUsageIdStart = parseJsonKeyUsageIdStart(jsonKeyUsageIdStartEl?.value);
          const jsonKeyUsageNeedsThreshold = jsonDiagnosticsEnabled && jsonKeyUsageAction !== "ignore";
          if (jsonKeyUsageNeedsThreshold && parsedJsonKeyUsageIdStart === null) {
            showError(tText("error.keyUsageThreshold", {}, state.locale));
            jsonKeyUsageIdStartEl?.focus();
            saving = false;
            if (saveButton) saveButton.disabled = false;
            return;
          }
          const jsonKeyUsageIdStart = parsedJsonKeyUsageIdStart ?? jsonRules.keyUsage.idStart;
          const updated = {
            ...config,
            lintMode: selectedMode,
            schemaVersion: versionSelect?.value || "3.2",
            referenceVersion: referenceVersionSelect?.value || undefined,
            pluginPath: pluginInput?.value.trim() || undefined,
            schemaPath: schemaInput?.value.trim() || undefined,
            vectorLspPath: lspInput?.value.trim() || undefined,
            debugLogging: debugLoggingEl?.checked ?? false,
            jsonDiagnostics: jsonDiagnosticsEnabled,
            jsonDiagnosticRules: {
              duplicateIds: { action: normalizeJsonRuleAction(jsonDuplicateIdsActionEl?.value) },
              stringFormat: { action: normalizeJsonRuleAction(jsonStringFormatActionEl?.value) },
              keyUsage: {
                action: jsonKeyUsageAction,
                idStart: jsonKeyUsageIdStart
              }
            }
          };
          try {
            await saveConfig(updated);
          } catch (err) {
            showError(tText("error.lintOptionsSave", { error: err }, state.locale));
            saving = false;
            if (saveButton) saveButton.disabled = false;
            return;
          }
          state.config = updated;
          configSnapshot = { ...updated };
          configLoaded = true;
          finish();
          if (isLegacyLintEngine()) {
            invalidateLegacyReferenceData("reference-version-changed");
          } else {
            setLintDiagnostics([]);
            updateGridDiagnostics();
            ensureDocumentSession({ forceRestart: true }).catch(showError);
          }
        }
        if (choice === "cancel") finish();
        if (choice === "restart-lsp") {
          finish();
          ensureDocumentSession({ forceRestart: true }).catch(showError);
        }
      });
    });
  }

  function saveLintSettings() {
    localStorage.setItem("txteditor.lint.settings", lintSettingsStorageValue(state.lint));
  }

  function saveLegacyLintSettings() {
    localStorage.setItem("txteditor.legacyLint.settings", legacyLintSettingsStorageValue(state.lint.legacy.settings));
  }

  function renderLintControls() {
    if (!els.lintControls) return;
    const controls = lintControlsModel({
      engine: state.lint.engine,
      lintEnabled: state.lint.enabled,
      profiles: lintProfileOptions(),
      activeProfile: state.lint.legacy.settings.profile,
      activeReferenceVersion: state.config?.referenceVersion ?? "",
      rulesOpen: state.lint.legacy.rulesOpen
    });
    const lintButton = `<button class="toggle-button${controls.lintButton.active ? " active" : ""}" data-command="${controls.lintButton.id}">${controls.lintButton.label}</button>`;
    if (controls.mode === "legacy") {
      const options = controls.profileSelect.options.map((option) =>
        `<option value="${escapeHtml(option.value)}"${option.selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`
      ).join("");
      const referenceOptions = controls.referenceSelect.options.map((option) =>
        `<option value="${escapeHtml(option.value)}"${option.selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`
      ).join("");
      els.lintControls.innerHTML = `
        ${lintButton}
        <select id="${controls.profileSelect.id}" class="${controls.profileSelect.className}" title="${controls.profileSelect.title}">${options}</select>
        <select id="${controls.referenceSelect.id}" class="${controls.referenceSelect.className}" title="${controls.referenceSelect.title}">${referenceOptions}</select>
        <button data-command="${controls.rulesButton.id}" class="${controls.rulesButton.active ? "active" : ""}">${controls.rulesButton.label}</button>
      `;
      const select = els.lintControls.querySelector("#lintProfileSelect");
      select?.addEventListener("change", () => setLegacyLintProfile(select.value));
      const referenceSelect = els.lintControls.querySelector("#lintReferenceVersionSelect");
      referenceSelect?.addEventListener("change", () => {
        setLegacyLintReferenceVersion(referenceSelect.value).catch((error) => showError(error));
      });
      renderLegacyLintRulesPanel();
      return;
    }
    els.lintControls.innerHTML = `
      ${lintButton}
      <button data-command="${controls.settingsButton.id}" title="${controls.settingsButton.title}">${controls.settingsButton.label}</button>
    `;
    if (controls.hideRulesPanel && els.lintRulesPanel) {
      els.lintRulesPanel.classList.add("hidden");
      els.lintRulesPanel.innerHTML = "";
    }
  }

  function renderLegacyLintRulesPanel() {
    if (!els.lintRulesPanel) return;
    if (!isLegacyLintEngine() || !state.lint.legacy.rulesOpen) {
      els.lintRulesPanel.classList.add("hidden");
      els.lintRulesPanel.innerHTML = "";
      return;
    }
    els.lintRulesPanel.classList.remove("hidden");
    els.lintRulesPanel.innerHTML = lintRuleGroupsForProfile(state.lint.legacy.settings.profile, state.locale).map((group) => `
      <section class="lint-rule-group">
        <h3>${escapeHtml(group.group)}</h3>
        ${group.rules.map((entry) => {
          const setting = currentLegacyProfileRules()[entry.id];
          const checked = setting?.enabled ? "checked" : "";
          const disabled = entry.implemented ? "" : "disabled";
          const note = `<span class="lint-rule-note">${escapeHtml(entry.note || entry.id)}</span>`;
          return `
            <div class="lint-rule">
              <input id="lint-${escapeHtml(entry.id)}" type="checkbox" data-lint-rule="${escapeHtml(entry.id)}" ${checked} ${disabled} />
              <label for="lint-${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</label>
              ${note}
            </div>`;
        }).join("")}
      </section>
    `).join("");
    for (const input of els.lintRulesPanel.querySelectorAll("[data-lint-rule]")) {
      input.addEventListener("change", () => setLegacyLintRuleEnabled(input.dataset.lintRule, input.checked));
    }
  }

  return {
    changeGridFont,
    loadConfig,
    renderLegacyLintRulesPanel,
    renderLintControls,
    saveLegacyLintSettings,
    saveLintSettings,
    setColorizeColumns,
    setMouseResizeLocked,
    setExcludeWorkspaceSubfolders,
    setLegacyLintProfile,
    setLegacyLintReferenceVersion,
    setLegacyLintRuleEnabled,
    setLintEngine,
    setLocale,
    setTheme,
    setVectorLspHover,
    showAppSettings,
    showSettings,
    toggleColorize,
    toggleLint,
    toggleLintRules,
    toggleTheme,
    toggleVectorLspHover
  };
}
