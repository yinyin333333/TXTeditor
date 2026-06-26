import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isTextLikeFile,
  isTextLikePath
} from "../src/core/text-file-policy.js";
import { createCommandController } from "../src/ui/controllers/command-controller.js";
import { renderWorkspaceFileList } from "../src/ui/workspace-file-list-policy.js";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pathKey(path) {
  return String(path || "").replace(/\\/g, "/").toLowerCase();
}

test("workspace Explorer rendering preserves open-file suppression, grouping, badges, and escaping", () => {
  const workspace = {
    path: "E:/Game/Data",
    files: [
      { name: "armor.txt", path: "E:/Game/Data/armor.txt" },
      { name: "weapons.txt", path: "E:/Game/Data/weapons.txt" },
      { name: "skills<bad>.txt", path: "E:/Game/Data/skills<bad>.txt" },
      { name: "fallen.txt", path: "E:/Game/Data/monsters/fallen.txt" },
      { name: "quote.txt", path: "E:/Game/Data/quoted\"dir/quote.txt" }
    ]
  };
  const docs = [{ name: "armor.txt", path: "E:/Game/Data/armor.txt" }];
  const html = renderWorkspaceFileList({
    workspace,
    docs,
    collapsedFileGroups: new Set(["monsters"]),
    pathKey,
    escapeHtml,
    problemBadgeForPath: (path) => path.endsWith("weapons.txt") ? ` <span class="file-problem-badge">2</span>` : ""
  });

  assert.doesNotMatch(html, /data-open-path="E:\/Game\/Data\/armor\.txt"/);
  assert.match(html, /<details class="file-group" open data-file-group="Data Files">/);
  assert.match(html, /data-open-path="E:\/Game\/Data\/weapons\.txt">weapons\.txt <span class="file-problem-badge">2<\/span>/);
  assert.match(html, /data-open-path="E:\/Game\/Data\/skills&lt;bad&gt;\.txt">skills&lt;bad&gt;\.txt/);
  assert.match(html, /<details class="file-group" data-file-group="monsters">/);
  assert.match(html, /data-file-group="quoted&quot;dir"/);
  assert.ok(html.indexOf("Data Files") < html.indexOf("monsters"));
  assert.ok(html.indexOf("monsters") < html.indexOf("quoted&quot;dir"));
});

test("text-like path policy is shared by document loading and legacy workspace lint", () => {
  assert.equal(isTextLikePath("E:/Game/Data/armor.TXT"), true);
  assert.equal(isTextLikePath("skills.tsv"), true);
  assert.equal(isTextLikePath("levels.tbl"), true);
  assert.equal(isTextLikePath("inventory.csv"), true);
  assert.equal(isTextLikePath("notes.txt.bak"), false);
  assert.equal(isTextLikePath("config.json"), false);
  assert.equal(isTextLikeFile({ name: "misc.CSV" }), true);

  const documentController = readFileSync(new URL("../src/ui/controllers/document-controller.js", import.meta.url), "utf8");
  const legacyLintController = readFileSync(new URL("../src/ui/controllers/legacy-lint-controller.js", import.meta.url), "utf8");
  assert.match(documentController, /core\/text-file-policy\.js/);
  assert.match(legacyLintController, /core\/text-file-policy\.js/);
  assert.doesNotMatch(documentController, /function isTextLikePath/);
  assert.doesNotMatch(legacyLintController, /function isTextLikePath/);
});

test("Explorer, Problems, and sidebar commands dispatch to available handlers without an open document", () => {
  const calls = [];
  const controller = createCommandController({
    isDevelopmentMode: false,
    state: { selection: { rect: { top: 0, bottom: 0, left: 0, right: 0 } } },
    activeDoc: () => ({}),
    hasOpenDocument: () => false,
    execute: () => calls.push("execute"),
    rowsFromSelection: () => [],
    columnsFromSelection: () => [],
    showError: (message) => calls.push(`error:${message}`),
    handlers: {
      toggleExplorerPane: () => calls.push("explorer"),
      toggleProblemsPanel: () => calls.push("problems"),
      toggleSidebar: () => calls.push("sidebar")
    }
  });

  controller.runCommand("show-explorer");
  controller.runCommand("show-problems");
  controller.runCommand("toggle-sidebar");
  assert.deepEqual(calls, ["explorer", "problems", "sidebar"]);
});
