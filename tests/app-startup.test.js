import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";
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
