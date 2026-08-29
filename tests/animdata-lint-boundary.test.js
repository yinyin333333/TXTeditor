import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { installFakeAppStartupDom } from "./helpers/fake-dom-app-startup.mjs";

test("editing AnimData does not schedule Legacy Lint", async () => {
  const { document, window } = await startAnimDataApp("legacy", "legacy");

  window.__txteditorPerf.lintEngineEvents.length = 0;
  editActiveDocument(document);
  await waitFor(() => document.querySelector(".tab-dirty-dot"));

  assert.equal(
    window.__txteditorPerf.lintEngineEvents.some((event) => event.kind === "legacy-lint-scheduled"),
    false
  );
});

test("opening and editing AnimData sends no Vector document calls", async () => {
  const { document, nativeCalls } = await startAnimDataApp("vector-lsp", "vector");

  editActiveDocument(document);
  await waitFor(() => document.querySelector(".tab-dirty-dot"));

  assert.equal(
    nativeCalls.some(([command]) => command === "lsp_open_file" || command.startsWith("lsp_update_file")),
    false
  );
});

async function startAnimDataApp(engine, importKey) {
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const { document, window } = installFakeAppStartupDom({ indexHtml });
  const nativeCalls = [];
  localStorage.setItem("txteditor.lint.engine", engine);
  window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        nativeCalls.push([command, args]);
        if (command === "get_config") return {};
        if (command === "startup_open_paths") return ["E:\\Mod\\animdata.d2"];
        if (command === "take_pending_open_paths") return [];
        if (command === "read_text_files") {
          return [{
            Ok: {
              path: "E:\\Mod\\animdata.d2",
              name: "animdata.d2",
              text: "CofName\tFramesPerDirection\tAnimationSpeed\nA1NUHTH\t1\t256\n",
              encoding: "animdata-d2",
              size_bytes: 1184
            }
          }];
        }
        if (command === "lsp_reserve_generation") return 1;
        if (command === "load_lint_reference_dataset") {
          return {
            schemaVariant: "3.3",
            gameVersion: "3.3",
            canonicalSha256: "test",
            files: []
          };
        }
        return null;
      }
    },
    event: {
      TauriEvent: { DRAG_DROP: "tauri://drag-drop" },
      listen: async () => () => {}
    }
  };

  await import(`../src/app.js?animdataLintBoundary=${importKey}-${Date.now()}`);
  await waitFor(() => document.querySelector("[data-tab]"));
  return { document, window, nativeCalls };
}

function editActiveDocument(document) {
  const editButton = document.createElement("button");
  editButton.dataset.command = "clear-selection";
  for (const listener of document.listeners.get("click") ?? []) {
    listener({ target: editButton });
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("Timed out waiting for AnimData app state.");
}
