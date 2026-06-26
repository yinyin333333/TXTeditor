export function lintToggleControl(lintEnabled = false) {
  return {
    id: "toggle-lint",
    label: lintEnabled ? "Lint: On" : "Lint: Off",
    active: Boolean(lintEnabled)
  };
}

export function lintControlsModel({
  engine = "vector-lsp",
  lintEnabled = false,
  profiles = [],
  activeProfile = "RotW",
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
        title: "D2R lint profile",
        options: profiles.map((profile) => ({
          value: profile,
          label: profile,
          selected: profile === activeProfile
        }))
      },
      rulesButton: {
        id: "toggle-lint-rules",
        label: "Rules",
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
    rulesButton: null,
    settingsButton: {
      id: "open-settings",
      label: "Lint Options",
      title: "Lint options"
    },
    hideRulesPanel: true
  };
}
