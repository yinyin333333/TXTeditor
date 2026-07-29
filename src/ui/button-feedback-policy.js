const feedbackTimers = new WeakMap();

export const BUTTON_FEEDBACK_CLASS = "button-click-feedback";
export const BUTTON_FEEDBACK_DURATION_MS = 150;

export function interactiveButtonFromTarget(target) {
  const button = target?.closest?.("button") ?? null;
  if (!button || button.disabled || button.getAttribute?.("aria-disabled") === "true") return null;
  return button;
}

export function showButtonClickFeedback(target, {
  duration = BUTTON_FEEDBACK_DURATION_MS,
  schedule = globalThis.setTimeout?.bind(globalThis),
  cancel = globalThis.clearTimeout?.bind(globalThis),
  nextFrame = globalThis.requestAnimationFrame?.bind(globalThis)
} = {}) {
  const button = interactiveButtonFromTarget(target);
  if (!button) return false;

  const previous = feedbackTimers.get(button);
  if (previous != null) cancel?.(previous);
  button.classList.remove(BUTTON_FEEDBACK_CLASS);
  const activate = () => button.classList.add(BUTTON_FEEDBACK_CLASS);
  if (typeof nextFrame === "function") nextFrame(activate);
  else activate();
  if (typeof schedule === "function") {
    const timer = schedule(() => {
      button.classList.remove(BUTTON_FEEDBACK_CLASS);
      feedbackTimers.delete(button);
    }, duration);
    feedbackTimers.set(button, timer);
  }
  return true;
}
