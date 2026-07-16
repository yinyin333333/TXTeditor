import { lspUpdateFile, lspUpdateFileIncremental } from "../../core/io.js";
import { documentRevision } from "../../core/document-file-state.js";
import { isLocalizationJsonPathInCurrentMode } from "../../core/json-document-policy.js";
import { docToUri } from "../../core/lsp-uri-policy.js";
import {
  lspDocumentState,
  nextLspDocumentVersion
} from "../../core/lsp-document-state.js";
import { clearLspUpdateFailureStatus } from "../../core/lsp-update-status.js";

export async function updateJsonLspDocument({
  state,
  doc,
  change = {},
  isVectorLintEngine,
  openDoc,
  recordLspTraffic,
  renderChrome
}) {
  if (!isVectorLintEngine() || !state.lsp.started) return;
  const docState = lspDocumentState(doc);
  const uri = docToUri(doc);
  const generation = state.lsp.generation ?? 0;
  const allowOpenDocumentFallback = docState.opened
    && docState.openedUri === uri
    && docState.sessionGeneration === generation;
  if (!uri || !isLocalizationJsonPathInCurrentMode(doc.path, state, {
    allowOpenDocumentFallback
  })) return;
  const version = nextLspDocumentVersion(doc);
  const revision = documentRevision(doc);
  const changes = Array.isArray(change?.changes) ? change.changes : [];
  docState.ready = false;
  docState.diagnosticsReady = false;
  const previousUpdate = docState.updatePromise ?? docState.openPromise ?? Promise.resolve();
  let trackedPromise;
  const operation = Promise.resolve(previousUpdate).catch(() => {}).then(async () => {
    if (docState.updatePromise !== trackedPromise || state.lsp.generation !== generation
      || !state.lsp.started || docToUri(doc) !== uri) return;
    if (!docState.opened || docState.openedUri !== uri || docState.sessionGeneration !== generation) {
      await openDoc(doc);
    }
    if (docState.updatePromise !== trackedPromise || state.lsp.generation !== generation
      || !state.lsp.started || !docState.opened || docState.openedUri !== uri
      || docState.sessionGeneration !== generation) return;
    if (docState.openedVersion >= version && docState.syncedRevision >= revision) return;
    const canIncrement = changes.length === 1 && docState.syncedRevision === revision - 1;
    if (canIncrement) {
      recordLspTraffic(uri, "lsp_update_file_incremental", {
        fileName: doc.name,
        documentVersion: version,
        json: true
      });
      await lspUpdateFileIncremental(uri, version, changes, generation);
    } else {
      recordLspTraffic(uri, "lsp_update_file", {
        fileName: doc.name,
        documentVersion: version,
        json: true
      });
      await lspUpdateFile(uri, version, doc.toText(), generation);
    }
    if (docState.updatePromise !== trackedPromise || state.lsp.generation !== generation
      || docToUri(doc) !== uri) return;
    docState.openedVersion = version;
    docState.syncedRevision = revision;
    docState.sessionGeneration = generation;
    docState.requiresFullSync = false;
    clearLspUpdateFailureStatus(state, renderChrome);
  }).catch((error) => {
    if (docState.updatePromise !== trackedPromise) return;
    docState.requiresFullSync = true;
    throw error;
  });
  trackedPromise = operation.finally(() => {
    if (docState.updatePromise === trackedPromise) docState.updatePromise = null;
  });
  docState.updatePromise = trackedPromise;
  return trackedPromise;
}

export function jsonDocumentCanOpen({ state, doc, uri, docState, generation }) {
  if (state.lsp.readiness !== "ready") return false;
  const allowOpenDocumentFallback = docState.opened
    && docState.openedUri === uri
    && docState.sessionGeneration === generation;
  return isLocalizationJsonPathInCurrentMode(doc.path, state, { allowOpenDocumentFallback });
}

export async function syncReadyJsonDocuments({
  state, generation, documentCanOpenInSession, openDoc, reportOpenFailure, renderChrome
}) {
  const documents = state.docs.filter((doc) => doc?.kind === "json" && documentCanOpenInSession(doc));
  for (const doc of documents) {
    if (state.lsp.generation !== generation || !state.lsp.started
      || state.lsp.readiness !== "ready") return;
    await openDoc(doc, { deferRender: true })
      .catch((error) => reportOpenFailure(doc, error, "workspace-ready-json-sync"));
  }
  if (state.lsp.generation === generation && state.lsp.started) renderChrome();
}
