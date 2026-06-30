import { clamp, TableDocument } from "../../core/table-model.js";
import {
  isTauriRuntime,
  lspCloseFile,
  lspDefinition,
  lspGetDiagnostics,
  lspListen,
  lspLogListen,
  lspOpenFile,
  lspStart,
  lspUpdateFile,
  lspUpdateFileIncremental,
  openNativePaths
} from "../../core/io.js";
import { diagnosticsForDocument } from "../../core/lint-engine.js";
import {
  docToUri,
  fileNameFromUri,
  pathFromUri,
  uriToFileKey as uriToFileKeyWithPolicy
} from "../../core/lsp-uri-policy.js";
import {
  ensureLspDocumentVersion,
  lspDocumentState,
  nextLspDocumentVersion,
  resetLspDocumentState
} from "../../core/lsp-document-state.js";
import {
  lspChangedRowsToIncrementalChanges,
  lspHoverReady,
  lspOpenDocumentPolicy,
  lspUpdateDocumentPolicy
} from "../../core/lsp-session-policy.js";
import {
  createLspReadinessState,
  createLspTrafficState,
  recordLspReadinessSample,
  recordLspTrafficSample
} from "../../core/perf-instrumentation.js";
import { vectorSessionAvailable } from "../../core/lint-controller-policy.js";
import {
  clearLspUpdateFailureStatus,
  reportLspRequestFailure,
  reportLspUpdateFailure
} from "../../core/lsp-update-status.js";
import { reportBackgroundTaskFailure } from "../../core/background-task-status.js";
import { createLspHoverController } from "./lsp-hover-controller.js";

const HOVER_READY_FALLBACK_MS = 1200;
const DEFERRED_FULL_UPDATE_DELAY_MS = 250;
const MAX_LOG_ENTRIES = 500;

export function mapLspDiagnosticToDisplay(diagnostic, {
  uri = "",
  fileKey = "",
  fileName = "",
  filePath = "",
  index = 0,
  doc = null
} = {}) {
  const rowIndex = numberOr(diagnostic?.row, 0);
  const columnIndex = numberOr(diagnostic?.col ?? diagnostic?.column, 0);
  const cellValue = knownCellValue(doc, rowIndex, columnIndex);
  const data = diagnostic?.data ?? null;
  const code = diagnostic?.code == null ? "" : String(diagnostic.code);
  const range = displayDiagnosticRange(diagnostic, cellValue, data);
  return {
    id: `lsp:${uri}:${rowIndex}:${columnIndex}:${index}`,
    fileKey,
    fileName,
    filePath,
    rowIndex,
    columnIndex,
    severity: diagnostic?.severity ?? "warning",
    message: diagnostic?.message ?? "",
    ruleId: code,
    code,
    data,
    locationLabel: `Row ${rowIndex + 1}, Col ${columnIndex + 1}`,
    ...range
  };
}

function knownCellValue(doc, rowIndex, columnIndex) {
  if (!doc || typeof doc.getCell !== "function") return null;
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return null;
  if (rowIndex < 0 || columnIndex < 0) return null;
  if (rowIndex >= Number(doc.rowCount) || columnIndex >= Number(doc.columnCount)) return null;
  return doc.getCell(rowIndex, columnIndex);
}

function displayDiagnosticRange(diagnostic, cellValue, data = null) {
  const startCharacter = optionalNumber(diagnostic?.startCharacter);
  const endCharacter = optionalNumber(diagnostic?.endCharacter);
  const cellStartCharacter = optionalNumber(diagnostic?.cellStartCharacter);
  const cellEndCharacter = optionalNumber(diagnostic?.cellEndCharacter);
  const insertionPoint = optionalNumber(data?.insertionPoint);
  const fallback = {
    startCharacter,
    endCharacter,
    cellStartCharacter,
    cellEndCharacter,
    insertionPoint,
    localStart: null,
    localEnd: null,
    localInsertionPoint: null,
    isInsertionPoint: false,
    hasPreciseRange: false
  };
  if (cellValue == null || [startCharacter, endCharacter, cellStartCharacter, cellEndCharacter].some((value) => value == null)) {
    return fallback;
  }
  const cellLength = String(cellValue).length;
  const rawLocalStart = startCharacter - cellStartCharacter;
  const rawLocalEnd = endCharacter - cellStartCharacter;
  const rangeWithinCell = startCharacter >= cellStartCharacter
    && startCharacter <= cellEndCharacter
    && endCharacter >= cellStartCharacter
    && endCharacter <= cellEndCharacter
    && endCharacter >= startCharacter;
  const localRangeWithinKnownCell = rangeWithinCell
    && rawLocalStart >= 0
    && rawLocalStart <= cellLength
    && rawLocalEnd >= 0
    && rawLocalEnd <= cellLength
    && rawLocalEnd >= rawLocalStart;
  const localStart = localRangeWithinKnownCell ? rawLocalStart : null;
  const localEnd = localRangeWithinKnownCell ? rawLocalEnd : null;
  const structuredInsertionPoint = isStructuredInsertionPointData(data);
  const fallbackInsertionPoint = localInsertionPointFromData(insertionPoint, {
    cellStartCharacter,
    cellLength
  });
  const localInsertionPoint = structuredInsertionPoint && localRangeWithinKnownCell
    ? localStart
    : fallbackInsertionPoint;
  const zeroWidthRange = localRangeWithinKnownCell && startCharacter === endCharacter;
  const isInsertionPoint = (structuredInsertionPoint && localInsertionPoint != null) || zeroWidthRange;
  const fullCellRange = localRangeWithinKnownCell && localStart <= 0 && localEnd >= cellLength;
  return {
    ...fallback,
    localStart,
    localEnd,
    localInsertionPoint,
    isInsertionPoint,
    hasPreciseRange: isInsertionPoint || (localRangeWithinKnownCell && !fullCellRange)
  };
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOr(value, fallback) {
  const number = optionalNumber(value);
  return number == null ? fallback : number;
}

function isStructuredInsertionPointData(data) {
  return data?.kind === "missing-token" || data?.kind === "unexpected-eof";
}

function localInsertionPointFromData(insertionPoint, {
  cellStartCharacter,
  cellLength
}) {
  if (insertionPoint == null) return null;
  if (insertionPoint >= 0 && insertionPoint <= cellLength) {
    return insertionPoint;
  }
  const absoluteLocalInsertionPoint = insertionPoint - cellStartCharacter;
  if (absoluteLocalInsertionPoint >= 0 && absoluteLocalInsertionPoint <= cellLength) {
    return absoluteLocalInsertionPoint;
  }
  return null;
}

export function createLspController({
  state,
  els,
  grid,
  activeDoc,
  isVectorLintEngine,
  effectiveVectorLspHoverEnabled,
  recordLintEngineEvent,
  perfNow,
  showToast,
  showError,
  setLintDiagnostics,
  updateGridDiagnostics,
  renderChrome,
  addDocument,
  applyFreezeToDoc,
  updateActiveProblemHighlight,
  saveSelectionState = () => {},
  lintPathKey,
  lspHoverRequest
}) {
  const lspReadiness = createLspReadinessState();
  const lspTraffic = createLspTrafficState();
  const hoverController = createLspHoverController({
    state,
    grid,
    activeDoc,
    docToUri,
    isDocReadyForHover,
    effectiveVectorLspHoverEnabled,
    recordLintEngineEvent,
    recordLspTraffic,
    recordLspReadiness,
    reportHoverFailure,
    computeCharOffset,
    lspHoverRequest,
    perfNow
  });

  function uriToFileKey(uri) {
    return uriToFileKeyWithPolicy(uri, lintPathKey);
  }

  function clearHoverReadyFallback(doc) {
    if (!doc) return;
    const docState = lspDocumentState(doc);
    if (docState.hoverReadyTimer != null) {
      clearTimeout(docState.hoverReadyTimer);
      docState.hoverReadyTimer = null;
    }
  }

  function scheduleDeferredFullUpdate(doc, reason) {
    const docState = lspDocumentState(doc);
    if (docState.fullUpdateTimer != null) clearTimeout(docState.fullUpdateTimer);
    docState.fullUpdateTimer = setTimeout(() => {
      docState.fullUpdateTimer = null;
      updateDoc(doc, { kind: "full", reason }).catch((error) => handleUpdateError(doc, error, `deferred-${reason}`));
    }, DEFERRED_FULL_UPDATE_DELAY_MS);
    recordLintEngineEvent("vector-update-deferred", { fileName: doc?.name, reason, delayMs: DEFERRED_FULL_UPDATE_DELAY_MS });
  }

  function scheduleHoverReadyFallback(doc, uri, reason) {
    clearHoverReadyFallback(doc);
    const docState = lspDocumentState(doc);
    docState.hoverReadyTimer = setTimeout(() => {
      docState.hoverReadyTimer = null;
      if (docToUri(doc) !== uri || docState.openedUri !== uri) return;
      markDocHoverReady(doc, uri, reason);
    }, HOVER_READY_FALLBACK_MS);
  }

  function markDocHoverReady(doc, uri, reason) {
    clearHoverReadyFallback(doc);
    const docState = lspDocumentState(doc);
    docState.ready = true;
    docState.hoverReady = true;
    recordLspReadiness(uri, "hoverReady", {
      fileName: doc?.name,
      documentVersion: docState.version,
      reason
    });
    hoverController.retryQueuedHover(`hover-ready:${reason}`);
    if (doc === activeDoc()) hoverController.scheduleHoverPrewarm(`hover-ready:${reason}`);
  }

  async function startWorkspace(workspacePath) {
    if (!isVectorLintEngine()) {
      recordLintEngineEvent("vector-start-skipped", { workspacePath });
      return;
    }
    hoverController.invalidateHover(true, "workspace-start");
    state.lspLogs = [];
    if (els.logList) els.logList.innerHTML = "";
    state.lint.status = "Connecting to linter...";
    renderChrome();
    state.lsp.started = false;
    try {
      await lspStart(workspacePath);
      state.lsp.started = true;
      state.lsp.openFileCount = 0;
      const docsWithPaths = state.docs.filter((d) => docToUri(d));
      for (const doc of docsWithPaths) {
        resetLspDocumentState(doc, { version: 1 });
        await openDoc(doc).catch((error) => reportOpenFailure(doc, error, "workspace-start"));
      }
      state.lint.status = "";
      renderChrome();
      hoverController.retryQueuedHover("workspace-ready");
      hoverController.scheduleHoverPrewarm("workspace-ready");
    } catch (error) {
      state.lsp.started = false;
      state.lsp.openFileCount = 0;
      reportStartupFailure("Vector-LSP startup", error);
      throw error;
    }
  }

  async function syncOpenDocs() {
    if (!vectorSessionAvailable({ engine: state.lint.engine, lspStarted: state.lsp.started })) return;
    state.lsp.openFileCount = 0;
    for (const doc of state.docs.filter((d) => docToUri(d))) {
      ensureLspDocumentVersion(doc);
      await openDoc(doc).catch((error) => reportOpenFailure(doc, error, "sync-open-docs"));
    }
    recordLintEngineEvent("vector-sync-open-docs", { docs: state.docs.length });
    renderChrome();
  }

  async function openDoc(doc) {
    if (doc?.largeFileMode) {
      recordLintEngineEvent("vector-open-skipped-large-file", { fileName: doc?.name, reasons: doc?.largeFileReasons ?? [] });
      return;
    }
    const uri = docToUri(doc);
    const docState = lspDocumentState(doc);
    const version = ensureLspDocumentVersion(doc);
    const policy = lspOpenDocumentPolicy({
      vectorEngine: isVectorLintEngine(),
      lspStarted: state.lsp.started,
      uri,
      docState,
      version
    });
    if (policy.action === "skip-legacy") {
      recordLintEngineEvent("vector-open-skipped-legacy", { fileName: doc?.name });
      return;
    }
    if (policy.action === "skip-not-started" || policy.action === "skip-no-uri" || policy.action === "already-open") return;
    if (policy.action === "reuse-open-promise") return policy.promise;
    clearHoverReadyFallback(doc);
    docState.ready = false;
    docState.opened = false;
    docState.diagnosticsReady = diagnosticsForDocument(state.lint.diagnostics, doc).length > 0;
    docState.hoverReady = docState.diagnosticsReady;
    docState.openPromise = (async () => {
      recordLspTraffic(uri, "lsp_open_file", { fileName: doc.name, documentVersion: version });
      recordLspReadiness(uri, "didOpenSent", { fileName: doc.name, documentVersion: version });
      await lspOpenFile(uri, doc.toText());
      docState.opened = true;
      docState.openedUri = uri;
      docState.openedVersion = version;
      if (docState.diagnosticsReady) {
        markDocHoverReady(doc, uri, "existing-diagnostics");
      } else {
        scheduleHoverReadyFallback(doc, uri, "diagnostics-fallback");
      }
      state.lsp.openFileCount = (state.lsp.openFileCount ?? 0) + 1;
      renderChrome();
      hoverController.retryQueuedHover("file-opened");
      if (doc === activeDoc()) hoverController.scheduleHoverPrewarm("file-opened");
    })().catch((error) => {
      docState.ready = false;
      docState.opened = false;
      throw error;
    }).finally(() => {
      docState.openPromise = null;
    });
    return docState.openPromise;
  }

  function reportOpenFailure(doc, error, context) {
    const uri = docToUri(doc);
    const docState = lspDocumentState(doc);
    clearHoverReadyFallback(doc);
    docState.ready = false;
    docState.opened = false;
    docState.hoverReady = false;
    reportLspRequestFailure({
      uri,
      operation: "open",
      eventKind: "lsp_open_failed",
      fileName: doc?.name ?? "",
      error,
      context,
      recordLspTraffic,
      appendLspLog
    });
  }

  async function updateDoc(doc, changedRows = null) {
    if (doc?.largeFileMode && !isIncrementalRowChange(changedRows)) {
      recordLintEngineEvent("vector-update-skipped-large-file", { fileName: doc?.name, changeKind: changedRows?.kind ?? "full" });
      return;
    }
    const uri = docToUri(doc);
    const policy = lspUpdateDocumentPolicy({
      vectorEngine: isVectorLintEngine(),
      lspStarted: state.lsp.started,
      uri,
      changedRows
    });
    if (policy.action === "skip-legacy") {
      recordLintEngineEvent("vector-update-skipped-legacy", { fileName: doc?.name, changedRows: policy.changedRowCount ?? null });
      return;
    }
    if (policy.action === "skip-not-started" || policy.action === "skip-no-uri" || policy.action === "skip-no-change") return;
    if (policy.action === "update-full-deferred") return scheduleDeferredFullUpdate(doc, policy.reason);
    const docState = lspDocumentState(doc);
    if (docState.fullUpdateTimer != null && policy.action === "update-incremental") {
      return scheduleDeferredFullUpdate(doc, "pending-structural-change");
    }
    if (docState.fullUpdateTimer != null) {
      clearTimeout(docState.fullUpdateTimer);
      docState.fullUpdateTimer = null;
    }
    hoverController.clearHoverCacheForUri(uri);
    const version = nextLspDocumentVersion(doc);
    hoverController.invalidateHover(false, "document-version-changed");
    docState.ready = false;
    docState.diagnosticsReady = false;
    docState.hoverReady = false;
    docState.openedVersion = version;
    scheduleHoverReadyFallback(doc, uri, "post-change-diagnostics-fallback");
    if (policy.action === "update-incremental") {
      const changes = lspChangedRowsToIncrementalChanges(doc, policy.change);
      recordLspTraffic(uri, "lsp_update_file_incremental", { fileName: doc.name, documentVersion: version, changedRows: policy.changedRowCount });
      await lspUpdateFileIncremental(uri, version, changes);
    } else {
      recordLspTraffic(uri, "lsp_update_file", { fileName: doc.name, documentVersion: version });
      await lspUpdateFile(uri, version, doc.toText());
    }
    clearLspUpdateFailureStatus(state, renderChrome);
  }

  function isIncrementalRowChange(change) {
    return Array.isArray(change) || change?.kind === "replaceRows";
  }

  function handleUpdateError(doc, error, context) {
    const uri = docToUri(doc);
    const docState = lspDocumentState(doc);
    clearHoverReadyFallback(doc);
    docState.ready = false;
    docState.diagnosticsReady = false;
    docState.hoverReady = false;
    reportLspUpdateFailure({
      state,
      doc,
      uri,
      error,
      context,
      recordLspTraffic,
      appendLspLog,
      renderChrome
    });
  }

  async function closeDoc(doc) {
    if (!isVectorLintEngine()) {
      recordLintEngineEvent("vector-close-skipped-legacy", { fileName: doc?.name });
      return;
    }
    if (!state.lsp.started) return;
    const uri = docToUri(doc);
    if (!uri) return;
    recordLspTraffic(uri, "lsp_close_file", { fileName: doc.name });
    await lspCloseFile(uri);
    resetLspDocumentState(doc);
    hoverController.clearHoverCacheForUri(uri);
    hoverController.invalidateHover(false, "file-closed");
    const fileKey = uriToFileKey(uri);
    setLintDiagnostics(state.lint.diagnostics.filter((d) => d.fileKey !== fileKey));
    updateGridDiagnostics();
  }

  function reportCloseFailure(doc, error, context) {
    reportLspRequestFailure({
      uri: docToUri(doc),
      operation: "close",
      eventKind: "lsp_close_failed",
      fileName: doc?.name ?? "",
      error,
      context,
      recordLspTraffic,
      appendLspLog
    });
  }

  function reportDefinitionFailure(doc, uri, error, context) {
    reportLspRequestFailure({
      uri,
      operation: "definition",
      eventKind: "lsp_definition_failed",
      fileName: doc?.name ?? "",
      error,
      context,
      recordLspTraffic,
      appendLspLog
    });
  }

  function reportHoverFailure(target, error, context) {
    reportLspRequestFailure({
      uri: target?.uri,
      operation: "hover",
      eventKind: "lsp_hover_failed",
      fileName: target?.fileName ?? "",
      error,
      context,
      recordLspTraffic,
      appendLspLog
    });
  }

  async function handleDiagnosticsChanged(uri) {
    if (!state.lint.enabled || !isVectorLintEngine()) {
      recordLintEngineEvent("vector-diagnostics-ignored", { uri });
      return;
    }
    recordLspTraffic(uri, "diagnostics_changed");
    recordLspTraffic(uri, "lsp_get_diagnostics");
    const fileKey = uriToFileKey(uri);
    const doc = state.docs.find((d) => uriToFileKey(docToUri(d)) === fileKey);
    const fileName = doc?.name ?? fileNameFromUri(uri);
    const filePath = doc?.path ?? pathFromUri(uri);
    const rawDiags = await lspGetDiagnostics(uri).catch((error) => {
      reportLspRequestFailure({
        uri,
        operation: "get diagnostics",
        eventKind: "lsp_get_diagnostics_failed",
        fileName,
        error,
        context: "diagnostics-changed",
        recordLspTraffic,
        appendLspLog
      });
      return [];
    });
    recordLspReadiness(uri, "firstDiagnosticsReceived", { fileName, activeFile: activeDoc()?.name ?? "", diagnosticCount: rawDiags.length });

    const displayDiags = rawDiags.map((d, i) => mapLspDiagnosticToDisplay(d, {
      uri,
      fileKey,
      fileName,
      filePath,
      index: i,
      doc
    }));

    setLintDiagnostics([
      ...state.lint.diagnostics.filter((d) => d.fileKey !== fileKey),
      ...displayDiags
    ]);

    updateGridDiagnostics();
    renderChrome();
    if (doc) {
      lspDocumentState(doc).diagnosticsReady = true;
      markDocHoverReady(doc, uri, "diagnostics-ready");
    }
    if (doc === activeDoc()) hoverController.scheduleHoverPrewarm("diagnostics-ready");
  }

  function computeCharOffset(doc, row, col) {
    let offset = 0;
    for (let c = 0; c < col; c++) {
      offset += doc.getCell(row, c).length + 1;
    }
    return offset;
  }

  function isDocReadyForHover(doc) {
    const docState = lspDocumentState(doc);
    return lspHoverReady({
      vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
      lspStarted: state.lsp.started,
      uri: docToUri(doc),
      docState
    });
  }

  function recordLspTraffic(uri, kind, details = {}) {
    recordLspTrafficSample(lspTraffic, uri, kind, details, { now: perfNow });
  }

  function recordLspReadiness(uri, eventKind, details = {}) {
    recordLspReadinessSample(lspReadiness, uri, eventKind, details, { now: perfNow });
  }

  function appendLspLog(msg) {
    state.lspLogs.push(msg);
    if (state.lspLogs.length > MAX_LOG_ENTRIES) state.lspLogs.shift();
    if (state.bottomTab === "log" && els.logList) {
      const entry = document.createElement("div");
      entry.className = "log-entry";
      entry.textContent = msg;
      els.logList.appendChild(entry);
      els.logList.scrollTop = els.logList.scrollHeight;
    }
  }

  function reportStartupFailure(label, error) {
    return reportBackgroundTaskFailure({
      state,
      label,
      error,
      context: "startup",
      appendLog: appendLspLog,
      renderChrome
    });
  }

  function reportBackgroundFailure(label, error, context) {
    return reportBackgroundTaskFailure({
      state,
      label,
      error,
      context,
      appendLog: appendLspLog,
      renderChrome
    });
  }

  function reportWindowCloseFailure(error, context) {
    return reportBackgroundFailure("Window close", error, context);
  }

  function charOffsetToColumn(doc, row, charOffset) {
    let offset = 0;
    for (let col = 0; col < doc.columnCount; col++) {
      if (offset >= charOffset) return col;
      offset += doc.getCell(row, col).length + 1;
    }
    return Math.max(0, doc.columnCount - 1);
  }

  async function goToDefinition() {
    if (!isVectorLintEngine() || !state.lsp.started) return;
    const doc = activeDoc();
    const uri = docToUri(doc);
    if (!uri) return;
    const hit = state.contextHit;
    const row = hit?.row ?? state.selection.focus.row;
    const col = hit?.column ?? state.selection.focus.column;
    const charOffset = computeCharOffset(doc, row, col);
    let definitionFailed = false;
    const result = await lspDefinition(uri, row, charOffset).catch((error) => {
      definitionFailed = true;
      reportDefinitionFailure(doc, uri, error, "go-to-definition");
      return null;
    });
    if (definitionFailed) return;
    if (!result) {
      showToast("No definition found.");
      return;
    }
    const targetPath = pathFromUri(result.uri);
    if (!targetPath) return;
    let index = state.docs.findIndex((d) => lintPathKey(d.path) === lintPathKey(targetPath));
    if (index < 0 && isTauriRuntime()) {
      const newDocs = await openNativePaths([targetPath], TableDocument).catch((error) => {
        reportBackgroundFailure("Definition file open", error, "go-to-definition");
        return [];
      });
      if (newDocs.length) {
        await addDocument(newDocs[0]);
        index = state.active;
      }
    }
    if (index >= 0 && index !== state.active) {
      state.active = index;
      applyFreezeToDoc(activeDoc());
      grid.setDocument(activeDoc());
      updateGridDiagnostics();
    }
    const targetDoc = activeDoc();
    const targetRow = clamp(result.line, 0, Math.max(0, targetDoc.rowCount - 1));
    const targetCol = clamp(charOffsetToColumn(targetDoc, targetRow, result.character), 0, Math.max(0, targetDoc.columnCount - 1));
    state.selection.set(targetRow, targetCol);
    saveSelectionState();
    grid.scrollCellIntoView(targetRow, targetCol);
    grid.draw();
    updateActiveProblemHighlight();
    renderChrome();
    els.host.focus();
  }

  function cellHasReference(_row, _col) {
    if (!isVectorLintEngine() || !state.lsp.started) return false;
    return Boolean(docToUri(activeDoc()));
  }

  function startListeners() {
    lspListen(handleDiagnosticsChanged).catch(showError);
    lspLogListen((msg) => appendLspLog(msg)).catch((error) => reportStartupFailure("Vector-LSP log listener", error));
  }

  return {
    appendLog: appendLspLog,
    cellHasReference,
    clearVisibleHover: hoverController.clearVisibleHover,
    closeDoc,
    docToUri,
    goToDefinition,
    handleDiagnosticsChanged,
    handleUpdateError,
    invalidateHover: hoverController.invalidateHover,
    openDoc,
    pathFromUri,
    perf: {
      ...hoverController.perf,
      lspTraffic,
      lspReadiness
    },
    reportBackgroundFailure,
    reportCloseFailure,
    reportDefinitionFailure,
    reportHoverDispatchFailure: hoverController.reportHoverDispatchFailure,
    reportHoverFailure,
    reportOpenFailure,
    reportStartupFailure,
    reportWindowCloseFailure,
    requestHover: hoverController.requestHover,
    scheduleHoverPrewarm: hoverController.scheduleHoverPrewarm,
    startListeners,
    startWorkspace,
    syncOpenDocs,
    updateDoc,
    uriToFileKey
  };
}
