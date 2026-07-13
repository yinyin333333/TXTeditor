import {
  getConfig,
  isTauriRuntime,
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

export function shouldCloseSettingsKey(key) {
  return key === "Escape";
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
  syncOpenDocsToVectorLsp,
  recordLintEngineEvent,
  renderChrome,
  reportBackgroundFailure,
  showError,
  escapeHtml
}) {
  async function loadConfig() {
    const config = await getConfig();
    state.config = config ?? {};
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
    } else if (state.workspace?.path) {
      lspStartWorkspace(state.workspace.path).catch(showError);
    } else if (state.lsp.started) {
      syncOpenDocsToVectorLsp().catch(showError);
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
    } else if (isVectorLintEngine() && state.workspace?.path && !state.lsp.started) {
      lspStartWorkspace(state.workspace.path).catch(showError);
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
    renderChrome();
  }

  function showAppSettings() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const visualControls = appSettingsVisualControls({
      colorizeColumns: state.colorizeColumns,
      mouseResizeLocked: state.mouseResizeLocked,
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
    backdrop.innerHTML = `
      <div class="modal settings-modal">
        <h2>Settings</h2>
        <div class="settings-stack">
          <label class="settings-checkbox-label">
            <input type="checkbox" id="${visualControls.colorize.id}"${visualControls.colorize.checked ? " checked" : ""} />
            ${visualControls.colorize.label}
          </label>
          <label class="settings-checkbox-label">
            <input type="checkbox" id="${visualControls.mouseResize.id}"${visualControls.mouseResize.checked ? " checked" : ""} />
            ${visualControls.mouseResize.label}
          </label>
          <div class="settings-label">Lint Engine</div>
          <div class="settings-segmented" role="group" aria-label="Lint Engine">
            <button class="${isVectorLintEngine() ? "active" : ""}" data-settings-lint-engine="vector-lsp">Vector-LSP</button>
            <button class="${isLegacyLintEngine() ? "active" : ""}" data-settings-lint-engine="legacy">Legacy Lint</button>
          </div>
          <label class="settings-checkbox-label">
            <input type="checkbox" id="${visualControls.vectorHover.id}"${visualControls.vectorHover.checked ? " checked" : ""}${visualControls.vectorHover.disabled ? " disabled" : ""} />
            ${visualControls.vectorHover.label}
          </label>
          <div class="settings-hint${visualControls.vectorHover.hintHidden ? " hidden" : ""}" id="${visualControls.vectorHover.hintId}">${visualControls.vectorHover.hintText}</div>
          <label class="settings-label" for="${visualControls.font.id}">${visualControls.font.label}</label>
          <select class="modal-input settings-font-select" id="${visualControls.font.id}">${fontOptions}</select>
          <div class="settings-label">Theme</div>
          <div class="settings-segmented" role="group" aria-label="Theme">
            ${themeControls}
          </div>
          <div class="settings-dock-row">
            ${dockControls}
          </div>
          <div class="settings-reset-row">
            <button data-settings-reset-layout>Reset Layout</button>
          </div>
        </div>
        <div class="modal-actions">
          <button data-settings-close>Close</button>
        </div>
      </div>`;
    document.body.append(backdrop);

    const colorizeInput = backdrop.querySelector("#settingsColorizeColumns");
    const mouseResizeInput = backdrop.querySelector("#settingsMouseResizeLocked");
    const hoverInput = backdrop.querySelector("#settingsVectorLspHover");
    const hoverHint = backdrop.querySelector("#settingsVectorLspHoverHint");
    const fontInput = backdrop.querySelector("#settingsGridFont");
    const lintEngineButtons = [...backdrop.querySelectorAll("[data-settings-lint-engine]")];
    const themeButtons = [...backdrop.querySelectorAll("[data-settings-theme]")];
    const dockButtons = [...backdrop.querySelectorAll("[data-settings-dock-panel]")];
    const refresh = () => {
      colorizeInput.checked = state.colorizeColumns;
      mouseResizeInput.checked = state.mouseResizeLocked;
      hoverInput.checked = state.vectorLspHover;
      hoverInput.disabled = isLegacyLintEngine();
      hoverHint?.classList.toggle("hidden", !isLegacyLintEngine());
      fontInput.value = state.gridFont;
      for (const button of lintEngineButtons) button.classList.toggle("active", button.dataset.settingsLintEngine === state.lint.engine);
      for (const button of themeButtons) button.classList.toggle("active", button.dataset.settingsTheme === state.theme);
      for (const button of dockButtons) button.classList.toggle("active", dockForPanel(button.dataset.settingsDockPanel) === button.dataset.settingsDockEdge);
    };
    colorizeInput.addEventListener("change", () => { setColorizeColumns(colorizeInput.checked); refresh(); });
    mouseResizeInput.addEventListener("change", () => { setMouseResizeLocked(mouseResizeInput.checked); refresh(); });
    hoverInput.addEventListener("change", () => { setVectorLspHover(hoverInput.checked); refresh(); });
    fontInput.addEventListener("change", () => { changeGridFont(fontInput.value); refresh(); });
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
      backdrop.remove();
      els.host.focus();
    };
    unbindEscape = bindEscapeToClose(close);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.closest("[data-settings-close]")) close();
    });
  }

  async function showSettings() {
    if (isLegacyLintEngine()) {
      state.lint.legacy.rulesOpen = true;
      renderChrome();
      return;
    }
    const config = await getConfig().catch((error) => {
      reportBackgroundFailure("Configuration load", error, "settings");
      return {};
    });
    const mode = config.lintMode ?? "basic";
    const schemaVersion = config.schemaVersion ?? "3.2";
    const VERSIONS = ["3.2", "3.1", "2.4", "1.13"];
    const versionOptions = VERSIONS.map((v) =>
      `<option value="${escapeHtml(v)}"${schemaVersion === v ? " selected" : ""}>${escapeHtml(v)}</option>`
    ).join("");

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal settings-modal">
        <h2>Lint Options</h2>
        <div class="settings-tabs">
          <button class="settings-tab${mode === "basic" ? " active" : ""}" data-settings-tab="basic">Basic</button>
          <button class="settings-tab${mode === "advanced" ? " active" : ""}" data-settings-tab="advanced">Advanced</button>
        </div>
        <div id="settingsBasicSection" class="settings-tab-panel${mode !== "basic" ? " hidden" : ""}">
          <label class="settings-label">Schema Version</label>
          <select class="modal-input settings-version-select" id="settingsSchemaVersion">${versionOptions}</select>
        </div>
        <div id="settingsAdvancedSection" class="settings-tab-panel${mode !== "advanced" ? " hidden" : ""}">
          <label class="settings-label">Plugin Folder</label>
          <div class="settings-row">
            <input class="modal-input" id="settingsPluginPath"
              value="${escapeHtml(config.pluginPath ?? "")}"
              placeholder="Path to plugins directory" />
            ${isTauriRuntime() ? `<button class="settings-browse-btn" id="settingsBrowsePluginBtn">Browse&hellip;</button>` : ""}
          </div>
          <label class="settings-label">Schema Folder</label>
          <div class="settings-row">
            <input class="modal-input" id="settingsSchemaPath"
              value="${escapeHtml(config.schemaPath ?? "")}"
              placeholder="Path to schema directory" />
            ${isTauriRuntime() ? `<button class="settings-browse-btn" id="settingsBrowseSchemaBtn">Browse&hellip;</button>` : ""}
          </div>
          <label class="settings-label">Linter (vector-lsp) Path</label>
          <div class="settings-row">
            <input class="modal-input" id="settingsLspPath"
              value="${escapeHtml(config.vectorLspPath ?? "")}"
              placeholder="Path to vector-lsp executable (auto-detect if blank)" />
            ${isTauriRuntime() ? `<button class="settings-browse-btn" id="settingsBrowseLspBtn">Browse&hellip;</button>` : ""}
          </div>
        </div>
        <div class="settings-debug-row">
          <label class="settings-checkbox-label">
            <input type="checkbox" id="settingsDebugLogging"${config.debugLogging ? " checked" : ""} />
            Enable debug logging (shows in Log panel)
          </label>
        </div>
        <div class="modal-actions">
          <button data-settings-choice="save">Save</button>
          <button data-settings-choice="cancel">Cancel</button>
          ${state.lsp.started ? `<button data-settings-choice="restart-lsp" style="margin-left:auto">Restart LSP</button>` : ""}
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
      const finish = () => {
        if (closed) return;
        closed = true;
        unbindEscape?.();
        backdrop.remove();
        els.host.focus();
        resolve();
      };
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
          const updated = {
            ...config,
            lintMode: selectedMode,
            schemaVersion: versionSelect?.value || "3.2",
            pluginPath: pluginInput?.value.trim() || undefined,
            schemaPath: schemaInput?.value.trim() || undefined,
            vectorLspPath: lspInput?.value.trim() || undefined,
            debugLogging: debugLoggingEl?.checked ?? false
          };
          try {
            await saveConfig(updated);
          } catch (err) {
            showError(`Failed to save lint options: ${err}`);
            saving = false;
            if (saveButton) saveButton.disabled = false;
            return;
          }
          state.config = updated;
          finish();
          if (state.workspace) {
            setLintDiagnostics([]);
            updateGridDiagnostics();
            lspStartWorkspace(state.workspace.path, { forceRestart: true }).catch(showError);
          }
        }
        if (choice === "cancel") finish();
        if (choice === "restart-lsp") {
          finish();
          if (state.workspace) lspStartWorkspace(state.workspace.path, { forceRestart: true }).catch(showError);
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
      rulesOpen: state.lint.legacy.rulesOpen
    });
    const lintButton = `<button class="toggle-button${controls.lintButton.active ? " active" : ""}" data-command="${controls.lintButton.id}">${controls.lintButton.label}</button>`;
    if (controls.mode === "legacy") {
      const options = controls.profileSelect.options.map((option) =>
        `<option value="${escapeHtml(option.value)}"${option.selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`
      ).join("");
      els.lintControls.innerHTML = `
        ${lintButton}
        <select id="${controls.profileSelect.id}" class="${controls.profileSelect.className}" title="${controls.profileSelect.title}">${options}</select>
        <button data-command="${controls.rulesButton.id}" class="${controls.rulesButton.active ? "active" : ""}">${controls.rulesButton.label}</button>
      `;
      const select = els.lintControls.querySelector("#lintProfileSelect");
      select?.addEventListener("change", () => setLegacyLintProfile(select.value));
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
    els.lintRulesPanel.innerHTML = lintRuleGroupsForProfile(state.lint.legacy.settings.profile).map((group) => `
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
    setLegacyLintProfile,
    setLegacyLintRuleEnabled,
    setLintEngine,
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
