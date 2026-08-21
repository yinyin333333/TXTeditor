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

test("Merge setup has symmetric inputs and no manual Result format control", () => {
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const elementsSource = readFileSync(new URL("../src/ui/app-elements.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../src/ui/controllers/merge-controller.js", import.meta.url), "utf8");
  assert.doesNotMatch(indexHtml, /data-merge-action="swap"|data-i18n="merge\.swap"/);
  assert.doesNotMatch(indexHtml, /id="mergeFormatSource"|data-i18n="merge\.resultFormat"/);
  assert.doesNotMatch(elementsSource, /mergeFormatSource/);
  assert.doesNotMatch(controllerSource, /mergeFormatSource|setMergeFormatSource|swapInputs/);

  const setupStart = indexHtml.indexOf('id="mergeSetup"');
  const setupEnd = indexHtml.indexOf("</div>", setupStart);
  const statusIndex = indexHtml.indexOf('id="mergeStatus"');
  assert.ok(setupStart >= 0 && setupEnd > setupStart);
  assert.ok(statusIndex > setupEnd, "mergeStatus must remain visible when mergeSetup is hidden");
  assert.match(indexHtml, /id="mergeOverwriteDialog"/);
  assert.match(indexHtml, /id="mergeOverwriteDialogText"/);
});
