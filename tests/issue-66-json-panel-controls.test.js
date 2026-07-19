import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/ui/codemirror-json-editor-entry.js", import.meta.url),
  "utf8"
);

test("JSON search and go-to-line panels use TXTeditor UI sizing", () => {
  assert.ok(source.includes("fontFamily: '\"Segoe UI\", Arial, sans-serif'"));
  assert.match(
    source,
    /"\.cm-panels": \{[\s\S]*?fontSize: "13px"/
  );
  assert.match(
    source,
    /"\.cm-panel \.cm-textfield": \{[\s\S]*?height: "28px"/
  );
  assert.match(
    source,
    /"\.cm-panel label": \{[\s\S]*?fontSize: "13px"/
  );
  assert.match(
    source,
    /"\.cm-panel button": \{[\s\S]*?minHeight: "28px"/
  );
});

test("JSON panel keyboard handling closes panels and restores editor focus", () => {
  assert.match(source, /ViewPlugin\.fromClass/);
  assert.match(
    source,
    /addEventListener\("keydown", this\.handleKeydown, true\)/
  );
  assert.match(
    source,
    /removeEventListener\("keydown", this\.handleKeydown, true\)/
  );
  assert.match(
    source,
    /event\.key !== "Escape"[\s\S]*?isRepeatedJsonPanelShortcut/
  );
  assert.match(source, /closeSearchPanel\(view\)/);
  assert.match(source, /querySelector\("\.cm-dialog-close"\)/);
  assert.match(source, /view\.focus\(\)/);
});

test("JSON go-to-line reuses an existing dialog before invoking CodeMirror", () => {
  assert.match(
    source,
    /function focusOpenJsonGotoLine\(view\) \{[\s\S]*?\.cm-dialog input\[name='line'\][\s\S]*?input\.focus\(\);[\s\S]*?input\.select\(\);/
  );
  assert.match(
    source,
    /function openJsonGotoLine\(view\) \{\s*if \(focusOpenJsonGotoLine\(view\)\) return true;\s*const opened = gotoLine\(view\);/
  );
  assert.match(source, /\{ key: "Ctrl-g", run: openJsonGotoLine \}/);
  assert.match(source, /\{ key: "Mod-Alt-g", run: openJsonGotoLine \}/);
});
