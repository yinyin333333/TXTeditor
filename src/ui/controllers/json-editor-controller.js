import { lspRangeToJsonOffsets } from "../../core/json-document.js";
import { loadJsonEditorModule } from "../json-editor-module-loader.js";

export function createJsonEditorController({
  gridHost,
  jsonHost,
  loadModule = loadJsonEditorModule,
  onDocumentChanged = () => {},
  onLoadError = () => {}
}) {
  let moduleApi = null;
  let view = null;
  let currentDocument = null;
  let activationToken = 0;

  function available() {
    return Boolean(jsonHost && typeof loadModule === "function");
  }

  async function showDocument(doc, { focus = true } = {}) {
    if (!doc || doc.kind !== "json") return false;
    const token = ++activationToken;
    gridHost?.classList.add("hidden");
    jsonHost?.classList.remove("hidden");
    if (currentDocument === doc && view) {
      if (focus) view.focus();
      return true;
    }
    unmountCurrent();
    currentDocument = doc;
    try {
      moduleApi ??= await loadModule();
    } catch (error) {
      if (token === activationToken) {
        currentDocument = null;
        jsonHost?.classList.add("hidden");
        gridHost?.classList.remove("hidden");
      }
      onLoadError(error);
      return false;
    }
    if (token !== activationToken || currentDocument !== doc) return false;
    const state = doc.editorState ?? moduleApi.createJsonEditorState({
      text: doc.text,
      lineSeparator: doc.lineEnding,
      onChange: (text, nextState, changeMeta = {}) => {
        doc.editorState = nextState;
        if (doc.applyEditorText(text)) onDocumentChanged(doc, changeMeta);
      }
    });
    view = moduleApi.createJsonEditorView({ parent: jsonHost, state });
    doc.editorState = view.state;
    if (focus) view.focus();
    return true;
  }

  function showTable() {
    activationToken += 1;
    unmountCurrent();
    currentDocument = null;
    jsonHost?.classList.add("hidden");
    gridHost?.classList.remove("hidden");
  }

  async function navigateToDiagnostic(doc, diagnostic) {
    if (!await showDocument(doc, { focus: false })) return false;
    doc.activeDiagnosticId = diagnostic.id ?? null;
    const range = {
      start: {
        line: diagnostic.rowIndex,
        character: diagnostic.startCharacter ?? diagnostic.columnIndex ?? 0
      },
      end: {
        line: diagnostic.endRowIndex ?? diagnostic.rowIndex,
        character: diagnostic.endCharacter ?? diagnostic.startCharacter ?? diagnostic.columnIndex ?? 0
      }
    };
    moduleApi.selectAndReveal(
      view,
      lspRangeToJsonOffsets(view.state.doc.toString(), range)
    );
    return true;
  }

  function reconcileDiagnosticHighlight(diagnostics = []) {
    if (!currentDocument?.activeDiagnosticId) return;
    const exists = diagnostics.some((diagnostic) => (
      diagnostic.id === currentDocument.activeDiagnosticId
      && diagnostic.filePath === currentDocument.path
    ));
    if (exists) return;
    currentDocument.activeDiagnosticId = null;
    moduleApi?.clearDiagnosticHighlight?.(view);
  }

  async function reloadActiveDocument(doc) {
    if (currentDocument !== doc) return;
    activationToken += 1;
    unmountCurrent();
    currentDocument = null;
    await showDocument(doc, { focus: false });
  }

  function unmountCurrent() {
    if (currentDocument && view) currentDocument.editorState = view.state;
    view?.destroy();
    view = null;
  }

  function commitActive() {
    if (currentDocument && view) {
      currentDocument.editorState = view.state;
      currentDocument.applyEditorText(view.state.doc.toString());
    }
  }

  function focusActive() {
    view?.focus();
  }

  function refreshAppearance() {
    moduleApi?.refreshJsonEditorAppearance?.(view);
  }

  function refreshLocale() {
    moduleApi?.refreshJsonEditorLocale?.(view);
  }

  function editorOwnsTarget(target) {
    const ElementCtor = globalThis.Element;
    return Boolean(ElementCtor && target instanceof ElementCtor && target.closest(".cm-editor"));
  }

  function run(name) {
    return Boolean(view && moduleApi?.[name]?.(view));
  }

  return {
    available,
    commitActive,
    editorOwnsTarget,
    findNext: () => run("findNextJson"),
    findPrevious: () => run("findPreviousJson"),
    focusActive,
    navigateToDiagnostic,
    openReplace: () => run("openJsonReplace"),
    openSearch: () => run("openJsonSearch"),
    reconcileDiagnosticHighlight,
    refreshAppearance,
    refreshLocale,
    redo: () => run("redoJsonEditor"),
    reloadActiveDocument,
    selectAll: () => run("selectAllJson"),
    showDocument,
    showTable,
    undo: () => run("undoJsonEditor")
  };
}
