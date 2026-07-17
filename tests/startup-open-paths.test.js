import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { startupOpenPathsNative } from "../src/core/platform/file-io.js";

test("native startup paths preserve Windows spaces and non-ASCII characters", async () => {
  const expected = [
    "C:\\D2 Mods\\My Mod\\monstats.txt",
    "C:\\모드\\데이터\\아이템.TXT"
  ];
  const calls = [];

  const paths = await startupOpenPathsNative(async (command, args) => {
    calls.push({ command, args });
    return expected;
  });

  assert.deepEqual(calls, [{ command: "startup_open_paths", args: undefined }]);
  assert.deepEqual(paths, expected);
});

test("malformed native startup payloads are ignored", async () => {
  assert.deepEqual(await startupOpenPathsNative(async () => null), []);
  assert.deepEqual(await startupOpenPathsNative(async () => ["a.txt", null, 3, ""]), ["a.txt"]);
});

test("app startup forwards launch paths through the existing native document lifecycle", () => {
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const rust = readFileSync(new URL("../src-tauri/src/launch_paths.rs", import.meta.url), "utf8");
  const rustLib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

  assert.match(app, /startupOpenPathsNative\(\)/);
  assert.match(app, /\.then\(\(paths\) => openDroppedNativePaths\(paths\)\)/);
  assert.match(rust, /std::env::args_os\(\)/);
  assert.match(rust, /\.skip\(1\)/);
  assert.match(rust, /extension\.eq_ignore_ascii_case\(candidate\)/);
  assert.match(rustLib, /launch_paths::startup_open_paths,/);
});
