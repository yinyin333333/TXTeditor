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
  "TXTeditor_lint_result_RotW_d2rlint_compatible.txt",
  "tmp",
  "temp"
];

const allTargets = [
  ...buildTargets,
  "references",
  ".npm-cache",
  "node_modules"
];

const cleanupPatterns = [
  /^.*\.log$/i,
  /^TXTeditor_lint_result.*\.txt$/i,
  /^.*_lint_result.*\.txt$/i
];

const targets = [
  ...(mode === "all" ? allTargets : buildTargets),
  ...matchedCleanupFiles()
];

for (const relative of targets) {
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep)) {
    throw new Error(`Refusing to clean outside project: ${absolute}`);
  }
  if (!fs.existsSync(absolute)) continue;
  fs.rmSync(absolute, { recursive: true, force: true });
  console.log(`removed ${relative}`);
}

function matchedCleanupFiles() {
  return fs.readdirSync(root)
    .filter((name) => cleanupPatterns.some((pattern) => pattern.test(name)))
    .filter((name) => fs.statSync(path.resolve(root, name)).isFile());
}
