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
        title: "D2R lint profile",
        options: profiles.map((profile) => ({
          value: profile,
          label: profile,
          selected: profile === activeProfile
        }))
      },
      referenceSelect: {
        id: "lintReferenceVersionSelect",
        className: "profile-select",
        title: "Bundled reference data version",
        options: ["", "3.2", "3.1", "2.4", "1.13c"].map((version) => ({
          value: version,
          label: version || "Profile",
          selected: version === activeReferenceVersion
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
    referenceSelect: null,
    rulesButton: null,
    settingsButton: {
      id: "open-settings",
      label: "Lint Options",
      title: "Lint options"
    },
    hideRulesPanel: true
  };
}
