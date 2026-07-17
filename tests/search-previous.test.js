import assert from "node:assert/strict";
import test from "node:test";
import {
  SEARCH_DIRECTION_BACKWARD,
  SEARCH_SCOPE_ALL,
  SEARCH_SCOPE_COLUMN_TITLES,
  SEARCH_SCOPE_ROW_TITLES,
  findInTable
} from "../src/core/search.js";
import { createSearchController } from "../src/ui/controllers/search-controller.js";

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name)
  };
}

function eventTarget(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      const dispatched = {
        type,
        target: this,
        currentTarget: this,
        preventDefault() { this.defaultPrevented = true; },
        ...event
      };
      for (const listener of listeners.get(type) ?? []) listener(dispatched);
      return dispatched;
    }
  }, extra);
}

function table(rows) {
  return {
    rowCount: rows.length,
    columnCount: Math.max(0, ...rows.map((row) => row.length)),
    getCell: (row, column) => rows[row]?.[column] ?? ""
  };
}

function searchHarness({ rows, focus, scope = SEARCH_SCOPE_ALL, query = "needle" }) {
  const scopeInput = eventTarget({ value: scope, checked: true });
  const modal = {
    classList: classList(),
    style: {},
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 180 })
  };
  const panel = eventTarget({
    classList: classList(["hidden"]),
    querySelector(selector) {
      if (selector === ".search-modal") return modal;
      if (selector === "input[name='searchScope']:checked") return scopeInput;
      return null;
    },
    querySelectorAll: (selector) => selector === "input[name='searchScope']" ? [scopeInput] : []
  });
  const searchInput = eventTarget({ value: query, focus() {}, select() {} });
  const selection = {
    focus: { ...focus },
    set(row, column) { this.focus = { row, column }; }
  };
  const state = { search: { lastQuery: query, lastScope: scope }, selection };
  const controller = createSearchController({
    state,
    els: {
      host: { focus() {} },
      searchInput,
      searchPanel: panel,
      searchStatus: { textContent: "" }
    },
    grid: { scrollCellToCenter() {}, scrollByWheel() {}, draw() {} },
    activeDoc: () => table(rows),
    updateActiveProblemHighlight() {}
  });
  return { controller, searchInput, state };
}

test("backward table search starts before the active cell and wraps", () => {
  const doc = table([["needle", "x", "needle"], ["needle", "x", "needle"]]);

  assert.deepEqual(findInTable(doc, "needle", { row: 0, column: 0 }, {
    direction: SEARCH_DIRECTION_BACKWARD
  }), { row: 1, column: 2 });
  assert.deepEqual(findInTable(doc, "needle", { row: 0, column: 0 }, {
    direction: SEARCH_DIRECTION_BACKWARD,
    includeStart: true
  }), { row: 0, column: 0 });
  assert.deepEqual(findInTable(doc, "needle", { row: 1, column: 0 }, {
    direction: SEARCH_DIRECTION_BACKWARD,
    scope: SEARCH_SCOPE_COLUMN_TITLES
  }), { row: 0, column: 2 });
  assert.deepEqual(findInTable(doc, "needle", { row: 0, column: 1 }, {
    direction: SEARCH_DIRECTION_BACKWARD,
    scope: SEARCH_SCOPE_ROW_TITLES
  }), { row: 1, column: 0 });
});

test("Find Previous preserves scoped coordinates and wraps at the first result", () => {
  const all = searchHarness({
    rows: [["name"], ["needle"], ["needle"]],
    focus: { row: 1, column: 0 }
  });
  all.controller.showSearch();
  all.controller.findPrevious();
  assert.deepEqual(all.state.selection.focus, { row: 1, column: 0 });
  all.controller.findPrevious();
  assert.deepEqual(all.state.selection.focus, { row: 2, column: 0 });

  const columns = searchHarness({
    rows: [["needle", "x", "needle"], ["a", "b", "c"]],
    scope: SEARCH_SCOPE_COLUMN_TITLES,
    focus: { row: 1, column: 0 }
  });
  columns.controller.showSearch();
  columns.controller.findPrevious();
  columns.controller.findPrevious();
  assert.deepEqual(columns.state.selection.focus, { row: 1, column: 2 });

  const rows = searchHarness({
    rows: [["name", "ref"], ["needle", "a"], ["needle", "b"]],
    scope: SEARCH_SCOPE_ROW_TITLES,
    focus: { row: 1, column: 1 }
  });
  rows.controller.showSearch();
  rows.controller.findPrevious();
  rows.controller.findPrevious();
  assert.deepEqual(rows.state.selection.focus, { row: 2, column: 1 });
});

test("Shift+Enter runs Find Previous while Enter keeps Find Next", () => {
  const previous = searchHarness({
    rows: [["x"], ["needle"], ["needle"]],
    focus: { row: 0, column: 0 }
  });
  previous.controller.wireEvents();
  previous.controller.showSearch();
  const backwardEvent = previous.searchInput.dispatch("keydown", { key: "Enter", shiftKey: true });
  assert.equal(backwardEvent.defaultPrevented, true);
  assert.deepEqual(previous.state.selection.focus, { row: 2, column: 0 });

  const next = searchHarness({
    rows: [["x"], ["needle"], ["needle"]],
    focus: { row: 0, column: 0 }
  });
  next.controller.wireEvents();
  next.controller.showSearch();
  next.searchInput.dispatch("keydown", { key: "Enter", shiftKey: false });
  assert.deepEqual(next.state.selection.focus, { row: 1, column: 0 });
});
