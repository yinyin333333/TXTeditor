import { TableDocument } from "../../core/table-model.js";
import { JsonDocument } from "../../core/json-document.js";
import { LARGE_FILE_THRESHOLDS } from "../../core/large-file-policy.js";
import {
  documentRevision,
  documentTextSnapshot,
  isJsonDocument,
  isTableDocument,
  markDocumentSaved
} from "../../core/document-file-state.js";
import {
  isEditableLocalizationJsonPath,
  isLocalizationJsonPathInCurrentMode,
  isJsonPath
} from "../../core/json-document-policy.js";
import { normalizePath } from "../../core/lint-paths.js";
import { docToUri, lspStandaloneParentPath, pathFromUri } from "../../core/lsp-uri-policy.js";
import { isTextLikeFile, isTextLikePath } from "../../core/text-file-policy.js";
import {
  closeWindow,
  downloadText,
  encodeText,
  isTauriRuntime,
  openNativePaths,
  openWorkspaceNative,
  pickOpenFilePathsNative,
  readFileAsDocument,
  readTextFilesNative,
  saveDocumentNative
} from "../../core/io.js";
import {
  documentOpenSyncRoute,
  legacyLintImmediateSchedule
} from "../../core/lint-controller-policy.js";
import {
  activeIndexAfterTabClose,
  closeDialogMessage,
  documentOpenPlan,
  unsavedDocuments
} from "../document-lifecycle-policy.js";
import { tText } from "../../core/i18n.js";

export function createDocumentController({
  state,
  els,
  grid,
  emptyDoc,
  activeDoc,
  activateDocument = async (doc) => grid.setDocument(doc),
  commitActiveEditor = () => grid.commitEdit?.(),
  focusActiveEditor = () => els.host?.focus?.(),
  jsonEditorController = null,
  saveSelectionState,
  applyFreezeToDoc,
  renderChrome,
  showError,
  showToast = () => {},
  reportWindowCloseFailure,
  lspOpenDoc,
  lspUpdateDoc = async () => {},
  reportLspOpenFailure,
  lspCloseDoc,
  handleLspUpdateError = () => {},
  reportLspCloseFailure,
  lspRebindSavedDoc = async () => {},
  lspStartWorkspace,
  ensureDocumentSession = async () => {},
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
  let pendingExternalResolve = null;
  let pendingExternal = null;
  const queuedExternalChanges = new Map();
  const pendingSaves = new WeakMap();

  function hasOpenDocument() {
    return state.docs.length > 0 && state.active >= 0;
  }

  async function wireCloseHandler() {
    if (!isTauriRuntime()) return;
    const tauri = window.__TAURI__;
    if (!tauri?.event?.listen) return;
    await tauri.event.listen("app-close-requested", async () => {
      commitActiveEditor();
      const unsaved = unsavedDocuments(state.docs);
      if (!unsaved.length) {
        closeWindow().catch((error) => reportWindowCloseFailure(error, "app-close-requested"));
        return;
      }
      for (const doc of [...unsaved]) {
        const index = state.docs.indexOf(doc);
        if (index >= 0) {
          state.active = index;
          await activateDocument(activeDoc(), { focus: false });
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

  async function handleExternalChangeDialogClick(event) {
    const choice = event.target.closest("[data-external-change-choice]")?.dataset.externalChangeChoice;
    if (!choice || !pendingExternalResolve) return;
    const resolve = pendingExternalResolve;
    pendingExternalResolve = null;
    els.externalChangeDialog?.classList.add("hidden");
    resolve(choice);
  }

  async function addDocument(doc, { scrollProblems = true, focus = true } = {}) {
    const plan = documentOpenPlan(state.docs, doc);
    if (plan.action === "activate-existing") {
      saveSelectionState();
      state.active = plan.activeIndex;
      await activateDocument(activeDoc(), { focus });
      renderChrome();
      if (focus) focusActiveEditor();
      return activeDoc();
    }
    if (isTableDocument(doc)) {
      resetUndoManagerForDocument(doc);
      doc.zoom = 1;
      applyFreezeToDoc(doc);
    }
    state.docs.push(doc);
    saveSelectionState();
    state.active = plan.activeIndex;
    await activateDocument(doc, { focus: false });
    if (isTableDocument(doc)) prepareOpenedTable(doc);
    renderChrome();
    if (scrollProblems) scrollProblemsToActiveFile();
    if (focus) focusActiveEditor();
    if (isJsonDocument(doc)) {
      if (isVectorLintEngine()) {
        await lspOpenDoc(doc).catch((error) => reportLspOpenFailure(doc, error, "json-open"));
      }
      return doc;
    }
    if (doc.largeFileMode) return doc;
    await syncOpenedTable(doc);
    return doc;
  }

  function prepareOpenedTable(doc) {
    if (doc.largeFileMode) {
      doc.initialColumnFitApplied = true;
      state.lint.status = `Large file mode: lint paused for ${doc.name}.`;
    } else if (isOpenStatus(state.lint.status)) {
      state.lint.status = "";
    }
    if (!doc.largeFileMode && !doc.initialColumnFitApplied) {
      grid.autoFitInitialColumns();
      doc.initialColumnFitApplied = true;
      grid.layout();
    }
  }

  async function syncOpenedTable(doc) {
    if (documentOpenSyncRoute(state.lint.engine, state.lint.enabled) === "vector-open") {
      const referenceRootPath = state.workspace?.path ?? "";
      const siblingParent = isTauriRuntime()
        ? lspStandaloneParentPath(doc.path, referenceRootPath, {
          includeSubfolders: !state.excludeWorkspaceSubfolders
        })
        : null;
      if (siblingParent) {
        try {
          const options = { contextMode: "sibling" };
          if (referenceRootPath) options.referenceRootPath = referenceRootPath;
          await lspStartWorkspace(siblingParent, options);
        } catch (error) {
          reportLspOpenFailure(doc, error, "sibling-session-start");
        }
        scheduleHoverPrewarm("document-opened");
        return;
      }
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
        await openNativeDocumentPaths(await pickOpenFilePathsNative());
      } else if ("showOpenFilePicker" in window) {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: "Structured text", accept: { "text/plain": [".txt", ".tsv", ".tbl", ".csv"] } }]
        });
        for (const handle of handles) {
          const file = await handle.getFile();
          if (file.size >= LARGE_FILE_THRESHOLDS.fileSizeBytes) await showOpeningFeedback(tText("status.openingLargeFile", { file: file.name }));
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

  async function openNativeDocumentPaths(paths, { requireCurrentJsonMode = false } = {}) {
    const candidates = Array.from(paths ?? []).filter((path) => isTextLikePath(path) || isJsonPath(path));
    const tablePaths = candidates.filter(isTextLikePath);
    const jsonPaths = candidates.filter(isJsonPath);
    if (tablePaths.length) {
      await showOpeningFeedback(`Opening ${tablePaths.length} file(s)...`);
      const docs = await openNativePaths(tablePaths, TableDocument);
      for (const doc of docs) await addDocument(doc);
    }
    for (const path of jsonPaths) {
      await openJsonDocumentPath(path, { requireCurrentMode: requireCurrentJsonMode });
    }
  }

  async function openJsonDocumentPath(path, { requireCurrentMode = true, focus = true } = {}) {
    if (!isTauriRuntime()) throw new Error(tText("error.jsonEditingDesktop"));
    if (!isEditableLocalizationJsonPath(path)) {
      throw new Error("Only direct data/local/lng/strings/*.json files can be opened as JSON documents.");
    }
    if (requireCurrentMode && !isLocalizationJsonPathInCurrentMode(path, state)) {
      throw new Error("This JSON file is outside the current mod workspace.");
    }
    const existing = state.docs.find((doc) => normalizePath(doc.path) === normalizePath(path));
    if (existing) {
      state.active = state.docs.indexOf(existing);
      await activateDocument(existing, { focus });
      renderChrome();
      return existing;
    }
    const [result] = await readTextFilesNative([path]);
    if (!result || result.error) throw new Error(result?.error || `Could not read ${path}`);
    const payload = result.payload;
    return addDocument(JsonDocument.fromText(payload.name, payload.text, {
      path: payload.path,
      encoding: payload.encoding,
      fileSizeBytes: payload.fileSizeBytes ?? payload.sizeBytes ?? payload.size_bytes,
      dirty: false
    }), { focus });
  }

  async function openDroppedNativePaths(paths, options = {}) {
    try {
      await openNativeDocumentPaths(paths, options);
    } catch (error) {
      showError(error);
    }
  }

  async function openBrowserFiles(files) {
    const textFiles = Array.from(files ?? []).filter(isTextLikeFile);
    for (const file of textFiles) {
      if (file.size >= LARGE_FILE_THRESHOLDS.fileSizeBytes) await showOpeningFeedback(tText("status.openingLargeFile", { file: file.name }));
      await addDocument(await readFileAsDocument(file, TableDocument));
    }
  }

  async function openFolder() {
    try {
      if (!isTauriRuntime()) return showError(tText("error.openFolderDesktop"));
      const includeSubfolders = !state.excludeWorkspaceSubfolders;
      const workspace = await openWorkspaceNative({ includeSubfolders });
      if (!workspace) return;
      state.workspace = workspace;
      resetLegacyWorkspaceIndex();
      if (isVectorLintEngine()) {
        if (state.lint.enabled) {
          lspStartWorkspace(workspace.path, { includeSubfolders }).catch(showError);
        }
      } else {
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
      if (!hasOpenDocument()) return showError(tText("error.noOpenFile")), false;
      commitActiveEditor();
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
      const saved = await saveDocumentNative(doc, false, { validateTarget: (path) => validateSaveTarget(doc, path) });
      if (!saved) return false;
      await lspRebindSavedDoc(doc, previousUri);
      grid.draw();
      renderChrome();
      return true;
    }
    const snapshot = documentTextSnapshot(doc);
    const writable = await doc.handle.createWritable();
    await writeDocumentText(writable, snapshot.chunks, snapshot.encoding);
    await writable.close();
    markDocumentSaved(doc, snapshot.revision, snapshot);
    await lspRebindSavedDoc(doc, previousUri);
    renderChrome();
    return true;
  }

  async function saveAs() {
    try {
      if (!hasOpenDocument()) return showError(tText("error.noOpenFile")), false;
      commitActiveEditor();
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
      const saved = await saveDocumentNative(doc, true, { validateTarget: (path) => validateSaveTarget(doc, path) });
      if (!saved) return false;
      await lspRebindSavedDoc(doc, previousUri);
      grid.draw();
      renderChrome();
      return true;
    }
    if ("showSaveFilePicker" in window) {
      const handle = await window.showSaveFilePicker({ suggestedName: doc.name });
      const snapshot = documentTextSnapshot(doc);
      const writable = await handle.createWritable();
      await writeDocumentText(writable, snapshot.chunks, snapshot.encoding);
      await writable.close();
      doc.handle = handle;
      doc.name = handle.name ?? doc.name;
      markDocumentSaved(doc, snapshot.revision, snapshot);
      await lspRebindSavedDoc(doc, previousUri);
      renderChrome();
      return true;
    }
    const snapshot = documentTextSnapshot(doc);
    downloadText(doc.name, snapshot.text, doc.encoding);
    markDocumentSaved(doc, snapshot.revision, snapshot);
    renderChrome();
    return true;
  }

  function validateSaveTarget(doc, path) {
    if (!isJsonDocument(doc)) return true;
    return isEditableLocalizationJsonPath(path)
      && (normalizePath(path) === normalizePath(doc.path)
        || isLocalizationJsonPathInCurrentMode(path, state));
  }

  async function loadFixture(size) {
    const name = size === 200000 ? "d2_200k.tsv" : "d2_20k.tsv";
    const response = await fetch(`./fixtures/${name}`);
    await addDocument(TableDocument.fromText(name, await response.text()));
  }

  async function closeTab(index) {
    if (index < 0 || index >= state.docs.length) return;
    commitActiveEditor();
    const previouslyActiveDoc = activeDoc();
    const doc = state.docs[index];
    if (doc.dirty) {
      const choice = await askCloseChoice(doc);
      if (choice === "cancel") return;
      if (choice === "save") {
        const previous = state.active;
        state.active = index;
        await activateDocument(activeDoc(), { focus: false });
        const saved = await saveFile();
        state.active = previous;
        if (!saved || doc.dirty) {
          await activateDocument(activeDoc(), { focus: false });
          renderChrome();
          return;
        }
      }
    }
    const lspClosePromise = isVectorLintEngine()
      ? lspCloseDoc(doc).catch((error) => reportLspCloseFailure(doc, error, "tab-close"))
      : null;
    if (!lspClosePromise && isTableDocument(doc)) cancelLegacyLintJobs({ clearDiagnostics: false });
    const documentCountBeforeClose = state.docs.length;
    state.docs.splice(index, 1);
    if (!state.docs.length) {
      state.active = -1;
      await activateDocument(emptyDoc, { focus: false });
    } else {
      state.active = activeIndexAfterTabClose({
        activeIndex: state.active,
        closeIndex: index,
        documentCount: documentCountBeforeClose
      });
      await activateDocument(activeDoc(), { focus: false });
    }
    if (isLegacyLintEngine() && isTableDocument(doc)) scheduleLegacyLintFull("tab-closed", 0);
    updateGridDiagnostics();
    renderChrome();
    const nextActiveDoc = activeDoc();
    if (isVectorLintEngine() && isTableDocument(nextActiveDoc) && nextActiveDoc !== previouslyActiveDoc) {
      await lspClosePromise;
      try {
        await ensureDocumentSession(nextActiveDoc);
      } catch (error) {
        reportLspOpenFailure(nextActiveDoc, error, "tab-close-session-rebind");
      }
    }
  }

  async function handleWatchedFilesChanged(payload = {}) {
    if (Number(payload.generation) !== Number(state.lsp.generation)) return;
    for (const change of payload.changes ?? []) {
      const path = pathFromUri(change.uri);
      if (!path || !isJsonPath(path)) continue;
      const doc = state.docs.find((candidate) => isJsonDocument(candidate)
        && normalizePath(candidate.path) === normalizePath(path));
      if (!doc) continue;
      if (Number(change.type) === 3) {
        const replacement = await readReplacementAfterDelete(path);
        if (replacement) {
          await processExternalPayload(doc, replacement);
          continue;
        }
        if (doc.pendingWriteText != null) continue;
        await resolveExternalConflict(doc, { path, deleted: true, text: null, encoding: doc.encoding });
        continue;
      }
      const [result] = await readTextFilesNative([path]);
      if (!result || result.error) continue;
      await processExternalPayload(doc, result.payload);
    }
  }

  function externalDiskObservation(doc, payload = {}) {
    const exists = payload.deleted !== true;
    return {
      exists,
      text: exists ? String(payload.text ?? "") : null,
      encoding: exists ? (payload.encoding || doc.encoding) : null
    };
  }

  async function processExternalPayload(doc, payload) {
    const observation = externalDiskObservation(doc, payload);
    const { text, encoding } = observation;
    if (doc.matchesObservedDiskState(observation)) return;
    if (text === doc.pendingWriteText && encoding === doc.pendingWriteEncoding) {
      doc.pendingWriteText = null;
      doc.pendingWriteEncoding = null;
      doc.observeDiskState(observation);
      return;
    }
    if (text === doc.lastWrittenText && encoding === doc.lastWrittenEncoding) {
      doc.observeDiskState(observation);
      return;
    }
    if (text === doc.text && encoding === doc.encoding) {
      doc.observeDiskState(observation);
      return;
    }
    if (!doc.dirty) {
      doc.reloadFromDisk(text, { encoding });
      await jsonEditorController?.reloadActiveDocument(doc);
      await syncReloadedJsonToLsp(doc, "external-clean-reload");
      renderChrome();
      showToast(tText("toast.externalReload", { file: doc.name }));
      return;
    }
    await resolveExternalConflict(doc, { path: payload.path, text, encoding, deleted: false });
  }

  async function syncReloadedJsonToLsp(doc, context) {
    if (!isJsonDocument(doc) || !isVectorLintEngine()) return;
    try {
      await lspUpdateDoc(doc, { kind: "json", changes: [] });
    } catch (error) {
      handleLspUpdateError(doc, error, context);
    }
  }

  async function readReplacementAfterDelete(path) {
    for (const delay of [0, 40, 120]) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const [result] = await readTextFilesNative([path]);
      if (result && !result.error && result.payload) return result.payload;
    }
    return null;
  }

  async function resolveExternalConflict(doc, payload) {
    const observation = externalDiskObservation(doc, payload);
    if (doc.matchesObservedDiskState(observation)) return;
    doc.noteExternalChange(payload);
    if (pendingExternal) {
      queuedExternalChanges.set(normalizePath(payload.path || doc.path), { doc, payload });
      return;
    }
    pendingExternal = { doc, payload };
    try {
      const choice = await askExternalChangeChoice(doc, payload);
      if (choice === "reload" && !payload.deleted) {
        doc.reloadFromDisk(payload.text, { encoding: payload.encoding });
        await jsonEditorController?.reloadActiveDocument(doc);
        await syncReloadedJsonToLsp(doc, "external-conflict-reload");
      } else {
        doc.keepLocalAfterExternalChange(payload);
      }
      renderChrome();
    } finally {
      pendingExternal = null;
    }
    const queued = [...queuedExternalChanges.values()];
    queuedExternalChanges.clear();
    for (const change of queued) {
      await resolveExternalConflict(change.doc, change.payload);
    }
  }

  function askExternalChangeChoice(doc, payload) {
    if (!els.externalChangeDialog || !els.externalChangeDialogText) return Promise.resolve("keep");
    els.externalChangeDialogText.textContent = payload.deleted
      ? tText("dialog.fileDeletedExternal", { file: doc.name })
      : tText("dialog.fileChangedUnsaved", { file: doc.name });
    els.externalChangeDialog.classList.remove("hidden");
    return new Promise((resolve) => { pendingExternalResolve = resolve; });
  }

  function askCloseChoice(doc) {
    els.closeDialogText.textContent = closeDialogMessage(doc);
    els.closeDialog.classList.remove("hidden");
    return new Promise((resolve) => { pendingCloseResolve = resolve; });
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

  async function writeDocumentText(writable, chunks, encoding) {
    const normalizedEncoding = String(encoding || "utf-8").toLowerCase();
    let first = true;
    for (const chunk of chunks) {
      if (normalizedEncoding === "utf-8") {
        if (chunk) await writable.write(chunk);
      } else if (chunk || first) {
        await writable.write(encodeText(chunk, encoding, { includeBom: first }));
      }
      first = false;
    }
    if (first && normalizedEncoding !== "utf-8") await writable.write(encodeText("", encoding));
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
    handleExternalChangeDialogClick,
    handleWatchedFilesChanged,
    hasOpenDocument,
    isTextLikeFile,
    isTextLikePath,
    loadFixture,
    openBrowserFiles,
    openDroppedNativePaths,
    openFile,
    openFolder,
    openJsonDocumentPath,
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
