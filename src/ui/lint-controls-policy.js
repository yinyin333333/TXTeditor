import { tText } from "../core/i18n.js";

export function lintToggleControl(lintEnabled = false) {
  return {
    id: "toggle-lint",
    label: lintEnabled ? tText("lint.on") : tText("lint.offSummary"),
    active: Boolean(lintEnabled)
  };
}

export function lintControlsModel({
  engine = "vector-lsp",
  lintEnabled = false,
  vectorLspHover = true,
  activeGameVersion = "3.3",
  rulesOpen = false
} = {}) {
  const lintButton = lintToggleControl(lintEnabled);
  const engineSelect = {
    id: "lintEngineSelect",
    className: "profile-select",
    title: tText("settings.lintEngine"),
    options: [
      { value: "vector-lsp", label: tText("settings.vectorEngine"), selected: engine === "vector-lsp" },
      { value: "legacy", label: tText("settings.legacyEngine"), selected: engine === "legacy" }
    ]
  };
  const versionSelect = {
    id: "lintGameVersionSelect",
    className: "profile-select",
    title: tText("lint.profileTitle"),
    options: ["3.3", "3.2", "3.1", "2.4", "1.13c"].map((version) => ({
      value: version,
      label: version,
      selected: version === activeGameVersion
    }))
  };
  if (engine === "legacy") {
    return {
      mode: "legacy",
      lintButton,
      engineSelect,
      versionSelect,
      rulesButton: {
        id: "toggle-lint-rules",
        label: tText("lint.rulesButton"),
        active: Boolean(rulesOpen)
      },
      settingsButton: null,
      hideRulesPanel: false
    };
  }
  return {
    mode: "vector-lsp",
    lintButton,
    engineSelect,
    versionSelect,
    hoverButton: {
      id: "toggle-vector-lsp-hover",
      label: tText(vectorLspHover ? "lint.hoverOn" : "lint.hoverOff"),
      active: Boolean(vectorLspHover),
      title: tText("settings.vectorHover")
    },
    rulesButton: null,
    settingsButton: {
      id: "open-settings",
      label: tText("command.open-settings"),
      title: tText("lint.optionsTitle")
    },
    hideRulesPanel: true
  };
}
