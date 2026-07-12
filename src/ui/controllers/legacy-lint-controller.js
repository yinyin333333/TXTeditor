import { TableDocument } from "../../core/table-model.js";
import { openNativePathsBulk } from "../../core/io.js";
import { buildWorkspaceIndex, runLintWithWorkspaceIndex } from "../../core/lint-engine.js";
import { legacyLintDocumentVersion, markLegacyLintDocumentChanged } from "../../core/lint-document-state.js";
import { isTextLikePath } from "../../core/text-file-policy.js";
import {
  legacyWorkspaceFileSignature,
  legacyWorkspaceIndexCacheHit,
  legacyWorkspaceLoadCacheHit,
  mergeOpenLegacyWorkspaceDocs
} from "../../core/lint-workspace-index.js";
import {
  legacyLintEditSchedule,
  legacyLintOpenSchedule
} from "../../core/lint-controller-policy.js";

export function createLegacyLintController({
  state,
  renderChrome,
  setLintDiagnostics,
  updateGridDiagnostics,
  legacyLintDisplayActive,
  docHasDiagnostics,
  recordLintEngineEvent,
  perfNow,
  elapsedMs,
  lintDocKey
}) {
  function markDocumentChanged(doc) {
    markLegacyLintDocumentChanged(doc);
  }

  function scheduleForOpen(reason = "file-opened") {
    const schedule = legacyLintOpenSchedule(reason);
    scheduleFull(schedule.reason, schedule.delay);
  }

  function scheduleForEdit(doc) {
    const schedule = legacyLintEditSchedule({
      displayActive: legacyLintDisplayActive(),
      hasDiagnostics: docHasDiagnostics(doc)
    });
    if (!schedule) return;
    scheduleFull(schedule.reason, schedule.delay);
  }

  function scheduleFull(reason = "change", delay = 0) {
    if (!legacyLintDisplayActive()) return;
    clearTimeout(state.lint.legacy.timer);
    const version = ++state.lint.legacy.version;
    const scheduledAt = perfNow();
    state.lint.legacy.pendingRun = { version, reason, delay, scheduledAt };
    recordLintEngineEvent("legacy-lint-scheduled", {
      reason,
      version,
      delayMs: delay,
      scheduledAt,
      profile: state.lint.legacy.settings.profile
    });
    state.lint.legacy.timer = setTimeout(() => runNow(reason, version), delay);
  }

  async function runNow(reason = "lint", version = ++state.lint.legacy.version) {
    clearTimeout(state.lint.legacy.timer);
    state.lint.legacy.timer = 0;
    if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) return;
    const pendingRun = state.lint.legacy.pendingRun?.version === version
      ? state.lint.legacy.pendingRun
      : { reason, version, delay: 0, scheduledAt: perfNow() };
    const startedAt = perfNow();
    const timings = {
      reason,
      version,
      profile: state.lint.legacy.settings.profile,
      scheduledAt: pendingRun.scheduledAt,
      startedAt,
      queueDelayMs: elapsedMs(pendingRun.scheduledAt),
      scheduledDelayMs: pendingRun.delay,
      workspaceFileCount: 0,
      workspaceReadMs: 0,
      workspaceParseMs: 0,
      workspaceIndexMs: 0,
      runLintMs: 0,
      diagnosticsApplyMs: 0,
      renderMs: 0,
      totalMs: 0,
      diagnosticCount: 0,
      usedWorkspaceCache: false,
      usedWorkspaceIndexCache: false,
      bulkRead: false
    };
    let published = false;
    state.lint.legacy.running = true;
    state.lint.legacy.status = state.workspace?.files?.length ? "Indexing workspace..." : `Linting ${state.lint.legacy.settings.profile}...`;
    recordLintEngineEvent("legacy-lint-start", timings);
    timings.renderMs += measureRenderChrome();
    try {
      const workspaceStats = await ensureWorkspaceIndexed(version);
      timings.renderMs += workspaceStats.workspaceRenderMs ?? 0;
      delete workspaceStats.workspaceRenderMs;
      Object.assign(timings, workspaceStats);
      if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) return;
      state.lint.legacy.status = `Linting ${state.lint.legacy.settings.profile}...`;
      timings.renderMs += measureRenderChrome();
      await yieldToUi();
      const docs = activeDocuments();
      const indexResult = workspaceIndexFor(docs, state.lint.legacy.settings.profile);
      timings.workspaceIndexMs = indexResult.ms;
      timings.usedWorkspaceIndexCache = indexResult.cached;
      const runStarted = perfNow();
      const diagnostics = runLintWithWorkspaceIndex(indexResult.index, state.lint.legacy.settings);
      timings.runLintMs = elapsedMs(runStarted);
      if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) {
        recordLintEngineEvent("legacy-lint-ignored", { reason, version, diagnostics: diagnostics.length });
        return;
      }
      const applyStarted = perfNow();
      setLintDiagnostics(diagnostics);
      timings.diagnosticsApplyMs = elapsedMs(applyStarted);
      timings.diagnosticCount = diagnostics.length;
      state.lint.legacy.lastRunAt = Date.now();
      published = true;
    } finally {
      if (version === state.lint.legacy.version) {
        state.lint.legacy.running = false;
        state.lint.legacy.status = "";
        timings.renderMs += measureRenderChrome();
        timings.totalMs = elapsedMs(timings.scheduledAt);
        if (published) recordLintEngineEvent("legacy-lint-finish", timings);
      }
    }
  }

  function measureRenderChrome() {
    const started = perfNow();
    renderChrome();
    return elapsedMs(started);
  }

  function activeDocuments() {
    return [...state.docs, ...state.lint.legacy.workspaceDocs];
  }

  function workspaceIndexFor(docs, profile) {
    const signature = indexSignature(docs, profile);
    const cache = state.lint.legacy.workspaceIndexCache;
    const cached = legacyWorkspaceIndexCacheHit(cache, signature, profile);
    if (cached) return cached;
    const started = perfNow();
    const index = buildWorkspaceIndex(docs, profile);
    const ms = elapsedMs(started);
    state.lint.legacy.workspaceIndexCache = { signature, profile, index };
    return { index, ms, cached: false };
  }

  function indexSignature(docs, profile) {
    return [
      profile,
      state.lint.legacy.workspaceLoad.signature ?? "",
      docs.map((doc) => [
        lintDocKey(doc),
        legacyLintDocumentVersion(doc),
        doc.rowCount ?? 0,
        doc.columnCount ?? 0
      ].join(":")).join("\u001f")
    ].join("\u001e");
  }

  function currentProfileRules() {
    return state.lint.legacy.settings.profiles?.[state.lint.legacy.settings.profile]?.rules ?? {};
  }

  function cancelJobs({ clearDiagnostics = false } = {}) {
    clearTimeout(state.lint.legacy.timer);
    state.lint.legacy.timer = 0;
    state.lint.legacy.pendingRun = null;
    state.lint.legacy.version += 1;
    state.lint.legacy.running = false;
    state.lint.legacy.status = "";
    if (clearDiagnostics) {
      setLintDiagnostics([]);
      updateGridDiagnostics();
    }
    recordLintEngineEvent("legacy-lint-cancel", { clearDiagnostics });
  }

  function resetWorkspaceIndex() {
    state.lint.legacy.workspaceDocs = [];
    state.lint.legacy.workspaceLoad = { status: "not-started", files: [], error: "", signature: "" };
    state.lint.legacy.workspaceIndexCache = { signature: "", profile: "", index: null };
  }

  async function ensureWorkspaceIndexed(version) {
    if (!state.workspace?.files?.length) {
      return { workspaceFileCount: 0, usedWorkspaceCache: true };
    }
    const explorerFiles = workspaceTxtFiles();
    const signature = legacyWorkspaceFileSignature(explorerFiles);
    if (!explorerFiles.length) {
      state.lint.legacy.workspaceDocs = [];
      state.lint.legacy.workspaceLoad = { status: "ready", files: [], error: "", signature };
      return { workspaceFileCount: 0, usedWorkspaceCache: true };
    }
    if (legacyWorkspaceLoadCacheHit(state.lint.legacy.workspaceLoad, signature)) {
      state.lint.legacy.workspaceDocs = mergeOpenLegacyWorkspaceDocs(state.lint.legacy.workspaceDocs, state.docs);
      return { workspaceFileCount: explorerFiles.length, usedWorkspaceCache: true };
    }
    state.lint.legacy.workspaceLoad = { status: "loading", files: workspaceFileStatesForExplorer(), error: "", signature };
    state.lint.legacy.workspaceDocs = [];
    let workspaceRenderMs = measureRenderChrome();
    const docs = [];
    const fileStates = [];
    const readStarted = perfNow();
    const results = await openNativePathsBulk(
      explorerFiles.map((file) => file.path),
      TableDocument,
      null,
      { shouldContinue: () => legacyLintDisplayActive() && version === state.lint.legacy.version }
    );
    const readAndParseMs = elapsedMs(readStarted);
    const workspaceParseMs = results.reduce((total, result) => total + (result?.parseMs ?? 0), 0);
    for (let index = 0; index < explorerFiles.length; index += 1) {
      if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) {
        return {
          workspaceFileCount: explorerFiles.length,
          workspaceReadMs: Math.max(0, readAndParseMs - workspaceParseMs),
          workspaceParseMs,
          bulkRead: results.some((result) => result?.bulkRead),
          usedWorkspaceCache: false,
          workspaceRenderMs
        };
      }
      const file = explorerFiles[index];
      const result = results[index] ?? { error: "No native read result returned." };
      if (result.doc) docs.push(result.doc);
      fileStates.push({
        filePath: file.path,
        fileName: file.name,
        listedInExplorer: true,
        readForLint: true,
        loadedForIndex: true,
        parsedForLint: Boolean(result.doc && !result.error),
        parseError: result.error ?? ""
      });
    }
    if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) {
      return {
        workspaceFileCount: explorerFiles.length,
        workspaceReadMs: Math.max(0, readAndParseMs - workspaceParseMs),
        workspaceParseMs,
        bulkRead: results.some((result) => result?.bulkRead),
        usedWorkspaceCache: false,
        workspaceRenderMs
      };
    }
    state.lint.legacy.workspaceDocs = mergeOpenLegacyWorkspaceDocs(docs, state.docs);
    state.lint.legacy.workspaceLoad = { status: "ready", files: fileStates, error: "", signature };
    workspaceRenderMs += measureRenderChrome();
    return {
      workspaceFileCount: explorerFiles.length,
      workspaceReadMs: Math.max(0, readAndParseMs - workspaceParseMs),
      workspaceParseMs,
      bulkRead: results.some((result) => result?.bulkRead),
      usedWorkspaceCache: false,
      workspaceRenderMs
    };
  }

  function workspaceTxtFiles() {
    return (state.workspace?.files ?? []).filter((file) => isTextLikePath(file.path || file.name));
  }

  function workspaceFileStatesForExplorer() {
    return workspaceTxtFiles().map((file) => ({
      filePath: file.path,
      fileName: file.name,
      listedInExplorer: true,
      loadedForIndex: false,
      parsedForLint: false,
      parseError: ""
    }));
  }

  function yieldToUi() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    cancelJobs,
    currentProfileRules,
    markDocumentChanged,
    resetWorkspaceIndex,
    scheduleForEdit,
    scheduleForOpen,
    scheduleFull,
    workspaceFileStatesForExplorer,
    workspaceTxtFiles
  };
}
