import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  listenForNativeOpenPaths,
  startupOpenPathsNative,
  takePendingOpenPathsNative
} from "../src/core/platform/file-io.js";

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

test("forwarded single-instance paths use the same payload filtering", async () => {
  const calls = [];
  const paths = await takePendingOpenPathsNative(async (command, args) => {
    calls.push({ command, args });
    return ["C:\\Mods\\skills.txt", null, "", 3];
  });

  assert.deepEqual(calls, [{ command: "take_pending_open_paths", args: undefined }]);
  assert.deepEqual(paths, ["C:\\Mods\\skills.txt"]);
});

test("native open listener drains queued launches and keeps drag-drop delivery", async () => {
  const originalWindow = globalThis.window;
  const handlers = new Map();
  const unlistened = [];
  const pending = [
    ["C:\\Mods\\first.txt"],
    ["C:\\Mods\\second.txt"]
  ];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command) => command === "take_pending_open_paths"
          ? pending.shift() ?? []
          : []
      },
      event: {
        listen: async (name, handler) => {
          handlers.set(name, handler);
          return () => unlistened.push(name);
        },
        TauriEvent: { DRAG_DROP: "tauri://drag-drop" }
      }
    }
  };
  const opened = [];

  try {
    const unlisten = await listenForNativeOpenPaths(async (paths) => opened.push(paths));
    await handlers.get("single-instance-open-paths")({});
    await handlers.get("tauri://drag-drop")({ payload: { paths: ["C:\\Mods\\third.txt"] } });
    unlisten();

    assert.deepEqual(opened, [
      ["C:\\Mods\\first.txt"],
      ["C:\\Mods\\second.txt"],
      ["C:\\Mods\\third.txt"]
    ]);
    assert.deepEqual(unlistened.sort(), ["single-instance-open-paths", "tauri://drag-drop"]);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("app startup forwards launch paths through the existing native document lifecycle", () => {
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const rust = readFileSync(new URL("../src-tauri/src/launch_paths.rs", import.meta.url), "utf8");
  const rustLib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

  assert.match(app, /startupOpenPathsNative\(\)/);
  assert.match(app, /\.then\(\(paths\) => openDroppedNativePaths\(paths\)\)/);
  assert.match(app, /listenForNativeOpenPaths\(\(paths\) => openDroppedNativePaths\(paths\), showError\)/);
  assert.match(rust, /std::env::args_os\(\)/);
  assert.match(rust, /\.skip\(1\)/);
  assert.match(rust, /extension\.eq_ignore_ascii_case\(candidate\)/);
  assert.match(rustLib, /launch_paths::startup_open_paths,/);
  assert.match(rustLib, /tauri_plugin_single_instance::init/);
  assert.match(rustLib, /launch_paths::take_pending_open_paths,/);
  assert.ok(
    rustLib.indexOf("tauri_plugin_single_instance::init")
      < rustLib.indexOf("tauri_plugin_dialog::init")
  );
});
