import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

export const NO_VECTOR_LSP_EXE_MESSAGE = "REAL VECTOR-LSP SMOKE NOT RUN: no existing vector-lsp executable found, and building E:\\vector-lsp is forbidden.";

export function missingVectorLspExecutableMessage(vectorLspExe = "") {
  if (vectorLspExe) {
    return `REAL VECTOR-LSP SMOKE NOT RUN: supplied vector-lsp executable does not exist: ${path.resolve(vectorLspExe)}. Building E:\\vector-lsp is forbidden.`;
  }
  return NO_VECTOR_LSP_EXE_MESSAGE;
}

export function missingVectorLspContribMessage(contribSource) {
  return `REAL VECTOR-LSP SMOKE NOT RUN: required contrib directory is missing: ${contribSource}. The runtime set is txteditor.exe + vector-lsp.exe + contrib\\. Building E:\\vector-lsp is forbidden.`;
}

export function vectorLspExecutableName(platform = process.platform) {
  return platform === "win32" ? "vector-lsp.exe" : "vector-lsp";
}

export function vectorLspExecutableCandidates(vectorRoot = "E:\\vector-lsp", { platform = process.platform } = {}) {
  const exeName = vectorLspExecutableName(platform);
  return [
    path.join(vectorRoot, exeName),
    path.join(vectorRoot, "target", "release", exeName),
    path.join(vectorRoot, "target", "x86_64-pc-windows-msvc", "release", exeName)
  ];
}

export function findExistingVectorLspExecutable(vectorRoot = "E:\\vector-lsp", exists = fs.existsSync, options = {}) {
  return vectorLspExecutableCandidates(vectorRoot, options).find((candidate) => exists(candidate)) ?? null;
}

export function resolveVectorLspExecutable({ vectorRoot = "E:\\vector-lsp", vectorLspExe = "", exists = fs.existsSync, platform = process.platform } = {}) {
  if (vectorLspExe) {
    const explicit = path.resolve(vectorLspExe);
    return exists(explicit) ? explicit : null;
  }
  return findExistingVectorLspExecutable(vectorRoot, exists, { platform });
}

export function smokePaths({ repoRoot = process.cwd(), vectorRoot = "E:\\vector-lsp" } = {}) {
  const runtimeRoot = path.join(repoRoot, ".runtime-smoke");
  return {
    repoRoot,
    vectorRoot,
    contribSource: path.join(vectorRoot, "contrib"),
    stagingDir: path.join(runtimeRoot, "vector-lsp-bundle"),
    workspaceDir: path.join(runtimeRoot, "vector-lsp-workspace"),
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

export function prepareStaging({ exePath, paths, requireContrib = false }) {
  assertWithin(paths.repoRoot, paths.stagingDir);
  assertWithin(paths.repoRoot, paths.workspaceDir);
  assertWithin(paths.repoRoot, paths.reportPath);
  const stagedContribPath = path.join(paths.stagingDir, "contrib");
  if (requireContrib && !fs.existsSync(paths.contribSource)) {
    throw new Error(missingVectorLspContribMessage(paths.contribSource));
  }
  fs.rmSync(paths.stagingDir, { recursive: true, force: true });
  fs.rmSync(paths.workspaceDir, { recursive: true, force: true });
  fs.mkdirSync(paths.stagingDir, { recursive: true });
  fs.mkdirSync(paths.workspaceDir, { recursive: true });
  fs.copyFileSync(exePath, path.join(paths.stagingDir, path.basename(exePath)));
  if (fs.existsSync(paths.contribSource)) {
    fs.cpSync(paths.contribSource, stagedContribPath, { recursive: true });
  }
  if (requireContrib && !fs.existsSync(stagedContribPath)) {
    throw new Error(`Vector-LSP contrib staging failed: ${stagedContribPath}`);
  }
  writeSmokeWorkspace(paths.workspaceDir);
}

function writeSmokeWorkspace(workspaceDir) {
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
  fs.writeFileSync(path.join(workspaceDir, "upper.TXT"), "id\nupper\n", "utf8");
  fs.writeFileSync(path.join(workspaceDir, "table.tbl"), "id\ntable\n", "utf8");
  fs.writeFileSync(path.join(workspaceDir, "data.csv"), "id\ndata\n", "utf8");
  const deep = path.join(workspaceDir, "d1", "d2", "d3", "d4", "d5", "d6");
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, "deep.tsv"), "id\ndeep\n", "utf8");
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

class LspClient {
  constructor({ exePath, workspaceDir, schemaVariant = "3.2" }) {
    this.exePath = exePath;
    this.workspaceDir = workspaceDir;
    this.schemaVariant = schemaVariant;
    this.nextId = 1;
    this.buffer = Buffer.alloc(0);
    this.messages = [];
    this.waiters = [];
    this.stderr = "";
  }

  start() {
    this.child = spawn(this.exePath, ["--editor-mode"], {
      cwd: this.workspaceDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        VLSP_SCHEMA_VARIANT: this.schemaVariant,
        VLSP_ENCODING: "auto"
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
  const client = new LspClient({ exePath, workspaceDir: paths.workspaceDir, schemaVariant });
  client.start();
  const skillsPath = path.join(paths.workspaceDir, "skills.txt");
  const skilldescPath = path.join(paths.workspaceDir, "skilldesc.txt");
  const skillsUri = encodeFileUriPath(skillsPath);
  const skilldescUri = encodeFileUriPath(skilldescPath);
  const skillsText = fs.readFileSync(skillsPath, "utf8");
  const skilldescText = new TextDecoder("windows-1252", { fatal: true })
    .decode(fs.readFileSync(skilldescPath));
  try {
    await withTimeout(client.request("initialize", {
      processId: process.pid,
      rootUri: encodeFileUriPath(paths.workspaceDir),
      initializationOptions: { sessionGeneration: 42 },
      capabilities: { textDocument: { publishDiagnostics: {} } }
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
    if (!String(indexMessage.params?.message || "").includes("Indexed 6 workspace files")) {
      throw new Error(`editor workspace file policy changed: ${indexMessage.params?.message}`);
    }
    const readyMessage = await withTimeout(client.waitFor((message) => (
      message.method === "vectorLsp/ready"
    )), timeoutMs, "workspace ready");
    if (readyMessage.params?.sessionGeneration !== 42) {
      throw new Error(`ready notification lost session generation: ${JSON.stringify(readyMessage.params)}`);
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
      indexedFiles: 6,
      readyGeneration: readyMessage.params.sessionGeneration,
      serverPerf,
      startupDiagnostics: startupDiagnostics.params.diagnostics.length,
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
    if (failure.params?.sessionGeneration !== 77 || !String(failure.params?.reason || "").includes("Schema load failed")) {
      throw new Error(`readiness failure contract changed: ${JSON.stringify(failure.params)}`);
    }
    return { generation: 77, reason: failure.params.reason, stderr: client.stderr.trim() };
  } finally {
    await client.stop();
  }
}

export async function runVectorLspRuntimeSmoke({
  repoRoot = process.cwd(),
  vectorRoot = "E:\\vector-lsp",
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
  prepareStaging({ exePath, paths, requireContrib: true });
  const stagedExePath = path.join(paths.stagingDir, path.basename(exePath));
  const stagedContribPath = path.join(paths.stagingDir, "contrib");
  const first = await runLspSession({ exePath: stagedExePath, paths, schemaVariant, timeoutMs });
  const second = await runLspSession({ exePath: stagedExePath, paths, schemaVariant, timeoutMs });
  const readinessFailure = await runReadinessFailureSession({ exePath: stagedExePath, paths, timeoutMs });
  const stderr = [first.stderr, second.stderr, readinessFailure.stderr].filter(Boolean);
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
    readinessFailure,
    staleEventSuppressionProbe: "direct sessions completed independently; TXTeditor UI suppression still requires owner runtime verification",
    sessions: [first, second]
  };
  fs.mkdirSync(path.dirname(paths.reportPath), { recursive: true });
  fs.writeFileSync(paths.reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

async function main() {
  const result = await runVectorLspRuntimeSmoke({
    repoRoot: path.resolve(optionValue("--repo-root", process.cwd())),
    vectorRoot: path.resolve(optionValue("--vector-lsp-root", "E:\\vector-lsp")),
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
