import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeMergeOutputNative } from "../src/core/io.js";

test("merge output facade sends the complete reviewed payload to the safe Tauri command", async () => {
  const calls = [];
  const result = await writeMergeOutputNative({
    outputPath: "C:\\mods\\merged",
    kind: "folder",
    files: [{ relativePath: "global/excel/skills.txt", text: "skill\tvalue\nx\t1\n", encoding: "utf-8" }],
    overwrite: true,
    protectedPaths: ["C:\\mods\\a", "C:\\mods\\b"]
  }, async (command, payload) => {
    calls.push([command, payload]);
    return { path: payload.outputPath, fileCount: payload.files.length };
  });
  assert.deepEqual(calls, [["write_merge_output_safe", {
    outputPath: "C:\\mods\\merged",
    kind: "folder",
    files: [{ relativePath: "global/excel/skills.txt", text: "skill\tvalue\nx\t1\n", encoding: "utf-8" }],
    overwrite: true,
    protectedPaths: ["C:\\mods\\a", "C:\\mods\\b"]
  }]]);
  assert.deepEqual(result, { path: "C:\\mods\\merged", fileCount: 1 });
});

test("native folder publishing is staged, path-safe, and protects both nesting directions", () => {
  const rust = readFileSync(new URL("../src-tauri/src/merge_output.rs", import.meta.url), "utf8");
  assert.match(rust, /write_staged_files\(&stage, &files\)/);
  assert.match(rust, /fs::rename\(&stage, target\)/);
  assert.match(rust, /Component::ParentDir \| Component::RootDir \| Component::Prefix\(_\)/);
  assert.match(rust, /path_is_descendant\(&target_identity, &protected_identity\)/);
  assert.match(rust, /path_is_descendant\(&protected_identity, &target_identity\)/);
  assert.match(rust, /resolve_path_identity/);
  assert.match(rust, /output_containing_input_folder_is_rejected/);
});
