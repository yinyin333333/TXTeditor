import assert from "node:assert/strict";
import test from "node:test";
import { installFakeAppStartupDom } from "./helpers/fake-dom-app-startup.mjs";
import { diagnosticsUiFixture } from "./helpers/diagnostics-ui-fixture.mjs";
import { diagnosticCopyText } from "../src/ui/diagnostic-copy-policy.js";

test("Problems delegates nested navigation and copying once across renders, preserving event policies", async () => {
  const { document } = installFakeAppStartupDom();
  const f = diagnosticsUiFixture(document);
  const { controller, state, els, calls } = f;
  const copies = [];
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text) => copies.push(text) } } });
  const bubble = [];
  for (const type of ["click", "contextmenu", "keydown"]) f.container.addEventListener(type, () => bubble.push(type));
  const fire = async (target, type, props = {}) => {
    const event = { type, bubbles: true, ...props };
    target.dispatchEvent(event);
    await new Promise((resolve) => setImmediate(resolve));
    return event;
  };
  try {
    controller.renderProblemsPanelIfNeeded();
    const oldButton = els.problemsList.querySelector("[data-diagnostic-id]");
    await fire(oldButton, "click");
    assert.equal(calls.navigations, 1);
    assert.deepEqual(state.selection.focus, { row: 1, column: 0 });
    for (let i = 0; i < 4; i += 1) {
      state.lint.version += 1;
      controller.renderProblemsPanelIfNeeded();
    }
    const button = els.problemsList.querySelector("[data-diagnostic-id]");
    const span = button.querySelector("span");
    await fire(span, "click");
    assert.equal(calls.navigations, 2);
    const menuEvent = await fire(span, "contextmenu", { clientX: 12, clientY: 34 });
    assert.equal(menuEvent.defaultPrevented, true);
    assert.equal(document.activeElement, button);
    assert.equal(calls.menus.length, 1);
    assert.equal(calls.menus[0].x, 12);
    assert.equal(calls.menus[0].y, 34);
    await calls.menus[0].onCopyMessage();
    await calls.menus[0].onCopyFull();
    assert.deepEqual(copies, ["message 0", diagnosticCopyText(state.lint.diagnostics[0])]);
    for (const modifier of ["ctrlKey", "metaKey"]) {
      const before = bubble.length;
      const event = await fire(span, "keydown", { key: "c", [modifier]: true });
      assert.equal(event.defaultPrevented, true);
      assert.equal(bubble.length, before, "copy stops before global shortcuts");
    }
    const ordinary = await fire(span, "keydown", { key: "v", ctrlKey: true });
    assert.equal(ordinary.defaultPrevented, undefined);
    assert.equal(bubble.at(-1), "keydown");
    assert.ok(bubble.includes("click"));
    assert.ok(bubble.includes("contextmenu"), "contextmenu retains original bubbling policy");

    state.lint.diagnostics[0].navigationDisabled = true;
    await fire(span, "click");
    assert.equal(calls.navigations, 2);
    await fire(span, "contextmenu");
    await fire(span, "keydown", { key: "c", ctrlKey: true });
    assert.equal(calls.menus.length, 2);
    assert.equal(copies.length, 5, "navigation-disabled diagnostics remain copyable");

    for (const target of [oldButton, els.problemsList.querySelector("summary"), els.problemsList]) {
      await fire(target, "click");
      await fire(target, "contextmenu");
      const event = await fire(target, "keydown", { key: "c", ctrlKey: true });
      assert.equal(event.defaultPrevented, undefined);
    }
    const outside = document.createElement("button");
    outside.setAttribute("data-diagnostic-id", "diagnostic-0");
    f.container.appendChild(outside);
    await fire(outside, "click");
    button.disabled = true;
    await fire(span, "click");
    assert.equal(calls.navigations, 2);
    assert.equal(calls.menus.length, 2);
    assert.equal(copies.length, 5);
    button.disabled = false;
    controller.setLintDiagnostics([]);
    await fire(span, "click");
    const deletedMenu = await fire(span, "contextmenu");
    assert.equal(deletedMenu.defaultPrevented, undefined);
    assert.equal(calls.menus.length, 2);
    assert.equal(calls.navigations, 2);
    const details = els.problemsList.querySelector("details[data-file-key]");
    details.open = false;
    await fire(details, "toggle", { bubbles: false });
    controller.setLintDiagnostics([{ id: "new", fileKey: "items.txt", fileName: "items.txt", rowIndex: 1, columnIndex: 0, severity: "error", message: "new" }]);
    controller.renderProblemsPanelIfNeeded();
    assert.equal(els.problemsList.querySelector("details[data-file-key]").open, false);
    for (const type of ["click", "contextmenu", "keydown"]) {
      assert.equal(els.problemsList.listeners.get(type).length, 1);
      assert.equal(button.listeners.get(type)?.length ?? 0, 0);
    }
    assert.deepEqual(calls.errors, []);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  }
});
