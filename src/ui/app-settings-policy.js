import { tText } from "../core/i18n.js";

export const DEFAULT_GRID_FONT = "'Cascadia Mono', Consolas, 'Segoe UI Mono', monospace";

export const FONT_OPTIONS = [
  ["Cascadia Mono", "'Cascadia Mono', Consolas, 'Segoe UI Mono', monospace"],
  ["Cascadia Code", "'Cascadia Code', 'Cascadia Mono', Consolas, monospace"],
  ["Consolas", "Consolas, 'Cascadia Mono', monospace"],
  ["Segoe UI Mono", "'Segoe UI Mono', Consolas, monospace"],
  ["JetBrains Mono", "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"],
  ["Fira Code", "'Fira Code', 'Cascadia Code', Consolas, monospace"],
  ["Roboto Mono", "'Roboto Mono', Consolas, monospace"],
  ["Noto Sans Mono", "'Noto Sans Mono', Consolas, monospace"],
  ["Lucida Console", "'Lucida Console', Consolas, monospace"],
  ["Lucida Sans Typewriter", "'Lucida Sans Typewriter', 'Lucida Console', monospace"],
  ["Courier New", "'Courier New', Consolas, monospace"],
  ["Arial", "Arial, 'Segoe UI', sans-serif"],
  ["Arial Black", "'Arial Black', Arial, sans-serif"],
  ["Arial Narrow", "'Arial Narrow', Arial, sans-serif"],
  ["Aptos", "Aptos, Calibri, 'Segoe UI', sans-serif"],
  ["Aptos Mono", "'Aptos Mono', 'Cascadia Mono', Consolas, monospace"],
  ["Bahnschrift", "Bahnschrift, 'Segoe UI', sans-serif"],
  ["Book Antiqua", "'Book Antiqua', Palatino, serif"],
  ["Bookman Old Style", "'Bookman Old Style', Georgia, serif"],
  ["Calibri", "Calibri, Aptos, 'Segoe UI', sans-serif"],
  ["Cambria", "Cambria, Georgia, serif"],
  ["Candara", "Candara, Calibri, 'Segoe UI', sans-serif"],
  ["Century Gothic", "'Century Gothic', Arial, sans-serif"],
  ["Corbel", "Corbel, Calibri, 'Segoe UI', sans-serif"],
  ["Franklin Gothic Medium", "'Franklin Gothic Medium', Arial, sans-serif"],
  ["Georgia", "Georgia, Cambria, serif"],
  ["Lucida Sans Unicode", "'Lucida Sans Unicode', 'Lucida Grande', sans-serif"],
  ["Microsoft Sans Serif", "'Microsoft Sans Serif', 'Segoe UI', sans-serif"],
  ["Segoe UI", "'Segoe UI', Arial, sans-serif"],
  ["Segoe UI Variable", "'Segoe UI Variable', 'Segoe UI', Arial, sans-serif"],
  ["Segoe UI Semibold", "'Segoe UI Semibold', 'Segoe UI', Arial, sans-serif"],
  ["Tahoma", "Tahoma, 'Segoe UI', sans-serif"],
  ["Times New Roman", "'Times New Roman', Cambria, serif"],
  ["Trebuchet MS", "'Trebuchet MS', Arial, sans-serif"],
  ["Verdana", "Verdana, 'Segoe UI', sans-serif"],
  ["Yu Gothic UI", "'Yu Gothic UI', 'Segoe UI', sans-serif"],
  ["Malgun Gothic", "'Malgun Gothic', 'Segoe UI', sans-serif"],
  ["Microsoft YaHei UI", "'Microsoft YaHei UI', 'Segoe UI', sans-serif"],
  ["Microsoft JhengHei UI", "'Microsoft JhengHei UI', 'Segoe UI', sans-serif"],
  ["Meiryo", "Meiryo, 'Segoe UI', sans-serif"],
  ["MS Gothic", "'MS Gothic', monospace"],
  ["MS Mincho", "'MS Mincho', serif"]
];

export function normaliseGridFont(value) {
  if (!value || value === "custom") return DEFAULT_GRID_FONT;
  return String(value).trim() || DEFAULT_GRID_FONT;
}

export function fontLabelFromFamily(fontFamily) {
  return String(fontFamily).split(",")[0].replaceAll("'", "").replaceAll("\"", "").trim() || "Selected Font";
}

export function appSettingsVisualControls({
  colorizeColumns = false,
  mouseResizeLocked = false,
  excludeWorkspaceSubfolders = false,
  vectorLspHover = true,
  legacyLintEngine = false,
  theme = "dark",
  gridFont = DEFAULT_GRID_FONT
} = {}) {
  return {
    colorize: { id: "settingsColorizeColumns", label: tText("settings.colorizeColumns"), checked: Boolean(colorizeColumns) },
    mouseResize: {
      id: "settingsMouseResizeLocked",
      label: tText("settings.lockResize"),
      checked: Boolean(mouseResizeLocked)
    },
    workspaceSubfolders: {
      id: "settingsExcludeWorkspaceSubfolders",
      label: tText("settings.excludeSubfolders"),
      checked: Boolean(excludeWorkspaceSubfolders)
    },
    vectorHover: {
      id: "settingsVectorLspHover",
      label: tText("settings.vectorHover"),
      checked: Boolean(vectorLspHover),
      disabled: Boolean(legacyLintEngine),
      hintId: "settingsVectorLspHoverHint",
      hintHidden: !legacyLintEngine,
      hintText: tText("settings.vectorHoverHint")
    },
    font: {
      id: "settingsGridFont",
      label: tText("settings.font"),
      value: normaliseGridFont(gridFont),
      options: FONT_OPTIONS
    },
    themes: [
      { theme: "dark", label: tText("theme.dark"), active: theme !== "light" },
      { theme: "light", label: tText("theme.light"), active: theme === "light" }
    ]
  };
}
