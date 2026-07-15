import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { diagnosticTooltipText } from "../src/ui/hover-policy.js";

const REFERENCE_ROOT_SHA256 = "6930d9c39b5380fd4c242bae4df24a9b0115386bdc074cb8482007e2a033cab0";
const REFERENCE_DATASETS = [
  ["1.13", "1.13c", "113c", 64, 2_920_000, "80ae8704937825906ec456c2d843fa173b5e940300a38eb9ab67ea615b2aa71f"],
  ["2.4", "2.4", "69270", 85, 4_585_088, "1e3e03fa3138debd1b87c6eec0a68d68fc76069842ccf6abffefa7be0d42c008"],
  ["3.1", "3.1", "92198", 91, 5_077_001, "8479a35241ad05196fc99c2219d8bd934ee3fc7820e0c0f5553fed07847d0152"],
  ["3.2", "3.2", "92777a", 91, 5_144_477, "7149352429c5d5ff3e641adb75ce6ff683ce4db6c390651c928f336f8dcddc75"]
];
const JSON_STRING_LOCALES = [
  "enUS", "zhTW", "deDE", "esES", "frFR", "itIT", "koKR", "plPL", "esMX", "jaJP",
  "ptBR", "ruRU", "zhCN"
];

export const NO_VECTOR_LSP_EXE_MESSAGE = "REAL VECTOR-LSP SMOKE NOT RUN: no existing vector-lsp executable found. Pass --vector-lsp-exe or --vector-lsp-root (or set VECTOR_LSP_ROOT); the smoke never builds an external repository.";

export function missingVectorLspExecutableMessage(vectorLspExe = "") {
  if (vectorLspExe) {
    return `REAL VECTOR-LSP SMOKE NOT RUN: supplied vector-lsp executable does not exist: ${path.resolve(vectorLspExe)}. The smoke never builds an external repository.`;
  }
  return NO_VECTOR_LSP_EXE_MESSAGE;
}

export function missingVectorLspContribMessage(contribSource) {
  return `REAL VECTOR-LSP SMOKE NOT RUN: required contrib directory is missing: ${contribSource}. The runtime set is txteditor.exe + vector-lsp.exe + contrib\\. The smoke never builds an external repository.`;
}

export function defaultVectorRoot(repoRoot = process.cwd()) {
  return path.resolve(repoRoot, "..", "vector-lsp");
}

export function vectorLspExecutableName(platform = process.platform) {
  return platform === "win32" ? "vector-lsp.exe" : "vector-lsp";
}

export function vectorLspExecutableCandidates(vectorRoot = defaultVectorRoot(), { platform = process.platform } = {}) {
  const exeName = vectorLspExecutableName(platform);
  return [
    path.join(vectorRoot, exeName),
    path.join(vectorRoot, "target", "release", exeName),
    path.join(vectorRoot, "target", "x86_64-pc-windows-msvc", "release", exeName)
  ];
}

export function findExistingVectorLspExecutable(vectorRoot = defaultVectorRoot(), exists = fs.existsSync, options = {}) {
  return vectorLspExecutableCandidates(vectorRoot, options).find((candidate) => exists(candidate)) ?? null;
}

export function resolveVectorLspExecutable({ vectorRoot = defaultVectorRoot(), vectorLspExe = "", exists = fs.existsSync, platform = process.platform } = {}) {
  if (vectorLspExe) {
    const explicit = path.resolve(vectorLspExe);
    return exists(explicit) ? explicit : null;
  }
  return findExistingVectorLspExecutable(vectorRoot, exists, { platform });
}

export function smokePaths({ repoRoot = process.cwd(), vectorRoot = defaultVectorRoot(repoRoot) } = {}) {
  const runtimeRoot = path.join(repoRoot, ".runtime-smoke");
  return {
    repoRoot,
    vectorRoot,
    contribSource: path.join(vectorRoot, "contrib"),
    stagingDir: path.join(runtimeRoot, "vector-lsp-bundle"),
    workspaceDir: path.join(runtimeRoot, "vector-lsp-workspace"),
    siblingWorkspaceDir: path.join(runtimeRoot, "vector-lsp-sibling-workspace"),
    referenceRootDir: path.join(runtimeRoot, "vector-lsp-reference-root"),
    reportPath: path.join(runtimeRoot, "vector-lsp-smoke-result.json")
  };
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function assertWithin(parent, child) {
  const parentResolved = path.resolve(parent);
  const childResolved = path.resolve(child);
  const relative = path.relative(parentResolved, childResolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside ${parentResolved}: ${childResolved}`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function verifyTooltipMessageSmoke() {
  const skilldesc = "Decimal values are not supported here. The game reads '-6.25' as '-6' and ignores '.25'. Use an integer expression that matches your intent.";
  const prefixStop = "Character ';' is not supported here. The game uses the valid part before it and ignores the rest. Rewrite the expression if the ignored part is intended to run.";
  const wrongArity = "Invalid calculation: Function 'min()' expects 2 arguments, got 1";
  const samples = {
    skilldesc: diagnosticTooltipText({ message: skilldesc, data: { hint: "Use an integer expression that matches your intent." } }),
    prefixStop: diagnosticTooltipText({ message: prefixStop, data: { hint: "Rewrite the expression if the ignored part is intended to run." } }),
    wrongArity: diagnosticTooltipText({ message: wrongArity, data: { hint: "Use exactly 2 arguments." } })
  };
  if (samples.skilldesc !== skilldesc || samples.prefixStop !== prefixStop
    || samples.wrongArity !== `${wrongArity}\n\nWhat to do:\nUse exactly 2 arguments.`) {
    throw new Error(`TXTEditor diagnostic tooltip wording changed: ${JSON.stringify(samples)}`);
  }
  return samples;
}

function jsonStringEntry(id, key) {
  return {
    id,
    Key: key,
    ...Object.fromEntries(JSON_STRING_LOCALES.map((locale) => [locale, ""]))
  };
}

export function verifyReferenceBundle(contribRoot) {
  const root = path.join(contribRoot, "d2rdoc");
  const manifestPath = path.join(root, "reference-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.formatVersion !== 1
      || manifest.totalFileCount !== 331
      || manifest.totalBytes !== 17_726_566
      || String(manifest.canonicalSha256).toLowerCase() !== REFERENCE_ROOT_SHA256
      || manifest.datasets?.length !== REFERENCE_DATASETS.length) {
    throw new Error("Bundled reference manifest inventory/digest mismatch");
  }

  let rootCanonical = "";
  for (const [schemaVariant, gameVersion, datasetId, fileCount, totalBytes, digest] of REFERENCE_DATASETS) {
    const dataset = manifest.datasets.find((candidate) => candidate.schemaVariant === schemaVariant);
    if (!dataset
        || dataset.gameVersion !== gameVersion
        || dataset.source?.datasetId !== datasetId
        || dataset.resourcePath !== `${schemaVariant}/reference`
        || dataset.fileCount !== fileCount
        || dataset.totalBytes !== totalBytes
        || String(dataset.canonicalSha256).toLowerCase() !== digest
        || dataset.files?.length !== fileCount) {
      throw new Error(`Bundled reference dataset mapping/inventory mismatch: ${schemaVariant}`);
    }
    const resourceRoot = path.resolve(root, dataset.resourcePath);
    assertWithin(root, resourceRoot);
    let datasetCanonical = "";
    let actualBytes = 0;
    const seen = new Set();
    const files = [...dataset.files].sort((left, right) =>
      left.path.toLowerCase().localeCompare(right.path.toLowerCase(), "en")
    );
    for (const file of files) {
      const lowerPath = file.path.replaceAll("\\", "/").toLowerCase();
      if (seen.has(lowerPath)) throw new Error(`Duplicate bundled reference path: ${gameVersion}/${file.path}`);
      seen.add(lowerPath);
      const filePath = path.resolve(resourceRoot, file.path);
      assertWithin(resourceRoot, filePath);
      const bytes = fs.readFileSync(filePath);
      const hash = sha256(bytes);
      if (bytes.length !== file.bytes || hash !== String(file.sha256).toLowerCase()) {
        throw new Error(`Bundled reference file verification failed: ${gameVersion}/${file.path}`);
      }
      actualBytes += bytes.length;
      datasetCanonical += `${hash}  ${lowerPath}\n`;
      rootCanonical += `${hash}  ${gameVersion}/${lowerPath}\n`;
    }
    if (actualBytes !== totalBytes || sha256(datasetCanonical) !== digest) {
      throw new Error(`Bundled reference aggregate verification failed: ${gameVersion}`);
    }
  }
  if (sha256(rootCanonical) !== REFERENCE_ROOT_SHA256) {
    throw new Error("Bundled reference root canonical digest mismatch");
  }
  return { fileCount: 331, totalBytes: 17_726_566, canonicalSha256: REFERENCE_ROOT_SHA256 };
}

export function prepareStaging({
  exePath,
  paths,
  requireContrib = false,
  requireReferenceBundle = false
}) {
  paths.siblingWorkspaceDir ??= path.join(path.dirname(paths.workspaceDir), "vector-lsp-sibling-workspace");
  paths.referenceRootDir ??= path.join(path.dirname(paths.workspaceDir), "vector-lsp-reference-root");
  assertWithin(paths.repoRoot, paths.stagingDir);
  assertWithin(paths.repoRoot, paths.workspaceDir);
  assertWithin(paths.repoRoot, paths.siblingWorkspaceDir);
  assertWithin(paths.repoRoot, paths.referenceRootDir);
  assertWithin(paths.repoRoot, paths.reportPath);
  const stagedContribPath = path.join(paths.stagingDir, "contrib");
  if (requireContrib && !fs.existsSync(paths.contribSource)) {
    throw new Error(missingVectorLspContribMessage(paths.contribSource));
  }
  fs.rmSync(paths.stagingDir, { recursive: true, force: true });
  fs.rmSync(paths.workspaceDir, { recursive: true, force: true });
  fs.rmSync(paths.siblingWorkspaceDir, { recursive: true, force: true });
  fs.rmSync(paths.referenceRootDir, { recursive: true, force: true });
  fs.mkdirSync(paths.stagingDir, { recursive: true });
  fs.mkdirSync(paths.workspaceDir, { recursive: true });
  fs.mkdirSync(paths.siblingWorkspaceDir, { recursive: true });
  fs.mkdirSync(paths.referenceRootDir, { recursive: true });
  fs.copyFileSync(exePath, path.join(paths.stagingDir, path.basename(exePath)));
  if (fs.existsSync(paths.contribSource)) {
    fs.cpSync(paths.contribSource, stagedContribPath, { recursive: true });
  }
  if (requireContrib && !fs.existsSync(stagedContribPath)) {
    throw new Error(`Vector-LSP contrib staging failed: ${stagedContribPath}`);
  }
  if (requireReferenceBundle) verifyReferenceBundle(stagedContribPath);
  writeSmokeWorkspace(paths.workspaceDir);
  writeSiblingSmokeWorkspace(paths.siblingWorkspaceDir, paths.referenceRootDir);
}

function writeSmokeWorkspace(workspaceDir) {
  const excelDir = path.join(workspaceDir, "data", "global", "excel");
  const stringsDir = path.join(workspaceDir, "data", "local", "lng", "strings");
  fs.mkdirSync(excelDir, { recursive: true });
  fs.mkdirSync(stringsDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "config.json"),
    `${JSON.stringify({
      single_shot: true,
      io_type: { type: "tcp", host: "127.0.0.1", port: 9 },
      schema_variant: "workspace-config-must-not-win",
      encoding: { invalid: true }
    }, null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(workspaceDir, "skilldesc.txt"),
    Buffer.from("skilldesc\ndesc-smoke\ncaf\xE9\n", "latin1")
  );
  fs.writeFileSync(
    path.join(workspaceDir, "skills.txt"),
    "skill\tskilldesc\tsrvstfunc\nsmoke-skill\tdesc-smoke\tbad-int\nsmoke-skill-2\tcafé\t0\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(workspaceDir, "properties.txt"),
    "code\tfunc1\tstat1\tfunc2\tstat2\n" +
      "active\t17\titem_strengthpercent_perlevel\t\t\n" +
      "inactive\t0\tinactive_unknown\t\t\n" +
      "later\t17\tstrength\t0\tlater_unknown\n" +
      "generic\t1\tgeneric_unknown\t\t\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(workspaceDir, "monpet.txt"),
    "monster\tconsumestat1\tconsumestat2\nrow\titem_addsksrc _tab\tstrength\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(workspaceDir, "missiles.txt"),
    "missile\tpSrvHitFunc\tsHitPar2\tcHitPar2\nsmoke-hit-summon\t6\tNU\t1\n",
    "utf8"
  );
  fs.writeFileSync(path.join(excelDir, "upper.TXT"), "id\nupper\n", "utf8");
  fs.writeFileSync(path.join(workspaceDir, "table.tbl"), "id\ntable\n", "utf8");
  fs.writeFileSync(path.join(workspaceDir, "data.csv"), "id\ndata\n", "utf8");
  const deep = path.join(workspaceDir, "d1", "d2", "d3", "d4", "d5", "d6");
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, "deep.tsv"), "id\ndeep\n", "utf8");
}

function writeSiblingSmokeWorkspace(siblingWorkspaceDir, referenceRootDir) {
  fs.writeFileSync(
    path.join(siblingWorkspaceDir, "MagicPrefix.txt"),
    "Name\titype1\nSmoke Prefix\tmodx\nSmoke Staff\tstaff\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(siblingWorkspaceDir, "MagicSuffix.txt"),
    "Name\titype1\nSmoke Ring\tring  \n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(siblingWorkspaceDir, "ItemTypes.txt"),
    "Code\nmodx\nstaf\nring\n",
    "utf8"
  );
  fs.writeFileSync(path.join(referenceRootDir, "ItemTypes.txt"), "Code\nroot\n", "utf8");
}

function encodeFileUriPath(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((segment, index) => {
      const value = encodeURIComponent(segment);
      if (index === 0 && /^[a-zA-Z]%3A$/.test(value)) return `${value[0]}:`;
      return value;
    })
    .join("/");
  return normalized.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}

function makeFrame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function takeFrame(buffer) {
  const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"));
  if (headerEnd < 0) return null;
  const header = buffer.subarray(0, headerEnd).toString("utf8");
  const match = /Content-Length:\s*(\d+)/i.exec(header);
  if (!match) throw new Error(`Malformed LSP frame header: ${header}`);
  const bodyStart = headerEnd + 4;
  const bodyLength = Number(match[1]);
  const frameEnd = bodyStart + bodyLength;
  if (buffer.length < frameEnd) return null;
  return {
    message: JSON.parse(buffer.subarray(bodyStart, frameEnd).toString("utf8")),
    rest: buffer.subarray(frameEnd)
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestNonNullHover(client, params, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`${label} timed out after ${timeoutMs}ms`);
    const hover = await withTimeout(
      client.request("textDocument/hover", params),
      remaining,
      label
    );
    if (hover != null) return hover;
    // A document notification can publish its diagnostics before another
    // in-flight workspace validation finishes. vector-lsp intentionally
    // rejects a hover captured against that superseded snapshot, so retry
    // the read until the latest workspace identity becomes stable.
    await wait(Math.min(25, Math.max(0, deadline - Date.now())));
  }
}

class LspClient {
  constructor({
    exePath,
    workspaceDir,
    schemaVariant = "3.2",
    jsonDiagnostics = false,
    jsonDiagnosticRules = {}
  }) {
    this.exePath = exePath;
    this.workspaceDir = workspaceDir;
    this.schemaVariant = schemaVariant;
    this.nextId = 1;
    this.buffer = Buffer.alloc(0);
    this.messages = [];
    this.waiters = [];
    this.dynamicRegistrations = [];
    this.jsonDiagnostics = jsonDiagnostics;
    this.jsonDiagnosticRules = jsonDiagnosticRules;
    this.stderr = "";
  }

  start() {
    const jsonRuleEnvironment = this.jsonDiagnostics ? {
      ...(this.jsonDiagnosticRules.duplicateIds == null
        ? {}
        : { VLSP_JSON_DUPLICATE_IDS_ACTION: String(this.jsonDiagnosticRules.duplicateIds) }),
      ...(this.jsonDiagnosticRules.stringFormat == null
        ? {}
        : { VLSP_JSON_STRING_FORMAT_ACTION: String(this.jsonDiagnosticRules.stringFormat) }),
      ...(this.jsonDiagnosticRules.keyUsage == null
        ? {}
        : { VLSP_JSON_KEY_USAGE_ACTION: String(this.jsonDiagnosticRules.keyUsage) }),
      ...(this.jsonDiagnosticRules.keyUsageIdStart == null
        ? {}
        : { VLSP_JSON_KEY_USAGE_ID_START: String(this.jsonDiagnosticRules.keyUsageIdStart) })
    } : {};
    this.child = spawn(this.exePath, ["--editor-mode"], {
      cwd: this.workspaceDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        VLSP_SCHEMA_VARIANT: this.schemaVariant,
        VLSP_ENCODING: "auto",
        VLSP_JSON_DIAGNOSTICS: this.jsonDiagnostics ? "true" : "false",
        ...jsonRuleEnvironment
      },
      windowsHide: true
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.consume(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = takeFrame(this.buffer);
      if (!frame) break;
      this.buffer = frame.rest;
      this.messages.push(frame.message);
      if (frame.message.method === "client/registerCapability" && frame.message.id != null) {
        this.dynamicRegistrations.push(...(frame.message.params?.registrations ?? []));
        this.send({ jsonrpc: "2.0", id: frame.message.id, result: null });
      }
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(frame.message)) {
          this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
          waiter.resolve(frame.message);
        }
      }
    }
  }

  send(message) {
    this.child.stdin.write(makeFrame(message));
  }

  request(method, params = {}) {
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, params });
    return this.waitFor((message) => message.id === id).then((message) => {
      if (message.error) throw new Error(`${method} failed: ${JSON.stringify(message.error)}`);
      return message.result;
    });
  }

  notify(method, params = {}) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  waitFor(predicate) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      this.waiters.push({ predicate, resolve });
    });
  }

  waitForNext(predicate, startIndex = this.messages.length) {
    const existing = this.messages.slice(startIndex).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      this.waiters.push({ predicate: (message) => {
        const index = this.messages.indexOf(message);
        return index >= startIndex && predicate(message);
      }, resolve });
    });
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) return;
    try {
      await withTimeout(this.request("shutdown", null), 3000, "shutdown");
      this.notify("exit");
      await withTimeout(new Promise((resolve) => this.child.once("exit", resolve)), 3000, "exit");
    } catch {
      this.child.kill();
      await Promise.race([
        new Promise((resolve) => this.child.once("exit", resolve)),
        wait(1000)
      ]);
    }
  }
}

async function runLspSession({ exePath, paths, schemaVariant, timeoutMs }) {
  const client = new LspClient({
    exePath,
    workspaceDir: paths.workspaceDir,
    schemaVariant,
    jsonDiagnostics: true,
    jsonDiagnosticRules: {
      duplicateIds: "warn",
      stringFormat: "ignore",
      keyUsage: "warn",
      keyUsageIdStart: 40_000.5
    }
  });
  client.start();
  const skillsPath = path.join(paths.workspaceDir, "skills.txt");
  const skilldescPath = path.join(paths.workspaceDir, "skilldesc.txt");
  const propertiesPath = path.join(paths.workspaceDir, "properties.txt");
  const monpetPath = path.join(paths.workspaceDir, "monpet.txt");
  const missilesPath = path.join(paths.workspaceDir, "missiles.txt");
  const upperPath = path.join(paths.workspaceDir, "data", "global", "excel", "upper.TXT");
  const skillsUri = encodeFileUriPath(skillsPath);
  const skilldescUri = encodeFileUriPath(skilldescPath);
  const propertiesUri = encodeFileUriPath(propertiesPath);
  const monpetUri = encodeFileUriPath(monpetPath);
  const missilesUri = encodeFileUriPath(missilesPath);
  const upperUri = encodeFileUriPath(upperPath);
  const jsonPath = path.join(paths.workspaceDir, "data", "local", "lng", "strings", "item-names.json");
  const jsonUri = encodeFileUriPath(jsonPath);
  const duplicateJsonText = `${JSON.stringify([
    { id: 40_000.5, Key: "SmokeJsonDuplicate" },
    { id: 40_000.5, Key: "SmokeJsonDuplicate" },
    jsonStringEntry(40_001, "SmokeJsonUnused")
  ], null, 2)}\n`;
  const validJsonText = `${JSON.stringify([
    jsonStringEntry(1001, "SmokeJsonOne"),
    jsonStringEntry(1002, "SmokeJsonTwo")
  ], null, 2)}\n`;
  const duplicateJsonDiagnostics = (message) => (message.params?.diagnostics ?? []).filter((diagnostic) => (
    diagnostic.code === "Json/DuplicateIds"
  ));
  const keyUsageJsonDiagnostics = (message) => (message.params?.diagnostics ?? []).filter((diagnostic) => (
    diagnostic.code === "Json/KeyUsage"
  ));
  const waitForJsonDiagnostics = (startIndex, predicate, label) => withTimeout(
    client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === jsonUri
      && Array.isArray(message.params?.diagnostics)
      && predicate(message)
    ), startIndex),
    timeoutMs,
    label
  );
  const notifyJsonChange = (type) => client.notify("workspace/didChangeWatchedFiles", {
    changes: [{ uri: jsonUri, type }]
  });
  const skillsText = fs.readFileSync(skillsPath, "utf8");
  const skilldescText = new TextDecoder("windows-1252", { fatal: true })
    .decode(fs.readFileSync(skilldescPath));
  const propertiesText = fs.readFileSync(propertiesPath, "utf8");
  const monpetText = fs.readFileSync(monpetPath, "utf8");
  const missilesText = fs.readFileSync(missilesPath, "utf8");
  const upperText = fs.readFileSync(upperPath, "utf8");
  // Open Folder must establish the physical JSON scope from primary disk TXT
  // files before any textDocument/didOpen notification exists.
  fs.writeFileSync(jsonPath, duplicateJsonText, "utf8");
  try {
    await withTimeout(client.request("initialize", {
      processId: process.pid,
      rootUri: encodeFileUriPath(paths.workspaceDir),
      initializationOptions: { sessionGeneration: 42 },
      capabilities: {
        workspace: {
          didChangeWatchedFiles: {
            dynamicRegistration: true,
            relativePatternSupport: true
          }
        },
        textDocument: { publishDiagnostics: {} }
      }
    }), timeoutMs, "initialize");
    client.notify("initialized", {});
    const effectiveConfig = await withTimeout(client.waitFor((message) => (
      message.method === "window/logMessage"
      && String(message.params?.message || "").includes("Effective vector-lsp config")
    )), timeoutMs, "effective editor config");
    const effectiveConfigMessage = String(effectiveConfig.params?.message || "");
    if (!effectiveConfigMessage.includes("editorMode=true")
      || !effectiveConfigMessage.includes("transport=stdio")
      || !effectiveConfigMessage.includes("singleShot=false")
      || !effectiveConfigMessage.includes("jsonDiagnostics=true")
      || !effectiveConfigMessage.includes(`variant:${schemaVariant}`)) {
      throw new Error(`editor mode effective config changed: ${effectiveConfigMessage}`);
    }
    await withTimeout(client.waitFor((message) => (
      message.method === "window/logMessage"
      && String(message.params?.message || "").includes("Schema loaded successfully")
    )), timeoutMs, "schema load");
    const indexMessage = await withTimeout(client.waitFor((message) => (
      message.method === "window/logMessage"
      && String(message.params?.message || "").includes("Indexed")
    )), timeoutMs, "workspace index");
    if (!String(indexMessage.params?.message || "").includes("Indexed 9 workspace files")) {
      throw new Error(`editor workspace file policy changed: ${indexMessage.params?.message}`);
    }
    const readyMessage = await withTimeout(client.waitFor((message) => (
      message.method === "vectorLsp/ready"
    )), timeoutMs, "workspace ready");
    if (readyMessage.params?.sessionGeneration !== 42) {
      throw new Error(`ready notification lost session generation: ${JSON.stringify(readyMessage.params)}`);
    }
    if (!client.dynamicRegistrations.some((registration) => (
      registration.method === "workspace/didChangeWatchedFiles"
      && registration.registerOptions?.watchers?.some((watcher) => (
        String(watcher.globPattern?.pattern ?? "").includes("[tT][xX][tT]")
      ))
    ))) {
      throw new Error(`workspace watched-files registration missing: ${JSON.stringify(client.dynamicRegistrations)}`);
    }
    const jsonFilePattern = "*.[jJ][sS][oO][nN]";
    await withTimeout(client.waitFor((message) => (
      message.method === "client/registerCapability"
      && message.params?.registrations?.some((registration) => (
        registration.method === "workspace/didChangeWatchedFiles"
        && String(registration.id ?? "").includes("-json-")
        && registration.registerOptions?.watchers?.some((watcher) => (
          watcher.globPattern?.pattern === jsonFilePattern
        ))
      ))
    )), timeoutMs, "local JSON watched-files registration");
    const jsonWatchRegistrations = client.dynamicRegistrations.filter((registration) => (
      registration.method === "workspace/didChangeWatchedFiles"
      && String(registration.id ?? "").includes("-json-")
    ));
    const jsonWatchers = jsonWatchRegistrations.flatMap((registration) => (
      registration.registerOptions?.watchers ?? []
    ));
    const normalizedWatcherBase = (watcher) => (
      String(watcher.globPattern?.baseUri ?? "").replace(/\/$/, "")
    );
    const expectedStringsUri = encodeFileUriPath(
      path.join(paths.workspaceDir, "data", "local", "lng", "strings")
    ).replace(/\/$/, "");
    const expectedLngUri = encodeFileUriPath(
      path.join(paths.workspaceDir, "data", "local", "lng")
    ).replace(/\/$/, "");
    const expectedGlobalUri = encodeFileUriPath(
      path.join(paths.workspaceDir, "data", "global")
    ).replace(/\/$/, "");
    const stringsFileWatcher = jsonWatchers.find((watcher) => (
      normalizedWatcherBase(watcher) === expectedStringsUri
      && watcher.globPattern?.pattern === jsonFilePattern
    ));
    const stringsGuardWatcher = jsonWatchers.find((watcher) => (
      normalizedWatcherBase(watcher) === expectedLngUri
      && watcher.globPattern?.pattern === "strings"
      && watcher.kind === 5
    ));
    const layoutsGuardWatcher = jsonWatchers.find((watcher) => (
      normalizedWatcherBase(watcher) === expectedGlobalUri
      && watcher.globPattern?.pattern === "ui"
      && watcher.kind === 5
    ));
    const recursiveJsonWatchers = jsonWatchers.filter((watcher) => {
      const pattern = String(watcher.globPattern?.pattern ?? "");
      return pattern.includes("**") || pattern.includes("/") || pattern.includes("\\");
    });
    if (!stringsFileWatcher || !stringsGuardWatcher || !layoutsGuardWatcher
      || recursiveJsonWatchers.length > 0) {
      throw new Error(`targeted/nonrecursive JSON watched-files registration changed: ${JSON.stringify(jsonWatchRegistrations)}`);
    }

    const workspaceOnlyJson = await withTimeout(client.waitFor((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === jsonUri
      && duplicateJsonDiagnostics(message).length === 2
    )), timeoutMs, "Open Folder JSON diagnostics before didOpen");
    if (workspaceOnlyJson.params.diagnostics.length !== 3
      || keyUsageJsonDiagnostics(workspaceOnlyJson).length !== 1) {
      throw new Error(`Open Folder JSON diagnostics changed: ${JSON.stringify(workspaceOnlyJson.params)}`);
    }

    const workspaceJsonDeleteStart = client.messages.length;
    fs.rmSync(jsonPath, { force: true });
    notifyJsonChange(3);
    await waitForJsonDiagnostics(
      workspaceJsonDeleteStart,
      (message) => message.params.diagnostics.length === 0,
      "Open Folder JSON cleanup before didOpen"
    );
    client.notify("textDocument/didOpen", {
      textDocument: { uri: upperUri, languageId: "plaintext", version: 1, text: upperText }
    });

    const jsonCreateStart = client.messages.length;
    fs.writeFileSync(jsonPath, duplicateJsonText, "utf8");
    notifyJsonChange(1);
    const jsonCreated = await waitForJsonDiagnostics(
      jsonCreateStart,
      (message) => duplicateJsonDiagnostics(message).length === 2,
      "watched JSON diagnostics after create"
    );
    const createdMessages = duplicateJsonDiagnostics(jsonCreated).map((diagnostic) => diagnostic.message);
    if (jsonCreated.params.diagnostics.length !== 3
      || duplicateJsonDiagnostics(jsonCreated).some((diagnostic) => diagnostic.severity !== 2)
      || keyUsageJsonDiagnostics(jsonCreated).length !== 1
      || keyUsageJsonDiagnostics(jsonCreated)[0]?.severity !== 2
      || !keyUsageJsonDiagnostics(jsonCreated)[0]?.message.includes("id: 40001")
      || !createdMessages.some((message) => message.includes("duplicate id 40000.5"))
      || !createdMessages.some((message) => message.includes("duplicate Key 'SmokeJsonDuplicate'"))) {
      throw new Error(`watched JSON duplicate diagnostics changed: ${JSON.stringify(jsonCreated.params)}`);
    }

    const jsonFixStart = client.messages.length;
    fs.writeFileSync(jsonPath, validJsonText, "utf8");
    notifyJsonChange(2);
    const jsonFixed = await waitForJsonDiagnostics(
      jsonFixStart,
      (message) => message.params.diagnostics.length === 0,
      "watched JSON diagnostics after fix"
    );

    const jsonReintroduceStart = client.messages.length;
    fs.writeFileSync(jsonPath, duplicateJsonText, "utf8");
    notifyJsonChange(2);
    const jsonReintroduced = await waitForJsonDiagnostics(
      jsonReintroduceStart,
      (message) => duplicateJsonDiagnostics(message).length === 2,
      "watched JSON diagnostics after error reintroduction"
    );

    const jsonDeleteStart = client.messages.length;
    fs.rmSync(jsonPath, { force: true });
    notifyJsonChange(3);
    const jsonDeleted = await waitForJsonDiagnostics(
      jsonDeleteStart,
      (message) => message.params.diagnostics.length === 0,
      "watched JSON diagnostics after delete"
    );

    const jsonRestoreStart = client.messages.length;
    fs.writeFileSync(jsonPath, duplicateJsonText, "utf8");
    notifyJsonChange(1);
    const jsonRestored = await waitForJsonDiagnostics(
      jsonRestoreStart,
      (message) => duplicateJsonDiagnostics(message).length === 2,
      "watched JSON diagnostics after restore"
    );

    const jsonFinalDeleteStart = client.messages.length;
    fs.rmSync(jsonPath, { force: true });
    notifyJsonChange(3);
    const jsonFinalDelete = await waitForJsonDiagnostics(
      jsonFinalDeleteStart,
      (message) => message.params.diagnostics.length === 0,
      "watched JSON diagnostics after final delete"
    );
    const unexpectedJsonPublishes = client.messages.filter((message) => (
      message.method === "textDocument/publishDiagnostics"
      && String(message.params?.uri ?? "").toLowerCase().endsWith(".json")
      && message.params.uri !== jsonUri
    ));
    if (unexpectedJsonPublishes.length) {
      throw new Error(`reference/bundled JSON diagnostics were published: ${JSON.stringify(unexpectedJsonPublishes)}`);
    }
    const perfMessage = await withTimeout(client.waitFor((message) => (
      message.method === "window/logMessage"
      && String(message.params?.message || "").includes("vlsp perf session=42")
    )), timeoutMs, "server startup performance log");
    const serverPerf = String(perfMessage.params?.message || "");
    for (const phase of ["schemaMs=", "enumerateMs=", "readParseMs=", "indexMs=", "reconcileMs=", "scanMs=", "startupMs="]) {
      if (!serverPerf.includes(phase)) throw new Error(`server performance phase missing ${phase}: ${serverPerf}`);
    }
    const startupDiagnostics = client.messages.filter((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === skillsUri
      && message.params?.version == null
    )).at(-1);
    if (startupDiagnostics?.params?.diagnostics?.length !== 1) {
      throw new Error(`auto-decoded disk diagnostics changed: ${JSON.stringify(startupDiagnostics?.params)}`);
    }
    const propertiesDiagnostics = client.messages.filter((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === propertiesUri
      && message.params?.version == null
    )).at(-1)?.params?.diagnostics ?? [];
    const propertyMessage = "Unknown stat name 'item_strengthpercent_perlevel'. This property has no effect. Use the exact Stat name from itemstatcost.txt.";
    const genericPropertyMessage = "Unknown stat name 'generic_unknown'. Use the exact Stat name from itemstatcost.txt.";
    if (propertiesDiagnostics.length !== 2
      || propertiesDiagnostics[0]?.severity !== 2
      || propertiesDiagnostics[0]?.message !== propertyMessage
      || propertiesDiagnostics[0]?.range?.start?.line !== 1
      || propertiesDiagnostics[0]?.range?.start?.character !== "active\t17\t".length
      || propertiesDiagnostics[0]?.range?.end?.character !== "active\t17\titem_strengthpercent_perlevel".length
      || propertiesDiagnostics[1]?.severity !== 2
      || propertiesDiagnostics[1]?.message !== genericPropertyMessage
      || propertiesDiagnostics[1]?.range?.start?.line !== 4
      || propertiesDiagnostics[1]?.range?.start?.character !== "generic\t1\t".length
      || propertiesDiagnostics[1]?.range?.end?.character !== "generic\t1\tgeneric_unknown".length) {
      throw new Error(`Properties active/inactive stat diagnostics changed: ${JSON.stringify(propertiesDiagnostics)}`);
    }
    const monpetDiagnostics = client.messages.filter((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === monpetUri
      && message.params?.version == null
    )).at(-1)?.params?.diagnostics ?? [];
    const consumeMessage = "Unknown stat name 'item_addsksrc _tab'. This Consume bonus is not applied; other Consume slots still work. Use the exact Stat name from itemstatcost.txt.";
    if (monpetDiagnostics.length !== 1
      || monpetDiagnostics[0]?.severity !== 2
      || monpetDiagnostics[0]?.message !== consumeMessage
      || monpetDiagnostics[0]?.range?.start?.line !== 1
      || monpetDiagnostics[0]?.range?.start?.character !== "row\t".length
      || monpetDiagnostics[0]?.range?.end?.character !== "row\titem_addsksrc _tab".length) {
      throw new Error(`MonPet consumestat diagnostics changed: ${JSON.stringify(monpetDiagnostics)}`);
    }
    const missilesDiagnostics = client.messages.filter((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === missilesUri
      && message.params?.version == null
    )).at(-1)?.params?.diagnostics ?? [];
    const hitSummonMessage = "'NU' is not a numeric mode ID here. The game replaces it with 1 (NU). Use 1 for neutral mode.";
    const hitSummonStart = "smoke-hit-summon\t6\t".length;
    if (missilesDiagnostics.length !== 1
      || missilesDiagnostics[0]?.severity !== 2
      || missilesDiagnostics[0]?.message !== hitSummonMessage
      || missilesDiagnostics[0]?.range?.start?.line !== 1
      || missilesDiagnostics[0]?.range?.start?.character !== hitSummonStart
      || missilesDiagnostics[0]?.range?.end?.character !== hitSummonStart + 2) {
      throw new Error(`HitSummon mode diagnostics changed: ${JSON.stringify(missilesDiagnostics)}`);
    }
    const propertiesOpenStart = client.messages.length;
    client.notify("textDocument/didOpen", {
      textDocument: { uri: propertiesUri, languageId: "plaintext", version: 1, text: propertiesText }
    });
    const openPropertiesDiagnostics = (await withTimeout(client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === propertiesUri
      && message.params?.version === 1
    ), propertiesOpenStart), timeoutMs, "open Properties diagnostics")).params.diagnostics;
    const monpetOpenStart = client.messages.length;
    client.notify("textDocument/didOpen", {
      textDocument: { uri: monpetUri, languageId: "plaintext", version: 1, text: monpetText }
    });
    const openMonpetDiagnostics = (await withTimeout(client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === monpetUri
      && message.params?.version === 1
    ), monpetOpenStart), timeoutMs, "open MonPet diagnostics")).params.diagnostics;
    if (openPropertiesDiagnostics.length !== 2
      || openPropertiesDiagnostics[0]?.message !== propertyMessage
      || openPropertiesDiagnostics[1]?.message !== genericPropertyMessage
      || openMonpetDiagnostics.length !== 1
      || openMonpetDiagnostics[0]?.message !== consumeMessage) {
      throw new Error(`open Properties/MonPet diagnostics changed: ${JSON.stringify({ openPropertiesDiagnostics, openMonpetDiagnostics })}`);
    }
    if (diagnosticTooltipText(openPropertiesDiagnostics[0]) !== propertyMessage
      || diagnosticTooltipText(openPropertiesDiagnostics[1]) !== genericPropertyMessage
      || diagnosticTooltipText(openMonpetDiagnostics[0]) !== consumeMessage) {
      throw new Error("Properties/MonPet Problems tooltip changed the diagnostic message");
    }
    const missilesOpenStart = client.messages.length;
    client.notify("textDocument/didOpen", {
      textDocument: { uri: missilesUri, languageId: "plaintext", version: 1, text: missilesText }
    });
    const openMissilesDiagnostics = (await withTimeout(client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === missilesUri
      && message.params?.version === 1
    ), missilesOpenStart), timeoutMs, "open HitSummon diagnostics")).params.diagnostics;
    if (openMissilesDiagnostics.length !== 1
      || openMissilesDiagnostics[0]?.message !== hitSummonMessage
      || diagnosticTooltipText(openMissilesDiagnostics[0]) !== hitSummonMessage) {
      throw new Error(`HitSummon Problems tooltip changed: ${JSON.stringify(openMissilesDiagnostics)}`);
    }
    const hitSummonHover = await requestNonNullHover(client, {
      textDocument: { uri: missilesUri },
      position: { line: 1, character: hitSummonStart + 1 }
    }, timeoutMs, "HitSummon mode hover");
    const hitSummonHoverText = String(hitSummonHover?.contents?.value ?? hitSummonHover?.contents ?? "");
    if (!hitSummonHoverText.includes("HitSummon monster mode")
      || !hitSummonHoverText.includes("0=DT, 1=NU")
      || !hitSummonHoverText.includes("15=RN")
      || !hitSummonHoverText.includes("Current value: `NU` -> 1 (NU)")) {
      throw new Error(`HitSummon hover changed: ${hitSummonHoverText}`);
    }
    const propertyHover = await withTimeout(client.request("textDocument/hover", {
      textDocument: { uri: propertiesUri },
      position: { line: 1, character: "active\t17\t".length + 1 }
    }), timeoutMs, "active Properties stat hover");
    const propertyHoverText = String(propertyHover?.contents?.value ?? propertyHover?.contents ?? "");
    if (!propertyHoverText.includes("This property has no effect")
      || !propertyHoverText.includes("Use the exact Stat name")) {
      throw new Error(`Properties stat hover changed: ${propertyHoverText}`);
    }
    const inactivePropertyHover = await withTimeout(client.request("textDocument/hover", {
      textDocument: { uri: propertiesUri },
      position: { line: 2, character: "inactive\t0\t".length + 1 }
    }), timeoutMs, "inactive Properties stat hover");
    const inactivePropertyHoverText = String(inactivePropertyHover?.contents?.value ?? inactivePropertyHover?.contents ?? "");
    if (inactivePropertyHoverText.includes("Unknown stat name")
      || inactivePropertyHoverText.includes("Reference resolved")) {
      throw new Error(`inactive Properties stat exposed a reference result: ${inactivePropertyHoverText}`);
    }
    const genericPropertyHover = await withTimeout(client.request("textDocument/hover", {
      textDocument: { uri: propertiesUri },
      position: { line: 4, character: "generic\t1\t".length + 1 }
    }), timeoutMs, "reachable non-func17 Properties stat hover");
    const genericPropertyHoverText = String(genericPropertyHover?.contents?.value ?? genericPropertyHover?.contents ?? "");
    if (!genericPropertyHoverText.includes("Use the exact Stat name")
      || genericPropertyHoverText.includes("has no effect")) {
      throw new Error(`non-func17 Properties stat hover overclaimed an effect: ${genericPropertyHoverText}`);
    }
    const consumeHover = await withTimeout(client.request("textDocument/hover", {
      textDocument: { uri: monpetUri },
      position: { line: 1, character: "row\t".length + 1 }
    }), timeoutMs, "MonPet consumestat hover");
    const consumeHoverText = String(consumeHover?.contents?.value ?? consumeHover?.contents ?? "");
    if (!consumeHoverText.includes("This Consume bonus is not applied")
      || !consumeHoverText.includes("other Consume slots still work")) {
      throw new Error(`MonPet consumestat hover changed: ${consumeHoverText}`);
    }
    const openStartIndex = client.messages.length;
    client.notify("textDocument/didOpen", {
      textDocument: { uri: skilldescUri, languageId: "plaintext", version: 1, text: skilldescText }
    });
    await withTimeout(client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === skilldescUri
      && message.params?.version === 1
      && Array.isArray(message.params?.diagnostics)
    ), openStartIndex), timeoutMs, "equivalent didOpen diagnostics");
    const skillsOpenStartIndex = client.messages.length;
    client.notify("textDocument/didOpen", {
      textDocument: { uri: skillsUri, languageId: "plaintext", version: 1, text: skillsText }
    });
    const diagnosticsMessage = await withTimeout(client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === skillsUri
      && message.params?.version === 1
      && Array.isArray(message.params?.diagnostics)
      && message.params.diagnostics.length > 0
    ), skillsOpenStartIndex), timeoutMs, "diagnostics");
    if (diagnosticsMessage.params.version !== 1) {
      throw new Error(`didOpen diagnostics were not version 1: ${JSON.stringify(diagnosticsMessage.params.version)}`);
    }
    await wait(50);
    const unrelatedOpenPublishes = client.messages.slice(skillsOpenStartIndex).filter((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri !== skillsUri
    ));
    if (unrelatedOpenPublishes.length) {
      throw new Error(`equivalent didOpen republished unrelated diagnostics: ${JSON.stringify(unrelatedOpenPublishes.map((message) => message.params))}`);
    }
    const hover = await withTimeout(client.request("textDocument/hover", {
      textDocument: { uri: skillsUri },
      position: { line: 0, character: "skill\ts".length }
    }), timeoutMs, "hover");
    if (!hover) throw new Error("hover returned no content");
    const definition = await withTimeout(client.request("textDocument/definition", {
      textDocument: { uri: skillsUri },
      position: { line: 1, character: "smoke-skill\td".length }
    }), timeoutMs, "definition");
    if (!definition) throw new Error("definition returned no location");
    const staleEditedText = "skill\tskilldesc\tsrvstfunc\nsmoke-skill\tdesc-smoke\tbad-int\nsmoke-skill-2\tcafé\t0\n";
    const editedText = "skill\tskilldesc\tsrvstfunc\nsmoke-skill\tdesc-smoke\t0\nsmoke-skill-2\tcafé\t0\n";
    const editStartIndex = client.messages.length;
    client.notify("textDocument/didChange", {
      textDocument: { uri: skillsUri, version: 2 },
      contentChanges: [{ text: staleEditedText }]
    });
    client.notify("textDocument/didChange", {
      textDocument: { uri: skillsUri, version: 3 },
      contentChanges: [{ text: editedText }]
    });
    const editDiagnostics = await withTimeout(client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === skillsUri
      && message.params?.version === 3
      && Array.isArray(message.params?.diagnostics)
    ), editStartIndex), timeoutMs, "edit diagnostics");
    if (editDiagnostics.params.diagnostics.length >= diagnosticsMessage.params.diagnostics.length) {
      throw new Error("edit diagnostics did not clear the staged invalid integer diagnostic");
    }
    await wait(50);
    const editPublishes = client.messages.slice(editStartIndex).filter((message) => (
      message.method === "textDocument/publishDiagnostics" && message.params?.uri === skillsUri
    ));
    if (editPublishes.at(-1)?.params?.version !== 3) {
      throw new Error(`stale diagnostics won after version 3: ${JSON.stringify(editPublishes.map((message) => message.params?.version))}`);
    }
    const deletedTargetText = "skilldesc\ndesc-smoke\n";
    const deleteStartIndex = client.messages.length;
    client.notify("textDocument/didChange", {
      textDocument: { uri: skilldescUri, version: 2 },
      contentChanges: [{ text: deletedTargetText }]
    });
    const dependentError = await withTimeout(client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === skillsUri
      && message.params?.version === 3
      && message.params?.diagnostics?.length > 0
    ), deleteStartIndex), timeoutMs, "dependent diagnostics after target delete");

    const restoreStartIndex = client.messages.length;
    client.notify("textDocument/didChange", {
      textDocument: { uri: skilldescUri, version: 3 },
      contentChanges: [{ text: skilldescText }]
    });
    const dependentClear = await withTimeout(client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === skillsUri
      && message.params?.version === 3
      && message.params?.diagnostics?.length === 0
    ), restoreStartIndex), timeoutMs, "dependent diagnostics after target restore");

    const closeDeleteStartIndex = client.messages.length;
    client.notify("textDocument/didChange", {
      textDocument: { uri: skilldescUri, version: 4 },
      contentChanges: [{ text: deletedTargetText }]
    });
    await withTimeout(client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === skillsUri
      && message.params?.version === 3
      && message.params?.diagnostics?.length > 0
    ), closeDeleteStartIndex), timeoutMs, "dependent diagnostics before didClose");
    const closeStartIndex = client.messages.length;
    client.notify("textDocument/didClose", { textDocument: { uri: skilldescUri } });
    const closeRestore = await withTimeout(client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === skillsUri
      && message.params?.version === 3
      && message.params?.diagnostics?.length === 0
    ), closeStartIndex), timeoutMs, "dependent diagnostics after didClose disk restore");
    await client.stop();
    return {
      initialize: "pass",
      editorModeConfig: effectiveConfigMessage,
      indexedFiles: 9,
      watchedFileRegistrations: client.dynamicRegistrations.length,
      watchedJsonRegistrations: jsonWatchRegistrations.length,
      watchedJsonRecursivePatterns: recursiveJsonWatchers.length,
      workspaceOnlyJsonDiagnostics: workspaceOnlyJson.params.diagnostics.length,
      watchedJsonCreateDiagnostics: duplicateJsonDiagnostics(jsonCreated).length,
      watchedJsonDuplicateSeverity: duplicateJsonDiagnostics(jsonCreated)[0]?.severity,
      watchedJsonKeyUsageDiagnostics: keyUsageJsonDiagnostics(jsonCreated).length,
      watchedJsonKeyUsageSeverity: keyUsageJsonDiagnostics(jsonCreated)[0]?.severity,
      watchedJsonFixDiagnostics: jsonFixed.params.diagnostics.length,
      watchedJsonReintroducedDiagnostics: duplicateJsonDiagnostics(jsonReintroduced).length,
      watchedJsonDeleteDiagnostics: jsonDeleted.params.diagnostics.length,
      watchedJsonRestoreDiagnostics: duplicateJsonDiagnostics(jsonRestored).length,
      watchedJsonFinalDeleteDiagnostics: jsonFinalDelete.params.diagnostics.length,
      watchedJsonFallbackPublishes: unexpectedJsonPublishes.length,
      readyGeneration: readyMessage.params.sessionGeneration,
      serverPerf,
      startupDiagnostics: startupDiagnostics.params.diagnostics.length,
      propertiesDiagnostics: propertiesDiagnostics.length,
      propertiesDiagnosticsVersion: 1,
      propertiesProblem: propertiesDiagnostics[0].message,
      propertiesHover: "pass",
      inactivePropertiesHover: "suppressed",
      genericPropertiesHover: "no unproven effect claim",
      monpetDiagnostics: monpetDiagnostics.length,
      monpetDiagnosticsVersion: 1,
      monpetProblem: monpetDiagnostics[0].message,
      monpetHover: "pass",
      hitSummonDiagnostics: missilesDiagnostics.length,
      hitSummonProblem: missilesDiagnostics[0].message,
      hitSummonTooltip: "pass",
      hitSummonHover: "pass",
      diagnostics: diagnosticsMessage.params.diagnostics.length,
      diagnosticsVersion: diagnosticsMessage.params.version,
      equivalentOpenUnrelatedPublishes: unrelatedOpenPublishes.length,
      hover: "pass",
      definition: "pass",
      editDiagnostics: editDiagnostics.params.diagnostics.length,
      editDiagnosticsVersion: editDiagnostics.params.version,
      dependentDeleteDiagnostics: dependentError.params.diagnostics.length,
      dependentRestoreDiagnostics: dependentClear.params.diagnostics.length,
      didCloseRestoreDiagnostics: closeRestore.params.diagnostics.length,
      stderr: client.stderr.trim()
    };
  } finally {
    fs.rmSync(jsonPath, { force: true });
    await client.stop();
  }
}

async function runStandaloneSiblingSession({ exePath, paths, timeoutMs }) {
  const client = new LspClient({
    exePath,
    workspaceDir: paths.siblingWorkspaceDir,
    schemaVariant: "3.2"
  });
  client.start();
  const magicPath = path.join(paths.siblingWorkspaceDir, "MagicPrefix.txt");
  const suffixPath = path.join(paths.siblingWorkspaceDir, "MagicSuffix.txt");
  const siblingItemTypesPath = path.join(paths.siblingWorkspaceDir, "ItemTypes.txt");
  const referenceItemTypesPath = path.join(paths.referenceRootDir, "ItemTypes.txt");
  const magicUri = encodeFileUriPath(magicPath);
  const suffixUri = encodeFileUriPath(suffixPath);
  const siblingItemTypesUri = encodeFileUriPath(siblingItemTypesPath);
  const referenceItemTypesUri = encodeFileUriPath(referenceItemTypesPath);
  const initialMagicText = "Name\titype1\nSmoke Prefix\tmodx\nSmoke Staff\tstaff\n";
  const suffixText = "Name\titype1\nSmoke Ring\tring  \n";
  const magicText = (value) => `Name\titype1\nSmoke Prefix\t${value}\n`;
  const itemTypesText = (value) => `Code\n${value}\n`;
  const referenceDiagnostics = (message) => (message.params?.diagnostics ?? []).filter((diagnostic) => (
    String(diagnostic?.message ?? "").includes("Unknown code")
    && String(diagnostic?.message ?? "").includes("four-character code and letter case")
  ));
  const waitForDiagnostics = (uri, startIndex, predicate, label) => withTimeout(
    client.waitForNext((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === uri
      && Array.isArray(message.params?.diagnostics)
      && predicate(message)
    ), startIndex),
    timeoutMs,
    label
  );
  const hoverCell = async (uri, line, rowLabel, label) => {
    const hover = await withTimeout(client.request("textDocument/hover", {
      textDocument: { uri },
      position: { line, character: `${rowLabel}\t`.length + 1 }
    }), timeoutMs, label);
    const content = String(hover?.contents?.value ?? hover?.contents ?? "");
    if (!content) throw new Error(`${label} returned no content`);
    return content;
  };

  try {
    await withTimeout(client.request("initialize", {
      processId: process.pid,
      rootUri: encodeFileUriPath(paths.siblingWorkspaceDir),
      initializationOptions: {
        sessionGeneration: 84,
        referenceContextMode: "sibling",
        referenceRootUri: encodeFileUriPath(paths.referenceRootDir)
      },
      capabilities: {
        workspace: {
          didChangeWatchedFiles: {
            dynamicRegistration: true,
            relativePatternSupport: true
          }
        },
        textDocument: { publishDiagnostics: {} }
      }
    }), timeoutMs, "sibling initialize");
    client.notify("initialized", {});
    await withTimeout(client.waitFor((message) => (
      message.method === "window/logMessage"
      && String(message.params?.message || "").includes("Schema loaded successfully")
    )), timeoutMs, "sibling schema load");
    const ready = await withTimeout(client.waitFor((message) => (
      message.method === "vectorLsp/ready"
    )), timeoutMs, "sibling workspace ready");
    if (ready.params?.sessionGeneration !== 84) {
      throw new Error(`sibling ready notification lost generation: ${JSON.stringify(ready.params)}`);
    }
    if (client.dynamicRegistrations.filter((registration) => (
      registration.method === "workspace/didChangeWatchedFiles"
    )).length < 2) {
      throw new Error(`sibling/reference watched-files registrations missing: ${JSON.stringify(client.dynamicRegistrations)}`);
    }

    const hiddenPublishes = client.messages.filter((message) => (
      message.method === "textDocument/publishDiagnostics"
      && [magicUri, suffixUri, siblingItemTypesUri, referenceItemTypesUri].includes(message.params?.uri)
    ));
    if (hiddenPublishes.length) {
      throw new Error(`hidden reference tables published startup diagnostics: ${JSON.stringify(hiddenPublishes)}`);
    }

    const magicOpenStart = client.messages.length;
    client.notify("textDocument/didOpen", {
      textDocument: { uri: magicUri, languageId: "plaintext", version: 1, text: initialMagicText }
    });
    const initialMagic = await waitForDiagnostics(
      magicUri,
      magicOpenStart,
      (message) => message.params?.version === 1,
      "sibling-backed MagicPrefix diagnostics"
    );
    if (referenceDiagnostics(initialMagic).length !== 0) {
      throw new Error(`sibling mod 4CC was diagnosed: ${JSON.stringify(initialMagic.params)}`);
    }
    const siblingHover = await hoverCell(magicUri, 1, "Smoke Prefix", "sibling source hover");
    if (!siblingHover.includes("`modx` → `modx`")
      || !siblingHover.includes("TXT file in the same folder (game version 3.2)")) {
      throw new Error(`sibling source/version hover changed: ${siblingHover}`);
    }
    const staffHover = await hoverCell(magicUri, 2, "Smoke Staff", "staff fixed4 hover");
    if (!staffHover.includes("`staff` → `staf`")
      || !staffHover.includes("TXT file in the same folder (game version 3.2)")) {
      throw new Error(`MagicPrefix staff fixed4 hover changed: ${staffHover}`);
    }

    const suffixOpenStart = client.messages.length;
    client.notify("textDocument/didOpen", {
      textDocument: { uri: suffixUri, languageId: "plaintext", version: 1, text: suffixText }
    });
    const initialSuffix = await waitForDiagnostics(
      suffixUri,
      suffixOpenStart,
      (message) => message.params?.version === 1,
      "sibling-backed MagicSuffix diagnostics"
    );
    if (referenceDiagnostics(initialSuffix).length !== 0) {
      throw new Error(`MagicSuffix ring fixed4 value was diagnosed: ${JSON.stringify(initialSuffix.params)}`);
    }
    const ringHover = await hoverCell(suffixUri, 1, "Smoke Ring", "ring fixed4 hover");
    if (!ringHover.includes("`ring␠␠` → `ring`")
      || !ringHover.includes("TXT file in the same folder (game version 3.2)")) {
      throw new Error(`MagicSuffix ring fixed4 hover changed: ${ringHover}`);
    }

    const shadowStart = client.messages.length;
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: siblingItemTypesUri,
        languageId: "plaintext",
        version: 1,
        text: itemTypesText("xxxx")
      }
    });
    await waitForDiagnostics(
      siblingItemTypesUri,
      shadowStart,
      (message) => message.params?.version === 1,
      "open ItemTypes diagnostics"
    );
    const shadowedMagic = await waitForDiagnostics(
      magicUri,
      shadowStart,
      (message) => referenceDiagnostics(message).length > 0,
      "open ItemTypes shadow diagnostics"
    );
    const shadowProblemLine = String(referenceDiagnostics(shadowedMagic)[0]?.message ?? "");
    if (!shadowProblemLine.startsWith("Unknown code '")
      || !shadowProblemLine.includes("Check the four-character code and letter case.")
      || /[\r\n]/.test(shadowProblemLine)) {
      throw new Error(`Problems one-line message changed: ${JSON.stringify(shadowProblemLine)}`);
    }

    const latestStart = client.messages.length;
    client.notify("textDocument/didChange", {
      textDocument: { uri: siblingItemTypesUri, version: 2 },
      contentChanges: [{ text: itemTypesText("modx") }]
    });
    client.notify("textDocument/didChange", {
      textDocument: { uri: siblingItemTypesUri, version: 3 },
      contentChanges: [{ text: itemTypesText("xxxx") }]
    });
    await waitForDiagnostics(
      siblingItemTypesUri,
      latestStart,
      (message) => message.params?.version === 3,
      "latest ItemTypes version diagnostics"
    );
    const latestMagic = await waitForDiagnostics(
      magicUri,
      latestStart,
      (message) => referenceDiagnostics(message).length > 0,
      "latest ItemTypes dependent diagnostics"
    );
    await wait(50);
    const itemTypesPublishes = client.messages.slice(latestStart).filter((message) => (
      message.method === "textDocument/publishDiagnostics"
      && message.params?.uri === siblingItemTypesUri
    ));
    if (itemTypesPublishes.at(-1)?.params?.version !== 3) {
      throw new Error(`stale ItemTypes diagnostics won: ${JSON.stringify(itemTypesPublishes.map((message) => message.params?.version))}`);
    }

    const closeRestoreStart = client.messages.length;
    client.notify("textDocument/didClose", { textDocument: { uri: siblingItemTypesUri } });
    const closeRestore = await waitForDiagnostics(
      magicUri,
      closeRestoreStart,
      (message) => referenceDiagnostics(message).length === 0,
      "sibling didClose latest disk restore"
    );
    const restoredSiblingHover = await hoverCell(magicUri, 1, "Smoke Prefix", "restored sibling hover");
    if (!restoredSiblingHover.includes("TXT file in the same folder (game version 3.2)")) {
      throw new Error(`didClose did not restore sibling source: ${restoredSiblingHover}`);
    }

    const siblingDeleteOpenStart = client.messages.length;
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: siblingItemTypesUri,
        languageId: "plaintext",
        version: 1,
        text: itemTypesText("modx")
      }
    });
    await waitForDiagnostics(
      siblingItemTypesUri,
      siblingDeleteOpenStart,
      (message) => message.params?.version === 1,
      "sibling delete setup diagnostics"
    );
    fs.rmSync(siblingItemTypesPath, { force: true });
    const siblingDeleteStart = client.messages.length;
    client.notify("textDocument/didClose", { textDocument: { uri: siblingItemTypesUri } });
    const referenceFallbackError = await waitForDiagnostics(
      magicUri,
      siblingDeleteStart,
      (message) => referenceDiagnostics(message).length > 0,
      "reference-root fallback after sibling delete"
    );

    const rootValueStart = client.messages.length;
    client.notify("textDocument/didChange", {
      textDocument: { uri: magicUri, version: 2 },
      contentChanges: [{ text: magicText("root") }]
    });
    const rootValueClear = await waitForDiagnostics(
      magicUri,
      rootValueStart,
      (message) => message.params?.version === 2 && referenceDiagnostics(message).length === 0,
      "reference-root value diagnostics"
    );
    const referenceRootHover = await hoverCell(magicUri, 1, "Smoke Prefix", "reference-root source hover");
    if (!referenceRootHover.includes("TXT file in the current workspace (game version 3.2)")) {
      throw new Error(`explicit reference-root source hover changed: ${referenceRootHover}`);
    }

    const referenceDeleteOpenStart = client.messages.length;
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: referenceItemTypesUri,
        languageId: "plaintext",
        version: 1,
        text: itemTypesText("root")
      }
    });
    await waitForDiagnostics(
      referenceItemTypesUri,
      referenceDeleteOpenStart,
      (message) => message.params?.version === 1,
      "reference-root delete setup diagnostics"
    );
    fs.rmSync(referenceItemTypesPath, { force: true });
    const referenceDeleteStart = client.messages.length;
    client.notify("textDocument/didClose", { textDocument: { uri: referenceItemTypesUri } });
    const bundledFallbackError = await waitForDiagnostics(
      magicUri,
      referenceDeleteStart,
      (message) => referenceDiagnostics(message).length > 0,
      "bundled fallback after reference-root delete"
    );

    const bundledValueStart = client.messages.length;
    client.notify("textDocument/didChange", {
      textDocument: { uri: magicUri, version: 3 },
      contentChanges: [{ text: magicText("staff") }]
    });
    const bundledValueClear = await waitForDiagnostics(
      magicUri,
      bundledValueStart,
      (message) => message.params?.version === 3 && referenceDiagnostics(message).length === 0,
      "bundled fixed4 diagnostics"
    );
    const bundledHover = await hoverCell(magicUri, 1, "Smoke Prefix", "bundled source hover");
    if (!bundledHover.includes("`staff` → `staf`")
      || !bundledHover.includes("Built-in reference data (game version 3.2)")) {
      throw new Error(`bundled fixed4/source hover changed: ${bundledHover}`);
    }

    return {
      initialize: "pass",
      readyGeneration: ready.params.sessionGeneration,
      watchedFileRegistrations: client.dynamicRegistrations.length,
      hiddenReferencePublishes: hiddenPublishes.length,
      siblingMod4ccDiagnostics: referenceDiagnostics(initialMagic).length,
      staffFixed4Diagnostics: referenceDiagnostics(initialMagic).length,
      ringFixed4Diagnostics: referenceDiagnostics(initialSuffix).length,
      siblingHover: siblingHover.match(/Source: ([^\n]+)/)?.[1] ?? siblingHover,
      staffFixed4Hover: staffHover.match(/`staff` → `staf`/)?.[0] ?? staffHover,
      ringFixed4Hover: ringHover.match(/`ring␠␠` → `ring`/)?.[0] ?? ringHover,
      openShadowDiagnostics: referenceDiagnostics(shadowedMagic).length,
      problemsOneLine: shadowProblemLine,
      latestDependentDiagnostics: referenceDiagnostics(latestMagic).length,
      latestItemTypesVersion: itemTypesPublishes.at(-1)?.params?.version,
      didCloseRestoreDiagnostics: referenceDiagnostics(closeRestore).length,
      referenceFallbackDiagnostics: referenceDiagnostics(referenceFallbackError).length,
      referenceRootValueDiagnostics: referenceDiagnostics(rootValueClear).length,
      referenceRootHover: referenceRootHover.match(/Source: ([^\n]+)/)?.[1] ?? referenceRootHover,
      bundledFallbackDiagnostics: referenceDiagnostics(bundledFallbackError).length,
      bundledValueDiagnostics: referenceDiagnostics(bundledValueClear).length,
      bundledHover: bundledHover.match(/Source: ([^\n]+)/)?.[1] ?? bundledHover,
      stderr: client.stderr.trim()
    };
  } finally {
    await client.stop();
  }
}

async function runReadinessFailureSession({ exePath, paths, timeoutMs }) {
  const client = new LspClient({
    exePath,
    workspaceDir: paths.workspaceDir,
    schemaVariant: "missing-readiness-regression-variant"
  });
  client.start();
  try {
    await withTimeout(client.request("initialize", {
      processId: process.pid,
      rootUri: encodeFileUriPath(paths.workspaceDir),
      initializationOptions: { sessionGeneration: 77 },
      capabilities: { textDocument: { publishDiagnostics: {} } }
    }), timeoutMs, "failure initialize");
    client.notify("initialized", {});
    const failure = await withTimeout(client.waitFor((message) => (
      message.method === "vectorLsp/failed"
    )), timeoutMs, "readiness failure notification");
    if (failure.params?.sessionGeneration !== 77 || !String(failure.params?.reason || "").includes("Could not load the schema")) {
      throw new Error(`readiness failure contract changed: ${JSON.stringify(failure.params)}`);
    }
    return { generation: 77, reason: failure.params.reason, stderr: client.stderr.trim() };
  } finally {
    await client.stop();
  }
}

export async function runVectorLspRuntimeSmoke({
  repoRoot = process.cwd(),
  vectorRoot = defaultVectorRoot(repoRoot),
  vectorLspExe = "",
  schemaVariant = "3.2",
  timeoutMs = 10000,
  requireReal = false,
  platform = process.platform
} = {}) {
  const paths = smokePaths({ repoRoot, vectorRoot });
  const exePath = resolveVectorLspExecutable({ vectorRoot, vectorLspExe, platform });
  if (!exePath) {
    const result = {
      status: "not-run",
      mode: "optional",
      message: missingVectorLspExecutableMessage(vectorLspExe),
      executable: null,
      paths
    };
    if (requireReal) throw new Error(result.message);
    return result;
  }
  if (!fs.existsSync(paths.contribSource)) {
    const result = {
      status: "not-run",
      mode: "optional",
      message: missingVectorLspContribMessage(paths.contribSource),
      executable: exePath,
      paths
    };
    if (requireReal) throw new Error(result.message);
    return result;
  }
  prepareStaging({
    exePath,
    paths,
    requireContrib: true,
    requireReferenceBundle: true
  });
  const stagedExePath = path.join(paths.stagingDir, path.basename(exePath));
  const stagedContribPath = path.join(paths.stagingDir, "contrib");
  const first = await runLspSession({ exePath: stagedExePath, paths, schemaVariant, timeoutMs });
  const second = await runLspSession({ exePath: stagedExePath, paths, schemaVariant, timeoutMs });
  const standaloneSibling = await runStandaloneSiblingSession({
    exePath: stagedExePath,
    paths,
    timeoutMs
  });
  const readinessFailure = await runReadinessFailureSession({ exePath: stagedExePath, paths, timeoutMs });
  const stderr = [first.stderr, second.stderr, standaloneSibling.stderr, readinessFailure.stderr].filter(Boolean);
  if (requireReal && stderr.length) {
    throw new Error(`Vector-LSP smoke stderr contained unexpected output: ${stderr.join(" | ")}`);
  }
  const result = {
    status: "pass",
    mode: requireReal ? "required" : "optional",
    executableSource: exePath,
    executable: exePath,
    stagedExecutable: stagedExePath,
    vectorRoot: paths.vectorRoot,
    contribCopiedFrom: paths.contribSource,
    contribCopiedTo: stagedContribPath,
    contribSource: paths.contribSource,
    stagedContrib: stagedContribPath,
    contribExistsInStaging: fs.existsSync(stagedContribPath),
    vectorRootModified: false,
    vectorRootReadOnlyConfirmation: `No files were added to, changed in, or deleted from ${paths.vectorRoot}; the smoke only read paths and copied existing contrib files into TXTeditor-owned staging.`,
    workspaceDir: paths.workspaceDir,
    resultPath: paths.reportPath,
    restart: "pass",
    tooltipMessageSmoke: verifyTooltipMessageSmoke(),
    standaloneSibling,
    readinessFailure,
    staleEventSuppressionProbe: "direct sessions completed independently; TXTeditor UI suppression still requires owner runtime verification",
    sessions: [first, second]
  };
  fs.mkdirSync(path.dirname(paths.reportPath), { recursive: true });
  fs.writeFileSync(paths.reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

async function main() {
  const repoRoot = path.resolve(optionValue("--repo-root", process.cwd()));
  const configuredVectorRoot = optionValue("--vector-lsp-root", process.env.VECTOR_LSP_ROOT ?? "");
  const result = await runVectorLspRuntimeSmoke({
    repoRoot,
    vectorRoot: configuredVectorRoot ? path.resolve(configuredVectorRoot) : defaultVectorRoot(repoRoot),
    vectorLspExe: optionValue("--vector-lsp-exe", ""),
    schemaVariant: optionValue("--schema-variant", "3.2"),
    timeoutMs: Number(optionValue("--timeout-ms", "10000")),
    requireReal: hasFlag("--require-real")
  });
  if (result.status === "not-run") {
    console.log(`OPTIONAL ${result.message}`);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
