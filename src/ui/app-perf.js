import { recordUiPerfSample } from "../core/perf-instrumentation.js";

export function createAppPerf({ state }) {
  const uiPerfSamples = [];
  const lintEngineEvents = [];

  function perfNow() {
    return typeof performance === "undefined" ? 0 : performance.now();
  }

  function elapsedMs(started) {
    return Math.round((perfNow() - started) * 100) / 100;
  }

  function recordUiPerf(name, started, details = {}) {
    if (typeof performance === "undefined") return;
    recordUiPerfSample(uiPerfSamples, {
      name,
      started,
      diagnostics: state.lint.diagnostics.length,
      problemsVisible: state.problemsVisible,
      bottomTab: state.bottomTab,
      details,
      now: () => performance.now()
    });
  }

  function recordLintEngineEvent(kind, details = {}) {
    lintEngineEvents.push({
      timestamp: perfNow(),
      engine: state.lint.engine,
      diagnostics: state.lint.diagnostics.length,
      ...details,
      kind
    });
    if (lintEngineEvents.length > 2000) lintEngineEvents.shift();
  }

  return {
    uiPerfSamples,
    lintEngineEvents,
    perfNow,
    elapsedMs,
    recordUiPerf,
    recordLintEngineEvent
  };
}
