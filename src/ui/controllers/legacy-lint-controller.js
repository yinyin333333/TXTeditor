import { TableDocument } from "../../core/table-model.js";
import {
  listSiblingTextFilesNative,
  listWorkspaceNative,
  loadLintReferenceDataset,
  openNativePathsBulk
} from "../../core/io.js";
import { buildWorkspaceIndex, runLintWithWorkspaceIndex } from "../../core/lint-engine.js";
import { compareDiagnostics } from "../../core/lint-diagnostics.js";
import { legacyLintDocumentVersion, markLegacyLintDocumentChanged } from "../../core/lint-document-state.js";
import {
  referenceDocumentsFromPayload,
  resolveLegacyLintReferenceVersion
} from "../../core/lint-reference-data.js";
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
import {
  isLegacyLintWorkspaceDocument,
  isDirectTxtSibling,
  legacySiblingContextParentKey,
  legacySiblingContextTargets
} from "../../core/lint-sibling-context.js";
import { documentKey, normalizePath } from "../../core/lint-paths.js";

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
  lintDocKey,
  loadReferenceDataset = loadLintReferenceDataset,
  refreshWorkspace = listWorkspaceNative,
  listSiblingFiles = listSiblingTextFilesNative,
  openPathsBulk = openNativePathsBulk
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
    // Closing a saved shadow must re-read its workspace URI instead of
    // restoring the pre-save snapshot held by the lint cache.
    if (reason === "tab-closed") {
      if (state.workspace?.path) {
        state.lint.legacy.workspaceLoad.status = "not-started";
        state.lint.legacy.workspaceRefreshRequired = true;
      }
      state.lint.legacy.siblingDocs = [];
      state.lint.legacy.siblingLoad = emptySiblingLoad();
    }
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
      siblingFileCount: 0,
      siblingReadMs: 0,
      siblingParseMs: 0,
      workspaceIndexMs: 0,
      runLintMs: 0,
      diagnosticsApplyMs: 0,
      renderMs: 0,
      totalMs: 0,
      diagnosticCount: 0,
      usedWorkspaceCache: false,
      usedSiblingCache: false,
      usedWorkspaceIndexCache: false,
      referenceVersion: "",
      referenceFileCount: 0,
      usedReferenceCache: false,
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
      const siblingStats = await ensureSiblingIndexed(version);
      Object.assign(timings, siblingStats);
      if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) return;
      const referenceStats = await ensureReferenceDataset(version, state.lint.legacy.settings.profile);
      Object.assign(timings, referenceStats);
      if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) return;
      state.lint.legacy.status = `Linting ${state.lint.legacy.settings.profile}...`;
      timings.renderMs += measureRenderChrome();
      await yieldToUi();
      const docs = activeDocuments();
      const indexResult = workspaceIndexesFor(docs, state.lint.legacy.settings.profile);
      timings.workspaceIndexMs = indexResult.ms;
      timings.usedWorkspaceIndexCache = indexResult.cached;
      const runStarted = perfNow();
      const diagnostics = indexResult.indexes
        .flatMap((index) => runLintWithWorkspaceIndex(index, state.lint.legacy.settings))
        .sort(compareDiagnostics);
      disambiguateDiagnosticIds(diagnostics);
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
    return mergeOpenLegacyWorkspaceDocs(state.lint.legacy.workspaceDocs, state.docs);
  }

  function workspaceIndexFor(docs, profile) {
    const signature = indexSignature(docs, profile);
    const cache = state.lint.legacy.workspaceIndexCache;
    const cached = legacyWorkspaceIndexCacheHit(cache, signature, profile);
    if (cached) return cached;
    const started = perfNow();
    const reference = referenceDatasetState();
    const index = buildWorkspaceIndex(docs, profile, {
      referenceDocuments: reference.status === "ready" ? reference.documents : [],
      referenceVersion: reference.status === "ready" ? reference.selectedVersion : null,
      workspaceFileNames: workspaceTxtFiles(),
      workspaceDocuments: state.lint.legacy.workspaceDocs,
      siblingDocuments: siblingDocs(),
      siblingFileNames: siblingTxtFiles(),
      openDocuments: state.docs
    });
    const ms = elapsedMs(started);
    state.lint.legacy.workspaceIndexCache = { signature, profile, index };
    return { index, ms, cached: false };
  }

  function workspaceIndexesFor(docs, profile) {
    const contexts = isolatedSiblingContexts(docs);
    if (!contexts) {
      const result = workspaceIndexFor(docs, profile);
      return { indexes: [result.index], ms: result.ms, cached: result.cached };
    }

    const signature = indexSignature(docs, profile);
    const cache = state.lint.legacy.workspaceIndexCache;
    if (
      cache.signature === signature
      && cache.profile === profile
      && Array.isArray(cache.contextIndexes)
    ) {
      return {
        indexes: cache.contextIndexes.map((entry) => entry.index),
        ms: 0,
        cached: true
      };
    }

    const started = perfNow();
    const reference = referenceDatasetState();
    const contextIndexes = contexts.map((context) => {
      const siblingDocuments = siblingDocs().filter((doc) => siblingRootKey(doc) === context.parentKey);
      const siblingFileNames = siblingTxtFiles().filter((file) => siblingRootKey(file) === context.parentKey);
      return {
        parentKey: context.parentKey,
        index: buildWorkspaceIndex(context.documents, profile, {
          referenceDocuments: reference.status === "ready" ? reference.documents : [],
          referenceVersion: reference.status === "ready" ? reference.selectedVersion : null,
          workspaceFileNames: workspaceTxtFiles(),
          workspaceDocuments: state.lint.legacy.workspaceDocs,
          siblingDocuments,
          siblingFileNames,
          openDocuments: context.openDocuments,
          referenceOpenDocuments: context.referenceOpenDocuments
        })
      };
    });
    const ms = elapsedMs(started);
    state.lint.legacy.workspaceIndexCache = {
      signature,
      profile,
      index: contextIndexes[0]?.index ?? null,
      contextIndexes
    };
    return {
      indexes: contextIndexes.map((entry) => entry.index),
      ms,
      cached: false
    };
  }

  function isolatedSiblingContexts(docs) {
    const workspacePath = state.workspace?.path ?? "";
    const openByParent = new Map();
    const isolatedDocumentKeys = new Set();
    for (const doc of state.docs) {
      const parentKey = legacySiblingContextParentKey(doc, workspacePath);
      if (!parentKey) continue;
      if (!openByParent.has(parentKey)) openByParent.set(parentKey, []);
      openByParent.get(parentKey).push(doc);
      isolatedDocumentKeys.add(documentKey(doc));
    }
    const sharedDocuments = docs.filter((doc) => !isolatedDocumentKeys.has(documentKey(doc)));
    const sharedOpenDocuments = state.docs.filter((doc) => !isolatedDocumentKeys.has(documentKey(doc)));
    const workspaceOpenDocuments = state.docs.filter((doc) => isLegacyLintWorkspaceDocument(doc, workspacePath));
    // Retain the established one-index path only when that index contains one
    // standalone parent and nothing else. A workspace (or another shared
    // document context) must not inherit that parent's sibling tier.
    if (openByParent.size === 0 || (openByParent.size === 1 && sharedDocuments.length === 0)) return null;

    const contexts = [];
    if (sharedDocuments.length) {
      contexts.push({
        parentKey: "",
        documents: sharedDocuments,
        openDocuments: sharedOpenDocuments,
        referenceOpenDocuments: sharedOpenDocuments
      });
    }
    for (const [parentKey, openDocuments] of openByParent) {
      contexts.push({
        parentKey,
        documents: openDocuments,
        openDocuments,
        referenceOpenDocuments: [...workspaceOpenDocuments, ...openDocuments]
      });
    }
    return contexts;
  }

  function indexSignature(docs, profile) {
    return [
      profile,
      state.lint.legacy.workspaceLoad.signature ?? "",
      siblingLoadState().signature ?? "",
      referenceDatasetState().selectedVersion ?? "",
      referenceDatasetState().digest ?? "",
      referenceDatasetState().status ?? "",
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
    state.lint.legacy.workspaceRefreshRequired = false;
    state.lint.legacy.siblingDocs = [];
    state.lint.legacy.siblingLoad = emptySiblingLoad();
  }

  async function ensureReferenceDataset(version, profile) {
    const selectedVersion = resolveLegacyLintReferenceVersion(state.config ?? {}, profile);
    const reference = referenceDatasetState();
    if (!selectedVersion) {
      state.lint.legacy.referenceDataset = emptyReferenceDataset({
        status: "unavailable",
        error: "Select a supported bundled reference version (1.13c, 2.4, 3.1, or 3.2)."
      });
      return { referenceVersion: "", referenceFileCount: 0, usedReferenceCache: false };
    }
    if (reference.status === "ready" && reference.selectedVersion === selectedVersion) {
      return {
        referenceVersion: selectedVersion,
        referenceFileCount: reference.documents.length,
        usedReferenceCache: true
      };
    }

    state.lint.legacy.referenceDataset = emptyReferenceDataset({
      status: "loading",
      selectedVersion
    });
    state.lint.legacy.status = `Loading ${selectedVersion} reference data...`;
    const started = perfNow();
    try {
      const payload = await loadReferenceDataset(selectedVersion);
      if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) {
        return { referenceVersion: selectedVersion, referenceFileCount: 0, usedReferenceCache: false };
      }
      if (!payload) {
        state.lint.legacy.referenceDataset = emptyReferenceDataset({
          status: "unavailable",
          selectedVersion,
          error: "Bundled reference data is available only in the desktop product runtime."
        });
        return { referenceVersion: selectedVersion, referenceFileCount: 0, usedReferenceCache: false };
      }
      const documents = referenceDocumentsFromPayload(payload, selectedVersion);
      state.lint.legacy.referenceDataset = {
        status: "ready",
        selectedVersion,
        gameVersion: payload.gameVersion,
        schemaVariant: payload.schemaVariant,
        digest: String(payload.canonicalSha256 ?? "").toLowerCase(),
        documents,
        error: "",
        loadMs: elapsedMs(started)
      };
      return {
        referenceVersion: selectedVersion,
        referenceFileCount: documents.length,
        usedReferenceCache: false
      };
    } catch (error) {
      if (version === state.lint.legacy.version) {
        state.lint.legacy.referenceDataset = emptyReferenceDataset({
          status: "unavailable",
          selectedVersion,
          error: String(error?.message ?? error)
        });
        recordLintEngineEvent("legacy-reference-unavailable", {
          version,
          referenceVersion: selectedVersion,
          error: String(error?.message ?? error)
        });
      }
      return { referenceVersion: selectedVersion, referenceFileCount: 0, usedReferenceCache: false };
    }
  }

  function referenceDatasetState() {
    if (!state.lint.legacy.referenceDataset) {
      state.lint.legacy.referenceDataset = emptyReferenceDataset();
    }
    return state.lint.legacy.referenceDataset;
  }

  async function ensureWorkspaceIndexed(version) {
    await refreshWorkspaceListingIfRequired(version);
    if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) {
      return { workspaceFileCount: 0, usedWorkspaceCache: false };
    }
    if (!state.workspace?.files?.length) {
      state.lint.legacy.workspaceDocs = [];
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
      return { workspaceFileCount: explorerFiles.length, usedWorkspaceCache: true };
    }
    state.lint.legacy.workspaceLoad = { status: "loading", files: workspaceFileStatesForExplorer(), error: "", signature };
    state.lint.legacy.workspaceDocs = [];
    let workspaceRenderMs = measureRenderChrome();
    const docs = [];
    const fileStates = [];
    const readStarted = perfNow();
    const results = await openPathsBulk(
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
    // Keep the disk snapshot immutable. Open documents are overlaid only when
    // building a diagnostic run so closing a tab restores this disk source.
    state.lint.legacy.workspaceDocs = docs;
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

  async function ensureSiblingIndexed(version) {
    const targets = legacySiblingContextTargets(state.docs, state.workspace?.path ?? "");
    if (!targets.length) {
      state.lint.legacy.siblingDocs = [];
      state.lint.legacy.siblingLoad = emptySiblingLoad({ status: "ready" });
      return { siblingFileCount: 0, usedSiblingCache: true };
    }

    const openDocumentKeys = new Set(state.docs.map(documentKey));
    const files = [];
    const listedPaths = new Set();
    const listingErrors = [];
    for (const target of targets) {
      try {
        const listing = await listSiblingFiles(target.filePath);
        if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) {
          return { siblingFileCount: 0, usedSiblingCache: false };
        }
        if (!listing || !Array.isArray(listing.files)) {
          throw new Error("Sibling listing returned an invalid file list.");
        }
        for (const file of listing.files) {
          if (!isDirectTxtSibling(file, openDocumentKeys)) continue;
          const key = documentKey({ path: file.path, name: file.name });
          if (!key || listedPaths.has(key)) continue;
          listedPaths.add(key);
          files.push({
            ...file,
            siblingRoot: listing.path ?? target.parentKey
          });
        }
      } catch (error) {
        listingErrors.push(`${target.parentKey}: ${String(error?.message ?? error)}`);
      }
    }
    if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) {
      return { siblingFileCount: files.length, usedSiblingCache: false };
    }

    const signature = [
      targets.map((target) => target.parentKey).join("\u001f"),
      legacyWorkspaceFileSignature(files),
      listingErrors.join("\u001f")
    ].join("\u001e");
    if (legacyWorkspaceLoadCacheHit(siblingLoadState(), signature)) {
      return { siblingFileCount: files.length, usedSiblingCache: true };
    }

    state.lint.legacy.siblingDocs = [];
    state.lint.legacy.siblingLoad = emptySiblingLoad({
      status: "loading",
      files: siblingFileStates(files),
      roots: targets.map((target) => target.parentKey),
      error: listingErrors.join("\n"),
      signature
    });
    if (!files.length) {
      state.lint.legacy.siblingLoad.status = "ready";
      return { siblingFileCount: 0, usedSiblingCache: false };
    }

    const readStarted = perfNow();
    const results = await openPathsBulk(
      files.map((file) => file.path),
      TableDocument,
      null,
      { shouldContinue: () => legacyLintDisplayActive() && version === state.lint.legacy.version }
    );
    const readAndParseMs = elapsedMs(readStarted);
    const siblingParseMs = results.reduce((total, result) => total + (result?.parseMs ?? 0), 0);
    if (!legacyLintDisplayActive() || version !== state.lint.legacy.version) {
      return {
        siblingFileCount: files.length,
        siblingReadMs: Math.max(0, readAndParseMs - siblingParseMs),
        siblingParseMs,
        usedSiblingCache: false
      };
    }

    const docs = [];
    const fileStates = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const result = results[index] ?? { error: "No native read result returned." };
      if (result.doc && !result.error) {
        result.doc.lintReferenceSibling = true;
        result.doc.lintReferenceRoot = file.siblingRoot;
        docs.push(result.doc);
      }
      fileStates.push({
        ...file,
        filePath: file.path,
        fileName: file.name,
        listedInExplorer: false,
        referenceOnly: true,
        readForLint: true,
        loadedForIndex: true,
        parsedForLint: Boolean(result.doc && !result.error),
        parseError: result.error ?? ""
      });
    }
    state.lint.legacy.siblingDocs = docs;
    state.lint.legacy.siblingLoad = emptySiblingLoad({
      status: "ready",
      files: fileStates,
      roots: targets.map((target) => target.parentKey),
      error: listingErrors.join("\n"),
      signature
    });
    return {
      siblingFileCount: files.length,
      siblingReadMs: Math.max(0, readAndParseMs - siblingParseMs),
      siblingParseMs,
      usedSiblingCache: false
    };
  }

  async function refreshWorkspaceListingIfRequired(version) {
    if (!state.lint.legacy.workspaceRefreshRequired || !state.workspace?.path) return;
    const workspace = state.workspace;
    try {
      const refreshed = await refreshWorkspace(workspace.path);
      if (!legacyLintDisplayActive() || version !== state.lint.legacy.version || state.workspace !== workspace) return;
      if (!refreshed || !Array.isArray(refreshed.files)) throw new Error("Workspace refresh returned an invalid file list.");
      state.workspace = refreshed;
      state.lint.legacy.workspaceRefreshRequired = false;
      state.lint.legacy.workspaceLoad = { status: "not-started", files: [], error: "", signature: "" };
      state.lint.legacy.workspaceIndexCache = { signature: "", profile: "", index: null };
    } catch (error) {
      if (version !== state.lint.legacy.version || state.workspace !== workspace) return;
      // A refresh failure cannot prove that a listed file disappeared. Keep the
      // stale listing so unreadable or unparseable workspace files still block
      // bundled fallback instead of silently changing reference sources.
      state.lint.legacy.workspaceRefreshRequired = false;
      recordLintEngineEvent("legacy-workspace-refresh-unavailable", {
        version,
        path: workspace.path,
        error: String(error?.message ?? error)
      });
    }
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

  function siblingLoadState() {
    if (!state.lint.legacy.siblingLoad) state.lint.legacy.siblingLoad = emptySiblingLoad();
    return state.lint.legacy.siblingLoad;
  }

  function siblingDocs() {
    if (!Array.isArray(state.lint.legacy.siblingDocs)) state.lint.legacy.siblingDocs = [];
    return state.lint.legacy.siblingDocs;
  }

  function siblingTxtFiles() {
    return siblingLoadState().files ?? [];
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
    siblingTxtFiles,
    workspaceFileStatesForExplorer,
    workspaceTxtFiles
  };
}

function emptyReferenceDataset(overrides = {}) {
  return {
    status: "not-started",
    selectedVersion: "",
    gameVersion: "",
    schemaVariant: "",
    digest: "",
    documents: [],
    error: "",
    loadMs: 0,
    ...overrides
  };
}

function emptySiblingLoad(overrides = {}) {
  return {
    status: "not-started",
    files: [],
    roots: [],
    error: "",
    signature: "",
    ...overrides
  };
}

function siblingFileStates(files = []) {
  return files.map((file) => ({
    ...file,
    filePath: file.path,
    fileName: file.name,
    listedInExplorer: false,
    referenceOnly: true,
    readForLint: false,
    loadedForIndex: false,
    parsedForLint: false,
    parseError: ""
  }));
}

function siblingRootKey(value) {
  return normalizePath(value?.lintReferenceRoot ?? value?.siblingRoot ?? "").replace(/\/+$/, "");
}

function disambiguateDiagnosticIds(diagnostics) {
  const counts = new Map();
  for (const diagnostic of diagnostics) {
    counts.set(diagnostic.id, (counts.get(diagnostic.id) ?? 0) + 1);
  }
  for (const diagnostic of diagnostics) {
    if ((counts.get(diagnostic.id) ?? 0) <= 1) continue;
    diagnostic.id = `${diagnostic.id}:${diagnostic.fileKey}`;
  }
}
