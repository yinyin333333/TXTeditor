import { createDiagnosticsController } from "../../src/ui/controllers/diagnostics-controller.js";

export function diagnosticsUiFixture(document, createController = createDiagnosticsController, count = 3) {
  const doc = { name: "items.txt", path: "items.txt", rowCount: count + 10, columnCount: 2 };
  const diagnostics = Array.from({ length: count }, (_, index) => ({
    id: `diagnostic-${index}`, fileKey: doc.path, fileName: doc.name,
    rowIndex: index + 1, columnIndex: 0, severity: "warning", message: `message ${index}`
  }));
  const state = {
    docs: [doc], active: 0, config: {}, problemsVisible: true, bottomTab: "problems",
    selection: { focus: { row: 0, column: 0 }, set(row, column) { this.focus = { row, column }; } },
    lint: { diagnostics, enabled: true, engine: "vector", status: "", version: 1,
      legacy: { status: "", rulesOpen: false, settings: { profile: "basic" }, workspaceDocs: [], workspaceLoad: {} } },
    lsp: { started: true, openFileCount: 1 }
  };
  const container = document.createElement("section");
  document.body.appendChild(container);
  const els = Object.fromEntries(["host", "problemsList", "overviewRuler"].map((name) => {
    const element = document.createElement("div");
    container.appendChild(element);
    return [name, element];
  }));
  // The startup fake DOM lacks contains; use its actual child tree, not parent pointers
  // (which the fake retains after innerHTML replacement).
  els.problemsList.contains ??= function contains(target) {
    const visit = (node) => node === target || node.children.some(visit);
    return visit(this);
  };
  let rect = { top: 20, height: 400 };
  els.host.getBoundingClientRect = () => rect;
  const calls = { navigations: 0, menus: [], errors: [] };
  const controller = createController({
    state, els,
    grid: { editingCell: () => null, setDiagnostics() {}, layout() {}, scrollCellToCenter() {}, draw() {} },
    activeDoc: () => state.docs[state.active], hasOpenDocument: () => true,
    addDocument: async () => {}, activateDocument: async () => { calls.navigations += 1; },
    renderChrome() {}, recordUiPerf() {}, showError: (error) => calls.errors.push(error),
    lintDocKey: (value) => value?.path ?? "", lintPathKey: (value) => value,
    escapeHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
    showDiagnosticContextMenu: (menu) => calls.menus.push(menu), storage: { setItem() {} }
  });
  return { controller, state, doc, els, calls, container, resize: (value) => { rect = value; } };
}
