import assert from "node:assert/strict";
import test from "node:test";
import {
  SEARCH_SCOPE_ALL
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
  const handle = eventTarget({
    setPointerCapture: () => {},
    releasePointerCapture: () => {}
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
  const controller = createSearchController({
    state,
    els: {
      host: { focus: () => {} },
      searchInput,
      searchPanel: panel,
      searchStatus: { textContent: "" }
    },
    grid: {
      scrollCellToCenter: (...args) => scrolls.push(args),
      scrollByWheel: () => {},
      draw: () => {}
    },
    activeDoc: () => table(rows),
    updateActiveProblemHighlight: () => {}
  });
  return { controller, handle, modal, panel, scopeInput, searchInput, state, scrolls };
}

test("Find title dragging clamps to the viewport and controls do not initiate dragging", () => {
  const originalWindow = globalThis.window;
  const viewport = eventTarget({ innerWidth: 800, innerHeight: 600 });
  globalThis.window = viewport;

  try {
    const harness = searchHarness({
      rows: [["needle"]],
      focus: { row: 0, column: 0 }
    });
    harness.controller.wireEvents();

    assert.equal(harness.searchInput.listeners.has("pointerdown"), false);
    assert.equal(harness.scopeInput.listeners.has("pointerdown"), false);
    assert.equal(harness.handle.listeners.has("pointerdown"), true);

    harness.handle.dispatch("pointerdown", {
      button: 0,
      isPrimary: true,
      pointerId: 7,
      clientX: 120,
      clientY: 95
    });
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
    harness.controller.showSearch();
    assert.equal(harness.modal.classList.contains("search-modal-positioned"), false);
    assert.equal(harness.modal.style.left, "");
    assert.equal(harness.modal.style.top, "");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
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
