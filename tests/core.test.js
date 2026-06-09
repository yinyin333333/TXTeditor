import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TableDocument } from "../src/core/table-model.js";
import { SelectionModel } from "../src/core/selection.js";
import { findInTable } from "../src/core/search.js";
import { UndoManager, makeCellCommand } from "../src/core/undo.js";
import { copyRange, pasteTextCommand } from "../src/core/operations.js";
import { movedCell, shouldDrawCellText, shouldShowFirstColumnHover } from "../src/ui/canvas-grid.js";
import { boundedTableExtent, classifyGridHit, classifyPanePoint, classifyResizeHandle, columnColorIndex } from "../src/ui/grid-geometry.js";
import { diagnosticsForDocument, groupDiagnosticsByCell } from "../src/core/diagnostics.js";

test("parses and serializes TSV while preserving CRLF and final newline", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\r\n1\t2\r\n");
  assert.equal(doc.rowCount, 2);
  assert.equal(doc.columnCount, 2);
  assert.equal(doc.lineEnding, "\r\n");
  assert.equal(doc.finalNewline, true);
  assert.equal(doc.toText(), "a\tb\r\n1\t2\r\n");
});

test("initial column sizing is compact and header-first", () => {
  const doc = TableDocument.fromText("x.txt", "very_long_header_name\tb\nshort\tmedium_content\nshort\t" + "x".repeat(200));
  assert.ok(doc.columnWidths[0] > 160);
  assert.ok(doc.columnWidths[1] <= 64);
});

test("cell commands undo and redo without full table snapshots", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\n1\t2");
  const undo = new UndoManager();
  const command = makeCellCommand("Edit", doc, [{ row: 1, column: 1, value: "42" }]);
  doc.applyCellChanges(command.changes, "after");
  undo.push(command);
  assert.equal(doc.getCell(1, 1), "42");
  undo.undo(doc);
  assert.equal(doc.getCell(1, 1), "2");
  undo.redo(doc);
  assert.equal(doc.getCell(1, 1), "42");
});

test("selection supports ranges, toggles, and select all", () => {
  const selection = new SelectionModel();
  selection.set(1, 1);
  selection.extend(3, 4);
  assert.deepEqual(selection.rect, { top: 1, left: 1, bottom: 3, right: 4 });
  selection.toggleCell(6, 2);
  assert.equal(selection.ranges.length, 2);
  selection.selectAll(10, 8);
  assert.deepEqual(selection.rect, { top: 0, left: 0, bottom: 9, right: 7 });
});

test("search wraps and can match first-row header cells", () => {
  const doc = TableDocument.fromText("skills.txt", "skill\tcharclass\nFire Bolt\tsor\nIce Bolt\tsor");
  assert.deepEqual(findInTable(doc, "charclass", { row: 0, column: 0 }), { row: 0, column: 1 });
  assert.deepEqual(findInTable(doc, "fire", { row: 2, column: 1 }), { row: 1, column: 0 });
});

test("copy and paste preserve tabular shape", () => {
  const doc = TableDocument.fromText("x.txt", "a\tb\tc\n1\t2\t3\n4\t5\t6");
  assert.equal(copyRange(doc, { top: 1, left: 0, bottom: 2, right: 1 }), "1\t2\n4\t5");
  pasteTextCommand(doc, { row: 1, column: 1 }, "x\ty\nz\tw").redo(doc);
  assert.equal(doc.getCell(1, 1), "x");
  assert.equal(doc.getCell(2, 2), "w");
});

test("grid geometry handles frozen panes and resize edges", () => {
  assert.equal(columnColorIndex(9, 5), 4);
  assert.equal(boundedTableExtent({ fixedExtent: 40, scrollableExtent: 80, scrollOffset: 20, viewportExtent: 200 }), 100);
  assert.equal(classifyPanePoint({ x: 20, y: 20, rowHeaderWidth: 38, headerHeight: 0, frozenColumnWidth: 72, frozenRowHeight: 26 }), "row-header");
  assert.equal(classifyGridHit({ pane: "frozen-row", row: 0, column: 2, x: 120, y: 10 }).kind, "cell");
  assert.deepEqual(
    classifyResizeHandle({
      hit: { kind: "cell", row: 5, column: 2, x: 198, y: 122 },
      columnRight: 200,
      rowBottom: 148,
      zoom: 1
    }),
    { kind: "column", index: 2 }
  );
  assert.deepEqual(
    classifyResizeHandle({
      hit: { kind: "cell", row: 5, column: 2, x: 150, y: 147 },
      columnRight: 200,
      rowBottom: 148,
      zoom: 1
    }),
    { kind: "row", index: 5 }
  );
});

test("canvas helpers gate hover and stale editor text", () => {
  assert.deepEqual(movedCell({ row: 2, column: 2 }, -10, 3, 5, 4), { row: 0, column: 3 });
  assert.equal(shouldDrawCellText(1, 1, { row: 1, column: 1 }), false);
  assert.equal(shouldDrawCellText(1, 1, { row: 1, column: 2 }), true);
  assert.equal(shouldShowFirstColumnHover({ kind: "cell", row: 2, column: 0 }, "code"), true);
  assert.equal(shouldShowFirstColumnHover({ kind: "cell", row: 2, column: 1 }, "code"), false);
});

test("diagnostic helpers group cells and filter by document", () => {
  const doc = TableDocument.fromText("armor.txt", "code\ncap", { path: "excel/armor.txt" });
  const diagnostics = [
    { id: "one", fileKey: "excel/armor.txt", rowIndex: 1, columnIndex: 0, severity: "warning", message: "one" },
    { id: "cell", fileKey: "excel/armor.txt", rowIndex: 1, columnIndex: 2, severity: "error", message: "cell" },
    { id: "two", fileKey: "excel/misc.txt", rowIndex: 1, columnIndex: 0, severity: "error", message: "two" }
  ];
  assert.equal(groupDiagnosticsByCell(diagnostics).get("1:0").length, 2);
  assert.equal(groupDiagnosticsByCell(diagnostics).get("1:2").length, 1);
  assert.deepEqual(diagnosticsForDocument(diagnostics, doc), [diagnostics[0], diagnostics[1]]);
});

test("app batches vector-lsp diagnostics without per-event fetches", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const io = readFileSync(new URL("../src/core/io.js", import.meta.url), "utf8");
  const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(source, /const pendingLspDiagnostics = new Map\(\)/);
  assert.match(source, /function handleLspDiagnosticsChanged\(payload\)/);
  assert.match(source, /function applyDiagnosticsSnapshot\(payload\)/);
  assert.match(source, /Array\.isArray\(payload\?\.entries\)/);
  assert.match(source, /function diagnosticsActive\(\)/);
  assert.match(source, /lspStop\(\)\.catch/);
  assert.match(source, /state\.lsp\.diagnosticsStats\.frontendFlushes \+= 1/);
  assert.match(source, /function shouldOpenDocDuringWorkspaceStartup\(doc, workspacePath\)/);
  assert.match(source, /return !workspaceScanCoversDoc\(doc, workspacePath\)/);
  assert.match(source, /pendingLspDiagnostics\.set\(uri, Array\.isArray\(diagnostics\) \? diagnostics : \[\]\)/);
  assert.match(source, /state\.lsp\.diagnosticsStartup/);
  assert.match(source, /state\.lsp\.diagnosticsComplete/);
  assert.match(source, /function hasReusableDiagnosticsSnapshot\(workspacePath\)/);
  assert.match(source, /state\.lint\.workspaceKey === lintPathKey\(workspacePath\)/);
  assert.match(source, /function hideDiagnosticsSession\(\)/);
  assert.match(source, /if \(state\.lsp\.diagnosticsStartup \|\| !state\.lsp\.diagnosticsComplete\)/);
  assert.match(source, /if \(diagnosticsFlushTimer\) clearTimeout\(diagnosticsFlushTimer\)/);
  assert.match(source, /diagnosticCountForFileKey\(key\)/);
  assert.match(io, /lsp-diagnostics-initial-snapshot/);
  assert.match(rust, /struct LspDiagnosticsSnapshotPayload/);
  assert.match(rust, /const INITIAL_DIAGNOSTICS_IDLE_MS: u64 = 150/);
  assert.match(rust, /expected_file_count/);
  assert.match(rust, /count_workspace_diagnostic_files/);
  assert.match(rust, /buffer\.entries\.len\(\) >= buffer\.expected_file_count/);
  assert.match(rust, /app\.emit\("lsp-diagnostics-initial-snapshot"/);
  assert.doesNotMatch(source, new RegExp(["lspGet", "Diagnostics"].join("")));
});

test("settings owns immediate display options in the toolbar", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const toolbar = html.match(/<section class="toolbar">([\s\S]*?)<\/section>/)?.[1] ?? "";
  assert.match(toolbar, /data-command="open-settings">Settings/);
  assert.doesNotMatch(toolbar, /toggle-colorize|fontSelect|toggle-theme/);
  assert.match(html, /data-command="open-lint-options" title="Lint options">Lint Options/);
  assert.match(source, /txteditor\.colorize/);
  assert.match(source, /txteditor\.vectorLspHover/);
  assert.match(source, /txteditor\.gridFont/);
  assert.match(source, /txteditor\.theme/);
  assert.match(source, /id="settingsColorize"/);
  assert.match(source, /id="settingsVectorLspHover"/);
  assert.match(source, /id="settingsFont"/);
  assert.match(source, /data-settings-theme="dark"/);
  const settingsBody = source.slice(source.indexOf("function showSettings"), source.indexOf("function saveLintSettings"));
  assert.doesNotMatch(settingsBody, new RegExp([
    ["LSP", "Options"].join(" "),
    ["Schema", "Version"].join(" "),
    "Debug",
    ["Restart", "LSP"].join(" "),
    ["data", "settings", "choice"].join("-"),
    ["settings", "tab"].join("-")
  ].join("|")));
  assert.doesNotMatch(settingsBody, />Save<|>Cancel</);
  assert.match(source, /function showLintOptions\(\)/);
  assert.match(source, /id="schemaVersion"/);
  assert.match(source, /id="pluginPath"/);
  assert.match(source, /id="debugLogging"/);
});

test("Vector-LSP hover defaults off and is gated before frontend requests", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const grid = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  assert.match(source, /localStorage\.getItem\("txteditor\.vectorLspHover"\) === "on"/);
  assert.match(source, /if \(!state\.vectorLspHover\) return;/);
  assert.match(source, /requestGeneration !== lspHoverGeneration/);
  assert.match(source, /clearLspHoverState\(\)/);
  assert.match(grid, /setVectorLspHoverEnabled\(enabled\)/);
  assert.match(grid, /if \(!this\.vectorLspHoverEnabled\) return;/);
  assert.match(grid, /updateFirstColumnHoverPreview\(hit, event\)/);
  assert.match(grid, /this\.vectorLspHoverEnabled \? this\._lspHoverByCell\.get/);
});

test("active row and header-column highlights are real canvas colors", () => {
  const grid = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(grid, /activeHeader = this\.selection\.focus\.row === row/);
  assert.match(grid, /activeColumnHeaderCell = row === 0 && this\.selection\.focus\.column === column/);
  assert.match(grid, /activeHeaderCell\) return GRID_COLORS\.activeHeader/);
  assert.match(css, /--activeHeaderBg:\s*var\(--selectionBg\)/);
  assert.match(css, /--grid-active-header-bg:\s*var\(--activeHeaderBg\)/);
});

test("top tabs stay neutral while cell markers are active-only diagnostics", () => {
  const grid = readFileSync(new URL("../src/ui/canvas-grid.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(grid, /drawDiagnosticMarker\(row, column, x, y, width, height\)/);
  assert.match(grid, /this\.diagnosticsByCell\.get\(`\$\{row\}:\$\{column\}`\)/);
  assert.match(app, /function resolveDiagnosticColumn\(doc, row, diagnostic\)/);
  assert.match(app, /function diagnosticCharacterToColumn\(doc, row, character, fallback = 0\)/);
  assert.match(app, /const character = maybeDiagnosticNumber\(diagnostic\?\.character\)/);
  assert.match(app, /columnIndex: col/);
  assert.match(app, /character,\s+endCharacter,/);
  assert.match(app, /if \(!diagnosticsActive\(\)\) \{\s*grid\.setDiagnostics\(new Map\(\)\)/);
  assert.match(app, /function updateOverviewRuler\(\)/);
  assert.match(app, /if \(!diagnosticsActive\(\) \|\| !diags\.length \|\| !rowCount\)/);
  assert.match(app, /<span class="tab-title">/);
  assert.doesNotMatch(app, /tab-title-\$\{sev\}|docDiagnosticSeverity\(doc\)/);
  assert.doesNotMatch(css, /tab-title-error|tab-title-warning/);
});

test("Rust LSP bridge emits diagnostic snapshots and skips empty file reads", () => {
  const source = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(source, /struct LspDiagnosticsChangedPayload/);
  assert.match(source, /session_id: u64/);
  assert.match(source, /diagnostics: Vec<LspDiagnostic>/);
  assert.match(source, /character: u32/);
  assert.match(source, /end_character: u32/);
  assert.match(source, /struct LspDiagnosticsSnapshotPayload/);
  assert.match(source, /struct LspStartResult/);
  assert.match(source, /if raw\.is_empty\(\)\s*\{\s*Vec::new\(\)/);
  assert.match(source, /let character = d\["range"\]\["start"\]\["character"\]/);
  assert.match(source, /end_character/);
  assert.match(source, /app\.emit\("lsp-diagnostics-initial-snapshot", payload\)/);
  assert.match(source, /fn lsp_stop/);
  assert.match(source, /if debug_logging && !trimmed\.is_empty\(\)/);
});

test("app metadata is bumped to version 0.4.0", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const tauri = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const cargoToml = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
  const cargoLock = readFileSync(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.equal(pkg.version, "0.4.0");
  assert.equal(lock.version, "0.4.0");
  assert.equal(lock.packages[""].version, "0.4.0");
  assert.equal(tauri.version, "0.4.0");
  assert.match(cargoToml, /version = "0\.4\.0"/);
  assert.match(cargoLock, /name = "txteditor"\s+version = "0\.4\.0"/);
  assert.match(readme, /TXTeditor 0\.4 is/);
});

test("legacy embedded lint engine and comparison scripts are no longer shipped", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.equal(["lint", "compare"].join(":") in pkg.scripts, false);
  assert.doesNotMatch(app, new RegExp([
    ["lint", "engine"].join("-"),
    ["run", "Lint"].join(""),
    ["LINT", "RULES"].join("_"),
    ["createDefault", "LintSettings"].join("")
  ].join("|")));
  assert.throws(() => readFileSync(new URL(["../src/core/lint", "engine.js"].join("-"), import.meta.url), "utf8"));
  assert.throws(() => readFileSync(new URL(["../scripts/lint", "compare.js"].join("-"), import.meta.url), "utf8"));
});
