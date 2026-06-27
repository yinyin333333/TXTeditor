import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { TableDocument } from "../src/core/table-model.js";
import { findInTable } from "../src/core/search.js";
import { makeCellCommand, UndoManager } from "../src/core/undo.js";

const size = Number(process.argv[2] ?? 20000);
const sizeLabel = size % 1000 === 0 ? `${size / 1000}k` : String(size);
const fixtureName = `d2_${sizeLabel}.tsv`;
const fixture = join(process.cwd(), "fixtures", fixtureName);
if (!existsSync(fixture)) {
  const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", "generate-fixture.js"), String(size)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const text = readFileSync(fixture, "utf8");

const t0 = performance.now();
const doc = TableDocument.fromText(fixtureName, text);
const t1 = performance.now();

const renderReady = estimateVisibleCells(doc, { width: 1500, height: 900, scrollTop: 0, scrollLeft: 0 });
const tRender = performance.now();

const scrollProbe = estimateVisibleCells(doc, { width: 1500, height: 900, scrollTop: Math.max(0, (doc.rowCount - 100) * 26), scrollLeft: 0 });
const tScroll = performance.now();

const found = findInTable(doc, `Generated Row ${size - 1}`, { row: 0, column: 0 });
const t2 = performance.now();

const undo = new UndoManager();
const editStart = performance.now();
const command = makeCellCommand("Perf Edit", doc, [{ row: Math.min(size - 1, doc.rowCount - 1), column: 2, value: "Edited" }]);
doc.applyCellChanges(command.changes, "after");
undo.push(command);
undo.undo(doc);
undo.redo(doc);
const t3 = performance.now();

mkdirSync(join(process.cwd(), "tmp"), { recursive: true });
writeFileSync(join(process.cwd(), "tmp", `d2_${sizeLabel}.saved.tsv`), doc.toText(), "utf8");
const t4 = performance.now();

console.log(JSON.stringify({
  rows: doc.rowCount,
  columns: doc.columnCount,
  found,
  parseMs: Math.round(t1 - t0),
  initialRenderReadinessMs: Math.round(tRender - t1),
  initialVisibleCells: renderReady.cells,
  scrollResponsivenessMs: Math.round(tScroll - tRender),
  scrolledVisibleCells: scrollProbe.cells,
  searchMs: Math.round(t2 - tScroll),
  singleCellEditMs: Math.round(t3 - editStart),
  editUndoRedoMs: Math.round(t3 - t2),
  saveSerializeMs: Math.round(t4 - t3)
}, null, 2));

function estimateVisibleCells(doc, viewport) {
  const rowHeight = 26;
  const headerHeight = 28;
  const firstRow = Math.max(0, Math.floor((viewport.scrollTop - headerHeight) / rowHeight) - 4);
  const visibleRows = Math.min(doc.rowCount - firstRow, Math.ceil(viewport.height / rowHeight) + 10);
  let width = 58;
  let visibleColumns = 0;
  for (let column = 0; column < doc.columnCount && width < viewport.width + 300; column++) {
    width += doc.columnWidths[column] ?? 120;
    visibleColumns++;
  }
  return { rows: visibleRows, columns: visibleColumns, cells: visibleRows * visibleColumns };
}
