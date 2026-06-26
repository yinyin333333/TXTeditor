export function lspUpdateErrorMessage(doc, error) {
  const fileName = doc?.name || "document";
  const detail = error instanceof Error ? error.message : String(error || "unknown error");
  return {
    status: `Vector-LSP update failed for ${fileName}`,
    log: `Vector-LSP update failed for ${fileName}: ${detail}`,
    detail
  };
}

export function reportLspUpdateFailure({
  state,
  doc,
  uri,
  error,
  context,
  recordLspTraffic,
  appendLspLog,
  renderChrome
}) {
  const message = lspUpdateErrorMessage(doc, error);
  state.lint.status = message.status;
  recordLspTraffic?.(uri, "lsp_update_failed", {
    fileName: doc?.name ?? "",
    context,
    error: message.detail
  });
  appendLspLog?.(`[${context}] ${message.log}`);
  renderChrome?.();
  return message;
}

export function lspRequestErrorMessage(operation, fileName, error) {
  const request = String(operation || "request");
  const target = fileName || "document";
  const detail = error instanceof Error ? error.message : String(error || "unknown error");
  return {
    log: `Vector-LSP ${request} failed for ${target}: ${detail}`,
    detail
  };
}

export function reportLspRequestFailure({
  uri,
  operation,
  eventKind,
  fileName = "",
  error,
  context,
  recordLspTraffic,
  appendLspLog
}) {
  const message = lspRequestErrorMessage(operation, fileName, error);
  recordLspTraffic?.(uri, eventKind || "lsp_request_failed", {
    fileName,
    context,
    operation,
    error: message.detail
  });
  appendLspLog?.(`[${context}] ${message.log}`);
  return message;
}

export function clearLspUpdateFailureStatus(state, renderChrome) {
  if (!String(state.lint.status || "").startsWith("Vector-LSP update failed")) return false;
  state.lint.status = "";
  renderChrome?.();
  return true;
}
