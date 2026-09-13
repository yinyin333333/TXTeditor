import assert from "node:assert/strict";
import test from "node:test";
import { installFakeAppStartupDom } from "./helpers/fake-dom-app-startup.mjs";
import { diagnosticsUiFixture } from "./helpers/diagnostics-ui-fixture.mjs";

test("overview retains identical marker DOM through resize and refresh, invalidating every display input", () => {
  const { document } = installFakeAppStartupDom();
  const { controller, state, doc, els, resize } = diagnosticsUiFixture(document);
  const ruler = els.overviewRuler;
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ruler), "innerHTML");
  let writes = 0;
  Object.defineProperty(ruler, "innerHTML", {
    get() { return descriptor.get.call(this); },
    set(value) { writes += 1; descriptor.set.call(this, value); }
  });
  const marks = () => ruler.querySelectorAll(".ruler-mark");
  controller.updateOverviewRuler();
  const first = marks()[0];
  for (let i = 0; i < 20; i += 1) {
    resize({ top: i, height: 500 + i });
    controller.updateOverviewRuler();
  }
  assert.equal(writes, 1);
  assert.equal(marks()[0], first);
  assert.equal(ruler.style.top, "19px");
  assert.equal(ruler.style.height, "519px");
  assert.equal(ruler.style.right, "0px");
  controller.setLintDiagnostics(state.lint.diagnostics.map((d) => ({ ...d, message: "changed message" })));
  controller.updateOverviewRuler();
  assert.equal(marks()[0], first);
  const version = state.lint.version;
  controller.setLintDiagnostics([...state.lint.diagnostics, { ...state.lint.diagnostics[0], id: "highest", severity: "error" }], { preserveVersion: true });
  controller.updateOverviewRuler();
  assert.equal(state.lint.version, version);
  assert.equal(marks().length, 3);
  assert.ok(marks()[0].classList.contains("ruler-mark-error"));
  controller.setLintDiagnostics(state.lint.diagnostics.filter((d) => d.id !== "highest"));
  controller.updateOverviewRuler();
  assert.ok(marks()[0].classList.contains("ruler-mark-warning"));
  const beforeRows = ruler.innerHTML;
  doc.rowCount += 1;
  controller.updateOverviewRuler();
  assert.notEqual(ruler.innerHTML, beforeRows);
  doc.rowCount -= 1;
  controller.updateOverviewRuler();
  assert.equal(ruler.innerHTML, beforeRows);
  controller.setLintDiagnostics(state.lint.diagnostics.map((d) => ({ ...d, rowIndex: d.rowIndex + 1 })));
  controller.updateOverviewRuler();
  assert.notEqual(ruler.innerHTML, beforeRows);
  const shiftedHtml = ruler.innerHTML;
  state.docs.push({ ...doc, path: "other.txt" });
  state.active = 1;
  controller.updateOverviewRuler();
  assert.equal(marks().length, 0);
  state.active = 0;
  controller.updateOverviewRuler();
  assert.equal(ruler.innerHTML, shiftedHtml);
  for (const [target, property] of [[state.lint, "enabled"], [state, "problemsVisible"]]) {
    target[property] = false;
    controller.updateOverviewRuler();
    assert.equal(marks().length, 0);
    target[property] = true;
    controller.updateOverviewRuler();
    assert.equal(ruler.innerHTML, shiftedHtml);
  }
  doc.kind = "json";
  controller.updateOverviewRuler();
  assert.equal(marks().length, 0);
  delete doc.kind;
  controller.updateOverviewRuler();
  assert.equal(ruler.innerHTML, shiftedHtml);
  doc.rowCount = 0;
  controller.updateOverviewRuler();
  assert.equal(marks().length, 0);
  doc.rowCount = 13;
  controller.updateOverviewRuler();
  assert.equal(ruler.innerHTML, shiftedHtml);
  controller.setLintDiagnostics([]);
  controller.updateOverviewRuler();
  const emptyWrites = writes;
  controller.updateOverviewRuler();
  assert.equal(writes, emptyWrites);
  assert.equal(marks().length, 0);
});

test("overview invalidates on same-source index rebuilds and renders into replacement rulers", () => {
  const { document } = installFakeAppStartupDom();
  const { controller, state, doc, els } = diagnosticsUiFixture(document);
  controller.updateOverviewRuler();
  state.lint.diagnostics[0].severity = "error";
  controller.setLintDiagnostics(state.lint.diagnostics, { preserveVersion: true });
  controller.updateOverviewRuler();
  assert.ok(els.overviewRuler.querySelector(".ruler-mark-error"));
  const original = els.overviewRuler.querySelector(".ruler-mark");
  state.docs.push({ ...doc, path: "same-projection.txt" });
  controller.setLintDiagnostics([
    ...state.lint.diagnostics,
    ...state.lint.diagnostics.map((d) => ({ ...d, id: `${d.id}-other`, fileKey: "same-projection.txt" }))
  ]);
  state.active = 1;
  controller.updateOverviewRuler();
  assert.equal(els.overviewRuler.querySelector(".ruler-mark"), original);
  const html = els.overviewRuler.innerHTML;
  els.overviewRuler = document.createElement("div");
  controller.updateOverviewRuler();
  assert.equal(els.overviewRuler.innerHTML, html);
  state.lint.diagnostics = state.lint.diagnostics.map((d) => ({ ...d, severity: "info" }));
  controller.updateOverviewRuler();
  assert.ok(els.overviewRuler.querySelector(".ruler-mark-info"));
  assert.equal(els.overviewRuler.querySelector(".ruler-mark-error"), null);
});
