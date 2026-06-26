export const DEFAULT_LSP_TRAFFIC_COUNTERS = Object.freeze({
  lsp_open_file: 0,
  lsp_update_file: 0,
  lsp_update_file_incremental: 0,
  lsp_get_diagnostics: 0,
  lsp_hover: 0,
  diagnostics_changed: 0,
  lsp_close_file: 0,
  hover_cache_hit: 0,
  hover_cache_miss: 0,
  hover_semantic_cache_hit: 0,
  hover_header_cache_hit: 0,
  hover_diagnostic_local_only: 0,
  hover_prewarm_queued: 0,
  hover_prewarm_canceled: 0
});

export const UI_PERF_EVENT_NAMES = Object.freeze([
  "row-command",
  "update-grid-diagnostics",
  "update-overview-ruler",
  "render-problems-panel",
  "render-chrome"
]);

export function createLspTrafficState() {
  return {
    totals: {},
    byUri: {},
    events: []
  };
}

export function createLspReadinessState() {
  return {
    byUri: {},
    events: []
  };
}

export function exposeTxteditorPerf(target, {
  uiPerfSamples,
  hoverPerfSamples,
  hoverPrewarmSamples,
  hoverQueueSamples,
  lintEngineEvents,
  lspTraffic,
  lspReadiness
}) {
  target.__txteditorPerf = uiPerfSamples;
  target.__txteditorPerf.hoverSamples = hoverPerfSamples;
  target.__txteditorPerf.hoverPrewarmSamples = hoverPrewarmSamples;
  target.__txteditorPerf.hoverQueueSamples = hoverQueueSamples;
  target.__txteditorPerf.lintEngineEvents = lintEngineEvents;
  target.__txteditorPerf.lspTraffic = lspTraffic;
  target.__txteditorPerf.lspReadiness = lspReadiness;
  return target.__txteditorPerf;
}

export function recordUiPerfSample(samples, {
  name,
  started,
  diagnostics = 0,
  problemsVisible = false,
  bottomTab = "",
  details = {},
  now = () => performance.now(),
  limit = 200
} = {}) {
  samples.push({
    name,
    ms: Math.round((now() - started) * 100) / 100,
    diagnostics,
    problemsVisible,
    bottomTab,
    ...details
  });
  if (samples.length > limit) samples.shift();
  return samples.at(-1);
}

export function recordLspTrafficSample(state, uri, kind, details = {}, { now = Date.now, limit = 5000 } = {}) {
  const key = uri || "(unknown)";
  state.totals[kind] = (state.totals[kind] ?? 0) + 1;
  const perUri = state.byUri[key] ?? { ...DEFAULT_LSP_TRAFFIC_COUNTERS };
  perUri[kind] = (perUri[kind] ?? 0) + 1;
  state.byUri[key] = perUri;
  const event = { timestamp: now(), uri: key, kind, ...details };
  state.events.push(event);
  if (state.events.length > limit) state.events.shift();
  return event;
}

export function recordLspReadinessSample(state, uri, eventKind, details = {}, { now = Date.now, limit = 1000 } = {}) {
  const key = uri || "(unknown)";
  const event = { timestamp: now(), uri: key, eventKind, ...details };
  state.events.push(event);
  if (state.events.length > limit) state.events.shift();
  state.byUri[key] = {
    ...(state.byUri[key] ?? {}),
    [eventKind]: event.timestamp,
    lastEventKind: eventKind,
    lastEventAt: event.timestamp,
    ...details
  };
  return event;
}
