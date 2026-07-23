import {
  SHORTCUT_DEFINITIONS,
  cloneShortcutBindings,
  defaultShortcutBindings,
  saveShortcutBindings,
  shortcutChordFromEvent,
  shortcutConflicts,
  shortcutDisplayForAction,
  validateShortcutChord
} from "../shortcut-policy.js";
import { tText } from "../../core/i18n.js";

export function createShortcutSettingsController({
  state,
  els,
  storage = localStorage,
  showToast = () => {},
  escapeHtml
}) {
  function showShortcutSettings() {
    let draft = cloneShortcutBindings(state.shortcuts);
    let recordingAction = null;
    let closed = false;
    const rowMessages = new Map();
    const definitionByAction = new Map(SHORTCUT_DEFINITIONS.map((definition) => [definition.action, definition]));
    const defaults = defaultShortcutBindings();

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal shortcut-modal" role="dialog" aria-modal="true" aria-labelledby="shortcutSettingsTitle">
        <h2 id="shortcutSettingsTitle" data-shortcut-i18n="toolbar.shortcuts">${tText("toolbar.shortcuts")}</h2>
        <p class="shortcut-settings-hint" data-shortcut-i18n="shortcut.hint">${tText("shortcut.hint")}</p>
        <div class="shortcut-settings-list" data-shortcut-list></div>
        <div class="modal-actions shortcut-modal-actions">
          <button data-shortcut-reset data-shortcut-i18n="shortcut.resetAll">${tText("shortcut.resetAll")}</button>
          <span class="shortcut-actions-spacer"></span>
          <button data-shortcut-choice="save" data-shortcut-i18n="toolbar.save">${tText("toolbar.save")}</button>
          <button data-shortcut-choice="cancel" data-shortcut-i18n="common.cancel">${tText("common.cancel")}</button>
        </div>
      </div>`;
    document.body.append(backdrop);

    const list = backdrop.querySelector("[data-shortcut-list]");

    const assignShortcuts = (action, chords, { restoringDefault = false } = {}) => {
      const target = definitionByAction.get(action);
      const assigned = [...new Set(chords)];
      const displaced = [];
      rowMessages.clear();

      for (const definition of SHORTCUT_DEFINITIONS) {
        if (definition.action === action) continue;
        const previous = draft[definition.action] ?? [];
        const removed = previous.filter((chord) => assigned.includes(chord));
        if (!removed.length) continue;
        draft[definition.action] = previous.filter((chord) => !assigned.includes(chord));
        const unassigned = draft[definition.action].length === 0;
        displaced.push({ definition, removed, unassigned });
        rowMessages.set(
          definition.action,
          tText("shortcut.reassigned", { keys: removed.join(" / "), target: target.label, suffix: unassigned ? tText("shortcut.nowUnassigned") : "" })
        );
      }

      draft[action] = assigned;
      if (displaced.length) {
        const previousAssignments = displaced
          .map(({ definition, unassigned }) => `${definition.label}${unassigned ? tText("shortcut.nowUnassignedLabel") : ""}`)
          .join(", ");
        rowMessages.set(action, tText("shortcut.previouslyAssigned", { keys: assigned.join(" / "), targets: previousAssignments }));
      } else if (restoringDefault) {
        rowMessages.set(action, tText("shortcut.restored"));
      }
    };

    const renderRows = () => {
      const groups = [...new Set(SHORTCUT_DEFINITIONS.map(({ group }) => group))];
      list.innerHTML = groups.map((group) => `
        <section class="shortcut-group">
          <h3>${escapeHtml(tText(group))}</h3>
          ${SHORTCUT_DEFINITIONS.filter((definition) => definition.group === group).map((definition) => {
            const recording = recordingAction === definition.action;
            const display = shortcutDisplayForAction(definition.action, draft) || tText("shortcut.unassigned");
            const message = rowMessages.get(definition.action) ?? "";
            return `
              <div class="shortcut-row">
                <span class="shortcut-command-label">${escapeHtml(definition.label)}</span>
                <button class="shortcut-capture${recording ? " recording" : ""}" data-shortcut-record="${escapeHtml(definition.action)}" aria-pressed="${recording ? "true" : "false"}">
                  ${recording ? tText("shortcut.press") : escapeHtml(display)}
                </button>
                <button class="shortcut-default" data-shortcut-default="${escapeHtml(definition.action)}" title="${tText("shortcut.restoreDefault")}">${tText("shortcut.default")}</button>
                ${message ? `<div class="shortcut-row-message" data-shortcut-message="${escapeHtml(definition.action)}" aria-live="polite">${escapeHtml(message)}</div>` : ""}
              </div>`;
          }).join("")}
        </section>
      `).join("");

      for (const button of list.querySelectorAll("[data-shortcut-record]")) {
        button.addEventListener("click", () => {
          recordingAction = button.dataset.shortcutRecord;
          rowMessages.clear();
          rowMessages.set(recordingAction, tText("shortcut.pressNew"));
          renderRows();
          list.querySelector(`[data-shortcut-record='${recordingAction}']`)?.focus();
        });
      }
      for (const button of list.querySelectorAll("[data-shortcut-default]")) {
        button.addEventListener("click", () => {
          const action = button.dataset.shortcutDefault;
          assignShortcuts(action, defaults[action], { restoringDefault: true });
          recordingAction = null;
          renderRows();
        });
      }
    };

    const refreshForLocale = () => {
      if (closed) return;
      rowMessages.clear();
      for (const element of backdrop.querySelectorAll("[data-shortcut-i18n]")) {
        element.textContent = tText(element.dataset.shortcutI18n);
      }
      renderRows();
    };

    const finish = (save = false) => {
      if (closed) return;
      if (save) {
        const conflict = shortcutConflicts(draft)[0];
        if (conflict) {
          for (const action of conflict.actions) {
            rowMessages.set(action, tText("shortcut.conflict", { chord: conflict.chord, labels: conflict.labels.join(" and ") }));
          }
          renderRows();
          return;
        }
        state.shortcuts = saveShortcutBindings(draft, storage);
        showToast(tText("shortcut.saved"));
      }
      closed = true;
      document.removeEventListener("keydown", onKeydown, true);
      document.removeEventListener("txteditor-locale-changed", refreshForLocale);
      backdrop.remove();
      els.host.focus();
    };

    const stopKeyEvent = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    const onKeydown = (event) => {
      if (recordingAction) {
        stopKeyEvent(event);
        if (event.key === "Escape") {
          rowMessages.delete(recordingAction);
          recordingAction = null;
          renderRows();
          return;
        }
        const chord = shortcutChordFromEvent(event);
        if (!chord) return;
        const validation = validateShortcutChord(chord);
        if (!validation.valid) {
          rowMessages.clear();
          rowMessages.set(recordingAction, validation.message);
          renderRows();
          list.querySelector(`[data-shortcut-record='${recordingAction}']`)?.focus();
          return;
        }
        assignShortcuts(recordingAction, [validation.chord]);
        recordingAction = null;
        renderRows();
        return;
      }
      if (event.key !== "Escape") return;
      stopKeyEvent(event);
      finish(false);
    };

    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("txteditor-locale-changed", refreshForLocale);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) return finish(false);
      const choice = event.target.closest("[data-shortcut-choice]")?.dataset.shortcutChoice;
      if (choice === "save") finish(true);
      if (choice === "cancel") finish(false);
      if (event.target.closest("[data-shortcut-reset]")) {
        draft = cloneShortcutBindings(defaults);
        recordingAction = null;
        rowMessages.clear();
        renderRows();
      }
    });

    renderRows();
  }

  return { showShortcutSettings };
}
