import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export function buildWeb(root = process.cwd()) {
  const dist = join(root, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  for (const entry of ["index.html", "src", "fixtures"]) {
    const src = join(root, entry);
    if (existsSync(src)) {
      cpSync(src, join(dist, entry), { recursive: true, filter: (source) => shouldCopyWebAsset(source, src, entry) });
    }
  }
  return dist;
}

export function shouldCopyWebAsset(source, entryRoot, entryName = "") {
  if (entryName !== "fixtures") return true;
  const rel = relative(entryRoot, source).replace(/\\/g, "/");
  return rel === "" || (rel !== "generated" && !rel.startsWith("generated/") && !/^d2_(?:\d+k|\d+)\.tsv$/i.test(rel));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(buildWeb());
}
