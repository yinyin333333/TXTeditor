import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeLintReferenceVersion,
  referenceDocumentsFromPayload,
  resolveLegacyLintReferenceVersion
} from "../src/core/lint-reference-data.js";
import {
  buildWorkspaceIndex,
  mergeOpenLegacyWorkspaceDocs
} from "../src/core/lint-workspace-index.js";
import { legacySiblingContextTargets } from "../src/core/lint-sibling-context.js";
import { fixed4Key } from "../src/core/lint-reference-semantics.js";
import { TableDocument } from "../src/core/table-model.js";
import { createDefaultLintSettings, runLintWithWorkspaceIndex } from "../src/core/lint-engine.js";
import { createLegacyLintController } from "../src/ui/controllers/legacy-lint-controller.js";

function doc(name, text, path = name) {
  return TableDocument.fromText(name, text, { path, autoFitInitialColumns: false });
}

function bundled(version, files, digest = `${version}-verified-digest`) {
  return referenceDocumentsFromPayload({
    schemaVariant: version === "1.13c" ? "1.13" : version,
    gameVersion: version,
    canonicalSha256: digest,
    files: Object.entries(files).map(([name, text], index) => ({
      name,
      text,
      encoding: "utf-8",
      bytes: text.length,
      sha256: `file-${index}`
    }))
  }, version);
}

test("Legacy reference version selection is explicit, profile-aware, and never guesses", () => {
  assert.equal(normalizeLintReferenceVersion("1.13"), "1.13c");
  assert.equal(resolveLegacyLintReferenceVersion({ referenceVersion: "3.1", schemaVersion: "3.2" }, "RotW"), "3.1");
  assert.equal(resolveLegacyLintReferenceVersion({ schemaVersion: "2.4" }, "RotW"), "3.2");
  assert.equal(resolveLegacyLintReferenceVersion({ schemaVersion: "3.1" }, ""), "3.1");
  assert.equal(resolveLegacyLintReferenceVersion({}, "2.4"), "2.4");
  assert.equal(resolveLegacyLintReferenceVersion({}, "RotW"), "3.2");
  assert.equal(resolveLegacyLintReferenceVersion({ referenceVersion: "latest", schemaVersion: "3.2" }, "RotW"), null);
  assert.equal(resolveLegacyLintReferenceVersion({ schemaVersion: "3.2" }, "unknown-profile"), null);
});

test("bundled reference payloads become hidden, version-tagged documents and reject version mixing", () => {
  const [reference] = bundled("3.2", { "ItemTypes.txt": "Code\nstaf\n" }, "abc123");
  assert.equal(reference.name, "ItemTypes.txt");
  assert.equal(reference.path, "builtin://d2r-reference/3.2/ItemTypes.txt");
  assert.equal(reference.lintReferenceBundled, true);
  assert.equal(reference.lintReferenceVersion, "3.2");
  assert.equal(reference.lintReferenceDigest, "abc123");
  assert.throws(() => referenceDocumentsFromPayload({
    gameVersion: "3.1",
    canonicalSha256: "digest",
    files: []
  }, "3.2"), /version mismatch/);
});

test("partial workspaces use bundled lookup tables without diagnosing or exposing bundled documents", () => {
  const magicPrefix = doc("MagicPrefix.txt", "Name\titype1\nCaster\tstaff\n", "E:/partial/MagicPrefix.txt");
  const references = bundled("3.2", {
    "ItemTypes.txt": "ItemType\tCode\nStaff\tstaf\n",
    "Properties.txt": "code\nac\n"
  });
  const index = buildWorkspaceIndex([magicPrefix], "RotW", {
    referenceDocuments: references,
    referenceVersion: "3.2",
    workspaceFileNames: [{ path: magicPrefix.path, name: magicPrefix.name }]
  });

  assert.deepEqual(index.tables.map((table) => table.fileName), ["magicprefix.txt"]);
  assert.deepEqual([...index.files.values()].map((file) => file.fileName), ["MagicPrefix.txt"]);
  assert.equal(index.referenceTablesByName.get("itemtypes.txt").doc.lintReferenceBundled, true);
  assert.equal(index.referenceSourceByName.get("itemtypes.txt").kind, "bundled");
  assert.equal(index.itemTypesFixed4.has(fixed4Key("staf")), true);

  const settings = createDefaultLintSettings();
  const partialDiagnostics = runLintWithWorkspaceIndex(index, settings)
    .filter((entry) => entry.ruleId === "Basic/LinkedExcel" && entry.fileName.toLowerCase() === "magicprefix.txt");
  const diskItemTypes = doc("ItemTypes.txt", "ItemType\tCode\nStaff\tstaf\n", "E:/full/ItemTypes.txt");
  const fullIndex = buildWorkspaceIndex([magicPrefix, diskItemTypes], "RotW", {
    referenceDocuments: references,
    referenceVersion: "3.2",
    workspaceFileNames: [
      { path: magicPrefix.path, name: magicPrefix.name },
      { path: diskItemTypes.path, name: diskItemTypes.name }
    ]
  });
  const fullDiagnostics = runLintWithWorkspaceIndex(fullIndex, settings)
    .filter((entry) => entry.ruleId === "Basic/LinkedExcel" && entry.fileName.toLowerCase() === "magicprefix.txt");
  assert.deepEqual(partialDiagnostics, []);
  assert.deepEqual(fullDiagnostics, partialDiagnostics);
});

test("Legacy property lookup follows the selected version's propertygroups capability", () => {
  const magicPrefix = doc(
    "MagicPrefix.txt",
    "Name\tmod1code\nKnown\tac\nMissing\tnot-a-property\n",
    "E:/partial/MagicPrefix.txt"
  );
  const oldIndex = buildWorkspaceIndex([magicPrefix], "RotW", {
    referenceDocuments: bundled("1.13c", { "Properties.txt": "code\nac\n" }),
    referenceVersion: "1.13c",
    workspaceFileNames: [{ path: magicPrefix.path, name: magicPrefix.name }]
  });
  const oldDiagnostics = runLintWithWorkspaceIndex(oldIndex, createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Basic/LinkedExcel" && entry.columnName === "mod1code");
  assert.deepEqual(oldDiagnostics.map((entry) => entry.offendingValue), ["not-a-property"]);

  const incompleteModernIndex = buildWorkspaceIndex([magicPrefix], "RotW", {
    referenceDocuments: bundled("3.2", { "Properties.txt": "code\nac\n" }),
    referenceVersion: "3.2",
    workspaceFileNames: [{ path: magicPrefix.path, name: magicPrefix.name }]
  });
  const modernDiagnostics = runLintWithWorkspaceIndex(incompleteModernIndex, createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Basic/LinkedExcel" && entry.columnName === "mod1code");
  assert.deepEqual(modernDiagnostics, []);

  const cubeMain = doc(
    "CubeMain.txt",
    "description\tenabled\tb mod 1\nrow\t1\tnot-a-property\n",
    "E:/partial/CubeMain.txt"
  );
  const oldCubeIndex = buildWorkspaceIndex([cubeMain], "RotW", {
    referenceDocuments: bundled("1.13c", { "Properties.txt": "code\nac\n" }),
    referenceVersion: "1.13c",
    workspaceFileNames: [{ path: cubeMain.path, name: cubeMain.name }]
  });
  const oldCubeDiagnostics = runLintWithWorkspaceIndex(oldCubeIndex, createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Cube/ValidOutputs" && entry.columnName === "b mod 1");
  assert.deepEqual(oldCubeDiagnostics.map((entry) => entry.offendingValue), ["not-a-property"]);

  const incompleteModernCubeIndex = buildWorkspaceIndex([cubeMain], "RotW", {
    referenceDocuments: bundled("3.2", { "Properties.txt": "code\nac\n" }),
    referenceVersion: "3.2",
    workspaceFileNames: [{ path: cubeMain.path, name: cubeMain.name }]
  });
  const modernCubeDiagnostics = runLintWithWorkspaceIndex(incompleteModernCubeIndex, createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Cube/ValidOutputs" && entry.columnName === "b mod 1");
  assert.deepEqual(modernCubeDiagnostics, []);
});

test("ValidStatParameters resolves hidden bundled properties, stats, and skills for an open item table", () => {
  const uniqueItems = doc(
    "UniqueItems.txt",
    "index\tprop1\tpar1\tmin1\tmax1\nFallback Check\tbounded-skill\tMissingSkill\t0\t8\n",
    "E:/partial/UniqueItems.txt"
  );
  const references = bundled("3.2", {
    "Properties.txt": "code\tfunc1\tstat1\nbounded-skill\t22\tskill_stat\n",
    "ItemStatCost.txt": "stat\tsave bits\tsave add\tsigned\tencode\nskill_stat\t3\t0\t0\t1\n",
    "Skills.txt": "skill\nAttack\n"
  });
  const index = buildWorkspaceIndex([uniqueItems], "RotW", {
    referenceDocuments: references,
    referenceVersion: "3.2",
    workspaceFileNames: [{ path: uniqueItems.path, name: uniqueItems.name }]
  });

  const diagnostics = runLintWithWorkspaceIndex(index, createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Items/ValidStatParameters");

  assert.deepEqual(diagnostics.map((entry) => entry.columnName).sort(), ["max1", "par1"]);
  assert.ok(diagnostics.every((entry) => entry.fileName.toLowerCase() === "uniqueitems.txt"));
  assert.equal(index.tables.some((table) => table.doc.lintReferenceBundled), false);
});

test("workspace tables override bundled tables and a present but unreadable stem blocks fallback", () => {
  const diskItemTypes = doc("ItemTypes.txt", "Code\ndisk\n", "E:/full/ItemTypes.txt");
  const references = bundled("3.2", { "ItemTypes.txt": "Code\nbund\n" });
  const full = buildWorkspaceIndex([diskItemTypes], "RotW", {
    referenceDocuments: references,
    referenceVersion: "3.2",
    workspaceFileNames: [{ path: diskItemTypes.path, name: diskItemTypes.name }]
  });
  assert.equal(full.referenceTablesByName.get("itemtypes.txt").doc, diskItemTypes);
  assert.equal(full.referenceSourceByName.get("itemtypes.txt").kind, "workspace");
  assert.equal(full.itemTypes.has("disk"), true);
  assert.equal(full.itemTypes.has("bund"), false);

  const unreadable = buildWorkspaceIndex([], "RotW", {
    referenceDocuments: references,
    referenceVersion: "3.2",
    workspaceFileNames: [{ path: "E:/full/ItemTypes.txt", name: "ItemTypes.txt" }]
  });
  assert.equal(unreadable.referenceTablesByName.has("itemtypes.txt"), false);
  assert.equal(unreadable.itemTypes.size, 0);
});

test("open documents shadow the same disk URI and closing restores disk before bundled fallback", () => {
  const disk = doc("ItemTypes.txt", "Code\ndisk\n", "E:/workspace/ItemTypes.txt");
  const open = doc("ItemTypes.txt", "Code\nopen\n", "E:\\workspace\\ItemTypes.txt");
  const references = bundled("3.2", { "ItemTypes.txt": "Code\nbund\n" });
  const options = {
    referenceDocuments: references,
    referenceVersion: "3.2",
    workspaceFileNames: [{ path: disk.path, name: disk.name }]
  };

  const whileOpen = buildWorkspaceIndex(mergeOpenLegacyWorkspaceDocs([disk], [open]), "RotW", options);
  assert.equal(whileOpen.referenceTablesByName.get("itemtypes.txt").doc, open);
  assert.equal(whileOpen.itemTypes.has("open"), true);
  assert.equal(whileOpen.itemTypes.has("disk"), false);

  const afterClose = buildWorkspaceIndex(mergeOpenLegacyWorkspaceDocs([disk], []), "RotW", options);
  assert.equal(afterClose.referenceTablesByName.get("itemtypes.txt").doc, disk);
  assert.equal(afterClose.itemTypes.has("disk"), true);
  assert.equal(afterClose.itemTypes.has("bund"), false);

  const noDisk = buildWorkspaceIndex([], "RotW", {
    referenceDocuments: references,
    referenceVersion: "3.2",
    workspaceFileNames: []
  });
  assert.equal(noDisk.referenceTablesByName.get("itemtypes.txt").doc.lintReferenceBundled, true);
});

test("one Legacy index accepts bundled documents from only its selected version", () => {
  const mixed = [
    ...bundled("3.1", { "ItemTypes.txt": "Code\nv31x\n" }, "digest31"),
    ...bundled("3.2", { "ItemTypes.txt": "Code\nv32x\n" }, "digest32")
  ];
  const v31 = buildWorkspaceIndex([], "RotW", {
    referenceDocuments: mixed,
    referenceVersion: "3.1"
  });
  const v32 = buildWorkspaceIndex([], "RotW", {
    referenceDocuments: mixed,
    referenceVersion: "3.2"
  });
  const unknown = buildWorkspaceIndex([], "RotW", { referenceDocuments: mixed });

  assert.deepEqual([...v31.itemTypes], ["v31x"]);
  assert.deepEqual([...v32.itemTypes], ["v32x"]);
  assert.equal(unknown.referenceTablesByName.size, 0);
});

test("open-only documents are retained by the immutable disk overlay", () => {
  const disk = doc("Skills.txt", "skill\nDisk\n", "E:/workspace/Skills.txt");
  const openOnly = doc("MagicPrefix.txt", "Name\nOpen\n", "E:/outside/MagicPrefix.txt");
  assert.deepEqual(mergeOpenLegacyWorkspaceDocs([disk], [openOnly]), [disk, openOnly]);
  assert.deepEqual(mergeOpenLegacyWorkspaceDocs([disk], []), [disk]);
});

test("Legacy sibling discovery accepts only absolute TXT parents outside the explicit workspace", () => {
  const targets = legacySiblingContextTargets([
    doc("MagicPrefix.txt", "Name\nA\n", "E:/ModA/global/excel/MagicPrefix.txt"),
    doc("MagicSuffix.txt", "Name\nB\n", "E:/ModA/global/excel/MagicSuffix.txt"),
    doc("Skills.txt", "skill\nA\n", "E:/Workspace/Skills.txt"),
    doc("ignored.tsv", "id\n1\n", "E:/ModB/ignored.tsv"),
    doc("browser.txt", "id\n1\n", "browser.txt"),
    doc("builtin.txt", "id\n1\n", "builtin://reference/builtin.txt")
  ], "E:/Workspace");

  assert.deepEqual(targets, [{
    filePath: "E:/ModA/global/excel/MagicPrefix.txt",
    parentKey: "e:/moda/global/excel"
  }]);
});

test("hidden sibling tables outrank workspace and bundled tables without becoming diagnostic documents", () => {
  const magicPrefix = doc("MagicPrefix.txt", "Name\titype1\nCaster\tmodx\n", "E:/Mod/MagicPrefix.txt");
  const siblingItemTypes = doc("ItemTypes.txt", "Code\nmodx\n", "E:/Mod/ItemTypes.txt");
  const workspaceItemTypes = doc("ItemTypes.txt", "Code\nroot\n", "E:/ReferenceRoot/ItemTypes.txt");
  const references = bundled("3.2", { "ItemTypes.txt": "Code\nbund\n" });
  const index = buildWorkspaceIndex([magicPrefix, workspaceItemTypes], "RotW", {
    referenceDocuments: references,
    referenceVersion: "3.2",
    workspaceFileNames: [{ path: workspaceItemTypes.path, name: workspaceItemTypes.name }],
    workspaceDocuments: [workspaceItemTypes],
    siblingDocuments: [siblingItemTypes],
    siblingFileNames: [{ path: siblingItemTypes.path, name: siblingItemTypes.name }],
    openDocuments: [magicPrefix]
  });

  assert.equal(index.referenceSourceByName.get("itemtypes.txt").kind, "sibling");
  assert.equal(index.itemTypesFixed4.has(fixed4Key("modx")), true);
  assert.equal(index.itemTypesFixed4.has(fixed4Key("root")), false);
  assert.equal(index.itemTypesFixed4.has(fixed4Key("bund")), false);
  assert.deepEqual(index.tables.map((table) => table.doc), [magicPrefix, workspaceItemTypes]);
  assert.equal(index.tables.some((table) => table.doc === siblingItemTypes), false);
  assert.deepEqual(runLintWithWorkspaceIndex(index, createDefaultLintSettings())
    .filter((entry) => entry.ruleId === "Basic/LinkedExcel" && entry.fileName === "MagicPrefix.txt"), []);
});

test("open documents shadow sibling tables; close and delete restore sibling then bundled", () => {
  const magicPrefix = doc("MagicPrefix.txt", "Name\titype1\nCaster\topen\n", "E:/Mod/MagicPrefix.txt");
  const openItemTypes = doc("ItemTypes.txt", "Code\nopen\n", "E:/Mod/ItemTypes.txt");
  const siblingItemTypes = doc("ItemTypes.txt", "Code\ndisk\n", "E:/Mod/ItemTypes.txt");
  const references = bundled("3.2", { "ItemTypes.txt": "Code\nbund\n" });
  const common = {
    referenceDocuments: references,
    referenceVersion: "3.2",
    siblingFileNames: [{ path: siblingItemTypes.path, name: siblingItemTypes.name }]
  };

  const whileOpen = buildWorkspaceIndex([magicPrefix, openItemTypes], "RotW", {
    ...common,
    siblingDocuments: [siblingItemTypes],
    openDocuments: [magicPrefix, openItemTypes]
  });
  assert.equal(whileOpen.referenceSourceByName.get("itemtypes.txt").kind, "open");
  assert.deepEqual([...whileOpen.itemTypes], ["open"]);

  const afterClose = buildWorkspaceIndex([magicPrefix], "RotW", {
    ...common,
    siblingDocuments: [siblingItemTypes],
    openDocuments: [magicPrefix]
  });
  assert.equal(afterClose.referenceSourceByName.get("itemtypes.txt").kind, "sibling");
  assert.deepEqual([...afterClose.itemTypes], ["disk"]);

  const afterDelete = buildWorkspaceIndex([magicPrefix], "RotW", {
    referenceDocuments: references,
    referenceVersion: "3.2",
    siblingDocuments: [],
    siblingFileNames: [],
    openDocuments: [magicPrefix]
  });
  assert.equal(afterDelete.referenceSourceByName.get("itemtypes.txt").kind, "bundled");
  assert.deepEqual([...afterDelete.itemTypes], ["bund"]);
});

test("an unreadable sibling table blocks lower workspace and bundled references", () => {
  const magicPrefix = doc("MagicPrefix.txt", "Name\titype1\nCaster\tstaff\n", "E:/Mod/MagicPrefix.txt");
  const workspaceItemTypes = doc("ItemTypes.txt", "Code\nstaf\n", "E:/ReferenceRoot/ItemTypes.txt");
  const index = buildWorkspaceIndex([magicPrefix, workspaceItemTypes], "RotW", {
    referenceDocuments: bundled("3.2", { "ItemTypes.txt": "Code\nstaf\n" }),
    referenceVersion: "3.2",
    workspaceFileNames: [{ path: workspaceItemTypes.path, name: workspaceItemTypes.name }],
    workspaceDocuments: [workspaceItemTypes],
    siblingDocuments: [],
    siblingFileNames: [{ path: "E:/Mod/ItemTypes.txt", name: "ItemTypes.txt" }],
    openDocuments: [magicPrefix]
  });

  assert.equal(index.referenceTablesByName.has("itemtypes.txt"), false);
  assert.equal(index.referenceSourceByName.has("itemtypes.txt"), false);
  assert.equal(index.itemTypesFixed4.size, 0);
});

test("sibling context does not change selected bundled-version isolation for missing tables", () => {
  const magicPrefix = doc("MagicPrefix.txt", "Name\titype1\nCaster\tmodx\n", "E:/Mod/MagicPrefix.txt");
  const siblingItemTypes = doc("ItemTypes.txt", "Code\nmodx\n", "E:/Mod/ItemTypes.txt");
  const mixed = [
    ...bundled("3.1", { "ItemTypes.txt": "Code\nv31x\n", "Properties.txt": "code\nv31p\n" }),
    ...bundled("3.2", { "ItemTypes.txt": "Code\nv32x\n", "Properties.txt": "code\nv32p\n" })
  ];
  const index = buildWorkspaceIndex([magicPrefix], "RotW", {
    referenceDocuments: mixed,
    referenceVersion: "3.1",
    siblingDocuments: [siblingItemTypes],
    siblingFileNames: [{ path: siblingItemTypes.path, name: siblingItemTypes.name }],
    openDocuments: [magicPrefix]
  });

  assert.deepEqual([...index.itemTypes], ["modx"]);
  assert.deepEqual([...index.properties], ["v31p"]);
  assert.equal(index.properties.has("v32p"), false);
});

test("Legacy controller keeps sibling context hidden and restores latest disk then bundled after close/delete", async () => {
  let diskCode = "modx";
  let itemTypesExists = true;
  const published = [];
  const listCalls = [];
  const state = {
    docs: [doc("MagicPrefix.txt", "Name\titype1\nCaster\tmodx\n", "E:/Mod/MagicPrefix.txt")],
    workspace: null,
    config: { referenceVersion: "3.2" },
    lint: {
      legacy: {
        settings: createDefaultLintSettings(),
        timer: 0,
        pendingRun: null,
        version: 0,
        running: false,
        status: "",
        lastRunAt: 0,
        workspaceDocs: [],
        workspaceLoad: { status: "not-started", files: [], error: "", signature: "" },
        workspaceIndexCache: { signature: "", profile: "", index: null },
        workspaceRefreshRequired: false
      }
    }
  };
  const controller = createLegacyLintController({
    state,
    renderChrome: () => {},
    setLintDiagnostics: (diagnostics) => published.push(diagnostics),
    updateGridDiagnostics: () => {},
    legacyLintDisplayActive: () => true,
    docHasDiagnostics: () => false,
    recordLintEngineEvent: () => {},
    perfNow: () => Date.now(),
    elapsedMs: (started) => Date.now() - started,
    lintDocKey: (value) => value.path || value.name,
    listSiblingFiles: async (path) => {
      listCalls.push(path);
      return {
        path: "E:/Mod",
        files: [
          { path: "E:/Mod/MagicPrefix.txt", name: "MagicPrefix.txt", modified_ms: 1, size: 20 },
          ...(itemTypesExists
            ? [{ path: "E:/Mod/ItemTypes.txt", name: "ItemTypes.txt", modified_ms: diskCode.length, size: diskCode.length }]
            : [])
        ]
      };
    },
    openPathsBulk: async (paths) => paths.map((path) => ({
      path,
      name: path.split("/").at(-1),
      bulkRead: true,
      parseMs: 0,
      doc: doc("ItemTypes.txt", `Code\n${diskCode}\n`, path)
    })),
    loadReferenceDataset: async () => ({
      schemaVariant: "3.2",
      gameVersion: "3.2",
      canonicalSha256: "verified-32",
      files: [{
        name: "ItemTypes.txt",
        text: "Code\nstaf\n",
        encoding: "utf-8",
        bytes: 10,
        sha256: "itemtypes-sha"
      }]
    })
  });

  try {
    controller.scheduleFull("single-file", 0);
    await waitFor(() => published.length === 1);
    assert.deepEqual(published[0].filter((entry) => entry.ruleId === "Basic/LinkedExcel"), []);
    assert.deepEqual(state.docs.map((value) => value.name), ["MagicPrefix.txt"]);
    assert.deepEqual(state.lint.legacy.siblingDocs.map((value) => value.name), ["ItemTypes.txt"]);
    assert.equal(state.lint.legacy.siblingDocs[0].lintReferenceSibling, true);
    assert.equal(state.lint.legacy.siblingLoad.files[0].listedInExplorer, false);
    assert.equal(state.lint.legacy.workspaceIndexCache.index.referenceSourceByName.get("itemtypes.txt").kind, "sibling");

    state.docs = [
      doc("MagicPrefix.txt", "Name\titype1\nCaster\topen\n", "E:/Mod/MagicPrefix.txt"),
      doc("ItemTypes.txt", "Code\nopen\n", "E:/Mod/ItemTypes.txt")
    ];
    controller.scheduleFull("file-opened", 0);
    await waitFor(() => published.length === 2);
    assert.equal(state.lint.legacy.workspaceIndexCache.index.referenceSourceByName.get("itemtypes.txt").kind, "open");
    assert.deepEqual([...state.lint.legacy.workspaceIndexCache.index.itemTypes], ["open"]);

    diskCode = "disk";
    state.docs = [doc("MagicPrefix.txt", "Name\titype1\nCaster\tdisk\n", "E:/Mod/MagicPrefix.txt")];
    controller.scheduleFull("tab-closed", 0);
    await waitFor(() => published.length === 3);
    assert.equal(state.lint.legacy.workspaceIndexCache.index.referenceSourceByName.get("itemtypes.txt").kind, "sibling");
    assert.deepEqual([...state.lint.legacy.workspaceIndexCache.index.itemTypes], ["disk"]);

    itemTypesExists = false;
    state.docs = [doc("MagicPrefix.txt", "Name\titype1\nCaster\tstaff\n", "E:/Mod/MagicPrefix.txt")];
    controller.scheduleFull("tab-closed", 0);
    await waitFor(() => published.length === 4);
    assert.equal(state.lint.legacy.workspaceIndexCache.index.referenceSourceByName.get("itemtypes.txt").kind, "bundled");
    assert.equal(state.lint.legacy.workspaceIndexCache.index.itemTypesFixed4.has(fixed4Key("staf")), true);
    assert.deepEqual(published[3].filter((entry) => entry.ruleId === "Basic/LinkedExcel"), []);
    assert.equal(listCalls.length >= 4, true);
  } finally {
    controller.cancelJobs();
  }
});

test("Legacy controller isolates same-named sibling tables by standalone parent", async () => {
  const parentA = "E:/Mods/A/TXT";
  const parentB = "E:/Mods/B/TXT";
  const magicA = doc("MagicPrefix.txt", "Name\titype1\nA Prefix\tatyp\n", `${parentA}/MagicPrefix.txt`);
  const magicB = doc("MagicPrefix.txt", "Name\titype1\nB Prefix\tbtyp\n", `${parentB}/MagicPrefix.txt`);
  const published = [];
  const state = {
    docs: [magicA, magicB],
    workspace: null,
    config: { referenceVersion: "3.2" },
    lint: {
      legacy: {
        settings: createDefaultLintSettings(),
        timer: 0,
        pendingRun: null,
        version: 0,
        running: false,
        status: "",
        lastRunAt: 0,
        workspaceDocs: [],
        workspaceLoad: { status: "not-started", files: [], error: "", signature: "" },
        workspaceIndexCache: { signature: "", profile: "", index: null },
        workspaceRefreshRequired: false
      }
    }
  };
  const controller = createLegacyLintController({
    state,
    renderChrome: () => {},
    setLintDiagnostics: (diagnostics) => published.push(diagnostics),
    updateGridDiagnostics: () => {},
    legacyLintDisplayActive: () => true,
    docHasDiagnostics: () => false,
    recordLintEngineEvent: () => {},
    perfNow: () => Date.now(),
    elapsedMs: (started) => Date.now() - started,
    lintDocKey: (value) => value.path || value.name,
    listSiblingFiles: async (path) => {
      const parent = path.includes("/A/") ? parentA : parentB;
      const code = parent === parentA ? "atyp" : "btyp";
      return {
        path: parent,
        files: [
          { path: `${parent}/MagicPrefix.txt`, name: "MagicPrefix.txt", modified_ms: 1, size: 20 },
          { path: `${parent}/ItemTypes.txt`, name: "ItemTypes.txt", modified_ms: 1, size: 10, code }
        ]
      };
    },
    openPathsBulk: async (paths) => paths.map((path) => ({
      path,
      name: "ItemTypes.txt",
      bulkRead: true,
      parseMs: 0,
      doc: doc("ItemTypes.txt", `Code\n${path.includes("/A/") ? "atyp" : "btyp"}\n`, path)
    })),
    loadReferenceDataset: async () => ({
      schemaVariant: "3.2",
      gameVersion: "3.2",
      canonicalSha256: "verified-32",
      files: [{
        name: "ItemTypes.txt",
        text: "Code\nbund\n",
        encoding: "utf-8",
        bytes: 10,
        sha256: "itemtypes-sha"
      }]
    })
  });

  try {
    controller.scheduleFull("two-standalone-parents", 0);
    await waitFor(() => published.length === 1);

    assert.deepEqual(published[0].filter((entry) => entry.ruleId === "Basic/LinkedExcel"), []);
    const contexts = state.lint.legacy.workspaceIndexCache.contextIndexes;
    assert.deepEqual(contexts.map((entry) => entry.parentKey), [
      "e:/mods/a/txt",
      "e:/mods/b/txt"
    ]);
    assert.equal(
      contexts[0].index.referenceSourceByName.get("itemtypes.txt").path,
      `${parentA}/ItemTypes.txt`
    );
    assert.equal(
      contexts[1].index.referenceSourceByName.get("itemtypes.txt").path,
      `${parentB}/ItemTypes.txt`
    );
    assert.deepEqual([...contexts[0].index.itemTypes], ["atyp"]);
    assert.deepEqual([...contexts[1].index.itemTypes], ["btyp"]);
    assert.equal(contexts.every((entry) => entry.index.tables.length === 1), true);

    magicB.setCell(1, 1, "atyp");
    controller.markDocumentChanged(magicB);
    controller.scheduleFull("cross-parent-reference", 0);
    await waitFor(() => published.length === 2);
    const linked = published[1].filter((entry) => entry.ruleId === "Basic/LinkedExcel");
    assert.equal(linked.length, 1);
    assert.equal(linked[0].fileKey, "e:/mods/b/txt/magicprefix.txt");
    assert.match(linked[0].message, /atyp/);
  } finally {
    controller.cancelJobs();
  }
});

test("Legacy controller isolates an explicit workspace from one outside sibling parent", async () => {
  const workspacePath = "E:/Workspace/TXT";
  const outsidePath = "E:/Mods/Outside/TXT";
  const workspaceItemTypesPath = `${workspacePath}/ItemTypes.txt`;
  const workspaceMagicSuffixPath = `${workspacePath}/MagicSuffix.txt`;
  const outsideMagic = doc(
    "MagicPrefix.txt",
    "Name\titype1\nOutside Prefix\tbbbb\n",
    `${outsidePath}/MagicPrefix.txt`
  );
  const published = [];
  const state = {
    docs: [outsideMagic],
    workspace: {
      path: workspacePath,
      files: [
        { path: workspaceItemTypesPath, name: "ItemTypes.txt", modified_ms: 1, size: 10 },
        { path: workspaceMagicSuffixPath, name: "MagicSuffix.txt", modified_ms: 1, size: 32 }
      ]
    },
    config: { referenceVersion: "3.2" },
    lint: {
      legacy: {
        settings: createDefaultLintSettings(),
        timer: 0,
        pendingRun: null,
        version: 0,
        running: false,
        status: "",
        lastRunAt: 0,
        workspaceDocs: [],
        workspaceLoad: { status: "not-started", files: [], error: "", signature: "" },
        workspaceIndexCache: { signature: "", profile: "", index: null },
        workspaceRefreshRequired: false
      }
    }
  };
  const controller = createLegacyLintController({
    state,
    renderChrome: () => {},
    setLintDiagnostics: (diagnostics) => published.push(diagnostics),
    updateGridDiagnostics: () => {},
    legacyLintDisplayActive: () => true,
    docHasDiagnostics: () => false,
    recordLintEngineEvent: () => {},
    perfNow: () => Date.now(),
    elapsedMs: (started) => Date.now() - started,
    lintDocKey: (value) => value.path || value.name,
    listSiblingFiles: async () => ({
      path: outsidePath,
      files: [
        { path: `${outsidePath}/MagicPrefix.txt`, name: "MagicPrefix.txt", modified_ms: 1, size: 32 },
        { path: `${outsidePath}/ItemTypes.txt`, name: "ItemTypes.txt", modified_ms: 1, size: 10 }
      ]
    }),
    openPathsBulk: async (paths) => paths.map((path) => {
      if (path === workspaceItemTypesPath) {
        return { path, name: "ItemTypes.txt", parseMs: 0, doc: doc("ItemTypes.txt", "Code\naaaa\n", path) };
      }
      if (path === workspaceMagicSuffixPath) {
        return {
          path,
          name: "MagicSuffix.txt",
          parseMs: 0,
          doc: doc("MagicSuffix.txt", "Name\titype1\nWorkspace Suffix\taaaa\n", path)
        };
      }
      return { path, name: "ItemTypes.txt", parseMs: 0, doc: doc("ItemTypes.txt", "Code\nbbbb\n", path) };
    }),
    loadReferenceDataset: async () => ({
      schemaVariant: "3.2",
      gameVersion: "3.2",
      canonicalSha256: "verified-32",
      files: [{
        name: "ItemTypes.txt",
        text: "Code\nbund\n",
        encoding: "utf-8",
        bytes: 10,
        sha256: "itemtypes-sha"
      }]
    })
  });

  try {
    controller.scheduleFull("workspace-and-outside-parent", 0);
    await waitFor(() => published.length === 1);

    assert.deepEqual(published[0].filter((entry) => entry.ruleId === "Basic/LinkedExcel"), []);
    const contexts = state.lint.legacy.workspaceIndexCache.contextIndexes;
    assert.deepEqual(contexts.map((entry) => entry.parentKey), [
      "e:/mods/outside/txt",
      "e:/workspace/txt"
    ]);
    const workspaceContext = contexts.find((entry) => entry.parentKey === "e:/workspace/txt");
    const outsideContext = contexts.find((entry) => entry.parentKey === "e:/mods/outside/txt");
    assert.equal(workspaceContext.index.referenceSourceByName.get("itemtypes.txt").kind, "workspace");
    assert.equal(outsideContext.index.referenceSourceByName.get("itemtypes.txt").kind, "sibling");
    assert.deepEqual([...workspaceContext.index.itemTypes], ["aaaa"]);
    assert.deepEqual([...outsideContext.index.itemTypes], ["bbbb"]);
    assert.deepEqual(
      workspaceContext.index.tables.map((table) => table.fileName),
      ["itemtypes.txt", "magicsuffix.txt"]
    );
    assert.deepEqual(outsideContext.index.tables.map((table) => table.fileName), ["magicprefix.txt"]);
  } finally {
    controller.cancelJobs();
  }
});

test("Legacy controller keeps recursive workspace directories as independent lint scopes", async () => {
  const root = "E:/Workspace/Excel";
  const base = `${root}/base`;
  const files = [
    { path: `${root}/ItemTypes.txt`, name: "ItemTypes.txt", modified_ms: 1, size: 10 },
    { path: `${root}/MagicPrefix.txt`, name: "MagicPrefix.txt", modified_ms: 1, size: 32 },
    { path: `${base}/ItemTypes.txt`, name: "ItemTypes.txt", modified_ms: 1, size: 10 },
    { path: `${base}/MagicPrefix.txt`, name: "MagicPrefix.txt", modified_ms: 1, size: 32 }
  ];
  const contents = new Map([
    [`${root}/ItemTypes.txt`, "Code\nroot\n"],
    [`${root}/MagicPrefix.txt`, "Name\titype1\nRoot Prefix\troot\n"],
    [`${base}/ItemTypes.txt`, "Code\nbase\n"],
    [`${base}/MagicPrefix.txt`, "Name\titype1\nBase Prefix\tbase\n"]
  ]);
  const published = [];
  const state = {
    docs: [],
    workspace: { path: root, files },
    config: { referenceVersion: "3.2" },
    lint: {
      legacy: {
        settings: createDefaultLintSettings(),
        timer: 0,
        pendingRun: null,
        version: 0,
        running: false,
        status: "",
        lastRunAt: 0,
        workspaceDocs: [],
        workspaceLoad: { status: "not-started", files: [], error: "", signature: "" },
        workspaceIndexCache: { signature: "", profile: "", index: null },
        workspaceRefreshRequired: false
      }
    }
  };
  const controller = createLegacyLintController({
    state,
    renderChrome: () => {},
    setLintDiagnostics: (diagnostics) => published.push(diagnostics),
    updateGridDiagnostics: () => {},
    legacyLintDisplayActive: () => true,
    docHasDiagnostics: () => false,
    recordLintEngineEvent: () => {},
    perfNow: () => Date.now(),
    elapsedMs: (started) => Date.now() - started,
    lintDocKey: (value) => value.path || value.name,
    openPathsBulk: async (paths) => paths.map((path) => ({
      path,
      name: path.split("/").pop(),
      parseMs: 0,
      doc: doc(path.split("/").pop(), contents.get(path), path)
    })),
    loadReferenceDataset: async () => ({
      schemaVariant: "3.2",
      gameVersion: "3.2",
      canonicalSha256: "verified-32",
      files: []
    })
  });

  try {
    controller.scheduleFull("recursive-directory-scopes", 0);
    await waitFor(() => published.length === 1);
    assert.deepEqual(published[0].filter((entry) => entry.ruleId === "Basic/LinkedExcel"), []);

    const contexts = state.lint.legacy.workspaceIndexCache.contextIndexes;
    assert.deepEqual(contexts.map((entry) => entry.parentKey), [
      "e:/workspace/excel",
      "e:/workspace/excel/base"
    ]);
    assert.deepEqual([...contexts[0].index.itemTypes], ["root"]);
    assert.deepEqual([...contexts[1].index.itemTypes], ["base"]);

    const baseMagic = state.lint.legacy.workspaceDocs.find((entry) => entry.path === `${base}/MagicPrefix.txt`);
    baseMagic.setCell(1, 1, "root");
    controller.markDocumentChanged(baseMagic);
    controller.scheduleFull("cross-directory-reference", 0);
    await waitFor(() => published.length === 2);
    const linked = published[1].filter((entry) => entry.ruleId === "Basic/LinkedExcel");
    assert.equal(linked.length, 1);
    assert.equal(linked[0].fileKey, "e:/workspace/excel/base/magicprefix.txt");
    assert.match(linked[0].message, /root/);
  } finally {
    controller.cancelJobs();
  }
});

test("outside Legacy context sees an open workspace shadow without diagnosing it twice", async () => {
  const workspacePath = "E:/Workspace/TXT";
  const outsidePath = "E:/Mods/Outside/TXT";
  const workspaceItemTypesPath = `${workspacePath}/ItemTypes.txt`;
  const openWorkspaceItemTypes = doc("ItemTypes.txt", "Code\nbbbb\n", workspaceItemTypesPath);
  const outsideMagic = doc(
    "MagicPrefix.txt",
    "Name\titype1\nOutside Prefix\tbbbb\n",
    `${outsidePath}/MagicPrefix.txt`
  );
  const published = [];
  const state = {
    docs: [openWorkspaceItemTypes, outsideMagic],
    workspace: {
      path: workspacePath,
      files: [{ path: workspaceItemTypesPath, name: "ItemTypes.txt", modified_ms: 1, size: 10 }]
    },
    config: { referenceVersion: "3.2" },
    lint: {
      legacy: {
        settings: createDefaultLintSettings(),
        timer: 0,
        pendingRun: null,
        version: 0,
        running: false,
        status: "",
        lastRunAt: 0,
        workspaceDocs: [],
        workspaceLoad: { status: "not-started", files: [], error: "", signature: "" },
        workspaceIndexCache: { signature: "", profile: "", index: null },
        workspaceRefreshRequired: false
      }
    }
  };
  const controller = createLegacyLintController({
    state,
    renderChrome: () => {},
    setLintDiagnostics: (diagnostics) => published.push(diagnostics),
    updateGridDiagnostics: () => {},
    legacyLintDisplayActive: () => true,
    docHasDiagnostics: () => false,
    recordLintEngineEvent: () => {},
    perfNow: () => Date.now(),
    elapsedMs: (started) => Date.now() - started,
    lintDocKey: (value) => value.path || value.name,
    listSiblingFiles: async () => ({
      path: outsidePath,
      files: [{ path: outsideMagic.path, name: outsideMagic.name, modified_ms: 1, size: 32 }]
    }),
    openPathsBulk: async (paths) => paths.map((path) => ({
      path,
      name: "ItemTypes.txt",
      parseMs: 0,
      doc: doc("ItemTypes.txt", "Code\naaaa\n", path)
    })),
    loadReferenceDataset: async () => ({
      schemaVariant: "3.2",
      gameVersion: "3.2",
      canonicalSha256: "verified-32",
      files: [{
        name: "ItemTypes.txt",
        text: "Code\nbund\n",
        encoding: "utf-8",
        bytes: 10,
        sha256: "itemtypes-sha"
      }]
    })
  });

  try {
    controller.scheduleFull("workspace-open-shadow-for-outside", 0);
    await waitFor(() => published.length === 1);

    assert.deepEqual(published[0].filter((entry) => entry.ruleId === "Basic/LinkedExcel"), []);
    const contexts = state.lint.legacy.workspaceIndexCache.contextIndexes;
    assert.deepEqual(contexts.map((entry) => entry.parentKey), [
      "e:/mods/outside/txt",
      "e:/workspace/txt"
    ]);
    const outsideContext = contexts.find((entry) => entry.parentKey === "e:/mods/outside/txt");
    assert.equal(outsideContext.index.referenceSourceByName.get("itemtypes.txt").kind, "open");
    assert.equal(
      outsideContext.index.referenceSourceByName.get("itemtypes.txt").path,
      workspaceItemTypesPath
    );
    assert.deepEqual([...outsideContext.index.itemTypes], ["bbbb"]);
    assert.deepEqual(outsideContext.index.tables.map((table) => table.fileName), ["magicprefix.txt"]);
  } finally {
    controller.cancelJobs();
  }
});

test("closing a Legacy shadow refreshes a deleted workspace path before choosing bundled fallback", async () => {
  const workspacePath = "E:/workspace";
  const deletedPath = `${workspacePath}/ItemTypes.txt`;
  const magicPrefix = doc(
    "MagicPrefix.txt",
    "Name\titype1\nCaster\tstaff\n",
    "E:/outside/MagicPrefix.txt"
  );
  const state = {
    docs: [magicPrefix],
    workspace: {
      path: workspacePath,
      files: [{ path: deletedPath, name: "ItemTypes.txt" }]
    },
    config: { referenceVersion: "3.2" },
    lint: {
      legacy: {
        settings: createDefaultLintSettings(),
        timer: 0,
        pendingRun: null,
        version: 0,
        running: false,
        status: "",
        lastRunAt: 0,
        workspaceDocs: [doc("ItemTypes.txt", "Code\ndisk\n", deletedPath)],
        workspaceLoad: { status: "ready", files: [], error: "", signature: "stale" },
        workspaceIndexCache: { signature: "stale", profile: "RotW", index: {} },
        workspaceRefreshRequired: false
      }
    }
  };
  const refreshCalls = [];
  const controller = createLegacyLintController({
    state,
    renderChrome: () => {},
    setLintDiagnostics: () => {},
    updateGridDiagnostics: () => {},
    legacyLintDisplayActive: () => true,
    docHasDiagnostics: () => false,
    recordLintEngineEvent: () => {},
    perfNow: () => Date.now(),
    elapsedMs: (started) => Date.now() - started,
    lintDocKey: (value) => value.path || value.name,
    refreshWorkspace: async (path) => {
      refreshCalls.push(path);
      return { path, files: [] };
    },
    loadReferenceDataset: async () => ({
      schemaVariant: "3.2",
      gameVersion: "3.2",
      canonicalSha256: "verified-32",
      files: [{
        name: "ItemTypes.txt",
        text: "ItemType\tCode\nStaff\tstaf\n",
        encoding: "utf-8",
        bytes: 25,
        sha256: "itemtypes-sha"
      }]
    })
  });

  try {
    controller.scheduleFull("tab-closed", 0);
    await waitFor(() => state.lint.legacy.lastRunAt > 0);

    assert.deepEqual(refreshCalls, [workspacePath]);
    assert.deepEqual(state.workspace.files, []);
    assert.deepEqual(state.lint.legacy.workspaceDocs, []);
    assert.equal(state.lint.legacy.workspaceRefreshRequired, false);

    const index = buildWorkspaceIndex(state.docs, "RotW", {
      referenceDocuments: state.lint.legacy.referenceDataset.documents,
      referenceVersion: state.lint.legacy.referenceDataset.selectedVersion,
      workspaceFileNames: state.workspace.files
    });
    assert.equal(index.referenceSourceByName.get("itemtypes.txt").kind, "bundled");
    assert.equal(index.itemTypesFixed4.has(fixed4Key("staf")), true);
  } finally {
    controller.cancelJobs();
  }
});

test("a stale bundled-reference load cannot replace the latest Legacy lint session", async () => {
  const pending = [];
  const state = {
    docs: [],
    workspace: null,
    config: { referenceVersion: "3.2" },
    lint: {
      legacy: {
        settings: createDefaultLintSettings(),
        timer: 0,
        pendingRun: null,
        version: 0,
        running: false,
        status: "",
        lastRunAt: 0,
        workspaceDocs: [],
        workspaceLoad: { status: "not-started", files: [], error: "", signature: "" },
        workspaceIndexCache: { signature: "", profile: "", index: null }
      }
    }
  };
  const controller = createLegacyLintController({
    state,
    renderChrome: () => {},
    setLintDiagnostics: () => {},
    updateGridDiagnostics: () => {},
    legacyLintDisplayActive: () => true,
    docHasDiagnostics: () => false,
    recordLintEngineEvent: () => {},
    perfNow: () => Date.now(),
    elapsedMs: (started) => Date.now() - started,
    lintDocKey: (value) => value.path || value.name,
    loadReferenceDataset: (version) => new Promise((resolve) => pending.push({ version, resolve }))
  });

  try {
    controller.scheduleFull("first-version", 0);
    await waitFor(() => pending.length === 1);
    assert.equal(pending[0].version, "3.2");

    state.config.referenceVersion = "3.1";
    controller.scheduleFull("latest-version", 0);
    await waitFor(() => pending.length === 2);
    assert.equal(pending[1].version, "3.1");

    pending[1].resolve(referencePayload("3.1", "digest31"));
    await waitFor(() => state.lint.legacy.referenceDataset?.status === "ready");
    assert.equal(state.lint.legacy.referenceDataset.selectedVersion, "3.1");

    pending[0].resolve(referencePayload("3.2", "digest32"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.lint.legacy.referenceDataset.selectedVersion, "3.1");
    assert.equal(state.lint.legacy.referenceDataset.digest, "digest31");
  } finally {
    controller.cancelJobs();
  }
});

function referencePayload(gameVersion, canonicalSha256) {
  return {
    schemaVariant: gameVersion,
    gameVersion,
    canonicalSha256,
    files: []
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("Timed out waiting for asynchronous Legacy lint state.");
}
