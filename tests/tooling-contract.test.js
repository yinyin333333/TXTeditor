import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldCopyWebAsset } from "../scripts/build-web.js";
import { fixtureNameForSize, fixturePathForSize, fixtureSizeLabel } from "../scripts/fixture-names.mjs";

test("build:web excludes generated perf fixtures from dist", () => {
  const root = "fixtures";
  assert.equal(shouldCopyWebAsset(join(root, "d2_20k.tsv"), root, "fixtures"), false);
  assert.equal(shouldCopyWebAsset(join(root, "d2_200k.tsv"), root, "fixtures"), false);
  assert.equal(shouldCopyWebAsset(join(root, "d2_2500.tsv"), root, "fixtures"), false);
  assert.equal(shouldCopyWebAsset(join(root, "d2_3.tsv"), root, "fixtures"), false);
  assert.equal(shouldCopyWebAsset(join(root, "generated"), root, "fixtures"), false);
  assert.equal(shouldCopyWebAsset(join(root, "sample.tsv"), root, "fixtures"), true);
  assert.equal(shouldCopyWebAsset("src/app.js", "src", "src"), true);
});

test("perf fixture naming is shared for round and non-round sizes", () => {
  assert.equal(fixtureSizeLabel(20000), "20k");
  assert.equal(fixtureSizeLabel(2500), "2500");
  assert.equal(fixtureSizeLabel(3), "3");
  assert.equal(fixtureNameForSize(2500), "d2_2500.tsv");
  assert.equal(fixturePathForSize(3, "root"), join("root", "fixtures", "d2_3.tsv"));
});

test("perf script generates missing fixtures and writes size-specific output", () => {
  const source = readFileSync(new URL("../scripts/perf-test.js", import.meta.url), "utf8");
  assert.match(source, /spawnSync\(process\.execPath, \[join\(process\.cwd\(\), "scripts", "generate-fixture\.js"\), String\(size\)\]/);
  assert.match(source, /TableDocument\.fromText\(fixtureName, text\)/);
  assert.match(source, /`d2_\$\{sizeLabel\}\.saved\.tsv`/);
  assert.doesNotMatch(source, /"d2_20k\.saved\.tsv"/);
  assert.match(source, /fixturePathForSize\(size\)/);
});

test("clean targets include Vector-LSP runtime smoke artifacts", () => {
  const source = readFileSync(new URL("../scripts/clean.js", import.meta.url), "utf8");
  assert.match(source, /"\.runtime-smoke"/);
});

test("package exposes explicit optional and required Vector-LSP smoke commands", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["test:vector-lsp-smoke:optional"], "node scripts/vector-lsp-runtime-smoke.mjs");
  assert.equal(pkg.scripts["test:vector-lsp-smoke:required"], "node scripts/vector-lsp-runtime-smoke.mjs --require-real");
});
