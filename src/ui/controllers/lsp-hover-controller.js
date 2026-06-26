import { diagnosticsForDocument } from "../../core/lint-engine.js";
import { lspHover } from "../../core/io.js";
import {
  cancelVectorHoverSample,
  finishVectorHoverSample,
  makeVectorHoverTarget,
  markVectorHoverRequested,
  markVectorHoverRetry,
  shouldAcceptVectorHoverResult,
  startVectorHoverSample
} from "../../core/vector-hover.js";
import {
  HOVER_PREWARM_CONCURRENCY,
  HOVER_PREWARM_DELAY_MS,
  HOVER_PREWARM_ENABLED,
  HOVER_PREWARM_MAX_TARGETS,
  hoverPrewarmSchedulePolicy,
  shouldCancelPrewarmForUserHover
} from "../../core/vector-hover-prewarm.js";
import {
  activeHoverQueueLength,
  createUserHoverRequest,
  planUserHoverEnqueue,
  takeLatestQueuedHover
} from "../../core/vector-hover-queue.js";
import {
  hoverCacheHitState,
  hoverCacheStoredState,
  isHoverCacheEntryUsable,
  makeHoverCacheEntry,
  makeHoverSemanticCacheKey,
  targetHasImmediateTooltip
} from "../../core/vector-hover-cache.js";
import { lspDocumentState } from "../../core/lsp-document-state.js";
import { visibleHoverClearEvent } from "../context-menu-policy.js";

export function createLspHoverController({
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
  lspHoverRequest = lspHover,
  perfNow
}) {
  const lspHoverCache = new Map();
  const lspHoverSemanticCache = new Map();
  const lspHoverPending = new Map();
  const hoverPerfSamples = [];
  const hoverPrewarmSamples = [];
  const hoverQueueSamples = [];
  let lspHoverCurrentTarget = null;
  let lspHoverQueued = null;
  let lspHoverActiveUserRequest = null;
  let lspHoverLatestQueuedRequest = null;
  let lspHoverGeneration = 0;
  let diagnosticCellSetCache = null;
  let hoverPrewarmTimer = null;
  let hoverPrewarmGeneration = 0;
  let hoverPrewarmActive = 0;
  let hoverPrewarmQueue = [];

  function makeCurrentHoverTarget(doc, row, col) {
    const uri = docToUri(doc);
    if (!uri) return null;
    const cellValue = doc.getCell(row, col);
    return makeVectorHoverTarget({
      uri,
      fileName: doc.name,
      row,
      column: col,
      columnName: doc.headers?.[col] ?? doc.getCell(0, col) ?? "",
      cellValue,
      documentVersion: lspDocumentState(doc).version,
      hasDiagnostics: diagnosticCellSetForDoc(doc).has(`${row}:${col}`)
    });
  }

  function clearHoverCacheForUri(uri) {
    for (const key of [...lspHoverCache.keys()]) {
      if (key.startsWith(`${uri}\u001f`)) lspHoverCache.delete(key);
    }
    for (const key of [...lspHoverSemanticCache.keys()]) {
      if (key.startsWith(`${uri}\u001f`)) lspHoverSemanticCache.delete(key);
    }
  }

  function diagnosticCellSetForDoc(doc) {
    const uri = docToUri(doc) ?? "";
    const cacheKey = `${uri}\u001f${state.lint.version}`;
    if (diagnosticCellSetCache?.key === cacheKey) return diagnosticCellSetCache.set;
    const set = new Set(diagnosticsForDocument(state.lint.diagnostics, doc).map((d) => `${d.rowIndex}:${d.columnIndex}`));
    diagnosticCellSetCache = { key: cacheKey, set };
    return set;
  }

  function targetMatchesCurrentDocument(target) {
    const doc = state.docs.find((candidate) => docToUri(candidate) === target.uri);
    return Boolean(doc && doc.getCell(target.row, target.column) === target.cellValue);
  }

  function getHoverCacheEntry(target) {
    const entry = lspHoverCache.get(target.key);
    if (!isHoverCacheEntryUsable(entry, target, { now: perfNow })) {
      if (entry) lspHoverCache.delete(target.key);
    } else {
      return { ...entry, cacheSource: "exact" };
    }
    const semanticKey = makeHoverSemanticCacheKey(target);
    const semanticEntry = lspHoverSemanticCache.get(semanticKey);
    if (!isHoverCacheEntryUsable(semanticEntry, target, { now: perfNow })) {
      if (semanticEntry) lspHoverSemanticCache.delete(semanticKey);
      return null;
    }
    lspHoverCache.set(target.key, semanticEntry);
    return { ...semanticEntry, cacheSource: target.targetKind === "header" ? "header" : "semantic" };
  }

  function setHoverCacheEntry(target, text) {
    const entry = makeHoverCacheEntry(target, text, { now: perfNow });
    lspHoverCache.set(target.key, entry);
    lspHoverSemanticCache.set(entry.semanticKey, entry);
    return entry;
  }

  function queueLspHover(target, generation, sample) {
    if (sample) {
      sample.requestQueuedAt ??= perfNow();
      sample.prewarmQueueLength = lspHoverQueued ? 1 : 0;
    }
    if (lspHoverQueued?.sample && lspHoverQueued.target?.key !== target.key) {
      cancelVectorHoverSample(lspHoverQueued.sample, "replaced-by-latest-hover", perfNow);
    }
    lspHoverQueued = { target, generation, sample };
    recordHoverQueueEvent({ reason: "queued-until-ready", fileName: target.fileName, row: target.row, column: target.column, targetKind: target.targetKind });
  }

  function retryQueuedHover(_reason) {
    if (!lspHoverQueued) return;
    const { target, generation, sample } = lspHoverQueued;
    const doc = activeDoc();
    const currentUri = docToUri(doc);
    if (target.uri !== currentUri || lspHoverCurrentTarget?.key !== target.key || generation !== lspHoverGeneration) {
      cancelVectorHoverSample(sample, "target-changed-before-ready", perfNow);
      lspHoverQueued = null;
      return;
    }
    if (!isDocReadyForHover(doc)) return;
    lspHoverQueued = null;
    markVectorHoverRetry(sample);
    requestHover(target.row, target.column, { target, generation, sample, fromQueue: true }).catch((error) => reportHoverFailure(target, error, "hover-queued-retry"));
  }

  async function requestHover(row, col, options = {}) {
    if (!effectiveVectorLspHoverEnabled()) {
      recordLintEngineEvent("vector-hover-skipped", { row, column: col });
      return;
    }
    if (shouldCancelPrewarmForUserHover()) cancelHoverPrewarm("user-hover");
    const doc = activeDoc();
    const target = options.target ?? makeCurrentHoverTarget(doc, row, col);
    if (!target) return;
    lspHoverCurrentTarget = target;
    const generation = options.generation ?? lspHoverGeneration;
    const ready = isDocReadyForHover(doc);
    const cacheEntry = getHoverCacheEntry(target);
    const sample = options.sample ?? recordHoverSample(startVectorHoverSample(target, {
      now: perfNow,
      vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
      cached: Boolean(cacheEntry),
      lspReady: ready,
      pointerEnterAt: options.pointerEnterAt,
      delayScheduledAt: options.delayScheduledAt,
      requestQueuedAt: options.requestQueuedAt,
      prewarmQueueLength: activeHoverQueueLength({
        activeRequest: lspHoverActiveUserRequest,
        latestQueuedRequest: lspHoverLatestQueuedRequest
      }),
      wasUserInitiated: true
    }));
    sample.diagnosticsImmediate = Boolean(target.hasDiagnostics);
    recordLspReadiness(target.uri, "firstHoverRequested", {
      fileName: target.fileName,
      row,
      column: col,
      targetKind: target.targetKind,
      lspReady: ready,
      cacheState: cacheEntry?.cacheSource ?? "miss"
    });
    const acceptance = shouldAcceptVectorHoverResult({
      target,
      generation,
      currentTargetKey: lspHoverCurrentTarget?.matchKey ?? lspHoverCurrentTarget?.key,
      currentGeneration: lspHoverGeneration,
      vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
      contextMenuOpen: state.contextMenuOpen
    });
    if (!acceptance.accepted) {
      cancelVectorHoverSample(sample, acceptance.reason, perfNow);
      return;
    }
    if (cacheEntry) {
      sample.cached = true;
      sample.semanticCacheHit = cacheEntry.cacheSource === "semantic";
      sample.headerCacheHit = cacheEntry.cacheSource === "header";
      sample.cacheState = hoverCacheHitState(cacheEntry);
      sample.responseAt = perfNow();
      sample.lspRequestSent = false;
      recordLspTraffic(target.uri, cacheEntry.cacheSource === "header" ? "hover_header_cache_hit" : cacheEntry.cacheSource === "semantic" ? "hover_semantic_cache_hit" : "hover_cache_hit", {
        fileName: target.fileName,
        row,
        column: col,
        targetKind: target.targetKind
      });
      grid.setLspHover(row, col, cacheEntry.text);
      finishVectorHoverSample(sample, {
        now: perfNow,
        contentReturned: cacheEntry.hasContent,
        rendered: cacheEntry.hasContent || targetHasImmediateTooltip(target),
        pointerStillOnTarget: true
      });
      if (target.hasDiagnostics && !cacheEntry.hasContent) recordLspTraffic(target.uri, "hover_diagnostic_local_only", { fileName: target.fileName, row, column: col });
      return;
    }
    recordLspTraffic(target.uri, "hover_cache_miss", { fileName: target.fileName, row, column: col, targetKind: target.targetKind });
    if (!ready) {
      queueLspHover(target, generation, sample);
      return;
    }
    enqueueUserHoverTarget(target, generation, sample);
  }

  function enqueueUserHoverTarget(target, generation, sample) {
    const plan = planUserHoverEnqueue({
      hasPending: lspHoverPending.has(target.key),
      activeRequest: lspHoverActiveUserRequest,
      latestQueuedRequest: lspHoverLatestQueuedRequest
    });
    if (plan.action === "attach-pending") {
      recordHoverQueueEvent({ reason: "attach-pending", fileName: target.fileName, row: target.row, column: target.column, targetKind: target.targetKind });
      fetchLspHoverTarget(target, { generation, sample, render: true }).catch((error) => reportHoverFailure(target, error, "hover-pending-attach"));
      return;
    }
    const queuedAt = perfNow();
    sample.requestQueuedAt ??= queuedAt;
    sample.prewarmQueueLength = activeHoverQueueLength({
      activeRequest: lspHoverActiveUserRequest,
      latestQueuedRequest: lspHoverLatestQueuedRequest
    });
    const request = createUserHoverRequest({ target, generation, sample, queuedAt });
    if (plan.action === "dispatch") {
      dispatchUserHoverRequest(request);
      return;
    }
    if (plan.replaceLatest) {
      cancelVectorHoverSample(lspHoverLatestQueuedRequest.sample, "replaced-by-latest-hover", perfNow);
    }
    lspHoverLatestQueuedRequest = request;
    recordHoverQueueEvent({
      reason: "queued-latest-hover",
      fileName: target.fileName,
      row: target.row,
      column: target.column,
      targetKind: target.targetKind,
      replacements: 1
    });
  }

  function dispatchUserHoverRequest(request) {
    const { target, generation, sample, queuedAt } = request;
    const acceptance = shouldAcceptVectorHoverResult({
      target,
      generation,
      currentTargetKey: lspHoverCurrentTarget?.matchKey ?? lspHoverCurrentTarget?.key,
      currentGeneration: lspHoverGeneration,
      vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
      contextMenuOpen: state.contextMenuOpen
    });
    if (!acceptance.accepted || !targetMatchesCurrentDocument(target)) {
      cancelVectorHoverSample(sample, acceptance.accepted ? "document-version-changed" : acceptance.reason, perfNow);
      return;
    }
    const cacheEntry = getHoverCacheEntry(target);
    if (cacheEntry) {
      sample.cached = true;
      sample.semanticCacheHit = cacheEntry.cacheSource === "semantic";
      sample.headerCacheHit = cacheEntry.cacheSource === "header";
      sample.cacheState = hoverCacheHitState(cacheEntry);
      sample.lspRequestSent = false;
      sample.responseAt = perfNow();
      recordLspTraffic(target.uri, cacheEntry.cacheSource === "header" ? "hover_header_cache_hit" : cacheEntry.cacheSource === "semantic" ? "hover_semantic_cache_hit" : "hover_cache_hit", {
        fileName: target.fileName,
        row: target.row,
        column: target.column,
        targetKind: target.targetKind
      });
      grid.setLspHover(target.row, target.column, cacheEntry.text);
      finishVectorHoverSample(sample, {
        now: perfNow,
        contentReturned: cacheEntry.hasContent,
        rendered: cacheEntry.hasContent || targetHasImmediateTooltip(target),
        pointerStillOnTarget: true
      });
      if (target.hasDiagnostics && !cacheEntry.hasContent) recordLspTraffic(target.uri, "hover_diagnostic_local_only", { fileName: target.fileName, row: target.row, column: target.column });
      recordHoverQueueEvent({ reason: "queued-cache-hit", fileName: target.fileName, row: target.row, column: target.column, targetKind: target.targetKind });
      return;
    }
    lspHoverActiveUserRequest = request;
    sample.queueWaitMs = Math.round((perfNow() - queuedAt) * 100) / 100;
    sample.lspRequestSent = true;
    recordHoverQueueEvent({
      reason: "dispatch-hover",
      fileName: target.fileName,
      row: target.row,
      column: target.column,
      targetKind: target.targetKind,
      queueWaitMs: sample.queueWaitMs
    });
    fetchLspHoverTarget(target, { generation, sample, render: true })
      .catch((error) => reportHoverFailure(target, error, "hover-dispatch"))
      .finally(() => {
        if (lspHoverActiveUserRequest === request) lspHoverActiveUserRequest = null;
        const queued = takeLatestQueuedHover(lspHoverLatestQueuedRequest);
        const next = queued.next;
        lspHoverLatestQueuedRequest = queued.latestQueuedRequest;
        if (next) dispatchUserHoverRequest(next);
      });
  }

  async function fetchLspHoverTarget(target, { generation, sample = null, render = false, prewarm = false } = {}) {
    const pending = lspHoverPending.get(target.key);
    if (pending) {
      if (render && sample) {
        markVectorHoverRequested(sample, () => pending.requestStarted);
        sample.lspRequestSent = false;
        sample.attachedToPending = true;
        pending.waiters.push({ generation, sample });
      }
      return pending.promise;
    }
    const waiters = render && sample ? [{ generation, sample }] : [];
    const requestStarted = perfNow();
    const promise = (async () => {
      for (const waiter of waiters) markVectorHoverRequested(waiter.sample, () => requestStarted);
      try {
        const doc = state.docs.find((candidate) => docToUri(candidate) === target.uri);
        if (!doc || !targetMatchesCurrentDocument(target)) return null;
        const charOffset = computeCharOffset(doc, target.row, target.column);
        recordLspTraffic(target.uri, "lsp_hover", { fileName: target.fileName, row: target.row, column: target.column, targetKind: target.targetKind });
        const text = await lspHoverRequest(target.uri, target.row, charOffset);
        const responseAt = perfNow();
        recordLspReadiness(target.uri, "firstHoverResponse", {
          fileName: target.fileName,
          row: target.row,
          column: target.column,
          targetKind: target.targetKind,
          lspResponseMs: Math.round((responseAt - requestStarted) * 100) / 100,
          hasContent: Boolean(text)
        });
        const currentPending = lspHoverPending.get(target.key);
        const currentWaiters = currentPending?.waiters ?? waiters;
        if (generation !== lspHoverGeneration || !targetMatchesCurrentDocument(target)) {
          const reason = generation !== lspHoverGeneration ? "generation-changed" : "document-version-changed";
          for (const waiter of currentWaiters) cancelVectorHoverSample(waiter.sample, reason, perfNow);
          return null;
        }
        const cacheEntry = setHoverCacheEntry(target, text);
        for (const waiter of currentWaiters) {
          waiter.sample.responseAt = responseAt;
          waiter.sample.cacheState = hoverCacheStoredState(cacheEntry);
          const resultAcceptance = shouldAcceptVectorHoverResult({
            target,
            generation: waiter.generation,
            currentTargetKey: lspHoverCurrentTarget?.matchKey ?? lspHoverCurrentTarget?.key,
            currentGeneration: lspHoverGeneration,
            vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
            contextMenuOpen: state.contextMenuOpen
          });
          if (!resultAcceptance.accepted) {
            cancelVectorHoverSample(waiter.sample, resultAcceptance.reason, perfNow);
            continue;
          }
          if (text) {
            grid.setLspHover(target.row, target.column, text);
            finishVectorHoverSample(waiter.sample, { now: perfNow, contentReturned: true, rendered: true, pointerStillOnTarget: true });
          } else {
            grid.setLspHover(target.row, target.column, null);
            finishVectorHoverSample(waiter.sample, { now: perfNow, contentReturned: false, rendered: targetHasImmediateTooltip(target), pointerStillOnTarget: true });
          }
        }
        if (prewarm) recordHoverPrewarmSample(target, { requestStarted, responseAt, contentReturned: Boolean(text) });
        return text;
      } catch (error) {
        reportHoverFailure(target, error, prewarm ? "hover-prewarm" : "hover-request");
        const currentPending = lspHoverPending.get(target.key);
        for (const waiter of currentPending?.waiters ?? waiters) {
          const resultAcceptance = shouldAcceptVectorHoverResult({
            target,
            generation: waiter.generation,
            currentTargetKey: lspHoverCurrentTarget?.matchKey ?? lspHoverCurrentTarget?.key,
            currentGeneration: lspHoverGeneration,
            vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
            contextMenuOpen: state.contextMenuOpen
          });
          if (resultAcceptance.accepted) cancelVectorHoverSample(waiter.sample, "request-failed", perfNow);
          else cancelVectorHoverSample(waiter.sample, resultAcceptance.reason, perfNow);
        }
        return null;
      } finally {
        lspHoverPending.delete(target.key);
      }
    })();
    lspHoverPending.set(target.key, { generation, waiters, promise, requestStarted, prewarm: Boolean(prewarm) });
    return promise;
  }

  function scheduleHoverPrewarm(reason = "schedule") {
    const policy = hoverPrewarmSchedulePolicy({
      vectorHoverEnabled: effectiveVectorLspHoverEnabled(),
      prewarmEnabled: HOVER_PREWARM_ENABLED
    });
    if (policy.action === "cancel" && !policy.recordTraffic) {
      cancelHoverPrewarm(reason);
      recordHoverPrewarmEvent({ reason, ...policy.event, engine: state.lint.engine });
      return;
    }
    if (policy.action === "cancel") {
      cancelHoverPrewarm(reason);
      recordLspTraffic(docToUri(activeDoc()), "hover_prewarm_canceled", { reason, disabled: true, activeFile: activeDoc()?.name ?? "" });
      recordHoverPrewarmEvent({ reason, ...policy.event });
      return;
    }
    if (hoverPrewarmTimer !== null) clearTimeout(hoverPrewarmTimer);
    hoverPrewarmTimer = setTimeout(() => {
      hoverPrewarmTimer = null;
      startHoverPrewarm(reason);
    }, HOVER_PREWARM_DELAY_MS);
  }

  function cancelHoverPrewarm(reason = "cancel") {
    hoverPrewarmGeneration += 1;
    hoverPrewarmQueue = [];
    hoverPrewarmActive = 0;
    if (hoverPrewarmTimer !== null) {
      clearTimeout(hoverPrewarmTimer);
      hoverPrewarmTimer = null;
    }
    recordHoverPrewarmEvent({ reason, canceled: true });
  }

  function startHoverPrewarm(reason = "visible") {
    const doc = activeDoc();
    if (!effectiveVectorLspHoverEnabled() || state.contextMenuOpen || !isDocReadyForHover(doc)) return;
    const uri = docToUri(doc);
    const targets = buildVisibleHoverPrewarmTargets(doc).filter((target) => !getHoverCacheEntry(target) && !lspHoverPending.has(target.key));
    if (!targets.length) return;
    hoverPrewarmGeneration += 1;
    hoverPrewarmQueue = targets.slice(0, HOVER_PREWARM_MAX_TARGETS);
    hoverPrewarmActive = 0;
    recordLspTraffic(uri, "hover_prewarm_queued", { reason, queued: hoverPrewarmQueue.length, fileName: doc.name });
    recordHoverPrewarmEvent({ reason, queued: hoverPrewarmQueue.length, fileName: doc.name });
    pumpHoverPrewarm(hoverPrewarmGeneration);
  }

  function pumpHoverPrewarm(generation) {
    if (generation !== hoverPrewarmGeneration) return;
    while (hoverPrewarmActive < HOVER_PREWARM_CONCURRENCY && hoverPrewarmQueue.length) {
      const target = hoverPrewarmQueue.shift();
      hoverPrewarmActive += 1;
      fetchLspHoverTarget(target, { generation: lspHoverGeneration, prewarm: true })
        .catch((error) => reportHoverFailure(target, error, "hover-prewarm-dispatch"))
        .finally(() => {
          hoverPrewarmActive = Math.max(0, hoverPrewarmActive - 1);
          pumpHoverPrewarm(generation);
        });
    }
  }

  function buildVisibleHoverPrewarmTargets(doc) {
    const uri = docToUri(doc);
    if (!uri) return [];
    const rows = grid.visibleRowIndexes?.() ?? [];
    const columns = grid.visibleColumnIndexes?.() ?? [];
    const diagCells = diagnosticCellSetForDoc(doc);
    const targets = [];
    const seen = new Set();
    const push = (row, column) => {
      if (row < 0 || column < 0 || row >= doc.rowCount || column >= doc.columnCount) return;
      const target = makeVectorHoverTarget({
        uri,
        fileName: doc.name,
        row,
        column,
        columnName: doc.headers?.[column] ?? doc.getCell(0, column) ?? "",
        cellValue: doc.getCell(row, column),
        documentVersion: lspDocumentState(doc).version,
        hasDiagnostics: diagCells.has(`${row}:${column}`)
      });
      if (seen.has(target.key)) return;
      seen.add(target.key);
      targets.push(target);
    };
    for (const column of columns.slice(0, 32)) push(0, column);
    for (const row of rows.filter((row) => row > 0).slice(0, 32)) push(row, 0);
    for (const row of rows.filter((row) => row > 0).slice(0, 8)) {
      for (const column of columns.filter((column) => column > 0).slice(0, 8)) push(row, column);
    }
    for (const key of diagCells) {
      const [row, column] = key.split(":").map(Number);
      if (rows.includes(row) && columns.includes(column)) push(row, column);
      if (targets.length >= HOVER_PREWARM_MAX_TARGETS) break;
    }
    return targets;
  }

  function recordHoverPrewarmEvent(event) {
    hoverPrewarmSamples.push({
      timestamp: perfNow(),
      ...event
    });
    if (hoverPrewarmSamples.length > 160) hoverPrewarmSamples.shift();
  }

  function recordHoverPrewarmSample(target, { requestStarted, responseAt, contentReturned }) {
    recordHoverPrewarmEvent({
      fileName: target.fileName,
      targetKind: target.targetKind,
      row: target.row,
      column: target.column,
      columnName: target.columnName,
      cellValue: target.cellValue,
      documentVersion: target.documentVersion,
      totalMs: Math.round((responseAt - requestStarted) * 100) / 100,
      contentReturned: Boolean(contentReturned),
      cacheState: contentReturned ? "filled" : "empty"
    });
  }

  function invalidateHover(clearCache = false, reason = "hover-invalidated") {
    lspHoverGeneration += 1;
    cancelHoverPrewarm(reason);
    if (lspHoverQueued?.sample) cancelVectorHoverSample(lspHoverQueued.sample, reason, perfNow);
    if (lspHoverLatestQueuedRequest?.sample) cancelVectorHoverSample(lspHoverLatestQueuedRequest.sample, reason, perfNow);
    for (const pending of lspHoverPending.values()) {
      for (const waiter of pending.waiters ?? []) cancelVectorHoverSample(waiter.sample, reason, perfNow);
    }
    lspHoverCurrentTarget = null;
    lspHoverQueued = null;
    lspHoverActiveUserRequest = null;
    lspHoverLatestQueuedRequest = null;
    lspHoverPending.clear();
    diagnosticCellSetCache = null;
    if (clearCache) {
      lspHoverCache.clear();
      lspHoverSemanticCache.clear();
    }
    grid.clearLspHovers();
  }

  function clearVisibleHover(reason = "hover-cleared") {
    cancelHoverPrewarm(reason);
    if (lspHoverQueued?.sample) cancelVectorHoverSample(lspHoverQueued.sample, reason, perfNow);
    if (lspHoverLatestQueuedRequest?.sample) cancelVectorHoverSample(lspHoverLatestQueuedRequest.sample, reason, perfNow);
    for (const pending of lspHoverPending.values()) {
      for (const waiter of pending.waiters ?? []) cancelVectorHoverSample(waiter.sample, reason, perfNow);
    }
    lspHoverCurrentTarget = null;
    lspHoverQueued = null;
    lspHoverLatestQueuedRequest = null;
    recordHoverQueueEvent(visibleHoverClearEvent({ reason, inFlight: lspHoverPending.size }));
  }

  function reportHoverDispatchFailure(row, column, error, context) {
    const doc = activeDoc();
    reportHoverFailure({
      uri: docToUri(doc),
      fileName: doc?.name ?? "",
      row,
      column
    }, error, context);
  }

  function recordHoverSample(sample) {
    if (!sample) return sample;
    hoverPerfSamples.push(sample);
    if (hoverPerfSamples.length > 2000) hoverPerfSamples.shift();
    return sample;
  }

  function recordHoverQueueEvent(event) {
    hoverQueueSamples.push({
      timestamp: perfNow(),
      active: Boolean(lspHoverActiveUserRequest),
      queued: Boolean(lspHoverLatestQueuedRequest),
      inFlight: lspHoverPending.size,
      ...event
    });
    if (hoverQueueSamples.length > 2000) hoverQueueSamples.shift();
  }

  return {
    clearHoverCacheForUri,
    clearVisibleHover,
    invalidateHover,
    perf: {
      hoverPerfSamples,
      hoverPrewarmSamples,
      hoverQueueSamples
    },
    reportHoverDispatchFailure,
    requestHover,
    retryQueuedHover,
    scheduleHoverPrewarm
  };
}
