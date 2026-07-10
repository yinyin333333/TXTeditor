import { lspGetDiagnosticsBatch } from "../../core/io.js";
import { lspDocumentState } from "../../core/lsp-document-state.js";
import { docToUri, fileNameFromUri, pathFromUri } from "../../core/lsp-uri-policy.js";
import { reportLspRequestFailure } from "../../core/lsp-update-status.js";

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function scheduleUiFlush(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(callback);
    return;
  }
  queueMicrotask(callback);
}

export function createLspDiagnosticsEventController({
  state,
  activeDoc,
  isVectorLintEngine,
  uriToFileKey,
  mapDiagnosticToDisplay,
  recordLintEngineEvent,
  recordLspTraffic,
  recordLspReadiness,
  appendLspLog,
  setLintDiagnostics,
  renderChrome,
  renderDiagnosticsChrome = renderChrome,
  markDocHoverReady,
  scheduleHoverPrewarm,
  sessionAcceptsEvents
}) {
  let requestToken = 0;
  let pendingEpoch = 0;
  let scheduledFlush = null;
  const latestRequests = new Map();
  const pendingRequests = new Map();
  const performance = {
    events: 0,
    getterCalls: 0,
    getterRequests: 0,
    getterInFlight: 0,
    getterMaxInFlight: 0,
    getterTotalMs: 0,
    getterMaxMs: 0,
    acceptedSnapshots: 0,
    flushes: 0,
    commits: 0,
    renders: 0,
    maxPendingUris: 0,
    mappedDiagnostics: 0,
    flushTotalMs: 0,
    flushMaxMs: 0
  };

  function acceptsCurrentSession(generation) {
    return generation === state.lsp.generation
      && sessionAcceptsEvents(generation)
      && state.lint.enabled
      && isVectorLintEngine();
  }

  function currentDocument(uri, generation, explicitEvent, version) {
    const fileKey = uriToFileKey(uri);
    const doc = state.docs.find((candidate) => uriToFileKey(docToUri(candidate)) === fileKey);
    const docState = doc ? lspDocumentState(doc) : null;
    const ownsOpenIdentity = (docState?.openedUri === uri && docState.sessionGeneration === generation)
      || (docState?.openingUri === uri && docState.openingGeneration === generation);
    if (ownsOpenIdentity) {
      if (explicitEvent && version == null) return null;
      if (version != null && version !== docState.version) return null;
    }
    return { doc, fileKey };
  }

  function clearPending() {
    pendingEpoch += 1;
    latestRequests.clear();
    pendingRequests.clear();
    if (scheduledFlush) {
      const flush = scheduledFlush;
      scheduledFlush = null;
      flush.resolve();
    }
  }

  function finishFlush(started) {
    const duration = nowMs() - started;
    performance.flushTotalMs += duration;
    performance.flushMaxMs = Math.max(performance.flushMaxMs, duration);
  }

  async function flushPendingRequests(epoch) {
    if (epoch !== pendingEpoch || pendingRequests.size === 0) return;
    const started = nowMs();
    performance.flushes += 1;
    const requests = [...pendingRequests.values()].sort((left, right) => left.token - right.token);
    pendingRequests.clear();
    const candidates = requests.filter((item) => (
      acceptsCurrentSession(item.generation)
      && latestRequests.get(item.requestKey) === item.token
      && currentDocument(item.uri, item.generation, item.explicitEvent, item.eventVersion)
    ));
    if (candidates.length === 0) {
      finishFlush(started);
      return;
    }

    const generation = candidates[0].generation;
    const getterStarted = nowMs();
    performance.getterCalls += 1;
    performance.getterRequests += candidates.length;
    performance.getterInFlight += 1;
    performance.getterMaxInFlight = Math.max(
      performance.getterMaxInFlight,
      performance.getterInFlight
    );
    let results;
    try {
      results = await lspGetDiagnosticsBatch(
        candidates.map(({ uri, eventSequence }) => ({ uri, sequence: eventSequence })),
        generation
      );
    } catch (error) {
      for (const item of candidates) {
        reportLspRequestFailure({
          uri: item.uri,
          operation: "get diagnostics batch",
          eventKind: "lsp_get_diagnostics_failed",
          fileName: item.fileName,
          error,
          context: "diagnostics-changed",
          recordLspTraffic,
          appendLspLog
        });
      }
      finishFlush(started);
      return;
    } finally {
      const getterDuration = nowMs() - getterStarted;
      performance.getterInFlight -= 1;
      performance.getterTotalMs += getterDuration;
      performance.getterMaxMs = Math.max(performance.getterMaxMs, getterDuration);
    }
    if (epoch !== pendingEpoch || !acceptsCurrentSession(generation)) {
      finishFlush(started);
      return;
    }

    const snapshots = Array.isArray(results) ? results : [];
    const replacements = new Map();
    for (let index = 0; index < candidates.length; index += 1) {
      const item = candidates[index];
      const result = snapshots[index];
      if (result == null || latestRequests.get(item.requestKey) !== item.token) continue;
      const snapshot = Array.isArray(result)
        ? {
            generation,
            uri: item.uri,
            version: item.eventVersion,
            sequence: item.eventSequence,
            diagnostics: result
          }
        : result;
      if (Number(snapshot.generation ?? generation) !== generation
        || String(snapshot.uri ?? item.uri) !== item.uri) continue;
      if (item.eventSequence != null && Number(snapshot.sequence) !== item.eventSequence) continue;
      const snapshotVersion = snapshot.version == null ? null : Number(snapshot.version);
      const current = currentDocument(
        item.uri,
        generation,
        item.explicitEvent,
        snapshotVersion
      );
      if (!current) continue;
      const rawDiagnostics = Array.isArray(snapshot.diagnostics) ? snapshot.diagnostics : [];
      const { doc, fileKey } = current;
      const fileName = doc?.name ?? fileNameFromUri(item.uri);
      const filePath = doc?.path ?? pathFromUri(item.uri);
      recordLspReadiness(item.uri, "firstDiagnosticsReceived", {
        fileName,
        activeFile: activeDoc()?.name ?? "",
        diagnosticCount: rawDiagnostics.length
      });
      const displayDiagnostics = rawDiagnostics.map((diagnostic, diagnosticIndex) => (
        mapDiagnosticToDisplay(diagnostic, {
          uri: item.uri,
          fileKey,
          fileName,
          filePath,
          index: diagnosticIndex,
          doc
        })
      ));
      replacements.set(fileKey, { displayDiagnostics, doc, uri: item.uri });
      latestRequests.delete(item.requestKey);
      performance.acceptedSnapshots += 1;
      performance.mappedDiagnostics += displayDiagnostics.length;
    }

    if (replacements.size > 0 && acceptsCurrentSession(generation)) {
      const replacedKeys = new Set(replacements.keys());
      const nextDiagnostics = state.lint.diagnostics.filter(
        (diagnostic) => !replacedKeys.has(diagnostic.fileKey)
      );
      for (const { displayDiagnostics } of replacements.values()) {
        nextDiagnostics.push(...displayDiagnostics);
      }
      setLintDiagnostics(nextDiagnostics);
      performance.commits += 1;
      renderDiagnosticsChrome();
      performance.renders += 1;
      let prewarmActive = false;
      for (const { doc, uri } of replacements.values()) {
        if (!doc) continue;
        lspDocumentState(doc).diagnosticsReady = true;
        markDocHoverReady(doc, uri, "diagnostics-ready");
        if (doc === activeDoc()) prewarmActive = true;
      }
      if (prewarmActive) scheduleHoverPrewarm("diagnostics-ready");
    }
    finishFlush(started);
  }

  function queuePendingFlush() {
    if (scheduledFlush) return scheduledFlush.promise;
    const epoch = pendingEpoch;
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const flush = { promise, resolve };
    scheduledFlush = flush;
    scheduleUiFlush(async () => {
      if (scheduledFlush === flush) scheduledFlush = null;
      try {
        await flushPendingRequests(epoch);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    return promise;
  }

  async function handleDiagnosticsChanged(uriOrEvent, metadata = {}) {
    performance.events += 1;
    const explicitEvent = typeof uriOrEvent === "object" || Object.keys(metadata).length > 0;
    const event = typeof uriOrEvent === "object" && uriOrEvent !== null
      ? uriOrEvent
      : { ...metadata, uri: uriOrEvent };
    const uri = String(event.uri ?? "");
    const generation = Number(event.generation ?? state.lsp.generation ?? 0);
    const eventVersion = event.version == null ? null : Number(event.version);
    const eventSequence = event.sequence == null ? null : Number(event.sequence);
    if (!uri || generation !== state.lsp.generation || !sessionAcceptsEvents(generation)) return;
    if (!state.lint.enabled || !isVectorLintEngine()) {
      recordLintEngineEvent("vector-diagnostics-ignored", { uri });
      return;
    }
    const current = currentDocument(uri, generation, explicitEvent, eventVersion);
    if (!current) return;
    recordLspTraffic(uri, "diagnostics_changed");
    recordLspTraffic(uri, "lsp_get_diagnostics");
    const requestKey = `${generation}\u001f${uri}`;
    const token = ++requestToken;
    latestRequests.set(requestKey, token);
    pendingRequests.set(requestKey, {
      requestKey,
      token,
      generation,
      explicitEvent,
      uri,
      eventVersion,
      eventSequence,
      fileName: current.doc?.name ?? fileNameFromUri(uri)
    });
    performance.maxPendingUris = Math.max(performance.maxPendingUris, pendingRequests.size);
    await queuePendingFlush();
  }

  function getPerformanceSnapshot() {
    return { ...performance, pendingUris: pendingRequests.size };
  }

  return { clearPending, getPerformanceSnapshot, handleDiagnosticsChanged };
}
