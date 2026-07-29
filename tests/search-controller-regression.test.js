import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SEARCH_SCOPE_ALL,
  SEARCH_SCOPE_COLUMN_TITLES,
  SEARCH_SCOPE_ROW_TITLES
} from "../src/core/search.js";
import { createSearchController } from "../src/ui/controllers/search-controller.js";
import { clampSearchModalPosition } from "../src/ui/search-policy.js";

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
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...event
      };
      for (const listener of listeners.get(type) ?? []) listener(dispatched);
      return dispatched;
    }
  }, extra);
}

function table(rows) {
  return {
    rows,
    rowCount: rows.length,
    columnCount: Math.max(...rows.map((row) => row.length)),
    getCell(row, column) {
      return rows[row]?.[column] ?? "";
    },
    setCell(row, column, value) {
      rows[row][column] = String(value);
    }
  };
}

function searchHarness({
  rows,
  scope = SEARCH_SCOPE_ALL,
  focus = { row: 0, column: 0 },
  query = "needle",
  modalRect = { left: 100, top: 80, width: 420, height: 220 }
}) {
  const pointerCaptures = [];
  const pointerReleases = [];
  const handle = eventTarget({
    setPointerCapture: (pointerId) => pointerCaptures.push(pointerId),
    releasePointerCapture: (pointerId) => pointerReleases.push(pointerId)
  });
  const modal = eventTarget({
    classList: classList(),
    style: { left: "", top: "" },
    querySelector: (selector) => selector === "[data-search-drag-handle]" ? handle : null,
    getBoundingClientRect() {
      const parsedLeft = Number.parseFloat(this.style.left);
      const parsedTop = Number.parseFloat(this.style.top);
      const left = Number.isFinite(parsedLeft) ? parsedLeft : modalRect.left;
      const top = Number.isFinite(parsedTop) ? parsedTop : modalRect.top;
      return {
        left,
        top,
        width: modalRect.width,
        height: modalRect.height,
        right: left + modalRect.width,
        bottom: top + modalRect.height
      };
    }
  });
  const scopeInput = eventTarget({ value: scope, checked: true });
  const panel = eventTarget({
    classList: classList(["hidden"]),
    querySelector(selector) {
      if (selector === ".search-modal") return modal;
      if (selector === "input[name='searchScope']:checked") return scopeInput;
      return null;
    },
    querySelectorAll(selector) {
      return selector === "input[name='searchScope']" ? [scopeInput] : [];
    }
  });
  const searchInput = eventTarget({
    value: query,
    focus: () => {},
    select: () => {}
  });
  const searchReplaceInput = eventTarget({ value: "replacement", focus: () => {}, select: () => {} });
  const searchReplaceRow = { classList: classList(["hidden"]) };
  const searchReplaceActions = { classList: classList(["hidden"]) };
  const searchTitle = { textContent: "Find" };
  const selection = {
    focus: { ...focus },
    set(row, column) {
      this.focus = { row, column };
    }
  };
  const state = {
    search: { lastQuery: query, lastScope: scope },
    selection
  };
  const scrolls = [];
  const doc = table(rows);
  const controller = createSearchController({
    state,
    els: {
      host: { focus: () => {} },
      searchInput,
      searchReplaceInput,
      searchReplaceRow,
      searchReplaceActions,
      searchTitle,
      searchPanel: panel,
      searchStatus: { textContent: "" }
    },
    grid: {
      scrollCellToCenter: (...args) => scrolls.push(args),
      scrollByWheel: () => {},
      draw: () => {}
    },
    activeDoc: () => doc,
    updateActiveProblemHighlight: () => {},
    applyEdits: (edits) => edits.forEach(({ row, column, value }) => doc.setCell(row, column, value))
  });
  return {
    controller,
    handle,
    modal,
    panel,
    pointerCaptures,
    pointerReleases,
    scopeInput,
    searchInput,
    searchReplaceInput,
    searchReplaceRow,
    searchReplaceActions,
    searchTitle,
    state,
    scrolls,
    rows
  };
}

test("opening Find starts again at the active cell and subsequent searches advance and wrap", () => {
  const all = searchHarness({
    rows: [["name", "ref"], ["needle", "x"], ["needle", "y"]],
    focus: { row: 1, column: 0 }
  });
  all.controller.showSearch();
  assert.deepEqual(all.state.search, { lastQuery: "", lastScope: SEARCH_SCOPE_ALL });
  all.controller.findNext();
  assert.deepEqual(all.state.selection.focus, { row: 1, column: 0 });
  all.controller.findNext();
  assert.deepEqual(all.state.selection.focus, { row: 2, column: 0 });
  all.controller.findNext();
  assert.deepEqual(all.state.selection.focus, { row: 1, column: 0 });

  const columns = searchHarness({
    rows: [["needle", "x", "needle"], ["a", "b", "c"]],
    scope: SEARCH_SCOPE_COLUMN_TITLES,
    focus: { row: 1, column: 2 }
  });
  columns.controller.showSearch();
  columns.controller.findNext();
  assert.deepEqual(columns.state.selection.focus, { row: 1, column: 2 });
  columns.controller.findNext();
  assert.deepEqual(columns.state.selection.focus, { row: 1, column: 0 });

  const rows = searchHarness({
    rows: [["name", "ref"], ["needle", "a"], ["needle", "b"]],
    scope: SEARCH_SCOPE_ROW_TITLES,
    focus: { row: 2, column: 1 }
  });
  rows.controller.showSearch();
  rows.controller.findNext();
  assert.deepEqual(rows.state.selection.focus, { row: 2, column: 1 });
  rows.controller.findNext();
  assert.deepEqual(rows.state.selection.focus, { row: 1, column: 1 });
});

test("Find header dragging clamps to the viewport and keeps its position when reopened", () => {
  const originalWindow = globalThis.window;
  const viewport = eventTarget({ innerWidth: 800, innerHeight: 600 });
  globalThis.window = viewport;

  try {
    const harness = searchHarness({
      rows: [["needle"]],
      focus: { row: 0, column: 0 }
    });
    harness.controller.wireEvents();
    harness.controller.showSearch();

    assert.equal(harness.searchInput.listeners.has("pointerdown"), false);
    assert.equal(harness.scopeInput.listeners.has("pointerdown"), false);
    assert.equal(harness.handle.listeners.has("pointerdown"), true);

    const inputTarget = { closest: (selector) => selector.includes("input") ? inputTarget : null };
    const blocked = harness.handle.dispatch("pointerdown", {
      button: 0,
      isPrimary: true,
      pointerId: 6,
      clientX: 120,
      clientY: 95,
      target: inputTarget
    });
    assert.equal(blocked.defaultPrevented, undefined);
    assert.deepEqual(harness.pointerCaptures, []);
    assert.equal(harness.modal.classList.contains("search-modal-dragging"), false);

    const started = harness.handle.dispatch("pointerdown", {
      button: 0,
      isPrimary: true,
      pointerId: 7,
      clientX: 120,
      clientY: 95
    });
    assert.equal(started.defaultPrevented, true);
    assert.deepEqual(harness.pointerCaptures, [7]);
    assert.equal(harness.modal.classList.contains("search-modal-dragging"), true);
    harness.handle.dispatch("pointermove", {
      pointerId: 7,
      clientX: -100,
      clientY: -100
    });
    assert.equal(harness.modal.style.left, "8px");
    assert.equal(harness.modal.style.top, "8px");

    harness.handle.dispatch("pointermove", {
      pointerId: 7,
      clientX: 1000,
      clientY: 1000
    });
    assert.equal(harness.modal.style.left, "372px");
    assert.equal(harness.modal.style.top, "372px");

    viewport.innerWidth = 500;
    viewport.innerHeight = 300;
    viewport.dispatch("resize");
    assert.equal(harness.modal.style.left, "72px");
    assert.equal(harness.modal.style.top, "72px");

    harness.handle.dispatch("pointerup", { pointerId: 7 });
    assert.deepEqual(harness.pointerReleases, [7]);
    assert.equal(harness.modal.classList.contains("search-modal-dragging"), false);
    harness.controller.closeSearch();
    viewport.dispatch("resize");
    assert.equal(harness.modal.style.left, "72px");
    assert.equal(harness.modal.style.top, "72px");

    harness.controller.showSearch();
    assert.equal(harness.modal.classList.contains("search-modal-positioned"), true);
    assert.equal(harness.modal.style.left, "72px");
    assert.equal(harness.modal.style.top, "72px");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("#78 search modal uses a dedicated full-width header without placing controls in the drag handle", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const header = html.match(/<header class="search-modal-header" data-search-drag-handle>([\s\S]*?)<\/header>/)?.[1] ?? "";
  assert.match(header, /id="searchTitle"/);
  assert.doesNotMatch(header, /<(?:input|button|select|textarea)\b/i);
  assert.match(css, /\.search-modal-header\s*\{[\s\S]*margin:\s*-18px -18px 0;/);
  assert.match(css, /\.search-modal\.search-modal-dragging \.search-modal-header\s*\{[\s\S]*cursor:\s*grabbing;/);
});

test("search modal clamp keeps all edges within the configured margin", () => {
  assert.deepEqual(clampSearchModalPosition({
    left: -200,
    top: 900,
    width: 420,
    height: 220,
    viewportWidth: 800,
    viewportHeight: 600
  }), { left: 8, top: 372 });
});

test("Find and Replace mode exposes replacement controls and applies edit batches", () => {
  const harness = searchHarness({
    rows: [["name", "description"], ["bash", "bash bash"], ["zeal", "bash"]],
    focus: { row: 1, column: 0 },
    query: "bash"
  });
  harness.searchReplaceInput.value = "hit";

  harness.controller.showReplace();
  assert.equal(harness.searchTitle.textContent, "Find and Replace");
  assert.equal(harness.searchReplaceRow.classList.contains("hidden"), false);
  assert.equal(harness.searchReplaceActions.classList.contains("hidden"), false);

  assert.equal(harness.controller.replaceNext(), true);
  assert.equal(harness.rows[1][0], "hit");
  assert.equal(harness.controller.replaceAll(), 3);
  assert.deepEqual(harness.rows, [["name", "description"], ["hit", "hit hit"], ["zeal", "hit"]]);

  harness.controller.showSearch();
  assert.equal(harness.searchTitle.textContent, "Find");
  assert.equal(harness.searchReplaceRow.classList.contains("hidden"), true);
  assert.equal(harness.searchReplaceActions.classList.contains("hidden"), true);
});
