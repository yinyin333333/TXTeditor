import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { lspRangeToJsonOffsets } from "../src/core/json-document.js";

test("JSON diagnostic navigation uses CodeMirror offsets for CRLF documents", () => {
  const rawText = "\u{feff}[\r\n  {\"Key\":\"first\"},\r\n  {\"Key\":\"??\"}\r\n]\r\n";
  const editorText = rawText.replaceAll("\r\n", "\n");
  const range = {
    start: { line: 2, character: 10 },
    end: { line: 2, character: 12 }
  };
  const expectedStart = editorText.indexOf("??");

  assert.deepEqual(lspRangeToJsonOffsets(editorText, range), {
    start: expectedStart,
    end: expectedStart + 2
  });
  assert.deepEqual(lspRangeToJsonOffsets(rawText, range), {
    start: expectedStart + 2,
    end: expectedStart + 4
  });

  const controllerSource = readFileSync(
    new URL("../src/ui/controllers/json-editor-controller.js", import.meta.url),
    "utf8"
  );
  assert.match(
    controllerSource,
    /lspRangeToJsonOffsets\(\s*view\.state\.doc\.toString\(\),\s*range\s*\)/
  );
  assert.doesNotMatch(controllerSource, /lspRangeToJsonOffsets\(doc\.text, range\)/);
});
