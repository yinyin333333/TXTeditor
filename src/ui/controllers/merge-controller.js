import { TableDocument } from "../../core/table-model.js";
import { documentTextSnapshot, isJsonDocument, isTableDocument } from "../../core/document-file-state.js";
import { normalizeGameVersion, vectorGameVersion } from "../../core/game-version.js";
import { tText } from "../../core/i18n.js";
import {
  isTauriRuntime,
  listWorkspaceNative,
  loadLintReferenceDataset,
  pickFolderPath,
  pickOpenFilePathsNative,
  pickSaveFilePathNative,
  readTextFilesNative,
  writeMergeOutputNative
} from "../../core/io.js";
import {
  MERGE_MISSING,
  acknowledgeMergeSchema,
  materializeMergeFile,
  mergeFileChanges,
  mergeHighlightIdForCell,
  mergeValueForDisplay,
  resolveMergeConflict,
  unresolvedMergeConflicts
} from "../../core/merge-engine.js";
import {
  analyzeFileMerge,
  analyzeFolderMerge,
  canonicalMergeFileKey,
  mergeInputFileFromPayload,
  mergeOutputPayload,
  mergeSessionCanSave,
  referenceFilesFromDataset,
  refreshMergeSession
} from "../../core/merge-workspace.js";

const TEXT_FILE_PATTERN = /\.(?:txt|tsv|tbl|csv)$/i;
const READ_BATCH_SIZE = 12;
const STATUS_LABEL_KEYS = Object.freeze({
  unchanged: "merge.statusLabel.unchanged",
  "auto-merged": "merge.statusLabel.autoMerged",
  conflict: "merge.statusLabel.conflict",
  resolved: "merge.statusLabel.resolved",
  "schema-mismatch": "merge.statusLabel.schemaMismatch",
  "custom-a": "merge.statusLabel.customA",
  "custom-b": "merge.statusLabel.customB",
  "custom-both": "merge.statusLabel.customBoth"
});

export function createMergeController({
  state,
  els,
  grid,
  emptyDoc,
  regularActiveDoc,
  activateDocument,
  commitActiveEditor = () => {},
  renderChrome,
  showError,
  showToast = () => {},
  documentController,
  updateGridDiagnostics = () => {},
  focusActiveEditor = () => {},
  documentRef = globalThis.document,
  io = {}
}) {
  const native = {
    isTauriRuntime: io.isTauriRuntime ?? isTauriRuntime,
    listWorkspaceNative: io.listWorkspaceNative ?? listWorkspaceNative,
    loadLintReferenceDataset: io.loadLintReferenceDataset ?? loadLintReferenceDataset,
    pickFolderPath: io.pickFolderPath ?? pickFolderPath,
    pickOpenFilePathsNative: io.pickOpenFilePathsNative ?? pickOpenFilePathsNative,
    pickSaveFilePathNative: io.pickSaveFilePathNative ?? pickSaveFilePathNative,
    readTextFilesNative: io.readTextFilesNative ?? readTextFilesNative,
    writeMergeOutputNative: io.writeMergeOutputNative ?? writeMergeOutputNative
  };
  const referenceCache = new Map();
  let pendingDirtyChoice = null;
  let pendingOverwriteChoice = null;
  let analysisGeneration = 0;

  function wireEvents() {
    if (els.mergeView && !els.mergeView.dataset.mergeBound) {
      els.mergeView.dataset.mergeBound = "true";
      els.mergeView.addEventListener("click", (event) => {
        const action = event.target.closest("[data-merge-action]")?.dataset.mergeAction;
        if (action) Promise.resolve(runAction(action)).catch(showError);
        const fileId = event.target.closest("[data-merge-file-id]")?.dataset.mergeFileId;
        if (fileId) Promise.resolve(selectFile(fileId, { focus: true })).catch(showError);
      });
      els.mergeView.addEventListener("input", handleMergeInput);
      els.mergeView.addEventListener("change", handleMergeChange);
    }
    if (els.mergeConflictsPanel && !els.mergeConflictsPanel.dataset.mergeBound) {
      els.mergeConflictsPanel.dataset.mergeBound = "true";
      els.mergeConflictsPanel.addEventListener("click", (event) => {
        const changeId = event.target.closest("[data-merge-change-id]")?.dataset.mergeChangeId;
        if (changeId) return Promise.resolve(selectChange(changeId, { focus: true })).catch(showError);
        const conflictId = event.target.closest("[data-merge-conflict-id]")?.dataset.mergeConflictId;
        if (conflictId) return Promise.resolve(selectConflict(conflictId, { focus: true })).catch(showError);
        const choice = event.target.closest("[data-merge-choice]")?.dataset.mergeChoice;
        if (choice) {
          const moveNext = event.target.closest("[data-merge-choice]")?.dataset.mergeNext !== "false";
          return Promise.resolve(resolveSelected(choice, { moveNext })).catch(showError);
        }
        if (event.target.closest("[data-merge-next-conflict]")) return Promise.resolve(nextUnresolvedConflict()).catch(showError);
        return undefined;
      });
    }
    if (els.mergeDirtyDialog && !els.mergeDirtyDialog.dataset.mergeBound) {
      els.mergeDirtyDialog.dataset.mergeBound = "true";
      els.mergeDirtyDialog.addEventListener("click", (event) => {
        const choice = event.target.closest("[data-merge-dirty-choice]")?.dataset.mergeDirtyChoice;
        if (!choice || !pendingDirtyChoice) return;
        const resolve = pendingDirtyChoice;
        pendingDirtyChoice = null;
        els.mergeDirtyDialog.classList.add("hidden");
        resolve(choice);
      });
      els.mergeDirtyDialog.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !pendingDirtyChoice) return;
        event.preventDefault();
        const resolve = pendingDirtyChoice;
        pendingDirtyChoice = null;
        els.mergeDirtyDialog.classList.add("hidden");
        resolve("cancel");
      });
    }
    if (els.mergeOverwriteDialog && !els.mergeOverwriteDialog.dataset.mergeBound) {
      els.mergeOverwriteDialog.dataset.mergeBound = "true";
      els.mergeOverwriteDialog.addEventListener("click", (event) => {
        const choice = event.target.closest("[data-merge-overwrite-choice]")?.dataset.mergeOverwriteChoice;
        if (choice) settleOverwriteChoice(choice);
      });
      els.mergeOverwriteDialog.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        settleOverwriteChoice("cancel");
      });
    }
  }

  function runAction(action) {
    if (action === "pick-a") return pickInput("a");
    if (action === "pick-b") return pickInput("b");
    if (action === "pick-output") return pickOutput();
    if (action === "change-inputs") return changeInputs();
    if (action === "swap-inputs") return swapInputs();
    if (action === "reset") return resetSession();
    if (action === "analyze") return analyze();
    if (action === "save") return saveResult();
    if (action === "validate") return validateSavedResult();
    return undefined;
  }

  function handleMergeInput(event) {
    if (event.target === els.mergeOutputPath) {
      state.merge.outputPath = event.target.value;
      if (state.merge.session) state.merge.session.outputPath = state.merge.outputPath;
      render();
      return;
    }
    if (event.target === els.mergeFileFilter) renderFileList();
  }

  function handleMergeChange(event) {
    if (event.target === els.mergeFormatSource) {
      return setMergeFormatSource(event.target.value);
    }
    if (event.target === els.mergeGameVersion) {
      state.merge.gameVersion = normalizeGameVersion(event.target.value) ?? "3.3";
      state.merge.gameVersionTouched = true;
      invalidateAnalysis(tText("merge.status.versionChanged"));
      return;
    }
    if (event.target === els.mergeKind) {
      const nextKind = event.target.value === "folder" ? "folder" : "file";
      if (nextKind !== state.merge.kind) {
        state.merge.kind = nextKind;
        state.merge.aPath = "";
        state.merge.bPath = "";
        state.merge.outputPath = "";
        state.merge.aSnapshot = null;
        state.merge.bSnapshot = null;
      }
      invalidateAnalysis(tText("merge.status.kindChanged"));
      return;
    }
    if (event.target === els.mergeIncludeSubfolders) {
      state.merge.includeSubfolders = event.target.checked;
      invalidateAnalysis(tText("merge.status.includeChanged"));
      return;
    }
    if (event.target === els.mergeStatusFilter) {
      state.merge.statusFilter = event.target.value || "changed";
      return renderFileList();
    }
    if (event.target === els.mergeSchemaAck) {
      const file = selectedFile();
      if (!file) return;
      acknowledgeMergeSchema(file, event.target.checked);
      refreshMergeSession(state.merge.session);
      renderChrome();
    }
  }

  function render() {
    const merge = state.merge;
    const session = merge.session;
    if (!els.mergeView) return;
    els.mergeGameVersion.value = merge.gameVersion;
    els.mergeKind.value = merge.kind;
    els.mergeAPath.value = merge.aPath;
    els.mergeBPath.value = merge.bPath;
    els.mergeAPath.title = merge.aPath;
    els.mergeBPath.title = merge.bPath;
    if (documentRef.activeElement !== els.mergeOutputPath) els.mergeOutputPath.value = merge.outputPath;
    els.mergeOutputPath.title = merge.outputPath;
    els.mergeIncludeSubfolders.checked = merge.includeSubfolders;
    els.mergeIncludeSubfoldersRow.classList.toggle("hidden", merge.kind !== "folder");
    els.mergeStageBadge.textContent = tText(`merge.stage.${merge.stage}`);
    els.mergeStatus.textContent = merge.status || defaultStatusText();
    els.mergeStatus.classList.toggle("is-error", Boolean(merge.statusError));
    els.mergeAnalyzeButton.disabled = merge.busy;
    els.mergeAnalyzeButton.textContent = merge.busy && merge.stage === "analyzing" ? tText("merge.stage.analyzing") : tText("merge.analyze");
    els.mergeSetup?.classList.toggle("hidden", Boolean(session));
    els.mergeSourceSummary?.classList.toggle("hidden", !session);
    if (session && els.mergeSourceSummary) {
      els.mergeSourceSummary.innerHTML = `<span class="merge-source-summary-text">${escapeHtml(tText("merge.sources.compact", {
        a: merge.aPath || tText("merge.missing"),
        b: merge.bPath || tText("merge.missing")
      }))}</span><button type="button" class="secondary-button" data-merge-action="change-inputs">${escapeHtml(tText("merge.changeInputs"))}</button>`;
    }
    els.mergeSummary.classList.toggle("hidden", !session);
    els.mergeReviewActions.classList.toggle("hidden", !session);
    els.mergeFileToolbar.classList.toggle("hidden", !session || session.files.length < 2);
    if (session) renderSummary();
    renderFileList();
    renderReviewActions();
    renderConflicts();
  }

  function defaultStatusText() {
    return tText("merge.status.default");
  }

  function renderSummary() {
    const summary = state.merge.session?.summary;
    if (!summary) return;
    const guideKey = state.merge.stage === "saved" || state.merge.savedOutputPath
      ? "merge.reviewGuide.saved"
      : summary.unresolvedConflicts > 0
        ? "merge.reviewGuide.conflicts"
        : "merge.reviewGuide.ready";
    const guide = `<div class="merge-review-guide"><strong>${escapeHtml(tText(guideKey, { count: summary.unresolvedConflicts }))}</strong></div>`;
    const cards = [
      [summary.outputFiles, tText("merge.summary.outputFiles")],
      [summary.unchangedFiles, tText("merge.summary.unchangedFiles")],
      [summary.autoMergedFiles + summary.resolvedFiles, tText("merge.summary.autoMerged")],
      [summary.unresolvedConflicts, tText("merge.summary.unresolved")],
    ];
    els.mergeSummary.innerHTML = guide + cards
      .map(([value, label]) => `<div class="merge-summary-card"><strong>${Number(value) || 0}</strong><span>${escapeHtml(label)}</span></div>`)
      .join("");
  }

  function renderFileList() {
    if (!els.mergeFileList) return;
    const session = state.merge.session;
    if (!session) {
      els.mergeFileList.innerHTML = "";
      return;
    }
    const query = String(els.mergeFileFilter?.value ?? "").trim().toLowerCase();
    const statusFilter = state.merge.statusFilter || "changed";
    if (els.mergeStatusFilter) els.mergeStatusFilter.value = statusFilter;
    const files = session.files.filter((file) => {
      const searchable = `${file.relativePath} ${file.name} ${file.statusDetail ?? ""}`.toLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (statusFilter === "conflict") return unresolvedMergeConflicts(file).length > 0 || file.status === "schema-mismatch";
      if (statusFilter === "custom") return Boolean(file.custom);
      if (statusFilter === "changed") return file.status !== "unchanged";
      return true;
    });
    if (!files.length) {
      els.mergeFileList.innerHTML = `<div class="merge-empty-list">${escapeHtml(tText("merge.fileList.empty"))}</div>`;
      return;
    }
    els.mergeFileList.innerHTML = files.map((file) => {
      const unresolved = unresolvedMergeConflicts(file).length;
      const matching = file.keySpec?.names?.length
        ? tText("merge.fileDetail.key", { key: file.keySpec.names.join(" + ") })
        : tText("merge.fileDetail.whole");
      const changes = [
        file.metrics?.addedRows ? tText("merge.fileDetail.rowsAdded", { count: file.metrics.addedRows }) : "",
        file.metrics?.deletedRows ? tText("merge.fileDetail.rowsDeleted", { count: file.metrics.deletedRows }) : "",
        file.metrics?.movedRows ? tText("merge.fileDetail.rowsMoved", { count: file.metrics.movedRows }) : ""
      ].filter(Boolean).join(", ");
      const detail = [localizedFileDetail(file), matching, changes].filter(Boolean).join(" · ") || file.relativePath || file.name;
      const suffix = unresolved
        ? ` · ${tText("merge.fileDetail.unresolved", { count: unresolved })}`
        : file.metrics?.changedCells ? ` · ${tText("merge.fileDetail.cells", { count: file.metrics.changedCells })}` : "";
      return `<button type="button" class="merge-file-item ${file.id === state.merge.previewFileId ? "active" : ""}" data-merge-file-id="${escapeHtml(file.id)}">
        <span class="merge-file-name" title="${escapeHtml(file.relativePath || file.name)}">${escapeHtml(file.relativePath || file.name)}</span>
        <span class="merge-file-status" data-status="${escapeHtml(file.status)}">${escapeHtml(tText(STATUS_LABEL_KEYS[file.status] ?? "merge.statusLabel.conflict"))}${escapeHtml(suffix)}</span>
        <span class="merge-file-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>
      </button>`;
    }).join("");
  }

  function renderReviewActions() {
    const session = state.merge.session;
    const file = selectedFile();
    if (!session || !file) {
      els.mergeFormatRow?.classList.add("hidden");
      if (els.mergeSaveButton) els.mergeSaveButton.disabled = true;
      if (els.mergeValidateButton) els.mergeValidateButton.disabled = !state.merge.savedOutputPath;
      return;
    }
    const formatSources = eligibleFormatSources(file);
    if (els.mergeFormatRow && els.mergeFormatSource) {
      els.mergeFormatRow.classList.toggle("hidden", !formatSources.length);
      els.mergeFormatSource.innerHTML = formatSources.map((source) => {
        const format = file.formats[source];
        const description = tText("merge.format.description", {
          encoding: format.encoding,
          newline: tText(newlineLabelKey(format.lineEnding)),
          final: format.finalNewline ? ` · ${tText("merge.format.finalNewline")}` : ""
        });
        return `<option value="${escapeHtml(source)}">${escapeHtml(`${formatSideLabel(source)} — ${description}`)}</option>`;
      }).join("");
      const automatic = automaticFormatSourceForFile(file);
      els.mergeFormatSource.value = formatSources.includes(file.formatSource) ? file.formatSource : automatic;
      els.mergeFormatSource.disabled = state.merge.busy;
    }
    const blockingWarnings = file.warnings?.filter((warning) => warning.blockingUntilAcknowledged) ?? [];
    els.mergeSchemaAckRow.classList.toggle("hidden", !blockingWarnings.length);
    els.mergeSchemaAck.checked = Boolean(file.schemaAcknowledged);
    els.mergeSchemaAckRow.title = blockingWarnings.map(localizedWarningMessage).join("\n");
    const canSave = mergeSessionCanSave(session) && Boolean(String(state.merge.outputPath).trim()) && !state.merge.busy;
    els.mergeSaveButton.disabled = !canSave;
    els.mergeSaveButton.textContent = state.merge.stage === "saving" ? tText("merge.stage.saving") : tText("merge.saveResult");
    els.mergeValidateButton.disabled = !state.merge.savedOutputPath || state.merge.busy;
  }

  function setMergeFormatSource(source) {
    const file = selectedFile();
    if (state.merge.busy || !file || !eligibleFormatSources(file).includes(source)) return false;
    file.formatSource = source;
    rebuildPreview(file, { preserveSelection: true });
    Promise.resolve(activateDocument(state.merge.previewDoc, { focus: false }))
      .then(() => {
        updateGridDiagnostics();
        renderChrome();
      })
      .catch(showError);
    return true;
  }

  function eligibleFormatSources(file) {
    return ["a", "b", "base"].filter((source) => {
      if (!file?.docs?.[source] || !file?.formats?.[source]) return false;
      return source === "base" || file.sidePresence?.[source] !== false;
    });
  }

  function automaticFormatSourceForFile(file) {
    if (file?.docs?.a && file.sidePresence?.a !== false) return "a";
    if (file?.docs?.b && file.sidePresence?.b !== false) return "b";
    if (file?.docs?.base) return "base";
    return "a";
  }

  function newlineLabelKey(lineEnding) {
    if (lineEnding === "\r\n") return "merge.newline.CRLF";
    if (lineEnding === "\r") return "merge.newline.CR";
    return "merge.newline.LF";
  }

  function renderConflicts() {
    const session = state.merge.session;
    const all = session?.files?.flatMap((file) => mergeFileChanges(file)) ?? [];
    const conflicts = all.filter((change) => change.kind === "conflict");
    const unresolvedCount = conflicts.filter((change) => !change.resolution).length;
    if (els.mergeConflictCount) els.mergeConflictCount.textContent = unresolvedCount ? String(unresolvedCount) : "";
    for (const button of documentRef.querySelectorAll("[data-command='show-merge']")) {
      if (unresolvedCount) button.dataset.badge = String(unresolvedCount);
      else delete button.dataset.badge;
    }
    if (!els.mergeConflictsList || !els.mergeConflictDetails) return;
    if (!all.length) {
      els.mergeConflictsList.innerHTML = `<div class="merge-empty-list">${escapeHtml(tText("merge.changes.none"))}</div>`;
      els.mergeConflictDetails.innerHTML = `<p class="merge-conflict-empty">${escapeHtml(tText("merge.changes.empty"))}</p>`;
      return;
    }
    let selected = all.find((change) => change.id === state.merge.selectedChangeId);
    if (!selected) {
      selected = conflicts.find((change) => !change.resolution) ?? all[0];
      state.merge.selectedChangeId = selected.id;
    }
    if (selected.kind === "conflict") {
      state.merge.selectedConflictId = selected.conflictId;
      state.merge.selectedChangeId = `change:${selected.fileId}:conflict:${selected.conflictId}`;
    } else {
      state.merge.selectedConflictId = null;
    }
    els.mergeConflictsList.innerHTML = all.map((change) => {
      const location = [change.relativePath || change.fileName, change.rowLabel, change.columnLabel]
        .filter(Boolean).join(" · ");
      const isConflict = change.kind === "conflict";
    const stateLabel = isConflict
      ? (change.resolution ? tText("merge.statusLabel.resolved") : tText("merge.conflict.unresolved"))
        : tText("merge.change.automaticReadyShort");
      return `<button type="button" class="merge-conflict-item ${change.id === selected.id ? "active" : ""} ${change.resolution ? "resolved" : ""}" data-merge-change-id="${escapeHtml(change.id)}">
        <span class="merge-conflict-location" title="${escapeHtml(location)}">${escapeHtml(location || change.fileName)}</span>
        <span class="merge-conflict-message" title="${escapeHtml(changeDescription(change))}">${escapeHtml(localizedChangeKind(change.kind))} · ${escapeHtml(changeDescription(change))}</span>
        <span class="merge-conflict-state">${escapeHtml(stateLabel)}</span>
      </button>`;
    }).join("");
    renderChangeDetails(selected);
  }

  function renderChangeDetails(change) {
    if (!change) {
      els.mergeConflictDetails.innerHTML = `<p class="merge-conflict-empty">${escapeHtml(tText("merge.changes.empty"))}</p>`;
      return;
    }
    if (change.kind === "conflict") {
      renderConflictDetails(findConflict(change.conflictId), change);
      return;
    }
    if (change.kind === "file") {
      renderWholeFileChangeDetails(change);
      return;
    }
    const location = [change.rowLabel, change.columnLabel].filter(Boolean).join(" · ");
    const decision = automaticDecision(change);
    const statuses = automaticCardStatusKeys(change.source);
    const values = [
      ["merge.inputA", statuses.a, change.a],
      ["merge.inputB", statuses.b, change.b],
      ["merge.change.result", statuses.result, change.result]
    ].map(([labelKey, statusKey, value]) => `<div class="merge-conflict-value"><strong>${escapeHtml([tText(labelKey), tText(statusKey)].join(" · "))}</strong><pre>${escapeHtml(formatConflictValue(value))}</pre></div>`).join("");
    els.mergeConflictDetails.innerHTML = `<h3>${escapeHtml(localizedChangeKind(change.kind))}</h3>
      <p class="merge-conflict-meta">${escapeHtml(change.relativePath || change.fileName)}${location ? ` · ${escapeHtml(location)}` : ""}</p>
      <p class="merge-change-decision">${escapeHtml(decision.text)}</p>
      <div class="merge-conflict-values">${values}</div>`;
  }

  function renderWholeFileChangeDetails(change) {
    const decision = wholeFileDecision(change);
    const cards = wholeFileCardValues(change.source)
      .map(([labelKey, statusKey, valueKey]) => `<div class="merge-conflict-value"><strong>${escapeHtml([tText(labelKey), tText(statusKey)].join(" · "))}</strong><pre>${escapeHtml(tText(valueKey))}</pre></div>`)
      .join("");
    els.mergeConflictDetails.innerHTML = `<h3>${escapeHtml(localizedChangeKind(change.kind))}</h3>
      <p class="merge-conflict-meta">${escapeHtml(change.relativePath || change.fileName)}</p>
      <p class="merge-change-decision">${escapeHtml(decision.text)}</p>
      <div class="merge-conflict-values">${cards}</div>`;
  }

  function renderConflictDetails(conflict, projectedChange) {
    if (!conflict) {
      els.mergeConflictDetails.innerHTML = `<p class="merge-conflict-empty">${escapeHtml(tText("merge.conflict.empty.review"))}</p>`;
      return;
    }
    const file = findFile(conflict.fileId);
    const customAllowed = conflict.target?.type === "cell" || conflict.target?.type === "header";
    const primaryChoiceCard = (side, labelKey) => {
      const available = conflict.values?.[side] !== MERGE_MISSING && conflict.values?.[side] !== undefined;
      return `<div class="merge-conflict-value merge-conflict-choice-card"><strong>${escapeHtml(formatSideLabel(side))}</strong><pre>${escapeHtml(formatConflictValue(conflict.values?.[side]))}</pre><button type="button" data-merge-choice="${side}" ${available ? "" : "disabled"}>${escapeHtml(tText(labelKey))}</button></div>`;
    };
    const resultValue = projectedChange?.result ?? MERGE_MISSING;
    const values = primaryChoiceCard("base", "merge.conflict.useBaseValue")
      + primaryChoiceCard("a", "merge.conflict.useAValue")
      + primaryChoiceCard("b", "merge.conflict.useBValue")
      + `<div class="merge-conflict-value merge-conflict-result-card"><strong>${escapeHtml(tText("merge.change.result"))}</strong><pre>${escapeHtml(formatConflictValue(resultValue))}</pre></div>`;
    const resolution = conflict.resolution
      ? `<p class="merge-conflict-meta">${escapeHtml(tText("merge.conflict.resolved", { choice: conflict.resolution.choice.toUpperCase() }))}</p>`
      : "";
    const otherChoices = customAllowed ? `<details class="merge-other-choices"><summary>${escapeHtml(tText("merge.conflict.otherChoices"))}</summary>
      <div class="merge-other-choice-content">
        <div class="merge-conflict-custom"><input class="merge-conflict-custom-input" type="text" value="${escapeHtml(customResolutionValue(conflict))}" placeholder="${escapeHtml(tText("merge.conflict.customPlaceholder"))}" /><button type="button" data-merge-choice="custom">${escapeHtml(tText("merge.conflict.custom"))}</button></div>
      </div>
    </details>` : "";
    const rowLocation = conflict.rowKey ? ` · ${tText("merge.conflict.locationRow", { row: displayRowKey(conflict.rowKey) })}` : "";
    const columnLocation = conflict.columnName ? ` · ${tText("merge.conflict.locationColumn", { column: conflict.columnName })}` : "";
    els.mergeConflictDetails.innerHTML = `<div class="merge-conflict-callout">${escapeHtml(tText("merge.conflict.callout"))}</div>
      <h3>${escapeHtml(tText("merge.conflict.details", { kind: localizedConflictKind(conflict.kind) }))}</h3>
      <p class="merge-conflict-meta">${escapeHtml(conflict.relativePath || conflict.fileName)}${escapeHtml(rowLocation)}${escapeHtml(columnLocation)}<br>${escapeHtml(localizedConflictMessage(conflict))}</p>
      ${resolution}
      <div class="merge-conflict-values">${values}</div>
      <div class="merge-conflict-actions"><button type="button" data-merge-next-conflict>${escapeHtml(tText("merge.conflict.next"))}</button></div>
      ${otherChoices}
      ${file?.warnings?.length ? `<p class="merge-conflict-meta">${file.warnings.map((warning) => escapeHtml(localizedWarningMessage(warning))).join("<br>")}</p>` : ""}`;
  }

  async function showMerge({ focus = true } = {}) {
    commitActiveEditor();
    state.activity = "merge";
    state.sidebarVisible = true;
    state.problemsVisible = true;
    state.bottomTab = "merge-conflicts";
    const target = state.merge.previewDoc ?? emptyDoc;
    await activateDocument(target, { focus: false });
    updateGridDiagnostics();
    renderChrome();
    if (focus) focusActiveEditor();
  }

  async function showExplorer({ focus = true } = {}) {
    commitActiveEditor();
    state.activity = "explorer";
    state.sidebarVisible = true;
    if (state.bottomTab === "merge-conflicts") state.bottomTab = "problems";
    const target = regularActiveDoc() ?? emptyDoc;
    await activateDocument(target, { focus: false });
    updateGridDiagnostics();
    renderChrome();
    if (focus) focusActiveEditor();
  }

  async function showProblems({ focus = true } = {}) {
    commitActiveEditor();
    state.activity = "problems";
    state.problemsVisible = true;
    state.bottomTab = "problems";
    const target = regularActiveDoc() ?? emptyDoc;
    await activateDocument(target, { focus: false });
    updateGridDiagnostics();
    renderChrome();
    if (focus) focusActiveEditor();
  }

  function beforeRegularDocumentActivation() {
    if (state.activity !== "merge") return;
    state.activity = "explorer";
    if (state.bottomTab === "merge-conflicts") state.bottomTab = "problems";
  }

  async function mergeWithCurrent() {
    const doc = regularActiveDoc();
    if (!doc || doc === emptyDoc || isJsonDocument(doc) || !isTableDocument(doc)) {
      if (state.workspace?.path) return mergeWithFolder();
      throw new Error(tText("merge.error.currentNoFile"));
    }
    commitActiveEditor();
    let snapshot = null;
    if (doc.dirty) {
      const choice = await askDirtyDocumentChoice(doc);
      if (choice === "cancel") return false;
      if (choice === "save") {
        const saved = await documentController.saveFile();
        if (!saved || doc.dirty) return false;
      } else {
        snapshot = snapshotInputFromDocument(doc);
      }
    } else if (!doc.path || !native.isTauriRuntime()) {
      snapshot = snapshotInputFromDocument(doc);
    }
    state.merge.kind = "file";
    state.merge.aPath = doc.path || doc.name;
    state.merge.aSnapshot = snapshot;
    state.merge.bSnapshot = null;
    state.merge.bPath = "";
    state.merge.outputPath = "";
    invalidateAnalysis(tText("merge.status.prefillFile"), { renderNow: false });
    await showMerge();
    return true;
  }

  async function mergeWithFolder() {
    const path = state.workspace?.path;
    if (!path) throw new Error(tText("merge.error.folderNoWorkspace"));
    commitActiveEditor();
    const dirtyDocs = (state.docs ?? []).filter((doc) => (
      isTableDocument(doc)
      && doc.dirty
      && (samePath(doc.path, path) || pathInside(doc.path, path))
    ));
    if (dirtyDocs.length) {
      const names = dirtyDocs.map((doc) => doc.name || fileName(doc.path)).join(", ");
      throw new Error(tText("merge.error.folderDirty", { files: names }));
    }
    state.merge.kind = "folder";
    state.merge.aPath = path;
    state.merge.aSnapshot = null;
    state.merge.bSnapshot = null;
    state.merge.bPath = "";
    state.merge.outputPath = "";
    invalidateAnalysis(tText("merge.status.prefillFolder"), { renderNow: false });
    await showMerge();
    return true;
  }

  function askDirtyDocumentChoice(doc) {
    if (pendingDirtyChoice) return Promise.resolve("cancel");
    els.mergeDirtyDialogText.textContent = tText("merge.dirty.text");
    els.mergeDirtyDialog.classList.remove("hidden");
    return new Promise((resolve) => { pendingDirtyChoice = resolve; });
  }

  async function pickInput(side) {
    requireDesktopRuntime();
    let path = null;
    if (state.merge.kind === "folder") path = await native.pickFolderPath();
    else path = (await native.pickOpenFilePathsNative())[0] ?? null;
    if (!path) return;
    if (state.merge.kind === "file" && !TEXT_FILE_PATTERN.test(fileName(path))) {
      throw new Error(tText("merge.error.supportedInput"));
    }
    state.merge[`${side}Path`] = path;
    state.merge[`${side}Snapshot`] = null;
    invalidateAnalysis(tText("merge.status.selected", { side: side.toUpperCase() }), { renderNow: false });
    renderChrome();
  }

  async function pickOutput() {
    requireDesktopRuntime();
    let path = null;
    if (state.merge.kind === "folder") {
      const parent = await native.pickFolderPath();
      path = parent ? joinNativePath(parent, suggestedOutputFolderName()) : null;
    }
    else path = await native.pickSaveFilePathNative(suggestedOutputName());
    if (!path) return;
    state.merge.outputPath = path;
    if (state.merge.session) state.merge.session.outputPath = path;
    state.merge.status = tText("merge.status.outputSelected");
    state.merge.statusError = false;
    renderChrome();
  }

  function changeInputs() {
    if (state.merge.busy) return false;
    invalidateAnalysis(tText("merge.status.inputsChanged"));
    return true;
  }

  function swapInputs() {
    if (state.merge.busy) return false;
    const { aPath, bPath, aSnapshot, bSnapshot } = state.merge;
    Object.assign(state.merge, {
      aPath: bPath,
      bPath: aPath,
      aSnapshot: bSnapshot,
      bSnapshot: aSnapshot
    });
    invalidateAnalysis(tText("merge.status.inputsChanged"));
    return true;
  }

  function resetSession() {
    analysisGeneration += 1;
    state.merge.busy = false;
    const configuredVersion = vectorGameVersion(state.config ?? {});
    Object.assign(state.merge, {
      kind: "file",
      gameVersion: configuredVersion,
      gameVersionTouched: false,
      aPath: "",
      bPath: "",
      outputPath: "",
      includeSubfolders: true,
      stage: "setup",
      status: "",
      statusError: false,
      session: null,
      previewDoc: null,
      previewFileId: null,
      selectedConflictId: null,
      selectedChangeId: null,
      statusFilter: "changed",
      aSnapshot: null,
      bSnapshot: null,
      savedOutputPath: "",
      busy: false
    });
    activateDocument(emptyDoc, { focus: false });
    renderChrome();
  }

  function invalidateAnalysis(message = "", { renderNow = true } = {}) {
    analysisGeneration += 1;
    state.merge.busy = false;
    state.merge.session = null;
    state.merge.previewDoc = null;
    state.merge.previewFileId = null;
    state.merge.selectedConflictId = null;
    state.merge.selectedChangeId = null;
    state.merge.savedOutputPath = "";
    state.merge.stage = "setup";
    state.merge.status = message;
    state.merge.statusError = false;
    if (state.activity === "merge") activateDocument(emptyDoc, { focus: false });
    if (renderNow) renderChrome();
  }

  function syncConfiguredVersion() {
    if (state.merge.session || state.merge.gameVersionTouched) return state.merge.gameVersion;
    state.merge.gameVersion = vectorGameVersion(state.config ?? {});
    if (state.activity === "merge") renderChrome();
    return state.merge.gameVersion;
  }

  async function analyze() {
    requireDesktopRuntime();
    validateSetup();
    const request = Object.freeze({
      kind: state.merge.kind,
      gameVersion: state.merge.gameVersion,
      aPath: state.merge.aPath,
      bPath: state.merge.bPath,
      outputPath: state.merge.outputPath,
      includeSubfolders: Boolean(state.merge.includeSubfolders),
      aSnapshot: state.merge.aSnapshot,
      bSnapshot: state.merge.bSnapshot
    });
    const generation = ++analysisGeneration;
    setBusy(true, "analyzing", tText("merge.status.loadingBase", { version: request.gameVersion }));
    try {
      const baseFiles = await loadReferenceFiles(request.gameVersion, generation);
      if (!isCurrentAnalysis(generation) || !baseFiles) return false;
      let session;
      if (request.kind === "file") {
        state.merge.status = tText("merge.status.readingAB");
        renderChrome();
        const [aFile, bFile] = await Promise.all([
          readInputFile(request.aPath, request.aSnapshot, generation),
          readInputFile(request.bPath, request.bSnapshot, generation)
        ]);
        if (!isCurrentAnalysis(generation) || !aFile || !bFile) return false;
        const key = canonicalMergeFileKey(aFile.relativePath || aFile.name);
        const baseFile = baseFiles.find((file) => canonicalMergeFileKey(file.relativePath || file.name) === key) ?? null;
        session = analyzeFileMerge({
          baseFile,
          aFile,
          bFile,
          gameVersion: request.gameVersion,
          outputPath: request.outputPath
        });
        if (!baseFile) markBaseUnavailable(session.files[0]);
      } else {
        state.merge.status = tText("merge.status.readingFolder", { side: "A" });
        renderChrome();
        const aFiles = await readFolder(request.aPath, "A", request.includeSubfolders, generation);
        if (!isCurrentAnalysis(generation) || !aFiles) return false;
        state.merge.status = tText("merge.status.readingFolder", { side: "B" });
        renderChrome();
        const bFiles = await readFolder(request.bPath, "B", request.includeSubfolders, generation);
        if (!isCurrentAnalysis(generation) || !bFiles) return false;
        state.merge.status = tText("merge.status.structural");
        renderChrome();
        session = analyzeFolderMerge({
          baseFiles,
          aFiles,
          bFiles,
          gameVersion: request.gameVersion,
          aPath: request.aPath,
          bPath: request.bPath,
          outputPath: request.outputPath
        });
        for (const file of session.files) {
          if (!file.baseAvailable && (!file.custom || (file.sidePresence?.a && file.sidePresence?.b))) markBaseUnavailable(file);
        }
      }
      if (!isCurrentAnalysis(generation)) return false;
      session.aPath = request.aPath;
      session.bPath = request.bPath;
      session.outputPath = request.outputPath;
      refreshMergeSession(session);
      if (!isCurrentAnalysis(generation)) return false;
      state.merge.session = session;
      state.merge.stage = session.stage;
      state.merge.savedOutputPath = "";
      state.merge.statusFilter = "changed";
      const firstConflict = session.files.flatMap((file) => file.conflicts).find((conflict) => !conflict.resolution) ?? null;
      const firstConflictFile = firstConflict ? session.files.find((file) => file.id === firstConflict.fileId) : null;
      const first = firstConflictFile
        ?? session.files.find((file) => file.includeInOutput !== false && file.status !== "unchanged")
        ?? session.files.find((file) => file.includeInOutput !== false && mergeFileChanges(file).length)
        ?? session.files[0];
      state.merge.selectedConflictId = firstConflict?.id ?? null;
      state.merge.status = analysisStatus(session);
      state.merge.statusError = false;
      if (first) {
        const selected = await selectFile(first.id, { renderNow: false, analysisGeneration: generation });
        if (!isCurrentAnalysis(generation) || selected === false) return false;
      } else {
        await activateDocument(emptyDoc, { focus: false });
        if (!isCurrentAnalysis(generation)) return false;
      }
      if (firstConflict) {
        state.merge.selectedConflictId = firstConflict.id;
        state.merge.selectedChangeId = `change:${firstConflict.fileId}:conflict:${firstConflict.id}`;
      }
      if (!isCurrentAnalysis(generation)) return false;
      showToast(tText("merge.toast.analysisComplete"));
      return true;
    } catch (error) {
      if (!isCurrentAnalysis(generation)) return false;
      state.merge.stage = "setup";
      state.merge.status = localizedErrorMessage(error);
      state.merge.statusError = true;
      state.merge.session = null;
      state.merge.previewDoc = null;
      state.merge.previewFileId = null;
      await activateDocument(emptyDoc, { focus: false });
      if (!isCurrentAnalysis(generation)) return false;
      throw new Error(localizedErrorMessage(error));
    } finally {
      if (isCurrentAnalysis(generation)) {
        state.merge.busy = false;
        if (state.merge.session) state.merge.stage = state.merge.session.stage;
        renderChrome();
      }
    }
  }

  function isCurrentAnalysis(generation) {
    return analysisGeneration === generation;
  }

  async function readInputFile(path, snapshot, generation) {
    if (snapshot) return { ...snapshot };
    const [result] = await native.readTextFilesNative([path]);
    if (!isCurrentAnalysis(generation)) return null;
    if (!result || result.error || !result.payload) throw new Error(result?.error || `Cannot read '${path}'.`);
    return mergeInputFileFromPayload(result.payload, { relativePath: result.payload.name || fileName(path) });
  }

  async function readFolder(root, label, includeSubfolders, generation) {
    const workspace = await native.listWorkspaceNative(root, null, { includeSubfolders });
    if (!isCurrentAnalysis(generation)) return null;
    const candidates = (workspace?.files ?? []).filter((file) => TEXT_FILE_PATTERN.test(file.name || file.path || ""));
    const files = [];
    for (let start = 0; start < candidates.length; start += READ_BATCH_SIZE) {
      const batch = candidates.slice(start, start + READ_BATCH_SIZE);
      state.merge.status = tText("merge.status.readingFiles", {
        side: label,
        current: Math.min(start + batch.length, candidates.length),
        total: candidates.length
      });
      renderChrome();
      const results = await native.readTextFilesNative(batch.map((file) => file.path));
      if (!isCurrentAnalysis(generation)) return null;
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const source = batch[index];
        if (!result || result.error || !result.payload) throw new Error(result?.error || `Cannot read '${source.path}'.`);
        files.push(mergeInputFileFromPayload(result.payload, {
          root,
          relativePath: source.relativePath || ""
        }));
      }
    }
    return files;
  }

  async function loadReferenceFiles(gameVersion, generation) {
    if (referenceCache.has(gameVersion)) return referenceCache.get(gameVersion);
    const payload = await native.loadLintReferenceDataset(gameVersion);
    if (!isCurrentAnalysis(generation)) return null;
    if (!payload || !Array.isArray(payload.files)) throw new Error(tText("merge.error.baseUnavailable"));
    const received = normalizeGameVersion(payload.gameVersion);
    if (received !== gameVersion) throw new Error(tText("merge.error.versionMismatch", { requested: gameVersion, received: payload.gameVersion || "unknown" }));
    if (!String(payload.canonicalSha256 ?? "").trim()) throw new Error(tText("merge.error.digest"));
    const files = referenceFilesFromDataset(payload);
    referenceCache.set(gameVersion, files);
    return files;
  }

  async function selectFile(fileId, { focus = false, renderNow = true, analysisGeneration: expectedGeneration = null } = {}) {
    if (expectedGeneration != null && !isCurrentAnalysis(expectedGeneration)) return false;
    const file = findFile(fileId);
    if (!file) return;
    state.merge.previewFileId = file.id;
    state.merge.session.selectedFileId = file.id;
    rebuildPreview(file);
    await activateDocument(state.merge.previewDoc, { focus: false });
    if (expectedGeneration != null && !isCurrentAnalysis(expectedGeneration)) return false;
    const firstConflict = file.conflicts.find((conflict) => !conflict.resolution) ?? file.conflicts[0];
    if (firstConflict && !findConflict(state.merge.selectedConflictId, file)) state.merge.selectedConflictId = firstConflict.id;
    const firstChange = mergeFileChanges(file)[0];
    if (firstChange) {
      state.merge.selectedChangeId = firstChange.id;
      if (firstChange.kind === "conflict") state.merge.selectedConflictId = firstChange.conflictId;
    }
    updateGridDiagnostics();
    if (renderNow) renderChrome();
    if (focus) focusActiveEditor();
    return true;
  }

  function rebuildPreview(file, { preserveSelection = false } = {}) {
    const selectionSnapshot = preserveSelection ? state.selection.snapshot() : null;
    const result = materializeMergeFile(file);
    const rows = (result?.rows ?? [[]]).map((row) => {
      const clone = [];
      clone.length = row.length;
      for (let index = 0; index < row.length; index += 1) if (index in row) clone[index] = String(row[index] ?? "");
      return clone;
    });
    const doc = new TableDocument(`${tText("merge.result")} · ${file.name}`, rows, {
      path: "",
      encoding: result?.encoding || "utf-8",
      lineEnding: result?.lineEnding || "\n",
      finalNewline: Boolean(result?.finalNewline),
      autoFitInitialColumns: true
    });
    doc.kind = "merge";
    doc.mergeFileId = file.id;
    doc.dirty = false;
    doc.freezeFirstRow = state.freezeRow;
    doc.freezeFirstColumn = state.freezeColumn;
    if (selectionSnapshot) doc.selectionState = selectionSnapshot;
    state.merge.previewDoc = doc;
    return doc;
  }

  async function selectConflict(conflictId, { focus = false } = {}) {
    const conflict = findConflict(conflictId);
    if (!conflict) return;
    state.merge.selectedConflictId = conflict.id;
    state.merge.selectedChangeId = `change:${conflict.fileId}:conflict:${conflict.id}`;
    state.problemsVisible = true;
    state.bottomTab = "merge-conflicts";
    if (state.merge.previewFileId !== conflict.fileId) {
      await selectFile(conflict.fileId, { renderNow: false });
      state.merge.selectedConflictId = conflict.id;
      state.merge.selectedChangeId = `change:${conflict.fileId}:conflict:${conflict.id}`;
    }
    renderChrome();
    navigateToConflict(conflict);
    if (focus) focusActiveEditor();
  }

  async function selectChange(changeId, { focus = false } = {}) {
    const change = state.merge.session?.files?.flatMap((file) => mergeFileChanges(file))
      .find((candidate) => candidate.id === changeId);
    if (!change) return;
    state.merge.selectedChangeId = change.id;
    if (change.kind === "conflict") state.merge.selectedConflictId = change.conflictId;
    if (state.merge.previewFileId !== change.fileId) {
      await selectFile(change.fileId, { renderNow: false });
      state.merge.selectedChangeId = change.id;
      if (change.kind === "conflict") state.merge.selectedConflictId = change.conflictId;
    }
    state.problemsVisible = true;
    state.bottomTab = "merge-conflicts";
    renderChrome();
    navigateToChange(change);
    if (focus) focusActiveEditor();
  }

  function navigateToConflict(conflict) {
    if (!state.merge.previewDoc) return;
    const row = clampIndex(conflict.row, state.merge.previewDoc.rowCount);
    const column = clampIndex(conflict.column, state.merge.previewDoc.columnCount);
    state.selection.set(row, column);
    grid.scrollCellToCenter(row, column);
    grid.draw();
  }

  function navigateToChange(change) {
    if (change?.resultRow == null || change?.resultColumn == null || !state.merge.previewDoc) return;
    const row = clampIndex(change.resultRow, state.merge.previewDoc.rowCount);
    const column = clampIndex(change.resultColumn, state.merge.previewDoc.columnCount);
    state.selection.set(row, column);
    grid.scrollCellToCenter(row, column);
    grid.draw();
  }

  async function resolveSelected(choice, { moveNext = true } = {}) {
    const conflict = findConflict(state.merge.selectedConflictId);
    if (!conflict) throw new Error(tText("merge.error.selectConflict"));
    const file = findFile(conflict.fileId);
    const value = choice === "custom"
      ? String(els.mergeConflictDetails.querySelector(".merge-conflict-custom-input")?.value ?? "")
      : "";
    resolveMergeConflict(file, conflict.id, { choice, value });
    refreshMergeSession(state.merge.session);
    state.merge.stage = state.merge.session.stage;
    rebuildPreview(file, { preserveSelection: true });
    await activateDocument(state.merge.previewDoc, { focus: false });
    if (moveNext) {
      const next = nextUnresolvedAfter(conflict.id);
      if (next) {
        state.merge.selectedConflictId = next.id;
        state.merge.selectedChangeId = `change:${next.fileId}:conflict:${next.id}`;
        if (next.fileId !== file.id) {
          await selectFile(next.fileId, { renderNow: false });
          state.merge.selectedConflictId = next.id;
          state.merge.selectedChangeId = `change:${next.fileId}:conflict:${next.id}`;
        }
      }
    }
    state.merge.status = unresolvedMergeConflicts(file).length || state.merge.session.summary.unresolvedConflicts
      ? analysisStatus(state.merge.session)
      : tText("merge.status.allResolved");
    renderChrome();
    const selected = findConflict(state.merge.selectedConflictId);
    if (selected) navigateToConflict(selected);
  }

  async function nextUnresolvedConflict() {
    const next = nextUnresolvedAfter(state.merge.selectedConflictId);
    if (!next) {
      state.merge.status = tText("merge.status.allResolved");
      renderChrome();
      return;
    }
    await selectConflict(next.id, { focus: true });
  }

  function nextUnresolvedAfter(conflictId) {
    const conflicts = state.merge.session?.files?.flatMap((file) => file.conflicts ?? []) ?? [];
    const unresolved = conflicts.filter((conflict) => !conflict.resolution);
    if (!unresolved.length) return null;
    const index = conflicts.findIndex((conflict) => conflict.id === conflictId);
    return unresolved.find((conflict) => conflicts.indexOf(conflict) > index) ?? unresolved[0];
  }

  async function saveResult() {
    requireDesktopRuntime();
    const session = state.merge.session;
    if (!session) throw new Error(tText("merge.error.analyzeBeforeSave"));
    session.outputPath = String(state.merge.outputPath).trim();
    if (!session.outputPath) throw new Error(tText("merge.error.noResultPath"));
    if (!mergeSessionCanSave(session)) {
      if (session.kind === "folder" && !(session.files ?? []).some((file) => file.includeInOutput !== false)) {
        state.merge.status = tText("merge.status.noChangedFiles");
        state.merge.statusError = true;
        renderChrome();
        throw new Error(tText("merge.status.noChangedFiles"));
      }
      throw new Error(tText("merge.error.cannotSave"));
    }
    validateOutputPath(session.outputPath);
    const files = mergeOutputPayload(session);
    const previousStage = session.stage === "saved" ? "review" : session.stage;
    setBusy(true, "saving", tText("merge.stage.saving"));
    try {
      await writeOutput(files, false);
    } catch (error) {
      if (!isExistingOutputError(error)) {
        state.merge.busy = false;
        state.merge.stage = previousStage;
        session.stage = previousStage;
        state.merge.status = tText("merge.error.generic", { error: localizedErrorMessage(error) });
        state.merge.statusError = true;
        renderChrome();
        throw new Error(localizedErrorMessage(error));
      }
      state.merge.status = tText("merge.overwrite.text", { path: session.outputPath });
      state.merge.statusError = false;
      renderChrome();
      const choice = await askOverwriteChoice(session.outputPath);
      if (choice !== "replace") {
        state.merge.busy = false;
        state.merge.stage = previousStage;
        session.stage = previousStage;
        state.merge.status = tText("merge.status.existingCancelled");
        state.merge.statusError = false;
        renderChrome();
        return false;
      }
      setBusy(true, "saving", tText("merge.stage.saving"));
      try {
        await writeOutput(files, true);
      } catch (overwriteError) {
        state.merge.busy = false;
        state.merge.stage = previousStage;
        session.stage = previousStage;
        state.merge.status = tText("merge.error.generic", { error: localizedErrorMessage(overwriteError) });
        state.merge.statusError = true;
        renderChrome();
        throw new Error(localizedErrorMessage(overwriteError));
      }
    }
    state.merge.busy = false;
    session.stage = "saved";
    session.savedAt = Date.now();
    state.merge.stage = "saved";
    state.merge.savedOutputPath = session.outputPath;
    state.merge.status = tText("merge.status.saved", { count: files.length, path: session.outputPath });
    state.merge.statusError = false;
    renderChrome();
    showToast(tText("merge.toast.saved"));
    return true;
  }

  function askOverwriteChoice(path) {
    if (pendingOverwriteChoice) return Promise.resolve("cancel");
    if (!els.mergeOverwriteDialog || !els.mergeOverwriteDialogText) return Promise.resolve("cancel");
    els.mergeOverwriteDialogText.textContent = tText("merge.overwrite.text", { path });
    els.mergeOverwriteDialog.classList.remove("hidden");
    return new Promise((resolve) => {
      pendingOverwriteChoice = resolve;
    });
  }

  function settleOverwriteChoice(choice) {
    if (!pendingOverwriteChoice) return;
    const resolve = pendingOverwriteChoice;
    pendingOverwriteChoice = null;
    els.mergeOverwriteDialog?.classList.add("hidden");
    resolve(choice);
  }

  function writeOutput(files, overwrite) {
    return native.writeMergeOutputNative({
      outputPath: state.merge.session?.outputPath || String(state.merge.outputPath).trim(),
      kind: state.merge.session?.kind || state.merge.kind,
      files,
      overwrite,
      protectedPaths: [state.merge.aPath, state.merge.bPath].filter(Boolean)
    });
  }

  async function validateSavedResult() {
    const path = state.merge.savedOutputPath;
    if (!path) throw new Error(tText("merge.error.noSavedResult"));
    await showExplorer({ focus: false });
    if (state.merge.kind === "folder") await documentController.openWorkspacePath(path);
    else await documentController.openDroppedNativePaths([path]);
    showToast(tText("merge.toast.validation"));
  }

  function highlightColorForCell(doc, row, column) {
    if (doc?.kind !== "merge") return null;
    const file = findFile(doc.mergeFileId);
    return mergeHighlightIdForCell(file, row, column);
  }

  function selectedFile() {
    return findFile(state.merge.previewFileId || state.merge.session?.selectedFileId);
  }

  function findFile(fileId) {
    return state.merge.session?.files?.find((file) => file.id === fileId) ?? null;
  }

  function findConflict(conflictId, file = null) {
    if (!conflictId) return null;
    if (file) return file.conflicts?.find((conflict) => conflict.id === conflictId) ?? null;
    for (const candidate of state.merge.session?.files ?? []) {
      const conflict = candidate.conflicts?.find((item) => item.id === conflictId);
      if (conflict) return conflict;
    }
    return null;
  }

  function setBusy(busy, stage, status) {
    state.merge.busy = busy;
    state.merge.stage = stage;
    state.merge.status = status;
    state.merge.statusError = false;
    renderChrome();
  }

  function validateSetup() {
    const a = String(state.merge.aPath).trim();
    const b = String(state.merge.bPath).trim();
    const output = String(state.merge.outputPath).trim();
    if (!a || !b) throw new Error(tText("merge.error.selectInputs"));
    if (!output) throw new Error(tText("merge.error.selectOutput"));
    if (samePath(a, b)) throw new Error(tText("merge.error.differentInputs"));
    if (state.merge.kind === "file") {
      if (!TEXT_FILE_PATTERN.test(fileName(a)) || !TEXT_FILE_PATTERN.test(fileName(b))) {
        throw new Error(tText("merge.error.fileExtensions"));
      }
      if (!TEXT_FILE_PATTERN.test(fileName(output))) {
        throw new Error(tText("merge.error.outputExtension"));
      }
    }
    validateOutputPath(output);
  }

  function validateOutputPath(output) {
    const inputs = [state.merge.aPath, state.merge.bPath].filter(Boolean);
    for (const input of inputs) {
      if (samePath(output, input)) throw new Error(tText("merge.error.samePath"));
      if (state.merge.kind === "folder" && pathInside(output, input)) throw new Error(tText("merge.error.outputInside"));
      if (state.merge.kind === "folder" && pathInside(input, output)) throw new Error(tText("merge.error.outputContains"));
    }
  }

  function requireDesktopRuntime() {
    if (!native.isTauriRuntime()) throw new Error(tText("merge.error.runtime"));
  }

  function markBaseUnavailable(file) {
    if (!file) return;
    if (!file.warnings.some((warning) => warning.kind === "base-missing")) {
      file.warnings.push({
        id: `${file.id}:base-missing`,
        kind: "base-missing",
        blockingUntilAcknowledged: false,
        message: tText("merge.warning.baseMissing")
      });
    }
    file.statusDetail = file.statusDetail || tText("merge.warning.baseMissing");
  }

  function snapshotInputFromDocument(doc) {
    const snapshot = documentTextSnapshot(doc);
    return mergeInputFileFromPayload({
      name: doc.name,
      path: doc.path || doc.name,
      text: snapshot.text,
      encoding: snapshot.encoding,
      sizeBytes: snapshot.text.length
    }, { relativePath: doc.name });
  }

  function suggestedOutputName() {
    const source = fileName(state.merge.aPath) || "Result.txt";
    const dot = source.lastIndexOf(".");
    return dot > 0 ? `${source.slice(0, dot)}.merged${source.slice(dot)}` : `${source}.merged.txt`;
  }

  function suggestedOutputFolderName() {
    const source = fileName(state.merge.aPath).replace(/[. ]+$/, "") || "TXTeditor";
    return `${source}.merged`;
  }

  return {
    analyze,
    beforeRegularDocumentActivation,
    changeInputs,
    highlightColorForCell,
    mergeWithCurrent,
    mergeWithFolder,
    render,
    resetSession,
    saveResult,
    selectChange,
    selectConflict,
    selectFile,
    swapInputs,
    showExplorer,
    showMerge,
    showProblems,
    syncConfiguredVersion,
    validateSavedResult,
    wireEvents
  };
}

function formatConflictValue(value) {
  if (value === MERGE_MISSING || value === undefined) return tText("merge.missing");
  if (value === "<missing>") return tText("merge.missing");
  if (value instanceof Map) {
    return [...value.entries()].map(([key, item]) => `${key} = ${mergeValueForDisplay(item)}`).join("\n");
  }
  if (Array.isArray(value)) return value.map((item) => mergeValueForDisplay(item)).join("\n");
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, item]) => `${key} = ${formatConflictValue(item)}`).join("\n");
  }
  return mergeValueForDisplay(value);
}

function customResolutionValue(conflict) {
  return conflict?.resolution?.choice === "custom" ? conflict.resolution.value ?? "" : "";
}

function displayRowKey(value) {
  const text = String(value ?? "");
  if (text.startsWith("data:")) return text.slice(5).replaceAll("\u001f", " / ");
  if (text.startsWith("special:comment:")) return tText("merge.conflict.commentRow");
  if (text.startsWith("special:blank:")) return tText("merge.conflict.blankRow");
  return text;
}

function analysisStatus(session) {
  const summary = session?.summary;
  if (!summary) return tText("merge.toast.analysisComplete");
  if (session?.kind === "folder" && summary.outputFiles < 1) return tText("merge.status.noChangedFiles");
  if (summary.unresolvedConflicts) {
    return tText("merge.status.analysisConflicts", {
      files: summary.totalFiles,
      conflicts: summary.unresolvedConflicts
    });
  }
  return tText("merge.status.analysisComplete", { count: summary.totalFiles });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "Unknown merge error");
}

function localizedErrorMessage(error) {
  const message = errorMessage(error);
  if (message.includes("Merge folder output must contain at least one file")) return tText("merge.status.noChangedFiles");
  if (message.includes("Resolve all conflicts and acknowledge schema warnings")) return tText("merge.error.cannotSave");
  if (message.includes("selected folders contain no supported")) return tText("merge.error.noFiles");
  if (message.includes("File merge requires both A and B")) return tText("merge.error.selectInputs");
  if (message.includes("A and B are different tables")) return tText("merge.error.differentInputs");
  return message;
}

function formatSideLabel(side) {
  if (side === "a") return tText("merge.inputA");
  if (side === "b") return tText("merge.inputB");
  if (side === "base") return tText("merge.inputBase");
  return "";
}

function localizedFileDetail(file) {
  if (file?.sidePresence?.a === false) return tText("merge.fileDetail.sideAbsent", { side: tText("merge.inputA") });
  if (file?.sidePresence?.b === false) return tText("merge.fileDetail.sideAbsent", { side: tText("merge.inputB") });
  if (file?.custom && file?.sidePresence?.a !== file?.sidePresence?.b) {
    return tText("merge.fileDetail.customOnly", {
      side: file.sidePresence?.a ? tText("merge.inputA") : tText("merge.inputB")
    });
  }
  return "";
}

function localizedWarningMessage(warning) {
  if (warning?.kind === "base-missing") return tText("merge.warning.baseMissing");
  if (warning?.kind === "schema-mismatch") {
    return tText("merge.warning.schemaMismatch", {
      side: formatSideLabel(warning.side),
      percent: Math.round(Number(warning.similarity) * 100) || 0
    });
  }
  return warning?.message ? tText("merge.error.generic", { error: warning.message }) : tText("merge.warning.baseMissing");
}

function localizedConflictKind(kind) {
  const key = {
    value: "merge.conflict.kind.value",
    "add-add": "merge.conflict.kind.addAdd",
    "delete-modify": "merge.conflict.kind.deleteModify",
    "column-delete-modify": "merge.conflict.kind.columnDeleteModify",
    "header-name": "merge.conflict.kind.headerName",
    "row-order": "merge.conflict.kind.rowOrder",
    "column-order": "merge.conflict.kind.columnOrder",
    "ambiguous-schema": "merge.conflict.kind.ambiguousSchema",
    "ambiguous-row-key": "merge.conflict.kind.ambiguousRowKey"
  }[kind];
  return tText(key ?? "merge.statusLabel.conflict");
}

function localizedChangeKind(kind) {
  return tText(`merge.change.kind.${kind}`);
}

function automaticDecision(change) {
  const source = change?.source === "a" || change?.source === "b" || change?.source === "both"
    ? change.source
    : "base";
  return {
    source,
    text: tText(["merge.change.decision", source].join("."))
  };
}

function automaticCardStatusKeys(source) {
  if (source === "a") return {
    a: "merge.change.cardStatus.changed",
    b: "merge.change.cardStatus.unchanged",
    result: "merge.change.cardStatus.automatic"
  };
  if (source === "b") return {
    a: "merge.change.cardStatus.unchanged",
    b: "merge.change.cardStatus.changed",
    result: "merge.change.cardStatus.automatic"
  };
  if (source === "both") return {
    a: "merge.change.cardStatus.same",
    b: "merge.change.cardStatus.same",
    result: "merge.change.cardStatus.automatic"
  };
  return {
    a: "merge.change.cardStatus.available",
    b: "merge.change.cardStatus.available",
    result: "merge.change.cardStatus.automatic"
  };
}

function wholeFileDecision(change) {
  const source = change?.source === "a" || change?.source === "b" || change?.source === "both"
    ? change.source
    : "base";
  return {
    source,
    text: tText(["merge.change.wholeFile.decision", source].join("."))
  };
}

function wholeFileCardValues(source) {
  if (source === "a") return [
    ["merge.inputA", "merge.change.cardStatus.changedFile", "merge.change.wholeFile.changedFile"],
    ["merge.inputB", "merge.change.cardStatus.unchangedFile", "merge.change.wholeFile.unchangedFile"],
    ["merge.change.result", "merge.change.cardStatus.automatic", "merge.change.wholeFile.selectedA"]
  ];
  if (source === "b") return [
    ["merge.inputA", "merge.change.cardStatus.unchangedFile", "merge.change.wholeFile.unchangedFile"],
    ["merge.inputB", "merge.change.cardStatus.changedFile", "merge.change.wholeFile.changedFile"],
    ["merge.change.result", "merge.change.cardStatus.automatic", "merge.change.wholeFile.selectedB"]
  ];
  if (source === "both") return [
    ["merge.inputA", "merge.change.cardStatus.sameFile", "merge.change.wholeFile.sameFile"],
    ["merge.inputB", "merge.change.cardStatus.sameFile", "merge.change.wholeFile.sameFile"],
    ["merge.change.result", "merge.change.cardStatus.automatic", "merge.change.wholeFile.mergedFile"]
  ];
  return [
    ["merge.inputA", "merge.change.cardStatus.available", "merge.change.wholeFile.availableFile"],
    ["merge.inputB", "merge.change.cardStatus.available", "merge.change.wholeFile.availableFile"],
    ["merge.change.result", "merge.change.cardStatus.automatic", "merge.change.wholeFile.mergedFile"]
  ];
}

function changeDescription(change) {
  if (change.kind === "conflict") return localizedConflictMessage({
    kind: change.conflictKind,
    rowKey: change.rowLabel,
    columnName: change.columnLabel
  });
  if (change.kind === "file") return wholeFileDecision(change).text;
  return automaticDecision(change).text;
}

function localizedConflictMessage(conflict) {
  const row = displayRowKey(conflict?.rowKey) || "?";
  const column = conflict?.columnName || "?";
  const key = {
    value: "merge.conflict.message.value",
    "add-add": "merge.conflict.message.addAdd",
    "delete-modify": "merge.conflict.message.deleteModify",
    "column-delete-modify": "merge.conflict.message.columnDeleteModify",
    "header-name": "merge.conflict.message.headerName",
    "row-order": "merge.conflict.message.order",
    "column-order": "merge.conflict.message.order",
    "ambiguous-schema": "merge.conflict.message.ambiguous",
    "ambiguous-row-key": "merge.conflict.message.ambiguous"
  }[conflict?.kind] ?? "merge.conflict.message.generic";
  return tText(key, { row, column });
}

function isExistingOutputError(error) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("merge_output_exists") || message.includes("already exists") || message.includes("output exists");
}

function fileName(path) {
  return String(path ?? "").replaceAll("\\", "/").split("/").pop() || "";
}

function normalizedPath(path) {
  let value = String(path ?? "").trim().replaceAll("\\", "/").replace(/\/+$/, "");
  if (/^[a-z]:\//i.test(value) || value.startsWith("//")) value = value.toLowerCase();
  return value;
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function pathInside(path, parent) {
  const value = normalizedPath(path);
  const root = normalizedPath(parent);
  return Boolean(value && root && value.startsWith(`${root}/`));
}

function joinNativePath(parent, child) {
  const root = String(parent ?? "").replace(/[\\/]+$/, "");
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${separator}${String(child ?? "").replace(/^[\\/]+/, "")}`;
}

function clampIndex(value, count) {
  return Math.max(0, Math.min(Math.max(0, count - 1), Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
