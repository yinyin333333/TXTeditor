import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const mode = process.argv[2] ?? "build";

const buildTargets = [
  "dist",
  "src-tauri/target",
  "src-tauri/gen",
  "fixtures/d2_20k.tsv",
  "fixtures/d2_200k.tsv",
  "fixtures/generated",
  "tmp",
  "temp"
];

const allTargets = [
  ...buildTargets,
  "references",
  ".npm-cache",
  "node_modules"
];

const targets = mode === "all" ? allTargets : buildTargets;

for (const relative of targets) {
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep)) {
    throw new Error(`Refusing to clean outside project: ${absolute}`);
  }
  if (!fs.existsSync(absolute)) continue;
  fs.rmSync(absolute, { recursive: true, force: true });
  console.log(`removed ${relative}`);
}
