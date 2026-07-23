import { applyDocumentLocale, setLocale as persistLocale } from "../../core/i18n.js";

export function initializeLocale({ state, storage = localStorage, ownerDocument = document }) {
  state.locale = persistLocale(state.locale, { storage });
  applyDocumentLocale(ownerDocument, state.locale);
  return state.locale;
}

export function createLocaleController({
  state,
  storage = localStorage,
  ownerDocument = document,
  legacyActive,
  scheduleLegacyLintFull,
  lspController,
  activeDoc,
  setLintDiagnostics,
  updateGridDiagnostics,
  renderChrome,
  refreshJsonEditorLocale = () => {}
}) {
  async function setLocale(locale) {
    state.locale = persistLocale(locale, { storage });
    applyDocumentLocale(ownerDocument, state.locale);
    refreshJsonEditorLocale();
    if (legacyActive()) {
      scheduleLegacyLintFull("locale-changed", 0);
    } else if (state.lint?.enabled !== false) {
      lspController.invalidateHover(true, "locale-changed");
      setLintDiagnostics([]);
      updateGridDiagnostics();
      if (state.lsp.started && state.lsp.workspacePath) {
        await lspController.startWorkspace(state.lsp.workspacePath, {
          forceRestart: true,
          contextMode: state.lsp.contextMode,
          referenceRootPath: state.lsp.referenceRootPath,
          includeSubfolders: state.lsp.includeSubfolders
        });
      } else {
        await lspController.ensureStandaloneSession(activeDoc(), { forceRestart: true });
      }
    }
    renderChrome();
    return state.locale;
  }

  return { setLocale };
}
