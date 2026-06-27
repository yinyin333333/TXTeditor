import { TableDocument } from "../../core/table-model.js";
import { isTextLikeFile, isTextLikePath } from "../../core/text-file-policy.js";
import {
  closeWindow,
  isTauriRuntime,
  openFilesNative,
  openNativePaths,
  openWorkspaceNative,
  readFileAsDocument,
  saveDocumentNative,
  encodedDocumentBytes,
  downloadBytes,
  writeBytesToFileHandle
} from "../../core/io.js";
import {
  LINT_ENGINE_VECTOR,
  documentOpenSyncRoute,
  legacyLintImmediateSchedule
} from "../../core/lint-controller-policy.js";
import {
  activeIndexAfterTabClose,
  closeDialogMessage,
  documentOpenPlan,
  unsavedDocuments
} from "../document-lifecycle-policy.js";

export function createDocumentController({
  state,
  els,
  grid,
  emptyDoc,
  activeDoc,
  applyFreezeToDoc,
  renderChrome,
  showError,
  reportWindowCloseFailure,
  lspOpenDoc,
  reportLspOpenFailure,
  lspCloseDoc,
  reportLspCloseFailure,
  lspStartWorkspace,
  scheduleHoverPrewarm,
  resetUndoManagerForDocument,
  resetLegacyWorkspaceIndex,
  scheduleLegacyLintForOpen,
  scheduleLegacyLintFull,
  cancelLegacyLintJobs,
  isVectorLintEngine,
  isLegacyLintEngine,
  updateGridDiagnostics,
  scrollProblemsToActiveFile,
  commitActiveCellEditor
}) {
  let pendingCloseResolve = null;

  function hasOpenDocument() {
    return state.docs.length > 0 && state.active >= 0;
  }

  async function wireCloseHandler() {
    if (!isTauriRuntime()) return;
    const tauri = window.__TAURI__;
    if (!tauri?.event?.listen) return;
    await tauri.event.listen("app-close-requested", async () => {
      commitActiveCellEditor?.();
      const unsaved = unsavedDocuments(state.docs);
      if (!unsaved.length) {
        closeWindow().catch((error) => reportWindowCloseFailure(error, "app-close-requested"));
        return;
      }
      for (const doc of [...unsaved]) {
        const index = state.docs.indexOf(doc);
        if (index >= 0) {
          state.active = index;
          applyFreezeToDoc(activeDoc());
          grid.setDocument(activeDoc());
          renderChrome();
        }
        const choice = await askCloseChoice(doc);
        if (choice === "cancel") return;
        if (choice === "save") {
          const saved = await saveFile().catch(() => false);
          if (!saved || doc.dirty) return;
        }
      }
      closeWindow().catch((error) => reportWindowCloseFailure(error, "app-close-requested"));
    });
  }

  function handleCloseDialogClick(event) {
    const choice = event.target.closest("[data-close-choice]")?.dataset.closeChoice;
    if (choice && pendingCloseResolve) {
      pendingCloseResolve(choice);
      pendingCloseResolve = null;
      els.closeDialog.classList.add("hidden");
    }
  }

  async function addDocument(doc) {
    const plan = documentOpenPlan(state.docs, doc);
    if (plan.action === "activate-existing") {
      state.active = plan.activeIndex;
      grid.setDocument(activeDoc());
      renderChrome();
      return;
    }
    resetUndoManagerForDocument(doc);
    doc.zoom = 1;
    state.docs.push(doc);
    state.active = plan.activeIndex;
    applyFreezeToDoc(doc);
    grid.setDocument(doc);
    if (!doc.initialColumnFitApplied) {
      grid.autoFitInitialColumns();
      doc.initialColumnFitApplied = true;
      grid.layout();
    }
    renderChrome();
    scrollProblemsToActiveFile();
    if (documentOpenSyncRoute(state.lint.engine) === "vector-open") {
      lspOpenDoc(doc).catch((error) => reportLspOpenFailure(doc, error, "document-open"));
      scheduleHoverPrewarm("document-opened");
    } else {
      scheduleLegacyLintForOpen("file-opened");
    }
  }

  async function openFile() {
    try {
      if (isTauriRuntime()) {
        const docs = await openFilesNative(TableDocument);
        for (const doc of docs) await addDocument(doc);
      } else if ("showOpenFilePicker" in window) {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: "Structured text", accept: { "text/plain": [".txt", ".tsv", ".tbl", ".csv"] } }]
        });
        for (const handle of handles) {
          const file = await handle.getFile();
          const doc = await readFileAsDocument(file, TableDocument);
          doc.handle = handle;
          await addDocument(doc);
        }
      } else {
        els.fileInput.click();
      }
    } catch (error) {
      showError(error);
    }
  }

  async function openDroppedNativePaths(paths) {
    try {
      const docs = await openNativePaths(paths.filter(isTextLikePath), TableDocument);
      for (const doc of docs) await addDocument(doc);
    } catch (error) {
      showError(error);
    }
  }

  async function openBrowserFiles(files) {
    const textFiles = Array.from(files ?? []).filter(isTextLikeFile);
    for (const file of textFiles) await addDocument(await readFileAsDocument(file, TableDocument));
  }

  async function openFolder() {
    try {
      if (!isTauriRuntime()) {
        showError("Open Folder is available in the desktop app.");
        return;
      }
      const workspace = await openWorkspaceNative();
      if (!workspace) return;
      state.workspace = workspace;
      resetLegacyWorkspaceIndex();
      if (isVectorLintEngine()) lspStartWorkspace(workspace.path).catch(showError);
      else {
        const schedule = legacyLintImmediateSchedule("workspace-opened");
        scheduleLegacyLintFull(schedule.reason, schedule.delay);
      }
      renderChrome();
    } catch (error) {
      showError(error);
    }
  }

  async function saveFile() {
    try {
      commitActiveCellEditor?.();
      const doc = activeDoc();
      if (!hasOpenDocument()) {
        showError("No file is open.");
        return false;
      }
      if (isTauriRuntime()) {
        const saved = await saveDocumentNative(doc, false);
        if (!saved) return false;
        grid.draw();
        renderChrome();
        return true;
      }
      if (doc.handle?.createWritable) {
        const bytes = encodedDocumentBytes(doc);
        await writeBytesToFileHandle(doc.handle, bytes);
        doc.dirty = false;
        renderChrome();
        return true;
      }
      return saveAs();
    } catch (error) {
      showError(error);
      return false;
    }
  }

  async function saveAs() {
    try {
      commitActiveCellEditor?.();
      const doc = activeDoc();
      if (!hasOpenDocument()) {
        showError("No file is open.");
        return false;
      }
      if (isTauriRuntime()) {
        const saved = await saveDocumentNative(doc, true);
        if (!saved) return false;
        grid.draw();
        renderChrome();
        return true;
      } else if ("showSaveFilePicker" in window) {
        const handle = await window.showSaveFilePicker({ suggestedName: doc.name });
        const bytes = encodedDocumentBytes(doc);
        await writeBytesToFileHandle(handle, bytes);
        doc.handle = handle;
        doc.name = handle.name ?? doc.name;
        doc.dirty = false;
        renderChrome();
        return true;
      } else {
        downloadBytes(doc.name, encodedDocumentBytes(doc), "text/plain");
        doc.dirty = false;
        renderChrome();
        return true;
      }
    } catch (error) {
      showError(error);
      return false;
    }
  }

  async function loadFixture(size) {
    const name = size === 200000 ? "d2_200k.tsv" : "d2_20k.tsv";
    const response = await fetch(`./fixtures/${name}`);
    const text = await response.text();
    await addDocument(TableDocument.fromText(name, text));
  }

  async function closeTab(index) {
    if (index < 0 || index >= state.docs.length) return;
    commitActiveCellEditor?.();
    const doc = state.docs[index];
    if (doc.dirty) {
      const choice = await askCloseChoice(doc);
      if (choice === "cancel") return;
      if (choice === "save") {
        const previous = state.active;
        state.active = index;
        grid.setDocument(activeDoc());
        const saved = await saveFile();
        state.active = previous;
        if (!saved || doc.dirty) {
          grid.setDocument(activeDoc());
          renderChrome();
          return;
        }
      }
    }
    if (isVectorLintEngine()) lspCloseDoc(doc).catch((error) => reportLspCloseFailure(doc, error, "tab-close"));
    else cancelLegacyLintJobs({ clearDiagnostics: false });
    const documentCountBeforeClose = state.docs.length;
    state.docs.splice(index, 1);
    if (!state.docs.length) {
      state.active = -1;
      grid.setDocument(emptyDoc);
    } else {
      state.active = activeIndexAfterTabClose({
        activeIndex: state.active,
        closeIndex: index,
        documentCount: documentCountBeforeClose
      });
      grid.setDocument(activeDoc());
    }
    if (isLegacyLintEngine()) scheduleLegacyLintFull("tab-closed", 0);
    updateGridDiagnostics();
    renderChrome();
  }

  function askCloseChoice(doc) {
    els.closeDialogText.textContent = closeDialogMessage(doc);
    els.closeDialog.classList.remove("hidden");
    return new Promise((resolve) => {
      pendingCloseResolve = resolve;
    });
  }

  return {
    addDocument,
    askCloseChoice,
    closeTab,
    handleCloseDialogClick,
    hasOpenDocument,
    isTextLikeFile,
    isTextLikePath,
    loadFixture,
    openBrowserFiles,
    openDroppedNativePaths,
    openFile,
    openFolder,
    saveAs,
    saveFile,
    wireCloseHandler
  };
}
