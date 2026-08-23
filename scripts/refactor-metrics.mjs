import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".rs"]);
const NON_EXECUTABLE_ROOTS = [
  ".npm-cache",
  ".runtime-smoke",
  "build",
  "coverage",
  "dist",
  "fixtures/generated",
  "generated",
  "node_modules",
  "out",
  "src-tauri/gen",
  "src-tauri/target",
  "target",
  "temp",
  "tmp"
];

function isNonExecutableArtifact(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  return NON_EXECUTABLE_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function sourceFiles() {
  let listed;
  try {
    listed = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.js", "*.mjs", "*.rs"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
    );
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    throw new Error(`Unable to enumerate non-ignored source files with Git${detail ? `: ${detail}` : "."}`);
  }

  return listed
    .split("\0")
    .filter(Boolean)
    .filter((file) => !isNonExecutableArtifact(file))
    .map((file) => path.resolve(ROOT, file))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)));
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function physicalLoc(text) {
  return text.split(/\r?\n/).length;
}

function nonblankNoncommentLoc(text, ext) {
  let inBlock = false;
  let count = 0;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    if (inBlock) {
      if (line.includes("*/")) {
        inBlock = false;
        line = line.slice(line.indexOf("*/") + 2).trim();
      } else {
        continue;
      }
    }
    if (!line) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlock = true;
      line = line.includes("*/") ? line.slice(line.indexOf("*/") + 2).trim() : "";
    }
    if (!line) continue;
    if (ext === ".rs" && line.startsWith("//")) continue;
    if ((ext === ".js" || ext === ".mjs") && line.startsWith("//")) continue;
    count += 1;
  }
  return count;
}

function importCount(text, ext) {
  if (ext === ".rs") return (text.match(/^\s*use\s+/gm) ?? []).length;
  return [
    ...(text.matchAll(/^\s*import\s+/gm)),
    ...(text.matchAll(/^\s*export\s+.*\s+from\s+["']/gm)),
    ...(text.matchAll(/\brequire\s*\(/g))
  ].length;
}

function jsImports(file, text, allFiles) {
  const imports = [];
  const dir = path.dirname(file);
  const re = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of text.matchAll(re)) {
    const spec = match[1];
    if (!spec.startsWith(".")) continue;
    const resolved = resolveJsImport(dir, spec, allFiles);
    if (resolved) imports.push(resolved);
  }
  return imports;
}

function resolveJsImport(dir, spec, allFiles) {
  const base = path.resolve(dir, spec);
  const candidates = [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js")];
  return candidates.find((candidate) => allFiles.has(candidate)) ?? null;
}

function findCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function visit(node) {
    if (visiting.has(node)) {
      const at = stack.indexOf(node);
      if (at >= 0) cycles.push([...stack.slice(at), node]);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of graph.keys()) visit(node);
  const seen = new Set();
  return cycles.filter((cycle) => {
    const key = cycle.map(rel).sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const files = sourceFiles().sort();
const fileSet = new Set(files);
const records = files.map((file) => {
  const text = fs.readFileSync(file, "utf8");
  const ext = path.extname(file);
  return {
    file,
    path: rel(file),
    ext,
    loc: physicalLoc(text),
    ncloc: nonblankNoncommentLoc(text, ext),
    imports: importCount(text, ext),
    text
  };
});

const graph = new Map();
const importerCount = new Map();
for (const record of records.filter((item) => item.ext === ".js" || item.ext === ".mjs")) {
  const imports = jsImports(record.file, record.text, fileSet);
  graph.set(record.file, imports);
  for (const imported of imports) importerCount.set(imported, (importerCount.get(imported) ?? 0) + 1);
}

const largest = [...records].sort((a, b) => b.loc - a.loc).slice(0, 20);
const below40 = records.filter((item) => item.loc < 40).sort((a, b) => a.loc - b.loc || a.path.localeCompare(b.path));
const below80 = records.filter((item) => item.loc < 80).sort((a, b) => a.loc - b.loc || a.path.localeCompare(b.path));
const byDir = new Map();
for (const record of records) {
  const parts = record.path.split("/");
  const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
  byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
}
const helperCandidates = records
  .filter((record) => /^src\//.test(record.path))
  .filter((record) => record.path.includes("policy") || record.path.includes("helper") || record.loc < 80)
  .map((record) => ({ ...record, importers: importerCount.get(record.file) ?? 0 }))
  .filter((record) => record.importers <= 1)
  .sort((a, b) => a.importers - b.importers || a.loc - b.loc || a.path.localeCompare(b.path));
const cycles = findCycles(graph);

function table(headers, rows) {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => String(row[i] ?? "").length)));
  const line = (row) => `| ${row.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join(" | ")} |`;
  return [
    line(headers),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map(line)
  ].join("\n");
}

console.log("# Refactor Metrics\n");
console.log("Generated by `node scripts/refactor-metrics.mjs`.\n");
console.log("Tracked and non-ignored source files are included; generated and temporary artifact roots are excluded.\n");
console.log(`- Source files scanned: ${records.length}`);
console.log(`- Total physical LOC: ${records.reduce((sum, item) => sum + item.loc, 0)}`);
console.log(`- Total nonblank/noncomment LOC: ${records.reduce((sum, item) => sum + item.ncloc, 0)}`);
console.log(`- Circular dependency count: ${cycles.length}`);
console.log(`- Files below 40 LOC: ${below40.length}`);
console.log(`- Files below 80 LOC: ${below80.length}\n`);

const byPath = new Map(records.map((item) => [item.path, item]));
const metricTargets = [
  "src/app.js",
  "src/ui/canvas-grid.js",
  "src/ui/controllers/lsp-controller.js",
  "src/ui/controllers/lsp-hover-controller.js",
  "src/core/lsp-uri-policy.js",
  "src/ui/controllers/settings-controller.js",
  "src/ui/app-runtime-utils.js"
];
console.log("## Responsibility Signals\n");
console.log("Selected hotspots and the largest-file table are informational; LOC is not a hard gate.\n");
for (const target of metricTargets) {
  const record = byPath.get(target);
  console.log(`- ${target}: ${record ? `${record.loc} physical LOC, ${record.ncloc} nonblank/noncomment LOC, ${record.imports} imports` : "missing"}`);
}

console.log("\n## Top 20 Largest Source Files\n");
console.log(table(["LOC", "NCLOC", "Imports", "Path"], largest.map((item) => [item.loc, item.ncloc, item.imports, item.path])));

console.log("\n## Source Files By Directory\n");
console.log(table(["Files", "Directory"], [...byDir.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dir, count]) => [count, dir])));

console.log("\n## Fragmentation Signals\n");
console.log("Small files and single-caller helper/policy candidates are informational review prompts.\n");

console.log("\n## Files Below 40 LOC\n");
console.log(table(["LOC", "Imports", "Path"], below40.map((item) => [item.loc, item.imports, item.path])));

console.log("\n## Files Below 80 LOC\n");
console.log(table(["LOC", "Imports", "Path"], below80.map((item) => [item.loc, item.imports, item.path])));

console.log("\n## Single-Caller Helper/Policy Candidates\n");
console.log(helperCandidates.length
  ? table(["LOC", "Importers", "Path"], helperCandidates.map((item) => [item.loc, item.importers, item.path]))
  : "No candidates found.");

console.log("\n## Circular Dependencies (Hard Gate)\n");
console.log(cycles.length
  ? cycles.map((cycle) => `- ${cycle.map(rel).join(" -> ")}`).join("\n")
  : "No circular dependencies detected in relative JS imports.");
if (cycles.length) {
  console.error(`Metric gate failed: ${cycles.length} circular import(s) detected.`);
  process.exitCode = 1;
}
