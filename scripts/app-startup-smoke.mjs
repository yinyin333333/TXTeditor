import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireBaselineDir } from "./baseline-paths.mjs";
import { installFakeAppStartupDom } from "../tests/helpers/fake-dom-app-startup.mjs";

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function resolveRoot(value) {
  if (!value || value === "current") return process.cwd();
  if (value === "baseline") return requireBaselineDir({ currentRoot: process.cwd() }).path;
  return value;
}

const root = path.resolve(resolveRoot(optionValue("--root", process.cwd())));
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
installFakeAppStartupDom({ indexHtml });

const appUrl = pathToFileURL(path.join(root, "src/app.js")).href;
await import(`${appUrl}?startupSmoke=${Date.now()}`);

console.log(`app-startup-smoke: PASS ${root}`);
