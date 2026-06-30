import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXCLUDED_SEGMENTS = new Set(["node_modules", "dist", "target", ".git", ".runtime-smoke", "bundle", "debug", "release"]);
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".rs"]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(full);
  }
  return files;
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

const files = walk(ROOT).sort();
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
for (const target of metricTargets) {
  const record = byPath.get(target);
  console.log(`- ${target}: ${record ? `${record.loc} physical LOC, ${record.ncloc} nonblank/noncomment LOC, ${record.imports} imports` : "missing"}`);
}

const locLimits = [
  ["src/app.js", 760],
  ["src/ui/canvas-grid.js", 900],
  ["src/ui/controllers/lsp-controller.js", 850]
];
for (const [target, limit] of locLimits) {
  const record = byPath.get(target);
  if (!record || record.loc > limit) {
    console.error(`Metric gate failed: ${target} is ${record?.loc ?? "missing"} physical LOC; limit is ${limit}.`);
    process.exitCode = 1;
  }
}
if (cycles.length) {
  console.error(`Metric gate failed: ${cycles.length} circular import(s) detected.`);
  process.exitCode = 1;
}

console.log("\n## Top 20 Largest Source Files\n");
console.log(table(["LOC", "NCLOC", "Imports", "Path"], largest.map((item) => [item.loc, item.ncloc, item.imports, item.path])));

console.log("\n## Source Files By Directory\n");
console.log(table(["Files", "Directory"], [...byDir.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dir, count]) => [count, dir])));

console.log("\n## Files Below 40 LOC\n");
console.log(table(["LOC", "Imports", "Path"], below40.map((item) => [item.loc, item.imports, item.path])));

console.log("\n## Files Below 80 LOC\n");
console.log(table(["LOC", "Imports", "Path"], below80.map((item) => [item.loc, item.imports, item.path])));

console.log("\n## Single-Caller Helper/Policy Candidates\n");
console.log(helperCandidates.length
  ? table(["LOC", "Importers", "Path"], helperCandidates.map((item) => [item.loc, item.importers, item.path]))
  : "No candidates found.");

console.log("\n## Circular Dependencies\n");
console.log(cycles.length
  ? cycles.map((cycle) => `- ${cycle.map(rel).join(" -> ")}`).join("\n")
  : "No circular dependencies detected in relative JS imports.");
