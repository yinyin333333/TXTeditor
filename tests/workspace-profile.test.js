import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceProfile, parseWorkspaceProfile, workspaceProfilePath } from "../src/core/workspace-profile.js";
import { renderWorkspaceFileList } from "../src/ui/workspace-file-list-policy.js";

test("workspace profiles round-trip ordered files, active file and hidden files with relative paths", () => {
  const profile = createWorkspaceProfile({
    workspace: { path: "D:\\Mod" },
    docs: [{ path: "D:\\Mod\\skills.txt" }, { path: "D:/Mod/sub/missiles.txt" }, { path: "D:/Other/test.txt" }, {}],
    active: 1,
    workspaceHiddenFiles: ["D:\\Mod\\charstats.txt"]
  });
  assert.deepEqual(parseWorkspaceProfile(`\uFEFF${JSON.stringify(profile)}`), {
    version: 1, folder: "D:\\Mod", openFiles: ["skills.txt", "sub/missiles.txt"],
    activeFile: "sub/missiles.txt", hiddenFiles: ["charstats.txt"]
  });
  assert.equal(workspaceProfilePath("D:\\Mod\\", "sub/a.txt"), "D:\\Mod/sub/a.txt");
});

test("invalid profiles and escaping file paths are rejected before session changes", () => {
  const base = { version: 1, folder: "D:/Mod", openFiles: [], activeFile: null, hiddenFiles: [] };
  for (const patch of [{ version: 2 }, { folder: "relative" }, { openFiles: null },
    { openFiles: ["../escape.txt"] }, { hiddenFiles: ["a/../../b.txt"] },
    { openFiles: ["C:/outside.txt"] }, { openFiles: ["/outside.txt"] },
    { openFiles: ["a\0.txt"] }, { activeFile: "missing.txt" }]) {
    assert.throws(() => parseWorkspaceProfile(JSON.stringify({ ...base, ...patch })));
  }
  assert.throws(() => createWorkspaceProfile({ docs: [] }));
});

test("Explorer hiding changes only rendered rows and can reveal hidden files for restoration", () => {
  const workspace = { path: "D:/Mod", files: [
    { name: "skills.txt", path: "D:/Mod/skills.txt" },
    { name: "missiles.txt", path: "D:/Mod/missiles.txt" }
  ] };
  const original = structuredClone(workspace);
  const options = { workspace, hiddenFiles: ["d:\\mod\\skills.txt"], escapeHtml: (s) => s, problemBadgeForPath: () => "" };
  assert.doesNotMatch(renderWorkspaceFileList(options), /skills.txt/);
  const shown = renderWorkspaceFileList({ ...options, showHiddenFiles: true });
  assert.match(shown, /data-open-path="D:\/Mod\/skills.txt"/);
  assert.match(shown, /workspace-hidden-badge/);
  assert.doesNotMatch(shown, /data-toggle-hidden-path/);
  assert.deepEqual(workspace, original, "all files remain available to lint reference indexing");
  assert.doesNotMatch(renderWorkspaceFileList({ ...options, docs: [{ path: "D:/Mod/skills.txt" }], showHiddenFiles: true }), /skills.txt/);
});
