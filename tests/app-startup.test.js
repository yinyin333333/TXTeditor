import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { baselineCandidates, resolveBaselineDir } from "../scripts/baseline-paths.mjs";
import { APP_ELEMENT_IDS } from "../src/ui/app-elements.js";
import { installFakeAppStartupDom } from "./helpers/fake-dom-app-startup.mjs";

const execFileAsync = promisify(execFile);

async function runStartupSmoke(root) {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/app-startup-smoke.mjs", "--root", root], {
    cwd: process.cwd(),
    windowsHide: true
  });
  assert.match(stdout, /app-startup-smoke: PASS/);
}

test("current app root imports under the app startup harness", async () => {
  await runStartupSmoke(process.cwd());
});

test("current app startup DOM ids are declared in index.html", () => {
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const appIds = Object.values(APP_ELEMENT_IDS);
  const indexIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

  assert.deepEqual(appIds.filter((id) => !indexIds.has(id)), []);
  const { document } = installFakeAppStartupDom({ indexHtml });
  assert.equal(document.getElementById("fontSelect"), null);
  assert.equal(document.getElementById("gridHost")?.tagName, "SECTION");
});

test("normal test suite keeps baseline startup comparison in the explicit baseline contract", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const appStartupTest = readFileSync(new URL("./app-startup.test.js", import.meta.url), "utf8");
  const baselineContract = readFileSync(new URL("../scripts/baseline-contract.mjs", import.meta.url), "utf8");

  assert.equal(packageJson.scripts.test, "node --test \"tests/*.test.js\"");
  assert.doesNotMatch(appStartupTest, new RegExp(`require${"BaselineDir"}`));
  assert.doesNotMatch(appStartupTest, new RegExp(`--root", "${"baseline"}`));
  assert.match(baselineContract, /runStartupSmoke\(BASELINE_DIR\);/);
  assert.match(baselineContract, /runStartupSmoke\(ROOT\);/);
});

test("baseline resolver supports a review snapshot sibling baseline without environment variables", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "txteditor-review-"));
  try {
    const snapshot = path.join(root, "TXTeditor-re-refactor-latest");
    const baseline = path.join(root, "TXTeditor-0.4.3-pr");
    mkdirSync(snapshot);
    mkdirSync(baseline);

    const resolved = resolveBaselineDir({ currentRoot: snapshot, env: {} });
    assert.equal(resolved?.source, "sibling");
    assert.equal(resolved?.path, baseline);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("baseline resolver has no owner-machine fallback in standalone checkouts", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "txteditor-standalone-"));
  try {
    const standalone = path.join(root, "TXTeditor");
    mkdirSync(standalone);

    const candidates = baselineCandidates({ currentRoot: standalone, env: {} });
    assert.deepEqual(candidates.map(([source]) => source), ["sibling"]);
    assert.equal(candidates.some(([, candidate]) => String(candidate).includes("TXTeditor for codereview")), false);
    assert.equal(resolveBaselineDir({ currentRoot: standalone, env: {} }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit baseline contract fails clearly when no baseline can be resolved", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "txteditor-no-baseline-"));
  const env = { ...process.env };
  delete env.TXTEDITOR_BASELINE_DIR;
  try {
    await assert.rejects(
      () => execFileAsync(process.execPath, [path.join(process.cwd(), "scripts", "baseline-contract.mjs")], {
        cwd: root,
        env,
        windowsHide: true
      }),
      (error) => {
        assert.notEqual(error.code, 0);
        assert.match(`${error.stderr}\n${error.stdout}`, /Baseline directory not found/);
        assert.match(`${error.stderr}\n${error.stdout}`, /Set TXTEDITOR_BASELINE_DIR/);
        return true;
      }
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
