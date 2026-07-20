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
  profiles = [],
  activeProfile = "RotW",
  activeReferenceVersion = "",
  rulesOpen = false
} = {}) {
  const lintButton = lintToggleControl(lintEnabled);
  if (engine === "legacy") {
    return {
      mode: "legacy",
      lintButton,
      profileSelect: {
        id: "lintProfileSelect",
        className: "profile-select",
        title: tText("lint.profileTitle"),
        options: profiles.map((profile) => ({
          value: profile,
          label: profile,
          selected: profile === activeProfile
        }))
      },
      referenceSelect: {
        id: "lintReferenceVersionSelect",
        className: "profile-select",
        title: tText("lint.referenceTitle"),
        options: ["", "3.2", "3.1", "2.4", "1.13c"].map((version) => ({
          value: version,
          label: version || tText("lint.profile"),
          selected: version === activeReferenceVersion
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
