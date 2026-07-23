import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("JSON editor routes Ctrl-g to the singleton go-to-line command before the search keymap", () => {
  const source = readFileSync(
    new URL("../src/ui/codemirror-json-editor-entry.js", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /import\s*\{[\s\S]*?\bgotoLine\b[\s\S]*?\}\s*from "@codemirror\/search";/
  );
  assert.match(
    source,
    /function openJsonGotoLine\(view\) \{[\s\S]*?gotoLine\(view\);[\s\S]*?\}/
  );

  const goToLineBinding = source.indexOf('{ key: "Ctrl-g", run: openJsonGotoLine }');
  const searchKeymap = source.indexOf("...searchKeymap");
  assert.notEqual(goToLineBinding, -1, "the JSON editor must bind Ctrl-g to the singleton wrapper");
  assert.notEqual(searchKeymap, -1, "the search keymap must remain installed");
  assert.ok(
    goToLineBinding < searchKeymap,
    "the explicit Ctrl-g binding must precede searchKeymap's Mod-g find-next binding"
  );
});
