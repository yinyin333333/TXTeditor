export const HOVER_PREWARM_ENABLED = false;
export const HOVER_PREWARM_DELAY_MS = 80;
export const HOVER_PREWARM_CONCURRENCY = 2;
export const HOVER_PREWARM_MAX_TARGETS = 90;

export function hoverPrewarmSchedulePolicy({ vectorHoverEnabled, prewarmEnabled = HOVER_PREWARM_ENABLED }) {
  if (!vectorHoverEnabled) {
    return {
      action: "cancel",
      disabled: true,
      recordTraffic: false,
      event: { skipped: true, disabled: true, queued: 0 }
    };
  }
  if (!prewarmEnabled) {
    return {
      action: "cancel",
      disabled: true,
      recordTraffic: true,
      event: { skipped: true, disabled: true, queued: 0 }
    };
  }
  return {
    action: "schedule",
    disabled: false,
    recordTraffic: false,
    event: { skipped: false, disabled: false }
  };
}

export function shouldCancelPrewarmForUserHover() {
  return true;
}
