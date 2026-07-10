import assert from "node:assert/strict";
import test from "node:test";
import { createShortcutSettingsController } from "../src/ui/controllers/shortcut-settings-controller.js";
import {
  SHORTCUT_STORAGE_KEY,
  defaultShortcutBindings
} from "../src/ui/shortcut-policy.js";
import { installFakeAppStartupDom } from "./helpers/fake-dom-app-startup.mjs";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function makeController() {
  const { document } = installFakeAppStartupDom();
  const host = document.createElement("section");
  const state = { shortcuts: defaultShortcutBindings() };
  const toasts = [];
  const controller = createShortcutSettingsController({
    state,
    els: { host },
    storage: localStorage,
    showToast: (message) => toasts.push(message),
    escapeHtml
  });
  return { controller, document, host, state, toasts };
}

function keyEvent(key, options = {}) {
  return {
    key,
    ...options,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; }
  };
}

test("shortcut settings renders all requested controls with Save and Cancel", () => {
  const { controller, document } = makeController();
  controller.showShortcutSettings();

  assert.ok(document.body.querySelector(".shortcut-modal"));
  assert.equal(document.body.querySelector("[data-shortcut-record='save-file']")?.textContent.trim(), "Ctrl+S");
  assert.equal(document.body.querySelector("[data-shortcut-record='scroll-page-up']")?.textContent.trim(), "PageUp");
  assert.equal(document.body.querySelector("[data-shortcut-record='scroll-left']")?.textContent.trim(), "Shift+Home");
  assert.equal(document.body.querySelector("[data-shortcut-choice='save']")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-shortcut-choice='cancel']")?.tagName, "BUTTON");
  assert.equal(document.body.querySelector("[data-shortcut-reset]")?.textContent.trim(), "Reset All to Defaults");
  assert.equal(document.body.querySelector("[data-shortcut-default='save-file']")?.textContent.trim(), "Default");
  assert.equal(document.body.querySelector("[data-shortcut-clear]"), null);
  assert.equal(document.body.querySelector("[data-shortcut-error]"), null);
});

test("recorded shortcut applies only after Save", () => {
  const { controller, document, state, toasts } = makeController();
  controller.showShortcutSettings();

  document.body.querySelector("[data-shortcut-record='save-file']").click();
  const event = keyEvent("k", { ctrlKey: true });
  document.listeners.get("keydown")[0](event);

  assert.deepEqual(state.shortcuts["save-file"], ["Ctrl+S"]);
  assert.equal(document.body.querySelector("[data-shortcut-record='save-file']")?.textContent.trim(), "Ctrl+K");
  assert.equal(event.defaultPrevented, true);

  document.body.querySelector("[data-shortcut-choice='save']").click();
  assert.deepEqual(state.shortcuts["save-file"], ["Ctrl+K"]);
  assert.ok(localStorage.getItem(SHORTCUT_STORAGE_KEY));
  assert.deepEqual(toasts, ["Keyboard shortcuts saved."]);
  assert.equal(document.body.querySelector(".shortcut-modal"), null);
});

test("Cancel and Escape discard shortcut drafts", () => {
  const first = makeController();
  first.controller.showShortcutSettings();
  first.document.body.querySelector("[data-shortcut-record='save-file']").click();
  first.document.listeners.get("keydown")[0](keyEvent("k", { ctrlKey: true }));
  first.document.body.querySelector("[data-shortcut-choice='cancel']").click();
  assert.deepEqual(first.state.shortcuts["save-file"], ["Ctrl+S"]);
  assert.equal(first.document.activeElement, first.host);

  const second = makeController();
  second.controller.showShortcutSettings();
  second.document.listeners.get("keydown")[0](keyEvent("Escape"));
  assert.equal(second.document.body.querySelector(".shortcut-modal"), null);
  assert.deepEqual(second.state.shortcuts["save-file"], ["Ctrl+S"]);
});

test("assigning an occupied shortcut transfers it and shows messages on both rows", () => {
  const { controller, document, state } = makeController();
  controller.showShortcutSettings();
  document.body.querySelector("[data-shortcut-record='open-file']").click();
  document.listeners.get("keydown")[0](keyEvent("s", { ctrlKey: true }));

  const save = document.body.querySelector("[data-shortcut-choice='save']");
  assert.notEqual(save.disabled, true);
  assert.equal(document.body.querySelector("[data-shortcut-record='open-file']")?.textContent.trim(), "Ctrl+S");
  assert.equal(document.body.querySelector("[data-shortcut-record='save-file']")?.textContent.trim(), "Unassigned");
  assert.match(document.body.querySelector("[data-shortcut-message='open-file']").textContent, /previously assigned to Save/);
  assert.match(document.body.querySelector("[data-shortcut-message='save-file']").textContent, /reassigned to Open File/);
  assert.match(document.body.querySelector("[data-shortcut-message='save-file']").textContent, /now unassigned/);
  assert.deepEqual(state.shortcuts["open-file"], ["Ctrl+O"]);
  assert.deepEqual(state.shortcuts["save-file"], ["Ctrl+S"]);

  save.click();
  assert.deepEqual(state.shortcuts["open-file"], ["Ctrl+S"]);
  assert.deepEqual(state.shortcuts["save-file"], []);
  assert.equal(document.body.querySelector(".shortcut-modal"), null);
});

test("Default restores one shortcut without applying it before Save", () => {
  const { controller, document, state } = makeController();
  state.shortcuts["save-file"] = ["Ctrl+K"];
  controller.showShortcutSettings();

  document.body.querySelector("[data-shortcut-default='save-file']").click();
  assert.equal(document.body.querySelector("[data-shortcut-record='save-file']")?.textContent.trim(), "Ctrl+S");
  assert.deepEqual(state.shortcuts["save-file"], ["Ctrl+K"]);

  document.body.querySelector("[data-shortcut-choice='save']").click();
  assert.deepEqual(state.shortcuts["save-file"], ["Ctrl+S"]);
});

test("recording guidance and validation errors render below the active shortcut row", () => {
  const { controller, document } = makeController();
  controller.showShortcutSettings();

  document.body.querySelector("[data-shortcut-record='save-file']").click();
  assert.match(document.body.querySelector("[data-shortcut-message='save-file']").textContent, /Press the new shortcut/);

  document.listeners.get("keydown")[0](keyEvent("Enter"));
  assert.match(document.body.querySelector("[data-shortcut-message='save-file']").textContent, /reserved for grid editing/);
  assert.equal(document.body.querySelector("[data-shortcut-record='save-file']")?.textContent.trim(), "Press shortcut...");
});

test("Default also transfers an occupied default binding from another command", () => {
  const { controller, document, state } = makeController();
  state.shortcuts["open-file"] = ["Ctrl+S"];
  state.shortcuts["save-file"] = [];
  controller.showShortcutSettings();

  document.body.querySelector("[data-shortcut-default='save-file']").click();

  assert.equal(document.body.querySelector("[data-shortcut-record='save-file']")?.textContent.trim(), "Ctrl+S");
  assert.equal(document.body.querySelector("[data-shortcut-record='open-file']")?.textContent.trim(), "Unassigned");
  assert.match(document.body.querySelector("[data-shortcut-message='open-file']").textContent, /reassigned to Save/);
});
