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
  activeGameVersion = "3.2",
  rulesOpen = false
} = {}) {
  const lintButton = lintToggleControl(lintEnabled);
  if (engine === "legacy") {
    return {
      mode: "legacy",
      lintButton,
      versionSelect: {
        id: "lintGameVersionSelect",
        className: "profile-select",
        title: tText("lint.profileTitle"),
        options: ["3.2", "3.1", "2.4", "1.13c"].map((version) => ({
          value: version,
          label: version,
          selected: version === activeGameVersion
        }))
      },
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
    profileSelect: null,
    referenceSelect: null,
    rulesButton: null,
    settingsButton: {
      id: "open-settings",
      label: tText("command.open-settings"),
      title: tText("lint.optionsTitle")
    },
    hideRulesPanel: true
  };
}
