import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldCopyWebAsset } from "../scripts/build-web.js";

test("build:web excludes generated perf fixtures from dist", () => {
  const root = "fixtures";
  assert.equal(shouldCopyWebAsset(join(root, "d2_20k.tsv"), root, "fixtures"), false);
  assert.equal(shouldCopyWebAsset(join(root, "d2_200k.tsv"), root, "fixtures"), false);
  assert.equal(shouldCopyWebAsset(join(root, "generated"), root, "fixtures"), false);
  assert.equal(shouldCopyWebAsset(join(root, "sample.tsv"), root, "fixtures"), true);
  assert.equal(shouldCopyWebAsset("src/app.js", "src", "src"), true);
});

test("perf script generates missing fixtures and writes size-specific output", () => {
  const source = readFileSync(new URL("../scripts/perf-test.js", import.meta.url), "utf8");
  assert.match(source, /spawnSync\(process\.execPath, \[join\(process\.cwd\(\), "scripts", "generate-fixture\.js"\), String\(size\)\]/);
  assert.match(source, /TableDocument\.fromText\(fixtureName, text\)/);
  assert.match(source, /`d2_\$\{sizeLabel\}\.saved\.tsv`/);
  assert.doesNotMatch(source, /"d2_20k\.saved\.tsv"/);
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
