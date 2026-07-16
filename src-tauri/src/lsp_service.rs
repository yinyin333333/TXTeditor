use crate::config::{AppConfig, AppConfigState, JsonDiagnosticRules};
use crate::file_io::decode_text;
use crate::lsp_file_watcher::{
    WatchChangeSink, WatchErrorSink, WatchRegistry, WatchedFileChange, WATCHED_FILES_METHOD,
};
use crate::lsp_protocol::{
    apply_line_change, diagnostics_from_lsp_publish, path_to_uri, read_lsp_msg, send_lsp_msg,
    strip_markdown_for_tooltip, uri_to_path, LspContentChange, LspDiagnostic,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::oneshot;

type PendingResponse = oneshot::Sender<Result<Option<Value>, String>>;
type PendingRequests = Mutex<HashMap<u64, PendingResponse>>;

struct LspProcess {
    generation: u64,
    workspace_root: PathBuf,
    outbound: Mutex<OutboundState>,
    next_id: AtomicU64,
    pending: PendingRequests,
    diagnostics: Mutex<HashMap<String, DiagnosticSnapshot>>,
    next_diagnostic_sequence: AtomicU64,
    watchers_active: AtomicBool,
    watchers: Mutex<WatchRegistry>,
}

#[derive(Clone)]
struct DocumentMirror {
    version: u32,
    lines: Arc<Vec<String>>,
}

struct OutboundState {
    stdin: ChildStdin,
    documents: HashMap<String, DocumentMirror>,
}

#[derive(Clone)]
struct DiagnosticSnapshot {
    version: Option<u32>,
    sequence: u64,
    source_exists: bool,
    diagnostics: Vec<LspDiagnostic>,
}

struct ActiveSession {
    generation: u64,
    workspace_path: String,
    process: Arc<LspProcess>,
    child: Child,
}

#[derive(Default)]
struct ManagerState {
    active: Option<ActiveSession>,
    starting: HashMap<u64, Child>,
}

struct LspManagerCore {
    state: Mutex<ManagerState>,
    latest_requested_generation: AtomicU64,
    shutdown_requested: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LspStartResult {
    generation: u64,
    workspace_path: String,
    installed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LspDiagnosticsChanged {
    generation: u64,
    uri: String,
    version: Option<u32>,
    sequence: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LspDiagnosticsSnapshot {
    generation: u64,
    uri: String,
    version: Option<u32>,
    sequence: u64,
    source_exists: bool,
    diagnostics: Vec<LspDiagnostic>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LspDiagnosticsRequest {
    uri: String,
    sequence: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LspWatchedFilesChanged {
    generation: u64,
    changes: Vec<WatchedFileChange>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LspStopped {
    generation: u64,
    reason: String,
}

pub(crate) struct LspManager {
    core: Arc<LspManagerCore>,
}

impl LspManager {
    pub(crate) fn new() -> Self {
        Self {
            core: Arc::new(LspManagerCore {
                state: Mutex::new(ManagerState::default()),
                latest_requested_generation: AtomicU64::new(0),
                shutdown_requested: AtomicBool::new(false),
            }),
        }
    }

    /// Stop every child owned by this editor instance. This must be invoked from
    /// the native run-event path because Tauri exits with `process::exit`, which
    /// does not guarantee that managed-state destructors run.
    pub(crate) fn shutdown(&self) -> usize {
        shutdown_lsp_manager(&self.core)
    }
}

impl Drop for LspManager {
    fn drop(&mut self) {
        // Fallback for tests and non-Tauri owners. The native app also calls
        // shutdown explicitly before the event loop exits.
        let _ = self.shutdown();
    }
}

pub(crate) fn find_vector_lsp_binary() -> Result<PathBuf, String> {
    let exe = if cfg!(windows) {
        "vector-lsp.exe"
    } else {
        "vector-lsp"
    };

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            candidates.push(dir.join(exe));
        }
    }
    candidates.push(PathBuf::from(format!("../vector-lsp/target/release/{exe}")));
    candidates.push(PathBuf::from(format!("../vector-lsp/target/debug/{exe}")));

    for path in &candidates {
        if path.exists() {
            return path.canonicalize().map_err(|error| {
                format!(
                    "Failed to resolve vector-lsp binary '{}': {error}",
                    path.display()
                )
            });
        }
    }
    Err(format!(
        "vector-lsp binary not found. Set a path in Settings or build it in ../vector-lsp. Tried: {}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

#[derive(Clone, Debug)]
struct EditorLaunchSpec {
    binary: PathBuf,
    lint_mode: String,
    schema_version: Option<String>,
    reference_version: Option<String>,
    schema_path: Option<PathBuf>,
    plugin_path: Option<PathBuf>,
    debug_logging: bool,
    json_diagnostics: bool,
    json_diagnostic_rules: JsonDiagnosticRules,
}

impl EditorLaunchSpec {
    fn resolve(config: &AppConfig) -> Result<Self, String> {
        let binary = match config
            .vector_lsp_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
        {
            Some(path) => canonical_existing_path(path, "Configured vector-lsp path")?,
            None => find_vector_lsp_binary()?,
        };
        let lint_mode = config
            .lint_mode
            .as_deref()
            .filter(|mode| *mode == "advanced")
            .unwrap_or("basic")
            .to_string();
        let (schema_version, schema_path, plugin_path) = if lint_mode == "advanced" {
            (
                None,
                resolve_optional_path(config.schema_path.as_deref(), "Schema path")?,
                resolve_optional_path(config.plugin_path.as_deref(), "Plugin path")?,
            )
        } else {
            (
                Some(
                    config
                        .schema_version
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or("3.2")
                        .to_string(),
                ),
                None,
                None,
            )
        };
        let reference_version = config
            .reference_version
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                (lint_mode == "basic")
                    .then(|| schema_version.clone())
                    .flatten()
            });
        Ok(Self {
            binary,
            lint_mode,
            schema_version,
            reference_version,
            schema_path,
            plugin_path,
            debug_logging: config.debug_logging,
            json_diagnostics: config.json_diagnostics,
            json_diagnostic_rules: config.json_diagnostic_rules,
        })
    }

    fn summary(&self) -> String {
        let schema = self
            .schema_path
            .as_ref()
            .map(|path| format!("path:{}", path.display()))
            .or_else(|| {
                self.schema_version
                    .as_ref()
                    .map(|version| format!("variant:{version}"))
            })
            .unwrap_or_else(|| "none".to_string());
        format!(
            "vector-lsp editor launch: executable={} mode={} schema={} reference={} encoding=auto transport=stdio singleShot=false pluginPath={} jsonDiagnostics={} jsonRules=duplicateIds:{},stringFormat:{},keyUsage:{}@{}",
            self.binary.display(),
            self.lint_mode,
            schema,
            self.reference_version.as_deref().unwrap_or("disabled"),
            self.plugin_path
                .as_ref()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| "none".to_string()),
            self.json_diagnostics,
            self.json_diagnostic_rules
                .duplicate_ids
                .action
                .as_env_value(),
            self.json_diagnostic_rules
                .string_format
                .action
                .as_env_value(),
            self.json_diagnostic_rules
                .key_usage
                .action
                .as_env_value(),
            self.json_diagnostic_rules.key_usage.id_start
        )
    }
}

fn canonical_existing_path(path: &str, label: &str) -> Result<PathBuf, String> {
    PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("{label} does not exist or cannot be resolved: {path}: {error}"))
}

fn resolve_optional_path(path: Option<&str>, label: &str) -> Result<Option<PathBuf>, String> {
    path.map(str::trim)
        .filter(|path| !path.is_empty())
        .map(|path| canonical_existing_path(path, label))
        .transpose()
}

fn configure_editor_command(command: &mut Command, spec: &EditorLaunchSpec) {
    const SANITIZED_ENVIRONMENT: &[&str] = &[
        "VLSP_IO_TYPE",
        "VLSP_SINGLE_SHOT",
        "VLSP_DELIMITER",
        "VLSP_EXTENSION",
        "VLSP_SCHEMA_LOADER",
        "VLSP_SCHEMA_PATH",
        "VLSP_SCHEMA_VARIANT",
        "VLSP_REFERENCE_VARIANT",
        "VLSP_PLUGIN_PATH",
        "VLSP_WORKSPACE_PATH",
        "VLSP_ENCODING",
        "VLSP_DEBUG_LOGGING",
        "VLSP_JSON_DIAGNOSTICS",
        "VLSP_JSON_DUPLICATE_IDS_ACTION",
        "VLSP_JSON_STRING_FORMAT_ACTION",
        "VLSP_JSON_KEY_USAGE_ACTION",
        "VLSP_JSON_KEY_USAGE_ID_START",
    ];
    command.arg("--editor-mode");
    for name in SANITIZED_ENVIRONMENT {
        command.env_remove(name);
    }
    command.env("VLSP_ENCODING", "auto");
    if let Some(path) = &spec.schema_path {
        command.env("VLSP_SCHEMA_PATH", path);
    }
    if let Some(version) = &spec.schema_version {
        command.env("VLSP_SCHEMA_VARIANT", version);
    }
    if let Some(version) = &spec.reference_version {
        command.env("VLSP_REFERENCE_VARIANT", version);
    }
    if let Some(path) = &spec.plugin_path {
        command.env("VLSP_PLUGIN_PATH", path);
    }
    if spec.debug_logging {
        command.env("VLSP_DEBUG_LOGGING", "1");
    }
    if spec.json_diagnostics {
        command.env("VLSP_JSON_DIAGNOSTICS", "true");
        command.env(
            "VLSP_JSON_DUPLICATE_IDS_ACTION",
            spec.json_diagnostic_rules
                .duplicate_ids
                .action
                .as_env_value(),
        );
        command.env(
            "VLSP_JSON_STRING_FORMAT_ACTION",
            spec.json_diagnostic_rules
                .string_format
                .action
                .as_env_value(),
        );
        command.env(
            "VLSP_JSON_KEY_USAGE_ACTION",
            spec.json_diagnostic_rules.key_usage.action.as_env_value(),
        );
        command.env(
            "VLSP_JSON_KEY_USAGE_ID_START",
            spec.json_diagnostic_rules.key_usage.id_start.to_string(),
        );
    }
}

fn stop_active_session(manager: &mut ManagerState, reason: &str) -> usize {
    let Some(mut active) = manager.active.take() else {
        return 0;
    };
    deactivate_lsp_process(&active.process);
    drain_pending_requests(&active.process.pending, reason);
    kill_and_wait_child(&mut active.child);
    1
}

fn stop_starting_sessions(
    manager: &mut ManagerState,
    mut should_stop: impl FnMut(u64) -> bool,
) -> usize {
    let mut generations = manager
        .starting
        .keys()
        .copied()
        .filter(|generation| should_stop(*generation))
        .collect::<Vec<_>>();
    generations.sort_unstable();
    let mut stopped = 0;
    for generation in generations {
        if let Some(mut child) = manager.starting.remove(&generation) {
            kill_and_wait_child(&mut child);
            stopped += 1;
        }
    }
    stopped
}

fn shutdown_lsp_manager(core: &LspManagerCore) -> usize {
    core.shutdown_requested.store(true, Ordering::SeqCst);
    core.latest_requested_generation
        .store(u64::MAX, Ordering::SeqCst);
    let mut manager = core
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut stopped = stop_active_session(&mut manager, "LSP manager stopped");
    stopped += stop_starting_sessions(&mut manager, |_| true);
    stopped
}

fn is_latest_request(core: &LspManagerCore, generation: u64) -> bool {
    !core.shutdown_requested.load(Ordering::SeqCst)
        && core.latest_requested_generation.load(Ordering::SeqCst) == generation
}

fn is_current_process(core: &LspManagerCore, proc: &Arc<LspProcess>) -> bool {
    core.state
        .lock()
        .unwrap()
        .active
        .as_ref()
        .is_some_and(|active| {
            active.generation == proc.generation && Arc::ptr_eq(&active.process, proc)
        })
}

fn drain_pending_requests(pending: &PendingRequests, reason: &str) -> usize {
    let mut pending = pending.lock().unwrap();
    let count = pending.len();
    for (_, sender) in pending.drain() {
        let _ = sender.send(Err(reason.to_string()));
    }
    count
}

fn deactivate_lsp_process(proc: &LspProcess) {
    proc.watchers_active.store(false, Ordering::SeqCst);
    proc.watchers.lock().unwrap().clear();
}

fn is_response_to_request(msg: &Value, request_id: u64) -> bool {
    msg.get("method").is_none()
        && msg
            .get("id")
            .and_then(|value| value.as_u64())
            .is_some_and(|id| id == request_id)
}

fn read_until_initialize_response<R: BufRead>(reader: &mut R, initialize_id: u64) -> Option<Value> {
    while let Some(msg) = read_lsp_msg(reader) {
        if is_response_to_request(&msg, initialize_id) {
            return Some(msg);
        }
    }
    None
}

fn read_initial_lsp_message(
    mut reader: BufReader<ChildStdout>,
    timeout: Duration,
) -> Result<(BufReader<ChildStdout>, Value), String> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let msg = read_until_initialize_response(&mut reader, 1);
        let _ = tx.send((reader, msg));
    });
    match rx.recv_timeout(timeout) {
        Ok((reader, Some(msg))) => Ok((reader, msg)),
        Ok((_reader, None)) => Err("LSP initialize response stream closed".to_string()),
        Err(mpsc::RecvTimeoutError::Timeout) => Err("LSP initialize timeout".to_string()),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("LSP initialize response reader stopped".to_string())
        }
    }
}

fn validate_initialize_response(msg: &Value) -> Result<(), String> {
    if msg.get("id").and_then(|value| value.as_u64()) != Some(1) {
        return Err("LSP initialize response had an unexpected id".to_string());
    }
    if let Some(error) = msg.get("error") {
        return Err(format!("LSP initialize failed: {error}"));
    }
    if !msg.get("result").is_some_and(|value| value.is_object()) {
        return Err("LSP initialize response had no result object".to_string());
    }
    Ok(())
}

fn kill_and_wait_child(child: &mut std::process::Child) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn cleanup_startup_failure(child: &mut std::process::Child, error: String) -> String {
    kill_and_wait_child(child);
    error
}

fn cleanup_tracked_startup_failure(
    core: &LspManagerCore,
    generation: u64,
    error: String,
) -> String {
    let mut manager = core.state.lock().unwrap();
    if let Some(mut child) = manager.starting.remove(&generation) {
        return cleanup_startup_failure(&mut child, error);
    }
    error
}

fn json_rpc_response_result(msg: &Value) -> Result<Option<Value>, String> {
    if let Some(error) = msg.get("error") {
        return Err(json_rpc_error_message(error));
    }
    Ok(msg.get("result").cloned())
}

fn json_rpc_error_message(error: &Value) -> String {
    let message = error
        .get("message")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown JSON-RPC error");
    if let Some(code) = error.get("code").and_then(|value| value.as_i64()) {
        format!("LSP request failed ({code}): {message}")
    } else {
        format!("LSP request failed: {message}")
    }
}

fn watched_file_sinks(
    proc: &Arc<LspProcess>,
    app: &tauri::AppHandle,
) -> (WatchChangeSink, WatchErrorSink) {
    let weak_process = Arc::downgrade(proc);
    let app_for_changes = app.clone();
    let changes: WatchChangeSink = Arc::new(move |changes| {
        let Some(proc) = weak_process.upgrade() else {
            return;
        };
        if !proc.watchers_active.load(Ordering::SeqCst) {
            return;
        }
        let mut outbound = proc.outbound.lock().unwrap();
        if !proc.watchers_active.load(Ordering::SeqCst) {
            return;
        }
        let event_changes = changes.clone();
        let _ = send_lsp_msg(
            &mut outbound.stdin,
            &json!({
                "jsonrpc": "2.0",
                "method": WATCHED_FILES_METHOD,
                "params": { "changes": changes }
            }),
        );
        drop(outbound);
        if proc.watchers_active.load(Ordering::SeqCst) {
            let _ = app_for_changes.emit(
                "lsp-watched-files-changed",
                LspWatchedFilesChanged {
                    generation: proc.generation,
                    changes: event_changes,
                },
            );
        }
    });

    let weak_process = Arc::downgrade(proc);
    let app = app.clone();
    let errors: WatchErrorSink = Arc::new(move |message| {
        let Some(proc) = weak_process.upgrade() else {
            return;
        };
        if proc.watchers_active.load(Ordering::SeqCst) {
            let _ = app.emit("lsp-log", message);
        }
    });
    (changes, errors)
}

fn send_server_request_response(
    proc: &LspProcess,
    id: Value,
    result: Result<(), (i64, String)>,
) -> Result<(), String> {
    let response = server_request_response(id, result);
    let mut outbound = proc.outbound.lock().unwrap();
    send_lsp_msg(&mut outbound.stdin, &response)
}

fn server_request_response(id: Value, result: Result<(), (i64, String)>) -> Value {
    match result {
        Ok(()) => json!({ "jsonrpc": "2.0", "id": id, "result": null }),
        Err((code, message)) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message }
        }),
    }
}

fn handle_server_request(
    proc: &Arc<LspProcess>,
    msg: &Value,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let id = msg
        .get("id")
        .filter(|id| id.is_u64() || id.is_i64() || id.is_string())
        .cloned()
        .ok_or_else(|| "LSP server request had an invalid id".to_string())?;
    let method = msg
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
    let result = match method {
        "client/registerCapability" => {
            let (changes, errors) = watched_file_sinks(proc, app);
            proc.watchers
                .lock()
                .unwrap()
                .register(&params, &proc.workspace_root, changes, errors)
                .map_err(|message| (-32602, message))
        }
        "client/unregisterCapability" => proc
            .watchers
            .lock()
            .unwrap()
            .unregister(&params)
            .map_err(|message| (-32602, message)),
        _ => Err((-32601, format!("Unsupported LSP server request: {method}"))),
    };
    send_server_request_response(proc, id, result)
}

fn run_lsp_reader(
    mut reader: BufReader<ChildStdout>,
    proc: Arc<LspProcess>,
    core: Arc<LspManagerCore>,
    app: tauri::AppHandle,
) {
    while let Some(msg) = read_lsp_msg(&mut reader) {
        if !is_current_process(&core, &proc) {
            break;
        }
        if msg.get("id").is_some() && msg.get("method").is_none() {
            if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                let sender = proc.pending.lock().unwrap().remove(&id);
                if let Some(tx) = sender {
                    let _ = tx.send(json_rpc_response_result(&msg));
                }
            }
            continue;
        }
        if msg.get("id").is_some() && msg.get("method").is_some() {
            if let Err(error) = handle_server_request(&proc, &msg, &app) {
                finish_lsp_reader(
                    &core,
                    &proc,
                    &format!("server request response failed: {error}"),
                    &app,
                );
                return;
            }
            continue;
        }
        match msg.get("method").and_then(|m| m.as_str()) {
            Some("window/logMessage") => {
                let text = msg["params"]["message"].as_str().unwrap_or("").to_string();
                if is_current_process(&core, &proc) {
                    let _ = app.emit("lsp-log", &text);
                }
                continue;
            }
            Some("vectorLsp/ready") => {
                let mut payload = msg.get("params").cloned().unwrap_or_else(|| json!({}));
                if let Some(object) = payload.as_object_mut() {
                    object.insert("generation".to_string(), json!(proc.generation));
                } else {
                    payload = json!({ "generation": proc.generation });
                }
                if is_current_process(&core, &proc) {
                    let _ = app.emit("lsp-ready", payload);
                }
                continue;
            }
            Some("vectorLsp/failed") => {
                let reason = msg["params"]["reason"]
                    .as_str()
                    .unwrap_or("Vector-LSP readiness failed")
                    .to_string();
                finish_lsp_reader(&core, &proc, &format!("readiness failed: {reason}"), &app);
                return;
            }
            Some("textDocument/publishDiagnostics") => {
                if let Some(event) = handle_publish_diagnostics(&core, &proc, &msg) {
                    if is_current_process(&core, &proc) {
                        let _ = app.emit("lsp-diagnostics-changed", event);
                    }
                }
                continue;
            }
            _ => continue,
        }
    }
    finish_lsp_reader(&core, &proc, "eof", &app);
}

fn lines_for_diagnostics(
    proc: &LspProcess,
    uri: &str,
    version: Option<u32>,
) -> Option<Arc<Vec<String>>> {
    {
        let outbound = proc.outbound.lock().unwrap();
        match (outbound.documents.get(uri), version) {
            (Some(document), Some(version)) if document.version == version => {
                return Some(Arc::clone(&document.lines));
            }
            (Some(_), _) | (None, Some(_)) => return None,
            (None, None) => {}
        }
    }
    Some(Arc::new(
        uri_to_path(uri)
            .ok()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| decode_text(bytes).ok().map(|(text, _)| text))
            .unwrap_or_default()
            .lines()
            .map(String::from)
            .collect(),
    ))
}

fn diagnostics_source_is_current(proc: &LspProcess, uri: &str, version: Option<u32>) -> bool {
    let outbound = proc.outbound.lock().unwrap();
    diagnostics_source_is_current_in(&outbound, uri, version)
}

fn diagnostics_source_is_current_in(
    outbound: &OutboundState,
    uri: &str,
    version: Option<u32>,
) -> bool {
    match (outbound.documents.get(uri), version) {
        (Some(document), Some(version)) => document.version == version,
        (Some(_), None) | (None, Some(_)) => false,
        (None, None) => true,
    }
}

fn handle_publish_diagnostics(
    core: &LspManagerCore,
    proc: &Arc<LspProcess>,
    msg: &Value,
) -> Option<LspDiagnosticsChanged> {
    handle_publish_diagnostics_before_commit(core, proc, msg, || {})
}

fn handle_publish_diagnostics_before_commit(
    core: &LspManagerCore,
    proc: &Arc<LspProcess>,
    msg: &Value,
    before_commit: impl FnOnce(),
) -> Option<LspDiagnosticsChanged> {
    if !is_current_process(core, proc) {
        return None;
    }
    let params = msg.get("params")?;
    let uri = params.get("uri")?.as_str()?.to_string();
    let version = params
        .get("version")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok());
    let raw = params
        .get("diagnostics")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    if !diagnostics_source_is_current(proc, &uri, version) {
        return None;
    }
    let diagnostics = if raw.is_empty() {
        Vec::new()
    } else {
        let lines = lines_for_diagnostics(proc, &uri, version)?;
        diagnostics_from_lsp_publish(raw, &lines)
    };
    if !is_current_process(core, proc) {
        return None;
    }
    let outbound = proc.outbound.lock().unwrap();
    if !diagnostics_source_is_current_in(&outbound, &uri, version) {
        return None;
    }
    before_commit();
    let mut snapshots = proc.diagnostics.lock().unwrap();
    if snapshots
        .get(&uri)
        .is_some_and(|snapshot| match (snapshot.version, version) {
            (Some(_), None) => true,
            (Some(current), Some(incoming)) => incoming < current,
            _ => false,
        })
    {
        return None;
    }
    let sequence = proc.next_diagnostic_sequence.fetch_add(1, Ordering::SeqCst) + 1;
    let source_exists =
        version.is_some() || uri_to_path(&uri).ok().is_some_and(|path| path.is_file());
    snapshots.insert(
        uri.clone(),
        DiagnosticSnapshot {
            version,
            sequence,
            source_exists,
            diagnostics,
        },
    );
    drop(snapshots);
    drop(outbound);
    Some(LspDiagnosticsChanged {
        generation: proc.generation,
        uri,
        version,
        sequence,
    })
}

fn install_open_document(
    proc: &LspProcess,
    outbound: &mut OutboundState,
    uri: String,
    document: DocumentMirror,
) {
    outbound.documents.insert(uri.clone(), document);
    proc.diagnostics.lock().unwrap().remove(&uri);
}

fn remove_open_document(proc: &LspProcess, outbound: &mut OutboundState, uri: &str) {
    outbound.documents.remove(uri);
    proc.diagnostics.lock().unwrap().remove(uri);
}

#[cfg(test)]
fn take_current_session(core: &LspManagerCore, proc: &Arc<LspProcess>) -> Option<ActiveSession> {
    let mut state = core.state.lock().unwrap();
    let current = state.active.as_ref().is_some_and(|active| {
        active.generation == proc.generation && Arc::ptr_eq(&active.process, proc)
    });
    current.then(|| state.active.take().unwrap())
}

fn finish_lsp_reader(
    core: &LspManagerCore,
    proc: &Arc<LspProcess>,
    reason: &str,
    app: &tauri::AppHandle,
) {
    drain_pending_requests(&proc.pending, "LSP reader stopped");
    let stopped = {
        let mut manager = core.state.lock().unwrap();
        let current = manager.active.as_ref().is_some_and(|active| {
            active.generation == proc.generation && Arc::ptr_eq(&active.process, proc)
        });
        current && stop_active_session(&mut manager, "LSP reader stopped") == 1
    };
    if !stopped {
        return;
    }
    let _ = app.emit(
        "lsp-stopped",
        LspStopped {
            generation: proc.generation,
            reason: reason.to_string(),
        },
    );
}

fn get_lsp_proc(
    state: &tauri::State<'_, LspManager>,
    generation: u64,
) -> Result<Arc<LspProcess>, String> {
    let manager = state.core.state.lock().unwrap();
    match manager.active.as_ref() {
        Some(active) if active.generation == generation => Ok(Arc::clone(&active.process)),
        Some(active) => Err(format!(
            "LSP generation {generation} is not active (current generation {} for {})",
            active.generation, active.workspace_path
        )),
        None => Err(format!("LSP generation {generation} is not active")),
    }
}

enum CandidateInstall {
    Installed,
    Superseded,
    Cancelled,
}

fn install_candidate_locked(
    core: &LspManagerCore,
    manager: &mut ManagerState,
    mut candidate: ActiveSession,
) -> CandidateInstall {
    if is_latest_request(core, candidate.generation) {
        if let Some(mut replaced) = manager.active.replace(candidate) {
            deactivate_lsp_process(&replaced.process);
            drain_pending_requests(&replaced.process.pending, "LSP session replaced");
            kill_and_wait_child(&mut replaced.child);
        }
        CandidateInstall::Installed
    } else {
        deactivate_lsp_process(&candidate.process);
        drain_pending_requests(&candidate.process.pending, "LSP start superseded");
        kill_and_wait_child(&mut candidate.child);
        CandidateInstall::Superseded
    }
}

#[cfg(test)]
fn install_candidate(core: &LspManagerCore, candidate: ActiveSession) -> CandidateInstall {
    let mut manager = core.state.lock().unwrap();
    install_candidate_locked(core, &mut manager, candidate)
}

fn install_tracked_candidate(
    core: &LspManagerCore,
    generation: u64,
    workspace_path: String,
    process: Arc<LspProcess>,
) -> CandidateInstall {
    let mut manager = core.state.lock().unwrap();
    let Some(child) = manager.starting.remove(&generation) else {
        drain_pending_requests(&process.pending, "LSP start cancelled");
        return CandidateInstall::Cancelled;
    };
    install_candidate_locked(
        core,
        &mut manager,
        ActiveSession {
            generation,
            workspace_path,
            process,
            child,
        },
    )
}

fn require_newer_document_version(uri: &str, current: u32, incoming: u32) -> Result<(), String> {
    if incoming <= current {
        Err(format!(
            "stale LSP document version for {uri}: {incoming} <= {current}"
        ))
    } else {
        Ok(())
    }
}

fn reference_context_mode(value: Option<&str>) -> Result<&'static str, String> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None | Some("workspace") => Ok("workspace"),
        Some("sibling") => Ok("sibling"),
        Some(value) => Err(format!(
            "Unsupported LSP reference context mode '{value}'. Expected 'workspace' or 'sibling'."
        )),
    }
}

#[tauri::command]
pub(crate) async fn lsp_start(
    workspace_path: String,
    generation: u64,
    context_mode: Option<String>,
    reference_root_path: Option<String>,
    include_subfolders: Option<bool>,
    state: tauri::State<'_, LspManager>,
    config_state: tauri::State<'_, AppConfigState>,
    app_handle: tauri::AppHandle,
) -> Result<LspStartResult, String> {
    let reference_context_mode = reference_context_mode(context_mode.as_deref())?;
    let reference_root_uri = reference_root_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(path_to_uri);
    let include_subfolders = include_subfolders.unwrap_or(true);
    if generation == 0 {
        return Err("LSP generation must be positive".to_string());
    }
    if state.core.shutdown_requested.load(Ordering::SeqCst) {
        return Ok(LspStartResult {
            generation,
            workspace_path,
            installed: false,
        });
    }
    let previous_latest = state
        .core
        .latest_requested_generation
        .fetch_max(generation, Ordering::SeqCst);
    if previous_latest > generation {
        return Ok(LspStartResult {
            generation,
            workspace_path,
            installed: false,
        });
    }
    {
        let mut manager = state.core.state.lock().unwrap();
        if manager
            .active
            .as_ref()
            .is_some_and(|active| active.generation < generation)
        {
            stop_active_session(&mut manager, "LSP session restarted");
        }
        stop_starting_sessions(&mut manager, |starting_generation| {
            starting_generation < generation
        });
    }
    if !is_latest_request(&state.core, generation) {
        return Ok(LspStartResult {
            generation,
            workspace_path,
            installed: false,
        });
    }

    let launch_spec = {
        let config = config_state.config.lock().unwrap();
        EditorLaunchSpec::resolve(&config)?
    };
    let _ = app_handle.emit("lsp-log", launch_spec.summary());

    let mut cmd = Command::new(&launch_spec.binary);
    cmd.current_dir(&workspace_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_editor_command(&mut cmd, &launch_spec);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    // Keep the child handle in ManagerState from the instant it is spawned.
    // The native exit callback can then reap it even while initialize is pending.
    let (mut stdin, stdout, stderr) = {
        let mut manager = state.core.state.lock().unwrap();
        if !is_latest_request(&state.core, generation)
            || manager.starting.contains_key(&generation)
            || manager
                .active
                .as_ref()
                .is_some_and(|active| active.generation == generation)
        {
            return Ok(LspStartResult {
                generation,
                workspace_path,
                installed: false,
            });
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start vector-lsp: {e}"))?;
        let Some(stdin) = child.stdin.take() else {
            kill_and_wait_child(&mut child);
            return Err("vector-lsp started without a stdin pipe".to_string());
        };
        let Some(stdout) = child.stdout.take() else {
            kill_and_wait_child(&mut child);
            return Err("vector-lsp started without a stdout pipe".to_string());
        };
        let Some(stderr) = child.stderr.take() else {
            kill_and_wait_child(&mut child);
            return Err("vector-lsp started without a stderr pipe".to_string());
        };
        manager.starting.insert(generation, child);
        (stdin, stdout, stderr)
    };

    let root_uri = path_to_uri(&workspace_path);
    if let Err(error) = send_lsp_msg(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "processId": std::process::id(),
                "rootUri": root_uri,
                "initializationOptions": {
                    "sessionGeneration": generation,
                    "referenceContextMode": reference_context_mode,
                    "referenceRootUri": reference_root_uri,
                    "includeSubfolders": include_subfolders,
                    "workspaceDirectoryScopes": true
                },
                "capabilities": {
                    "workspace": {
                        "didChangeWatchedFiles": {
                            "dynamicRegistration": true,
                            "relativePatternSupport": true
                        }
                    },
                    "textDocument": { "publishDiagnostics": {} }
                }
            }
        }),
    ) {
        return Err(cleanup_tracked_startup_failure(
            &state.core,
            generation,
            format!("Failed to send LSP initialize request: {error}"),
        ));
    }

    let (reader, initialize_response) =
        match read_initial_lsp_message(BufReader::new(stdout), Duration::from_secs(10)) {
            Ok(result) => result,
            Err(error) => {
                return Err(cleanup_tracked_startup_failure(
                    &state.core,
                    generation,
                    error,
                ));
            }
        };
    if let Err(error) = validate_initialize_response(&initialize_response) {
        return Err(cleanup_tracked_startup_failure(
            &state.core,
            generation,
            error,
        ));
    }

    if let Err(error) = send_lsp_msg(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {}
        }),
    ) {
        return Err(cleanup_tracked_startup_failure(
            &state.core,
            generation,
            format!("Failed to send LSP initialized notification: {error}"),
        ));
    }

    let proc = Arc::new(LspProcess {
        generation,
        workspace_root: PathBuf::from(&workspace_path),
        outbound: Mutex::new(OutboundState {
            stdin,
            documents: HashMap::new(),
        }),
        next_id: AtomicU64::new(100),
        pending: Mutex::new(HashMap::new()),
        diagnostics: Mutex::new(HashMap::new()),
        next_diagnostic_sequence: AtomicU64::new(0),
        watchers_active: AtomicBool::new(true),
        watchers: Mutex::new(WatchRegistry::new()),
    });

    match install_tracked_candidate(
        &state.core,
        generation,
        workspace_path.clone(),
        Arc::clone(&proc),
    ) {
        CandidateInstall::Installed => {}
        CandidateInstall::Superseded | CandidateInstall::Cancelled => {
            return Ok(LspStartResult {
                generation,
                workspace_path,
                installed: false,
            });
        }
    }

    let app_clone = app_handle.clone();
    let reader_core = Arc::clone(&state.core);
    let reader_proc = Arc::clone(&proc);
    std::thread::spawn(move || run_lsp_reader(reader, reader_proc, reader_core, app_clone));

    let app_stderr = app_handle.clone();
    let stderr_core = Arc::clone(&state.core);
    let stderr_proc = Arc::clone(&proc);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        while reader.read_line(&mut line).unwrap_or(0) > 0 {
            if !is_current_process(&stderr_core, &stderr_proc) {
                return;
            }
            let trimmed = line.trim().to_string();
            if !trimmed.is_empty() {
                let _ = app_stderr.emit("lsp-log", &trimmed);
            }
            line.clear();
        }
    });

    Ok(LspStartResult {
        generation,
        workspace_path,
        installed: true,
    })
}

#[tauri::command]
pub(crate) fn lsp_open_file(
    uri: String,
    version: u32,
    text: String,
    generation: u64,
    state: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    let proc = get_lsp_proc(&state, generation)?;
    let mut outbound = proc.outbound.lock().unwrap();
    if outbound.documents.contains_key(&uri) {
        return Err(format!("LSP document is already open: {uri}"));
    }
    send_lsp_msg(
        &mut outbound.stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {
                "textDocument": { "uri": &uri, "languageId": "plaintext", "version": version, "text": &text }
            }
        }),
    )?;
    install_open_document(
        &proc,
        &mut outbound,
        uri.clone(),
        DocumentMirror {
            version,
            lines: Arc::new(text.lines().map(String::from).collect()),
        },
    );
    Ok(())
}

#[tauri::command]
pub(crate) fn lsp_update_file(
    uri: String,
    version: u32,
    text: String,
    generation: u64,
    state: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    let proc = get_lsp_proc(&state, generation)?;
    let mut outbound = proc.outbound.lock().unwrap();
    let current_version = outbound
        .documents
        .get(&uri)
        .ok_or_else(|| format!("LSP document is not open: {uri}"))?
        .version;
    require_newer_document_version(&uri, current_version, version)?;
    send_lsp_msg(
        &mut outbound.stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didChange",
            "params": {
                "textDocument": { "uri": &uri, "version": version },
                "contentChanges": [{ "text": &text }]
            }
        }),
    )?;
    outbound.documents.insert(
        uri,
        DocumentMirror {
            version,
            lines: Arc::new(text.lines().map(String::from).collect()),
        },
    );
    Ok(())
}

#[tauri::command]
pub(crate) fn lsp_update_file_incremental(
    uri: String,
    version: u32,
    changes: Vec<LspContentChange>,
    generation: u64,
    state: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    let proc = get_lsp_proc(&state, generation)?;
    let mut outbound = proc.outbound.lock().unwrap();
    let document = outbound
        .documents
        .get(&uri)
        .ok_or_else(|| format!("LSP document is not open: {uri}"))?;
    require_newer_document_version(&uri, document.version, version)?;
    let mut next_lines = document.lines.as_ref().clone();
    for change in &changes {
        apply_line_change(&mut next_lines, &change.range, &change.text);
    }
    let content_changes: Vec<Value> = changes
        .iter()
        .map(|c| {
            json!({
                "range": {
                    "start": { "line": c.range.start.line, "character": c.range.start.character },
                    "end":   { "line": c.range.end.line,   "character": c.range.end.character }
                },
                "text": c.text
            })
        })
        .collect();
    send_lsp_msg(
        &mut outbound.stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didChange",
            "params": {
                "textDocument": { "uri": &uri, "version": version },
                "contentChanges": content_changes
            }
        }),
    )?;
    outbound.documents.insert(
        uri,
        DocumentMirror {
            version,
            lines: Arc::new(next_lines),
        },
    );
    Ok(())
}

#[tauri::command]
pub(crate) fn lsp_close_file(
    uri: String,
    generation: u64,
    state: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    let proc = get_lsp_proc(&state, generation)?;
    let mut outbound = proc.outbound.lock().unwrap();
    if !outbound.documents.contains_key(&uri) {
        return Err(format!("LSP document is not open: {uri}"));
    }
    send_lsp_msg(
        &mut outbound.stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didClose",
            "params": { "textDocument": { "uri": &uri } }
        }),
    )?;
    remove_open_document(&proc, &mut outbound, &uri);
    Ok(())
}

#[tauri::command]
pub(crate) fn lsp_get_diagnostics(
    uri: String,
    generation: u64,
    sequence: Option<u64>,
    state: tauri::State<'_, LspManager>,
) -> Result<Option<LspDiagnosticsSnapshot>, String> {
    let proc = get_lsp_proc(&state, generation)?;
    let snapshot = proc
        .diagnostics
        .lock()
        .unwrap()
        .get(&uri)
        .filter(|snapshot| sequence.is_none_or(|expected| snapshot.sequence == expected))
        .cloned();
    Ok(snapshot.map(|snapshot| LspDiagnosticsSnapshot {
        generation,
        uri,
        version: snapshot.version,
        sequence: snapshot.sequence,
        source_exists: snapshot.source_exists,
        diagnostics: snapshot.diagnostics,
    }))
}

#[tauri::command]
pub(crate) fn lsp_get_diagnostics_batch(
    requests: Vec<LspDiagnosticsRequest>,
    generation: u64,
    state: tauri::State<'_, LspManager>,
) -> Result<Vec<Option<LspDiagnosticsSnapshot>>, String> {
    let proc = get_lsp_proc(&state, generation)?;
    let snapshots = proc.diagnostics.lock().unwrap();
    Ok(requests
        .into_iter()
        .map(|request| {
            snapshots
                .get(&request.uri)
                .filter(|snapshot| {
                    request
                        .sequence
                        .is_none_or(|expected| snapshot.sequence == expected)
                })
                .cloned()
                .map(|snapshot| LspDiagnosticsSnapshot {
                    generation,
                    uri: request.uri,
                    version: snapshot.version,
                    sequence: snapshot.sequence,
                    source_exists: snapshot.source_exists,
                    diagnostics: snapshot.diagnostics,
                })
        })
        .collect())
}

#[tauri::command]
pub(crate) async fn lsp_hover(
    uri: String,
    line: u32,
    character: u32,
    generation: u64,
    state: tauri::State<'_, LspManager>,
) -> Result<Option<String>, String> {
    let proc = get_lsp_proc(&state, generation)?;
    let id = proc.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    proc.pending.lock().unwrap().insert(id, tx);
    {
        let mut outbound = proc.outbound.lock().unwrap();
        if let Err(error) = send_lsp_msg(
            &mut outbound.stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": "textDocument/hover",
                "params": {
                    "textDocument": { "uri": uri },
                    "position": { "line": line, "character": character }
                }
            }),
        ) {
            proc.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
        .await
        .map_err(|_| {
            proc.pending.lock().unwrap().remove(&id);
            "hover timeout".to_string()
        })?
        .map_err(|_| "hover channel closed".to_string())??;
    let text = result.and_then(|v| {
        let contents = v.get("contents")?;
        if let Some(val) = contents.get("value") {
            val.as_str().map(String::from)
        } else {
            contents.as_str().map(String::from)
        }
    });
    Ok(text.map(|t| strip_markdown_for_tooltip(&t)))
}

#[derive(Serialize)]
pub(crate) struct DefinitionLocation {
    uri: String,
    line: u32,
    character: u32,
}

#[tauri::command]
pub(crate) async fn lsp_definition(
    uri: String,
    line: u32,
    character: u32,
    generation: u64,
    state: tauri::State<'_, LspManager>,
) -> Result<Option<DefinitionLocation>, String> {
    let proc = get_lsp_proc(&state, generation)?;
    let id = proc.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    proc.pending.lock().unwrap().insert(id, tx);
    {
        let mut outbound = proc.outbound.lock().unwrap();
        if let Err(error) = send_lsp_msg(
            &mut outbound.stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": "textDocument/definition",
                "params": {
                    "textDocument": { "uri": uri },
                    "position": { "line": line, "character": character }
                }
            }),
        ) {
            proc.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
        .await
        .map_err(|_| {
            proc.pending.lock().unwrap().remove(&id);
            "definition timeout".to_string()
        })?
        .map_err(|_| "definition channel closed".to_string())??;
    let loc = result.and_then(|v| {
        let item = if v.is_array() {
            v.as_array()?.first()?.clone()
        } else {
            v
        };
        if item.is_null() {
            return None;
        }
        let target_uri = item
            .get("uri")
            .or_else(|| item.get("targetUri"))?
            .as_str()
            .map(String::from)?;
        let range = item
            .get("range")
            .or_else(|| item.get("targetSelectionRange"))
            .or_else(|| item.get("targetRange"))?;
        let start = range.get("start")?;
        let def_line = start.get("line")?.as_u64()? as u32;
        let character = start.get("character")?.as_u64()? as u32;
        Some(DefinitionLocation {
            uri: target_uri,
            line: def_line,
            character,
        })
    });
    Ok(loc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn lsp_frame(value: Value) -> Vec<u8> {
        let body = value.to_string();
        format!("Content-Length: {}\r\n\r\n{}", body.len(), body).into_bytes()
    }

    fn test_lsp_process(generation: u64) -> (Arc<LspProcess>, Child) {
        #[cfg(windows)]
        let mut child = Command::new("cmd")
            .args(["/C", "more > NUL"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test LSP child");
        #[cfg(not(windows))]
        let mut child = Command::new("sh")
            .args(["-c", "cat >/dev/null"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test LSP child");
        let stdin = child.stdin.take().expect("test child stdin");
        (
            Arc::new(LspProcess {
                generation,
                workspace_root: std::env::temp_dir(),
                outbound: Mutex::new(OutboundState {
                    stdin,
                    documents: HashMap::new(),
                }),
                next_id: AtomicU64::new(100),
                pending: Mutex::new(HashMap::new()),
                diagnostics: Mutex::new(HashMap::new()),
                next_diagnostic_sequence: AtomicU64::new(0),
                watchers_active: AtomicBool::new(true),
                watchers: Mutex::new(WatchRegistry::new()),
            }),
            child,
        )
    }

    fn test_core(latest_generation: u64) -> LspManagerCore {
        LspManagerCore {
            state: Mutex::new(ManagerState::default()),
            latest_requested_generation: AtomicU64::new(latest_generation),
            shutdown_requested: AtomicBool::new(false),
        }
    }

    #[test]
    fn reverse_completion_installs_latest_candidate_and_reaps_superseded_child() {
        let core = test_core(2);
        let (process_b, child_b) = test_lsp_process(2);
        let candidate_b = ActiveSession {
            generation: 2,
            workspace_path: "B".to_string(),
            process: Arc::clone(&process_b),
            child: child_b,
        };
        assert!(matches!(
            install_candidate(&core, candidate_b),
            CandidateInstall::Installed
        ));

        let (process_a, child_a) = test_lsp_process(1);
        let candidate_a = ActiveSession {
            generation: 1,
            workspace_path: "A".to_string(),
            process: process_a,
            child: child_a,
        };
        assert!(matches!(
            install_candidate(&core, candidate_a),
            CandidateInstall::Superseded
        ));
        assert!(is_current_process(&core, &process_b));
        assert_eq!(
            core.state
                .lock()
                .unwrap()
                .active
                .as_ref()
                .unwrap()
                .workspace_path,
            "B"
        );

        let mut active = take_current_session(&core, &process_b).unwrap();
        kill_and_wait_child(&mut active.child);
    }

    #[test]
    fn eof_state_transition_is_generation_guarded_and_idempotent() {
        let core = test_core(2);
        let (stale_process, mut stale_child) = test_lsp_process(1);
        let (current_process, current_child) = test_lsp_process(2);
        let (stale_tx, mut stale_rx) = oneshot::channel();
        stale_process.pending.lock().unwrap().insert(1, stale_tx);
        let (current_tx, mut current_rx) = oneshot::channel();
        current_process
            .pending
            .lock()
            .unwrap()
            .insert(2, current_tx);
        core.state.lock().unwrap().active = Some(ActiveSession {
            generation: 2,
            workspace_path: "B".to_string(),
            process: Arc::clone(&current_process),
            child: current_child,
        });

        assert!(take_current_session(&core, &stale_process).is_none());
        assert!(is_current_process(&core, &current_process));
        drain_pending_requests(&stale_process.pending, "stale LSP session");
        assert_eq!(
            stale_rx.try_recv().unwrap().unwrap_err(),
            "stale LSP session"
        );
        kill_and_wait_child(&mut stale_child);

        let mut current = take_current_session(&core, &current_process).unwrap();
        drain_pending_requests(&current.process.pending, "LSP reader stopped");
        kill_and_wait_child(&mut current.child);
        assert_eq!(
            current_rx.try_recv().unwrap().unwrap_err(),
            "LSP reader stopped"
        );
        assert!(take_current_session(&core, &current_process).is_none());
        assert!(core.state.lock().unwrap().active.is_none());
    }

    #[test]
    fn diagnostics_keep_exact_generation_version_and_sequence() {
        let core = test_core(3);
        let (process, child) = test_lsp_process(3);
        let uri = "file:///E:/workspace/items.txt".to_string();
        process.outbound.lock().unwrap().documents.insert(
            uri.clone(),
            DocumentMirror {
                version: 3,
                lines: Arc::new(vec!["id".to_string(), "NEW".to_string()]),
            },
        );
        core.state.lock().unwrap().active = Some(ActiveSession {
            generation: 3,
            workspace_path: "workspace".to_string(),
            process: Arc::clone(&process),
            child,
        });

        let publish = |version: Option<u32>| {
            let mut params = json!({ "uri": uri, "diagnostics": [] });
            if let Some(version) = version {
                params["version"] = json!(version);
            }
            json!({
                "jsonrpc": "2.0",
                "method": "textDocument/publishDiagnostics",
                "params": params
            })
        };
        let first = handle_publish_diagnostics(&core, &process, &publish(Some(3))).unwrap();
        assert_eq!(
            (first.generation, first.version, first.sequence),
            (3, Some(3), 1)
        );
        assert!(handle_publish_diagnostics(&core, &process, &publish(Some(2))).is_none());
        assert!(handle_publish_diagnostics(&core, &process, &publish(None)).is_none());
        let second = handle_publish_diagnostics(&core, &process, &publish(Some(3))).unwrap();
        assert_eq!(second.sequence, 2);
        let snapshot = process
            .diagnostics
            .lock()
            .unwrap()
            .get(&uri)
            .cloned()
            .unwrap();
        assert_eq!((snapshot.version, snapshot.sequence), (Some(3), 2));

        let mut active = take_current_session(&core, &process).unwrap();
        kill_and_wait_child(&mut active.child);
    }

    #[test]
    fn did_open_transition_cannot_leave_a_versionless_snapshot_after_final_source_check() {
        let core = test_core(30);
        let (process, child) = test_lsp_process(30);
        let uri = "file:///E:/workspace/items.txt".to_string();
        core.state.lock().unwrap().active = Some(ActiveSession {
            generation: 30,
            workspace_path: "workspace".to_string(),
            process: Arc::clone(&process),
            child,
        });
        let publish = json!({
            "jsonrpc": "2.0",
            "method": "textDocument/publishDiagnostics",
            "params": { "uri": uri, "diagnostics": [] }
        });
        let open_thread = Mutex::new(None);
        let process_for_open = Arc::clone(&process);
        let uri_for_open = uri.clone();

        let event = handle_publish_diagnostics_before_commit(&core, &process, &publish, || {
            let process = Arc::clone(&process_for_open);
            let uri = uri_for_open.clone();
            *open_thread.lock().unwrap() = Some(std::thread::spawn(move || {
                let mut outbound = process.outbound.lock().unwrap();
                install_open_document(
                    &process,
                    &mut outbound,
                    uri,
                    DocumentMirror {
                        version: 1,
                        lines: Arc::new(vec!["id".to_string(), "OPEN".to_string()]),
                    },
                );
            }));
        });
        open_thread.lock().unwrap().take().unwrap().join().unwrap();

        assert!(event.is_some());
        assert!(process.diagnostics.lock().unwrap().get(&uri).is_none());
        assert_eq!(
            process
                .outbound
                .lock()
                .unwrap()
                .documents
                .get(&uri)
                .unwrap()
                .version,
            1
        );
        let mut active = take_current_session(&core, &process).unwrap();
        kill_and_wait_child(&mut active.child);
    }

    #[test]
    fn empty_publish_clears_cached_diagnostics_without_a_file_line_source() {
        let core = test_core(4);
        let (process, child) = test_lsp_process(4);
        let uri = "untitled:bridge-empty-diagnostics".to_string();
        core.state.lock().unwrap().active = Some(ActiveSession {
            generation: 4,
            workspace_path: "workspace".to_string(),
            process: Arc::clone(&process),
            child,
        });
        let publish = |diagnostics: Value| {
            json!({
                "jsonrpc": "2.0",
                "method": "textDocument/publishDiagnostics",
                "params": { "uri": uri, "diagnostics": diagnostics }
            })
        };

        let populated = handle_publish_diagnostics(
            &core,
            &process,
            &publish(json!([{
                "range": {
                    "start": { "line": 99, "character": 7 },
                    "end": { "line": 99, "character": 7 }
                },
                "severity": 1,
                "message": "cached"
            }])),
        )
        .unwrap();
        assert_eq!(populated.sequence, 1);
        assert_eq!(
            process
                .diagnostics
                .lock()
                .unwrap()
                .get(&uri)
                .unwrap()
                .diagnostics
                .len(),
            1
        );

        let cleared = handle_publish_diagnostics(&core, &process, &publish(json!([]))).unwrap();
        assert_eq!(
            (cleared.generation, cleared.version, cleared.sequence),
            (4, None, 2)
        );
        assert!(process
            .diagnostics
            .lock()
            .unwrap()
            .get(&uri)
            .unwrap()
            .diagnostics
            .is_empty());

        let mut active = take_current_session(&core, &process).unwrap();
        kill_and_wait_child(&mut active.child);
    }

    #[test]
    fn unversioned_disk_diagnostics_use_editor_auto_encoding() {
        let dir = std::env::temp_dir().join(format!(
            "txteditor-lsp-disk-encoding-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("items.txt");
        std::fs::write(&path, [b'i', b'd', b'\n', b'c', b'a', b'f', 0xE9]).unwrap();
        let uri = path_to_uri(path.to_str().unwrap());
        let (process, mut child) = test_lsp_process(1);

        assert_eq!(
            lines_for_diagnostics(&process, &uri, None)
                .unwrap()
                .as_ref(),
            &vec!["id".to_string(), "café".to_string()]
        );

        kill_and_wait_child(&mut child);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn document_versions_are_strictly_monotonic() {
        assert!(require_newer_document_version("uri", 2, 3).is_ok());
        assert!(require_newer_document_version("uri", 3, 3).is_err());
        assert!(require_newer_document_version("uri", 3, 2).is_err());
    }

    #[test]
    fn pending_requests_are_completed_with_failure_when_drained() {
        let pending = Mutex::new(HashMap::new());
        let (tx, mut rx) = oneshot::channel();
        pending.lock().unwrap().insert(7, tx);

        assert_eq!(drain_pending_requests(&pending, "session restarted"), 1);
        assert!(pending.lock().unwrap().is_empty());
        let received = rx.try_recv().unwrap();
        assert_eq!(received.unwrap_err(), "session restarted");
    }

    #[test]
    fn restart_and_stop_complete_pending_hover_and_definition_requests() {
        let pending = Mutex::new(HashMap::new());
        let (hover_tx, mut hover_rx) = oneshot::channel();
        let (definition_tx, mut definition_rx) = oneshot::channel();
        pending.lock().unwrap().insert(100, hover_tx);
        pending.lock().unwrap().insert(101, definition_tx);

        assert_eq!(drain_pending_requests(&pending, "LSP session restarted"), 2);
        assert!(pending.lock().unwrap().is_empty());
        assert_eq!(
            hover_rx.try_recv().unwrap().unwrap_err(),
            "LSP session restarted"
        );
        assert_eq!(
            definition_rx.try_recv().unwrap().unwrap_err(),
            "LSP session restarted"
        );

        let (hover_tx, mut hover_rx) = oneshot::channel();
        let (definition_tx, mut definition_rx) = oneshot::channel();
        pending.lock().unwrap().insert(200, hover_tx);
        pending.lock().unwrap().insert(201, definition_tx);

        assert_eq!(drain_pending_requests(&pending, "LSP manager stopped"), 2);
        assert!(pending.lock().unwrap().is_empty());
        assert_eq!(
            hover_rx.try_recv().unwrap().unwrap_err(),
            "LSP manager stopped"
        );
        assert_eq!(
            definition_rx.try_recv().unwrap().unwrap_err(),
            "LSP manager stopped"
        );
    }

    #[test]
    fn manager_shutdown_reaps_active_and_starting_children_and_is_idempotent() {
        let manager = LspManager::new();
        let (process, child) = test_lsp_process(1);
        let (tx, mut rx) = oneshot::channel();
        process.pending.lock().unwrap().insert(7, tx);
        {
            let mut state = manager.core.state.lock().unwrap();
            state.active = Some(ActiveSession {
                generation: 1,
                workspace_path: "active".to_string(),
                process,
                child,
            });
            state.starting.insert(2, spawn_long_running_child());
        }

        assert_eq!(manager.shutdown(), 2);
        assert!(manager.core.shutdown_requested.load(Ordering::SeqCst));
        assert!(!is_latest_request(&manager.core, 1));
        {
            let state = manager.core.state.lock().unwrap();
            assert!(state.active.is_none());
            assert!(state.starting.is_empty());
        }
        assert_eq!(rx.try_recv().unwrap().unwrap_err(), "LSP manager stopped");
        assert_eq!(manager.shutdown(), 0);
    }

    #[test]
    fn request_guard_accepts_only_latest_generation() {
        let core = LspManagerCore {
            state: Mutex::new(ManagerState::default()),
            latest_requested_generation: AtomicU64::new(4),
            shutdown_requested: AtomicBool::new(false),
        };
        assert!(is_latest_request(&core, 4));
        assert!(!is_latest_request(&core, 3));
        core.latest_requested_generation.store(5, Ordering::SeqCst);
        assert!(!is_latest_request(&core, 4));
        core.shutdown_requested.store(true, Ordering::SeqCst);
        assert!(!is_latest_request(&core, 5));
    }

    #[test]
    fn initialize_response_validation_rejects_stale_or_malformed_replies() {
        assert!(validate_initialize_response(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {}
        }))
        .is_ok());
        assert!(validate_initialize_response(&json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": {}
        }))
        .unwrap_err()
        .contains("unexpected id"));
        assert!(validate_initialize_response(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": { "message": "bad" }
        }))
        .unwrap_err()
        .contains("initialize failed"));
        assert!(validate_initialize_response(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": null
        }))
        .unwrap_err()
        .contains("result object"));
    }

    #[test]
    fn initialize_reader_ignores_notifications_until_initialize_response() {
        let mut bytes = Vec::new();
        bytes.extend(lsp_frame(json!({
            "jsonrpc": "2.0",
            "method": "window/logMessage",
            "params": { "message": "starting" }
        })));
        bytes.extend(lsp_frame(json!({
            "jsonrpc": "2.0",
            "id": 99,
            "result": {}
        })));
        bytes.extend(lsp_frame(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "capabilities": {} }
        })));
        let mut reader = Cursor::new(bytes);
        let msg = read_until_initialize_response(&mut reader, 1).unwrap();
        assert_eq!(msg["id"], 1);
    }

    #[test]
    fn initialize_reader_preserves_buffered_post_initialize_frame() {
        let mut bytes = Vec::new();
        bytes.extend(lsp_frame(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "capabilities": {} }
        })));
        bytes.extend(lsp_frame(json!({
            "jsonrpc": "2.0",
            "method": "window/logMessage",
            "params": { "message": "indexed immediately after initialize" }
        })));

        let mut reader = BufReader::with_capacity(8192, Cursor::new(bytes));
        let initialize = read_until_initialize_response(&mut reader, 1).unwrap();
        assert_eq!(initialize["id"], 1);

        let next = read_lsp_msg(&mut reader).expect("buffered post-initialize frame");
        assert_eq!(next["method"], "window/logMessage");
        assert_eq!(
            next["params"]["message"],
            "indexed immediately after initialize"
        );
    }

    #[test]
    fn production_startup_hands_buffered_reader_to_lsp_reader() {
        let source = include_str!("lsp_service.rs");
        let forbidden_handoff = format!("{}{}", "run_lsp_reader(", "reader.into_inner()");
        assert!(source.contains("fn run_lsp_reader(\n    mut reader: BufReader<ChildStdout>,"));
        assert!(!source.contains(&forbidden_handoff));
        assert!(source.contains("command.env(\"VLSP_ENCODING\", \"auto\")"));
        assert!(source.contains("command.arg(\"--editor-mode\")"));
    }

    #[test]
    fn reference_context_mode_is_explicit_and_rejects_unknown_values() {
        assert_eq!(reference_context_mode(None).unwrap(), "workspace");
        assert_eq!(
            reference_context_mode(Some("workspace")).unwrap(),
            "workspace"
        );
        assert_eq!(reference_context_mode(Some("sibling")).unwrap(), "sibling");
        assert!(reference_context_mode(Some("recursive-sibling")).is_err());
    }

    #[test]
    fn editor_launch_defaults_match_the_ui_and_resolve_absolute_paths() {
        let binary = std::env::current_exe().unwrap();
        let config = AppConfig {
            vector_lsp_path: Some(binary.to_string_lossy().to_string()),
            ..Default::default()
        };

        let spec = EditorLaunchSpec::resolve(&config).unwrap();

        assert!(spec.binary.is_absolute());
        assert_eq!(spec.lint_mode, "basic");
        assert_eq!(spec.schema_version.as_deref(), Some("3.2"));
        assert_eq!(spec.reference_version.as_deref(), Some("3.2"));
        assert!(spec.schema_path.is_none());
        assert!(spec.plugin_path.is_none());
        assert!(canonical_existing_path(".", "cwd").unwrap().is_absolute());
    }

    #[test]
    fn editor_command_forces_lifecycle_and_sanitizes_inherited_settings() {
        let spec = EditorLaunchSpec {
            binary: std::env::current_exe().unwrap(),
            lint_mode: "basic".to_string(),
            schema_version: Some("3.2".to_string()),
            reference_version: Some("3.2".to_string()),
            schema_path: None,
            plugin_path: None,
            debug_logging: false,
            json_diagnostics: false,
            json_diagnostic_rules: JsonDiagnosticRules::default(),
        };
        let mut command = Command::new(&spec.binary);
        command.env("VLSP_SINGLE_SHOT", "true");
        command.env("VLSP_IO_TYPE", "tcp");
        command.env("VLSP_JSON_DIAGNOSTICS", "true");
        command.env("VLSP_JSON_DUPLICATE_IDS_ACTION", "error");
        command.env("VLSP_JSON_STRING_FORMAT_ACTION", "error");
        command.env("VLSP_JSON_KEY_USAGE_ACTION", "error");
        command.env("VLSP_JSON_KEY_USAGE_ID_START", "1");

        configure_editor_command(&mut command, &spec);

        assert_eq!(
            command
                .get_args()
                .map(|argument| argument.to_string_lossy().to_string())
                .collect::<Vec<_>>(),
            vec!["--editor-mode"]
        );
        let environment = command
            .get_envs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().to_string(),
                    value.map(|value| value.to_string_lossy().to_string()),
                )
            })
            .collect::<HashMap<_, _>>();
        assert_eq!(environment.get("VLSP_IO_TYPE"), Some(&None));
        assert_eq!(environment.get("VLSP_SINGLE_SHOT"), Some(&None));
        assert_eq!(
            environment.get("VLSP_ENCODING"),
            Some(&Some("auto".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_SCHEMA_VARIANT"),
            Some(&Some("3.2".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_REFERENCE_VARIANT"),
            Some(&Some("3.2".to_string()))
        );
        assert_eq!(environment.get("VLSP_JSON_DIAGNOSTICS"), Some(&None));
        for name in [
            "VLSP_JSON_DUPLICATE_IDS_ACTION",
            "VLSP_JSON_STRING_FORMAT_ACTION",
            "VLSP_JSON_KEY_USAGE_ACTION",
            "VLSP_JSON_KEY_USAGE_ID_START",
        ] {
            assert_eq!(environment.get(name), Some(&None), "{name}");
        }
    }

    #[test]
    fn editor_command_enables_json_diagnostics_only_when_configured() {
        let rules = JsonDiagnosticRules {
            duplicate_ids: crate::config::JsonDiagnosticRule {
                action: crate::config::JsonDiagnosticAction::Warn,
            },
            string_format: crate::config::JsonDiagnosticRule {
                action: crate::config::JsonDiagnosticAction::Ignore,
            },
            key_usage: crate::config::JsonKeyUsageRule {
                action: crate::config::JsonDiagnosticAction::Warn,
                id_start: 51_566.5,
            },
        };
        let spec = EditorLaunchSpec {
            binary: std::env::current_exe().unwrap(),
            lint_mode: "basic".to_string(),
            schema_version: Some("3.2".to_string()),
            reference_version: Some("3.2".to_string()),
            schema_path: None,
            plugin_path: None,
            debug_logging: false,
            json_diagnostics: true,
            json_diagnostic_rules: rules,
        };
        let mut command = Command::new(&spec.binary);
        configure_editor_command(&mut command, &spec);
        let environment = command
            .get_envs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().to_string(),
                    value.map(|value| value.to_string_lossy().to_string()),
                )
            })
            .collect::<HashMap<_, _>>();

        assert_eq!(
            environment.get("VLSP_JSON_DIAGNOSTICS"),
            Some(&Some("true".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_JSON_DUPLICATE_IDS_ACTION"),
            Some(&Some("warn".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_JSON_STRING_FORMAT_ACTION"),
            Some(&Some("ignore".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_JSON_KEY_USAGE_ACTION"),
            Some(&Some("warn".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_JSON_KEY_USAGE_ID_START"),
            Some(&Some("51566.5".to_string()))
        );
    }

    #[test]
    fn advanced_editor_mode_never_guesses_a_reference_version() {
        let binary = std::env::current_exe().unwrap();
        let config = AppConfig {
            vector_lsp_path: Some(binary.to_string_lossy().to_string()),
            lint_mode: Some("advanced".to_string()),
            schema_path: Some(binary.to_string_lossy().to_string()),
            schema_version: Some("3.2".to_string()),
            reference_version: None,
            ..Default::default()
        };

        let spec = EditorLaunchSpec::resolve(&config).unwrap();
        assert_eq!(spec.lint_mode, "advanced");
        assert!(spec.reference_version.is_none());

        let mut command = Command::new(&spec.binary);
        configure_editor_command(&mut command, &spec);
        let environment = command
            .get_envs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().to_string(),
                    value.map(|value| value.to_string_lossy().to_string()),
                )
            })
            .collect::<HashMap<_, _>>();
        assert_eq!(environment.get("VLSP_REFERENCE_VARIANT"), Some(&None));
    }

    #[test]
    fn json_rpc_error_responses_complete_pending_requests_with_errors() {
        assert_eq!(
            json_rpc_response_result(&json!({
                "jsonrpc": "2.0",
                "id": 7,
                "result": { "contents": "ok" }
            }))
            .unwrap()
            .unwrap()["contents"],
            "ok"
        );

        let error = json_rpc_response_result(&json!({
            "jsonrpc": "2.0",
            "id": 8,
            "error": { "code": -32603, "message": "hover failed" }
        }))
        .unwrap_err();
        assert!(error.contains("-32603"));
        assert!(error.contains("hover failed"));
    }

    #[test]
    fn server_request_responses_preserve_numeric_and_string_ids() {
        let ok = server_request_response(json!(27), Ok(()));
        assert_eq!(ok["id"], 27);
        assert!(ok["result"].is_null());

        let error = server_request_response(
            json!("watch-registration"),
            Err((-32602, "invalid watcher".to_string())),
        );
        assert_eq!(error["id"], "watch-registration");
        assert_eq!(error["error"]["code"], -32602);
        assert_eq!(error["error"]["message"], "invalid watcher");
    }

    #[test]
    fn startup_failure_cleanup_reaps_running_child() {
        let mut child = spawn_long_running_child();
        let error = cleanup_startup_failure(&mut child, "send failed".to_string());
        assert_eq!(error, "send failed");
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn kill_and_wait_child_reaps_running_process() {
        let mut child = spawn_long_running_child();
        kill_and_wait_child(&mut child);
        assert!(child.try_wait().unwrap().is_some());
    }

    #[cfg(windows)]
    fn spawn_long_running_child() -> std::process::Child {
        Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn long-running child")
    }

    #[cfg(not(windows))]
    fn spawn_long_running_child() -> std::process::Child {
        Command::new("sh")
            .args(["-c", "sleep 30"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn long-running child")
    }
}
