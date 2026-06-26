export function backgroundTaskErrorMessage(label, error) {
  const task = String(label || "Background task");
  const detail = error instanceof Error ? error.message : String(error || "unknown error");
  return {
    status: `${task} failed`,
    log: `${task} failed: ${detail}`,
    detail
  };
}

export function reportBackgroundTaskFailure({
  state,
  label,
  error,
  context = "background",
  appendLog,
  renderChrome
}) {
  const message = backgroundTaskErrorMessage(label, error);
  if (state?.lint) state.lint.status = message.status;
  appendLog?.(`[${context}] ${message.log}`);
  renderChrome?.();
  return message;
}
