import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TableDocument } from "../src/core/table-model.js";
import { createDefaultLintSettings, runLint } from "../src/core/lint-engine.js";
import { formatD2rlintCompatibleExport } from "../src/core/lint-export.js";

const rawArgs = process.argv.slice(2);
const writeIndex = rawArgs.indexOf("--write");
const writePath = writeIndex >= 0 ? rawArgs[writeIndex + 1] : "";
const positional = writeIndex >= 0
  ? rawArgs.filter((_, index) => index !== writeIndex && index !== writeIndex + 1)
  : rawArgs;
const [excelZipPath, expectedPath] = positional;

if (!excelZipPath) {
  console.error("Usage: node scripts/lint-compare.js <lint-report.zip|excel-fixture.zip> [d2rlint-output.txt|lint-report.zip] [--write actual-output.txt|actual-output-dir]");
  process.exit(2);
}
if (!existsSync(excelZipPath)) fail(`TXT fixture not found: ${excelZipPath}`, 2);
if (expectedPath && !existsSync(expectedPath)) fail(`Expected lint output not found: ${expectedPath}`, 2);

const tempDirs = [];
try {
  const reportCases = loadReportCases(excelZipPath);
  const cases = reportCases.length && shouldUseReportCases(excelZipPath, expectedPath)
    ? reportCases
    : [loadLegacyCase(excelZipPath, expectedPath)];
  let failed = false;
  for (const testCase of cases) {
    const diagnostics = runLint(testCase.documents, lintSettingsForConfig(testCase.config));
    const actualText = formatD2rlintCompatibleExport({ diagnostics });
    writeActualOutput(writePath, testCase.name, actualText, cases.length > 1);

    const expected = parseD2rlintOutput(testCase.expectedText);
    const actual = parseD2rlintOutput(actualText);
    const comparison = compareRecords(expected.records, actual.records);

    console.log(testCase.name);
    console.log(`TXT files: ${testCase.documents.length}`);
    console.log(`Expected warnings: ${expected.records.length}`);
    console.log(`Actual warnings: ${actual.records.length}`);
    printRuleTable(expected.ruleCounts, actual.ruleCounts);
    printExamples("Missing", comparison.missing);
    printExamples("Extra", comparison.extra);
    console.log("");

    if (comparison.missing.length || comparison.extra.length) failed = true;
  }
  if (writePath) console.log(`Actual compatible export: ${path.resolve(writePath)}`);
  if (failed) process.exit(1);
} finally {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}

function shouldUseReportCases(zipPath, expectedPath) {
  return !expectedPath || path.resolve(zipPath) === path.resolve(expectedPath);
}

function loadLegacyCase(zipPath, expectedOutputPath) {
  if (!expectedOutputPath) fail("Expected lint output is required for legacy fixture comparison.", 2);
  return {
    name: "single",
    documents: loadTxtZip(zipPath),
    expectedText: loadExpectedText(expectedOutputPath),
    config: loadExpectedConfig(expectedOutputPath)
  };
}

function loadReportCases(zipPath) {
  if (!/\.zip$/i.test(zipPath)) return [];
  const workDir = mkdtempSync(path.join(tmpdir(), "txteditor-lint-report-"));
  tempDirs.push(workDir);
  execFileSync("tar", ["-xf", zipPath, "-C", workDir], { stdio: "pipe" });
  const config = loadReportConfig(workDir);
  const caseDirs = new Map();
  for (const file of listFiles(workDir)) {
    const relative = normalizeSlashes(path.relative(workDir, file));
    const parts = relative.split("/");
    if (parts.length < 3) continue;
    const [caseName, folderName, ...rest] = parts;
    if (!caseName || !folderName) continue;
    const entry = caseDirs.get(caseName) ?? { name: caseName, excelFiles: [], expectedFile: "" };
    if (folderName === "excel" && file.toLowerCase().endsWith(".txt")) entry.excelFiles.push(file);
    if (folderName === "original lint" && rest.join("/") === "output.txt") entry.expectedFile = file;
    caseDirs.set(caseName, entry);
  }
  return [...caseDirs.values()]
    .filter((entry) => entry.excelFiles.length && entry.expectedFile)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((entry) => ({
      name: entry.name,
      documents: documentsFromFiles(entry.excelFiles),
      expectedText: readFileSync(entry.expectedFile, "utf8"),
      config
    }));
}

function loadTxtZip(zipPath) {
  const workDir = mkdtempSync(path.join(tmpdir(), "txteditor-lint-fixture-"));
  tempDirs.push(workDir);
  execFileSync("tar", ["-xf", zipPath, "-C", workDir], { stdio: "pipe" });
  const allTxtFiles = listFiles(workDir).filter((file) => file.toLowerCase().endsWith(".txt"));
  const reportFixtureFiles = allTxtFiles.filter((file) => normalizeSlashes(path.relative(workDir, file)).startsWith("excel for test/"));
  const files = reportFixtureFiles.length ? reportFixtureFiles : allTxtFiles;
  if (!files.length) fail(`No TXT files found in ${zipPath}`, 2);
  return documentsFromFiles(files);
}

function loadExpectedText(filePath) {
  if (!/\.zip$/i.test(filePath)) return readFileSync(filePath, "utf8");
  const workDir = mkdtempSync(path.join(tmpdir(), "txteditor-lint-report-"));
  tempDirs.push(workDir);
  execFileSync("tar", ["-xf", filePath, "-C", workDir], { stdio: "pipe" });
  const output = listFiles(workDir).find((file) => normalizeSlashes(file).endsWith("/original lint/output.txt"));
  if (!output) fail(`original lint/output.txt not found in ${filePath}`, 2);
  return readFileSync(output, "utf8");
}

function loadExpectedConfig(filePath) {
  if (!filePath || !/\.zip$/i.test(filePath)) return null;
  const workDir = mkdtempSync(path.join(tmpdir(), "txteditor-lint-config-"));
  tempDirs.push(workDir);
  execFileSync("tar", ["-xf", filePath, "-C", workDir], { stdio: "pipe" });
  return loadReportConfig(workDir);
}

function loadReportConfig(workDir) {
  const configFile = listFiles(workDir).find((file) => normalizeSlashes(path.relative(workDir, file)) === "config.json");
  if (!configFile) return null;
  try {
    return JSON.parse(readFileSync(configFile, "utf8"));
  } catch {
    return null;
  }
}

function lintSettingsForConfig(config) {
  const settings = createDefaultLintSettings();
  if (!config?.rules) return settings;
  for (const profileSettings of Object.values(settings.profiles)) {
    for (const [ruleId, ruleConfig] of Object.entries(config.rules)) {
      const localRule = profileSettings.rules[ruleId];
      if (!localRule) continue;
      localRule.enabled = ruleConfig?.action !== "ignore";
      if (ruleConfig?.action === "error") localRule.severity = "error";
      if (ruleConfig?.action === "warn") localRule.severity = "warning";
    }
  }
  return settings;
}

function documentsFromFiles(files) {
  return [...files]
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
    .map((file) => TableDocument.fromText(path.basename(file), readFileSync(file, "utf8"), { path: file, dirty: false }));
}

function writeActualOutput(outputPath, caseName, text, multipleCases) {
  if (!outputPath) return;
  const resolved = path.resolve(outputPath);
  if (!multipleCases) {
    mkdirSync(path.dirname(resolved), { recursive: true });
    writeFileSync(resolved, text, "utf8");
    return;
  }
  mkdirSync(resolved, { recursive: true });
  writeFileSync(path.join(resolved, `${caseName}-actual-output.txt`), text, "utf8");
}

function parseD2rlintOutput(text) {
  const records = [];
  const ruleCounts = new Map();
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line || line.startsWith("Log started")) continue;
    const [severity, rule, ...messageParts] = line.split("\t");
    if (severity !== "WARN" || !rule || !messageParts.length) continue;
    const message = messageParts.join("\t");
    const key = `${severity}\t${rule}\t${message}`;
    records.push({ severity, rule, message, key });
    ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1);
  }
  return { records, ruleCounts };
}

function compareRecords(expected, actual) {
  const expectedCounts = countByKey(expected);
  const actualCounts = countByKey(actual);
  const missing = [];
  const extra = [];
  for (const record of expected) {
    const available = actualCounts.get(record.key) ?? 0;
    const consumed = expectedCounts.get(`__used:${record.key}`) ?? 0;
    if (consumed < available) {
      expectedCounts.set(`__used:${record.key}`, consumed + 1);
    } else {
      missing.push(record);
    }
  }
  for (const record of actual) {
    const wanted = expectedCounts.get(record.key) ?? 0;
    const consumed = actualCounts.get(`__used:${record.key}`) ?? 0;
    if (consumed < wanted) {
      actualCounts.set(`__used:${record.key}`, consumed + 1);
    } else {
      extra.push(record);
    }
  }
  return { missing, extra };
}

function countByKey(records) {
  const counts = new Map();
  for (const record of records) counts.set(record.key, (counts.get(record.key) ?? 0) + 1);
  return counts;
}

function printRuleTable(expectedCounts, actualCounts) {
  const rules = [...new Set([...expectedCounts.keys(), ...actualCounts.keys()])].sort();
  console.log("Rule\tExpected\tActual");
  for (const rule of rules) {
    console.log(`${rule}\t${expectedCounts.get(rule) ?? 0}\t${actualCounts.get(rule) ?? 0}`);
  }
}

function printExamples(label, records) {
  console.log(`${label}: ${records.length}`);
  for (const record of records.slice(0, 10)) console.log(`${label}\t${record.rule}\t${record.message}`);
}

function listFiles(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) entries.push(...listFiles(file));
    else entries.push(file);
  }
  return entries;
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/").toLowerCase();
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}
