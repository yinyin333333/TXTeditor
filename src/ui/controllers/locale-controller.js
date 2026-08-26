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
  renderChrome,
  refreshJsonEditorLocale = () => {}
}) {
  let localeRequestSequence = 0;

  async function restartLsp(session) {
    if (session.started && session.workspacePath) {
      await lspController.startWorkspace(session.workspacePath, {
        forceRestart: true,
        contextMode: session.contextMode,
        referenceRootPath: session.referenceRootPath,
        includeSubfolders: session.includeSubfolders
      });
    } else {
      await lspController.ensureStandaloneSession(activeDoc(), { forceRestart: true });
    }
  }

  async function setLocale(locale) {
    const requestSequence = ++localeRequestSequence;
    const lspSession = {
      started: state.lsp.started,
      generation: Number(state.lsp.generation) || 0,
      workspacePath: state.lsp.workspacePath,
      contextMode: state.lsp.contextMode,
      referenceRootPath: state.lsp.referenceRootPath,
      includeSubfolders: state.lsp.includeSubfolders
    };
    state.locale = persistLocale(locale, { storage });
    applyDocumentLocale(ownerDocument, state.locale);
    refreshJsonEditorLocale();
    if (legacyActive()) {
      scheduleLegacyLintFull("locale-changed", 0);
    } else if (state.lint?.enabled !== false) {
      lspController.invalidateHover(true, "locale-changed");
      if (state.lsp.started && typeof lspController.changeLocale === "function") {
        try {
          await lspController.changeLocale(state.locale);
        } catch {
          if (requestSequence === localeRequestSequence
            && (Number(state.lsp.generation) || 0) === lspSession.generation) {
            await restartLsp(lspSession);
          }
        }
      } else if (requestSequence === localeRequestSequence) {
        await restartLsp(lspSession);
      }
    }
    renderChrome();
    return state.locale;
  }

  return { setLocale };
}
