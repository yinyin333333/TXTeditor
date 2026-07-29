import assert from "node:assert/strict";
import test from "node:test";
import { JsonDocument } from "../src/core/json-document.js";
import {
  SEARCH_DIRECTION_BACKWARD,
  SEARCH_SCOPE_COLUMN_TITLES,
  findAllInTableAsync,
  findAllInTextAsync,
  findInText,
  searchSnippet,
  textLineColumn,
  textLineStarts
} from "../src/core/search.js";
import { SelectionModel } from "../src/core/selection.js";
import { TableDocument } from "../src/core/table-model.js";
import { createSearchController } from "../src/ui/controllers/search-controller.js";
import { initialSearchState } from "../src/ui/search-policy.js";

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle(name, force) {
      if (force === undefined ? !values.has(name) : force) values.add(name);
      else values.delete(name);
    }
  };
}

function element(extra = {}) {
  const listeners = new Map();
  const attributes = new Map();
  return Object.assign({
    listeners,
    attributes,
    classList: classList(),
    textContent: "",
    innerHTML: "",
    addEventListener(type, listener) { listeners.set(type, listener); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    focus() {},
    select() {},
    querySelectorAll() { return []; }
  }, extra);
}

function searchHarness({ doc, query, scope = "all", jsonSnapshot = null }) {
  const scopeInput = element({ value: scope, checked: true });
  const modal = element({
    style: {},
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 30, top: 30, width: 620, height: 420 })
  });
  const panel = element({
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
  const results = element({ classList: classList(["hidden"]) });
  const summary = element({ classList: classList(["hidden"]) });
  const searchScope = element();
  const searchInput = element({ value: query, placeholder: "" });
  const searchStatus = element();
  const searchMatchCase = element({ checked: false });
  const selection = new SelectionModel();
  selection.set(0, 0);
  const calls = [];
  const jsonSelections = [];
  const controller = createSearchController({
    state: { search: initialSearchState(), selection },
    els: {
      host: element(),
      searchPanel: panel,
      searchTitle: element(),
      searchInput,
      searchScope,
      searchMatchCase,
      searchStatus,
      searchResults: results,
      searchResultsSummary: summary
    },
    grid: {
      notifySelectionChanged: (reason) => calls.push(["notify", reason]),
      scrollCellToCenter: (row, column) => calls.push(["scroll", row, column]),
      scrollByWheel() {},
      draw: () => calls.push(["draw"])
    },
    activeDoc: () => doc,
    updateActiveProblemHighlight: () => calls.push(["problem"]),
    saveSelectionState: () => calls.push(["save"]),
    selectTableMatch: (start, end) => calls.push(["range", start, end]),
    jsonSearch: {
      searchSnapshot: () => jsonSnapshot,
      selectSearchRange: (range) => {
        jsonSelections.push({ start: range.start, end: range.end });
        return true;
      },
      openReplace: () => true
    }
  });
  return {
    calls,
    controller,
    jsonSelections,
    panel,
    results,
    scopeInput,
    searchInput,
    searchMatchCase,
    searchScope,
    searchStatus,
    selection,
    summary
  };
}

test("Find All scans table cells with the same scope and case options without blocking one long loop", async () => {
  const doc = TableDocument.fromText("skills.txt", "Name\tDescription\nBash\tBASH bash\nZeal\tbash");
  let yields = 0;
  const all = await findAllInTableAsync(doc, "bash", {
    batchSize: 2,
    yieldControl: async () => { yields += 1; }
  });
  assert.equal(all.totalMatches, 4);
  assert.deepEqual(all.matches.map(({ row, column, start, end }) => ({ row, column, start, end })), [
    { row: 1, column: 0, start: 0, end: 4 },
    { row: 1, column: 1, start: 0, end: 4 },
    { row: 1, column: 1, start: 5, end: 9 },
    { row: 2, column: 1, start: 0, end: 4 }
  ]);
  assert.ok(yields > 0);

  const headers = await findAllInTableAsync(doc, "name", {
    matchCase: true,
    scope: SEARCH_SCOPE_COLUMN_TITLES
  });
  assert.equal(headers.totalMatches, 0);
  assert.equal((await findAllInTableAsync(doc, "Name", {
    matchCase: true,
    scope: SEARCH_SCOPE_COLUMN_TITLES
  })).totalMatches, 1);
});

test("text Find All returns exact offsets and supports cancellation, line locations, snippets, and backward wrap", async () => {
  const text = "alpha\nBETA beta\nomega beta";
  const all = await findAllInTextAsync(text, "beta", { chunkSize: 8 });
  assert.deepEqual(all.matches, [
    { start: 6, end: 10 },
    { start: 11, end: 15 },
    { start: 22, end: 26 }
  ]);
  assert.deepEqual(textLineColumn(textLineStarts(text), 22), { line: 3, column: 7 });
  assert.equal(searchSnippet(text, 22, 26), "alpha BETA beta omega beta");
  assert.deepEqual(findInText("hit x hit", "hit", -1, { direction: SEARCH_DIRECTION_BACKWARD }), { start: 6, end: 9 });

  let keepGoing = true;
  const canceled = await findAllInTextAsync("x ".repeat(100) + "x", "x", {
    chunkSize: 12,
    shouldContinue: () => keepGoing,
    yieldControl: async () => { keepGoing = false; }
  });
  assert.equal(canceled.canceled, true);
  assert.ok(canceled.totalMatches > 0);
  assert.ok(canceled.totalMatches < 101);
});

test("table Find All renders current-document locations and selects the exact matching range", async () => {
  const doc = TableDocument.fromText("skills.txt", "Name\tDescription\nBash\tfirst bash\nZeal\tsecond bash");
  const harness = searchHarness({ doc, query: "bash" });

  assert.equal(await harness.controller.findAll(), 3);
  assert.equal(harness.summary.textContent, "3 results");
  assert.match(harness.results.innerHTML, /skills\.txt/);
  assert.match(harness.results.innerHTML, /Display row 2 · Name/);
  assert.match(harness.results.innerHTML, /Display row 3 · Description/);

  assert.equal(harness.controller.navigateToResult(2), true);
  assert.deepEqual(harness.selection.focus, { row: 2, column: 1 });
  assert.deepEqual(harness.calls.slice(-6), [
    ["save"],
    ["notify", "search-all-result"],
    ["scroll", 2, 1],
    ["draw"],
    ["problem"],
    ["range", 7, 11]
  ]);
});

test("Find All results become inert after document edits or condition changes", async () => {
  const doc = TableDocument.fromText("skills.txt", "Name\nBash");
  const harness = searchHarness({ doc, query: "bash" });
  await harness.controller.findAll();
  doc.setCell(1, 0, "Zeal");

  assert.equal(harness.controller.navigateToResult(0), false);
  assert.equal(harness.summary.textContent, "Results are outdated. Run Find All again.");
  assert.equal(harness.results.classList.contains("stale"), true);

  harness.searchInput.value = "zeal";
  assert.equal(await harness.controller.findAll(), 1);
  harness.controller.notifyDocumentChanged(doc);
  assert.equal(harness.controller.navigateToResult(0), false);
});

test("JSON Find uses the shared modal and Find All navigates exact editor offsets", async () => {
  const text = '{\n  "name": "bash",\n  "other": "bash"\n}';
  const doc = JsonDocument.fromText("skills.json", text);
  const snapshot = { text, from: 0, to: 0 };
  const harness = searchHarness({ doc, query: "bash", jsonSnapshot: snapshot });

  harness.controller.showSearch();
  assert.equal(harness.searchScope.classList.contains("hidden"), true);
  assert.equal(harness.searchInput.placeholder, "Search in current JSON document");
  assert.equal(await harness.controller.findAll(), 2);
  assert.match(harness.results.innerHTML, /Line 2, column 12/);
  assert.match(harness.results.innerHTML, /Line 3, column 13/);

  assert.equal(harness.controller.navigateToResult(1), true);
  assert.deepEqual(harness.jsonSelections, [{ start: 32, end: 36 }]);

  assert.deepEqual(harness.controller.findNext(), { start: 13, end: 17 });
  assert.deepEqual(harness.jsonSelections.at(-1), { start: 13, end: 17 });
  assert.deepEqual(harness.controller.findPrevious(), { start: 32, end: 36 });
});
