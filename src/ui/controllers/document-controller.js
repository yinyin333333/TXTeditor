import { TableDocument } from "../../core/table-model.js";
import { LARGE_FILE_THRESHOLDS } from "../../core/large-file-policy.js";
import { markTableSaved, tableFileState } from "../../core/table-file-state.js";
import { docToUri } from "../../core/lsp-uri-policy.js";
import { isTextLikeFile, isTextLikePath } from "../../core/text-file-policy.js";
import {
  closeWindow,
  downloadText,
  encodeText,
  isTauriRuntime,
  openFilesNative,
  openNativePaths,
  openWorkspaceNative,
  readFileAsDocument,
  saveDocumentNative
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
  saveSelectionState,
  applyFreezeToDoc,
  renderChrome,
  showError,
  reportWindowCloseFailure,
  lspOpenDoc,
  reportLspOpenFailure,
  lspCloseDoc,
  reportLspCloseFailure,
  lspRebindSavedDoc = async () => {},
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
  scrollProblemsToActiveFile
}) {
  let pendingCloseResolve = null;
  const pendingSaves = new WeakMap();

  function hasOpenDocument() {
    return state.docs.length > 0 && state.active >= 0;
  }

  async function wireCloseHandler() {
    if (!isTauriRuntime()) return;
    const tauri = window.__TAURI__;
    if (!tauri?.event?.listen) return;
    await tauri.event.listen("app-close-requested", async () => {
      commitActiveEdit();
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
      saveSelectionState();
      state.active = plan.activeIndex;
      grid.setDocument(activeDoc());
      renderChrome();
      focusGrid();
      return;
    }
    if (!state.docs.length) {
      state.freezeRow = false;
      state.freezeColumn = false;
    }
    resetUndoManagerForDocument(doc);
    doc.zoom = 1;
    state.docs.push(doc);
    saveSelectionState();
    state.active = plan.activeIndex;
    applyFreezeToDoc(doc);
    grid.setDocument(doc);
    if (doc.largeFileMode) {
      doc.initialColumnFitApplied = true;
      state.lint.status = `Large file mode: lint paused for ${doc.name}.`;
    } else {
      if (isOpenStatus(state.lint.status)) state.lint.status = "";
    }
    if (!doc.largeFileMode && !doc.initialColumnFitApplied) {
      grid.autoFitInitialColumns();
      doc.initialColumnFitApplied = true;
      grid.layout();
    }
    renderChrome();
    scrollProblemsToActiveFile();
    focusGrid();
    if (doc.largeFileMode) return;
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
        await showOpeningFeedback("Opening file...");
        const docs = await openFilesNative(TableDocument);
        for (const doc of docs) await addDocument(doc);
      } else if ("showOpenFilePicker" in window) {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: "Structured text", accept: { "text/plain": [".txt", ".tsv", ".tbl", ".csv"] } }]
        });
        for (const handle of handles) {
          const file = await handle.getFile();
          if (file.size >= LARGE_FILE_THRESHOLDS.fileSizeBytes) await showOpeningFeedback(`Opening large file: ${file.name}...`);
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
      const textPaths = paths.filter(isTextLikePath);
      if (textPaths.length) await showOpeningFeedback(`Opening ${textPaths.length} file(s)...`);
      const docs = await openNativePaths(textPaths, TableDocument);
      for (const doc of docs) await addDocument(doc);
    } catch (error) {
      showError(error);
    }
  }

  async function openBrowserFiles(files) {
    const textFiles = Array.from(files ?? []).filter(isTextLikeFile);
    for (const file of textFiles) {
      if (file.size >= LARGE_FILE_THRESHOLDS.fileSizeBytes) await showOpeningFeedback(`Opening large file: ${file.name}...`);
      await addDocument(await readFileAsDocument(file, TableDocument));
    }
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
      if (!hasOpenDocument()) {
        showError("No file is open.");
        return false;
      }
      commitActiveEdit();
      const doc = activeDoc();
      if (!isTauriRuntime() && !doc.handle?.createWritable) return saveAs();
      return await queueSave(doc, () => saveFileNow(doc));
    } catch (error) {
      showError(error);
      return false;
    }
  }

  async function saveFileNow(doc) {
    const previousUri = docToUri(doc);
    if (isTauriRuntime()) {
      const saved = await saveDocumentNative(doc, false);
      if (!saved) return false;
      await lspRebindSavedDoc(doc, previousUri);
      grid.draw();
      renderChrome();
      return true;
    }
    const revision = tableFileState(doc).revision;
    const writable = await doc.handle.createWritable();
    await writeDocumentText(writable, doc);
    await writable.close();
    markTableSaved(doc, revision);
    await lspRebindSavedDoc(doc, previousUri);
    renderChrome();
    return true;
  }

  async function saveAs() {
    try {
      if (!hasOpenDocument()) {
        showError("No file is open.");
        return false;
      }
      commitActiveEdit();
      const doc = activeDoc();
      return await queueSave(doc, () => saveAsNow(doc));
    } catch (error) {
      showError(error);
      return false;
    }
  }

  async function saveAsNow(doc) {
    const previousUri = docToUri(doc);
    if (isTauriRuntime()) {
      const saved = await saveDocumentNative(doc, true);
      if (!saved) return false;
      await lspRebindSavedDoc(doc, previousUri);
      grid.draw();
      renderChrome();
      return true;
    } else if ("showSaveFilePicker" in window) {
      const handle = await window.showSaveFilePicker({ suggestedName: doc.name });
      const revision = tableFileState(doc).revision;
      const writable = await handle.createWritable();
      await writeDocumentText(writable, doc);
      await writable.close();
      doc.handle = handle;
      doc.name = handle.name ?? doc.name;
      markTableSaved(doc, revision);
      await lspRebindSavedDoc(doc, previousUri);
      renderChrome();
      return true;
    } else {
      const revision = tableFileState(doc).revision;
      const text = doc.toText();
      downloadText(doc.name, text, doc.encoding);
      markTableSaved(doc, revision);
      renderChrome();
      return true;
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
    commitActiveEdit();
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
      state.freezeRow = false;
      state.freezeColumn = false;
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

  function commitActiveEdit() {
    grid.commitEdit?.();
  }

  function focusGrid() {
    els.host?.focus?.();
  }

  async function showOpeningFeedback(message) {
    state.lint.status = message;
    renderChrome();
    await yieldToUi();
  }

  function queueSave(doc, save) {
    const previous = pendingSaves.get(doc) ?? Promise.resolve();
    const queued = previous.catch(() => {}).then(save);
    pendingSaves.set(doc, queued);
    queued.then(
      () => {
        if (pendingSaves.get(doc) === queued) pendingSaves.delete(doc);
      },
      () => {
        if (pendingSaves.get(doc) === queued) pendingSaves.delete(doc);
      }
    );
    return queued;
  }

  async function writeDocumentText(writable, doc) {
    let first = true;
    for (const chunk of doc.toTextChunks()) {
      if ((doc.encoding || "utf-8").toLowerCase() === "utf-8") {
        if (chunk) await writable.write(chunk);
      } else if (chunk || first) {
        await writable.write(encodeText(chunk, doc.encoding, { includeBom: first }));
      }
      first = false;
    }
    if (first && (doc.encoding || "utf-8").toLowerCase() !== "utf-8") {
      await writable.write(encodeText("", doc.encoding));
    }
  }

  function isOpenStatus(status) {
    const text = String(status || "");
    return text.startsWith("Large file mode:") || text.startsWith("Opening ");
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

function yieldToUi() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}
