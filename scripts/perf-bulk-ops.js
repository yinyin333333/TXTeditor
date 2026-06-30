import { performance } from "node:perf_hooks";
import { addColumnsCommand, addRowsCommand } from "../src/core/operations.js";
import { TableDocument } from "../src/core/table-model.js";

const options = parseArgs(process.argv.slice(2));
const rows = numberOption(options, "rows", 10000);
const cols = numberOption(options, "cols", 8);
const addRows = numberOption(options, "add-rows", 0);
const addCols = numberOption(options, "add-cols", 0);
const hideRows = numberOption(options, "hide-rows", 0);

const parseStarted = performance.now();
const doc = TableDocument.fromText("perf.txt", fixtureText(rows, cols), { dirty: false, autoFitInitialColumns: false });
const parseMs = elapsed(parseStarted);
const counters = instrumentDocument(doc);

let viewToTextCalls = 0;
let dirtyAfterViewCommands = false;
let addRowsMs = 0;
let addColumnsMs = 0;
let hiddenStateAddRowsMs = 0;

if (hideRows > 0) {
  const beforeToText = counters.toText;
  doc.setRowsHidden([[0, Math.min(hideRows, doc.rowCount) - 1]], true);
  viewToTextCalls = counters.toText - beforeToText;
  dirtyAfterViewCommands = doc.dirty;
}

if (addRows > 0) {
  const started = performance.now();
  addRowsCommand(doc, addRows).redo(doc);
  addRowsMs = elapsed(started);
  if (hideRows > 0) hiddenStateAddRowsMs = addRowsMs;
}

if (addCols > 0) {
  const started = performance.now();
  addColumnsCommand(doc, addCols).redo(doc);
  addColumnsMs = elapsed(started);
}

const report = {
  rows,
  cols,
  addRows,
  addCols,
  hideRows,
  parseMs,
  addRowsMs,
  addColumnsMs,
  hiddenStateAddRowsMs,
  dirtyAfterViewCommands,
  refreshShapeCalls: counters.refreshShape,
  insertRowsCalls: counters.insertRows,
  insertColumnsCalls: counters.insertColumns,
  toTextCalls: counters.toText,
  viewToTextCalls,
  peakHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
};

assertCounters(report);
console.log(JSON.stringify(report, null, 2));

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    parsed[key] = next && !next.startsWith("--") ? args[++index] : true;
  }
  return parsed;
}

function numberOption(options, key, fallback) {
  const value = Number(options[key] ?? fallback);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function fixtureText(rowCount, columnCount) {
  const header = Array.from({ length: columnCount }, (_, index) => `Column${index + 1}`).join("\t");
  const body = Array.from({ length: columnCount }, (_, index) => String(index + 1)).join("\t");
  return [header, ...Array.from({ length: Math.max(0, rowCount - 1) }, () => body)].join("\n");
}

function instrumentDocument(doc) {
  const counters = { refreshShape: 0, insertRows: 0, insertColumns: 0, toText: 0 };
  for (const method of Object.keys(counters)) {
    const original = doc[method].bind(doc);
    doc[method] = (...args) => {
      counters[method] += 1;
      return original(...args);
    };
  }
  return counters;
}

function elapsed(started) {
  return Math.round((performance.now() - started) * 100) / 100;
}

function assertCounters(report) {
  if (report.addRows > 0 && report.insertRowsCalls !== 1) throw new Error("Expected bulk row add to call insertRows once.");
  if (report.addCols > 0 && report.insertColumnsCalls !== 1) throw new Error("Expected bulk column add to call insertColumns once.");
  if (report.refreshShapeCalls > Number(report.addRows > 0) + Number(report.addCols > 0)) {
    throw new Error("Expected at most one refreshShape call per bulk structural operation.");
  }
  if (report.viewToTextCalls !== 0) throw new Error("View-only operations should not call toText.");
  if (report.dirtyAfterViewCommands) throw new Error("View-only operations should not mark the document dirty.");
}
