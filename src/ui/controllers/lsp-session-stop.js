import { isTauriRuntime, lspStop } from "../../core/io.js";
import { resetLspDocumentState } from "../../core/lsp-document-state.js";

export function stopLspSession({
  state,
  reason,
  readyGenerations,
  stoppedGenerations,
  diagnosticsEventController,
  hoverController,
  pendingCloses
}) {
  const stoppedGeneration = Number(state.lsp.generation) || 0;
  const invalidatedGeneration = stoppedGeneration + 1;
  readyGenerations.delete(stoppedGeneration);
  stoppedGenerations.add(stoppedGeneration);
  diagnosticsEventController.clearPending();
  hoverController.invalidateHover(true, reason);
  pendingCloses.clear();
  Object.assign(state.lsp, {
    started: false,
    generation: invalidatedGeneration,
    workspacePath: "",
    workspaceKey: "",
    contextMode: "workspace",
    referenceRootPath: "",
    includeSubfolders: true,
    readiness: "stopped",
    openFileCount: 0
  });
  state.lint.status = "";
  for (const doc of state.docs) resetLspDocumentState(doc);
  if (!stoppedGeneration || !isTauriRuntime()) return Promise.resolve(0);
  return lspStop(stoppedGeneration);
}
