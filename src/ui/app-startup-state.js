import { SelectionModel } from "../core/selection.js";
import {
  createDefaultLintSettings,
  normalizeLintSettings
} from "../core/lint-engine.js";
import {
  normalizeLintEngine,
  vectorLspHoverFromStorage
} from "../core/lint-controller-policy.js";
import {
  DEFAULT_DOCK_LAYOUT,
  normalizeDockLayout
} from "./dock-layout-policy.js";
import {
  DOCK_LAYOUT_KEY,
  panelStateFromStorage
} from "./panel-state-policy.js";
import { initialSearchState } from "./search-policy.js";
import { normaliseGridFont } from "./app-settings-policy.js";
import { readJsonStorage } from "./app-runtime-utils.js";
import { loadShortcutBindings } from "./shortcut-policy.js";

export function createInitialAppState({ storage = localStorage } = {}) {
  const savedTheme = storage.getItem("txteditor.theme") === "light" ? "light" : "dark";
  const savedGridFont = normaliseGridFont(storage.getItem("txteditor.gridFont"));
  const savedColorize = storage.getItem("txteditor.colorize") === "on";
  const savedMouseResizeLocked = storage.getItem("txteditor.mouseResizeLocked") === "on";
  const savedVectorLspHover = vectorLspHoverFromStorage(storage.getItem("txteditor.vectorLspHover"));
  const savedLintEnabled = readJsonStorage("txteditor.lint.settings", {}).enabled !== false;
  const savedLintEngine = normalizeLintEngine(storage.getItem("txteditor.lint.engine"));
  const savedLegacyLintSettings = normalizeLintSettings(readJsonStorage("txteditor.legacyLint.settings", createDefaultLintSettings()));
  const savedDockLayout = normalizeDockLayout(readJsonStorage(DOCK_LAYOUT_KEY, DEFAULT_DOCK_LAYOUT));
  const savedPanelState = panelStateFromStorage(storage, savedDockLayout);
  const savedShortcuts = loadShortcutBindings(storage);
  const state = {
    docs: [],
    active: 0,
    selection: new SelectionModel(),
    workspace: null,
    search: initialSearchState(),
    sidebarVisible: savedPanelState.sidebarVisible,
    sidebarWidth: savedPanelState.sidebarWidth,
    sidebarHeight: savedPanelState.sidebarHeight,
    problemsVisible: savedPanelState.problemsVisible,
    problemsWidth: savedPanelState.problemsWidth,
    problemsHeight: savedPanelState.problemsHeight,
    dockLayout: savedPanelState.dockLayout,
    freezeRow: false,
    freezeColumn: false,
    contextHit: null,
    contextMenuActiveGroup: "",
    contextMenuOpen: false,
    theme: savedTheme,
    gridFont: savedGridFont,
    colorizeColumns: savedColorize,
    mouseResizeLocked: savedMouseResizeLocked,
    vectorLspHover: savedVectorLspHover,
    shortcuts: savedShortcuts,
    lint: {
      engine: savedLintEngine,
      enabled: savedLintEnabled,
      diagnostics: [],
      status: "",
      version: 0,
      legacy: {
        settings: savedLegacyLintSettings,
        timer: 0,
        pendingRun: null,
        version: 0,
        running: false,
        status: "",
        rulesOpen: false,
        lastRunAt: 0,
        workspaceDocs: [],
        workspaceLoad: {
          status: "not-started",
          files: [],
          error: "",
          signature: ""
        },
        workspaceIndexCache: {
          signature: "",
          profile: "",
          index: null
        },
        workspaceRefreshRequired: false,
        siblingDocs: [],
        siblingLoad: {
          status: "not-started",
          files: [],
          roots: [],
          error: "",
          signature: ""
        },
        referenceDataset: {
          status: "not-started",
          selectedVersion: "",
          gameVersion: "",
          schemaVariant: "",
          digest: "",
          documents: [],
          error: "",
          loadMs: 0
        }
      }
    },
    lsp: {
      started: false,
      workspacePath: "",
      workspaceKey: "",
      contextMode: "workspace",
      referenceRootPath: "",
      generation: 0,
      readiness: "stopped",
      openFileCount: 0
    },
    config: {},
    bottomTab: "problems",
    lspLogs: []
  };

  return { state, savedTheme, savedGridFont, savedPanelState };
}
