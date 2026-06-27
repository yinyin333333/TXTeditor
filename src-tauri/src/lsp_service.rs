use crate::config::AppConfigState;
use crate::lsp_protocol::{
    apply_line_change, diagnostics_from_lsp_publish, path_to_uri, read_lsp_msg, send_lsp_msg,
    strip_markdown_for_tooltip, LspContentChange, LspDiagnostic,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

struct LspProcess {
    session_id: u64,
    stdin: Mutex<ChildStdin>,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Option<Value>, String>>>>,
    diagnostics: Mutex<HashMap<String, LspDiagnosticsPayload>>,
    file_lines: Mutex<HashMap<String, Vec<String>>>,
    document_versions: Mutex<HashMap<String, u32>>,
}

pub(crate) struct LspManager {
    process: Mutex<Option<Arc<LspProcess>>>,
    child: Mutex<Option<std::process::Child>>,
    active_session: Arc<AtomicU64>,
    publication: Mutex<()>,
}

impl LspManager {
    pub(crate) fn new() -> Self {
        Self {
            process: Mutex::new(None),
            child: Mutex::new(None),
            active_session: Arc::new(AtomicU64::new(0)),
            publication: Mutex::new(()),
        }
    }

    fn begin_start_session(&self) -> (u64, Option<Arc<LspProcess>>, Option<std::process::Child>) {
        let _publication = self.publication.lock().unwrap();
        let session_id = self.active_session.fetch_add(1, Ordering::SeqCst) + 1;
        let old_proc = self.process.lock().unwrap().take();
        let old_child = self.child.lock().unwrap().take();
        (session_id, old_proc, old_child)
    }

    fn publish_started_process(
        &self,
        session_id: u64,
        proc: Arc<LspProcess>,
        mut child: std::process::Child,
    ) -> bool {
        let (old_proc, old_child) = {
            let _publication = self.publication.lock().unwrap();
            if !is_current_session(&self.active_session, session_id) {
                drain_pending_requests(&proc.pending, "stale LSP session");
                kill_and_wait_child(&mut child);
                return false;
            }
            let old_proc = self.process.lock().unwrap().replace(Arc::clone(&proc));
            let old_child = self.child.lock().unwrap().replace(child);
            (old_proc, old_child)
        };
        if let Some(old_proc) = old_proc {
            drain_pending_requests(&old_proc.pending, "LSP session replaced");
        }
        if let Some(mut old_child) = old_child {
            kill_and_wait_child(&mut old_child);
        }
        true
    }
}

impl Drop for LspManager {
    fn drop(&mut self) {
        self.active_session.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut process_lock) = self.process.lock() {
            if let Some(proc) = process_lock.take() {
                drain_pending_requests(&proc.pending, "LSP manager stopped");
            }
        }
        if let Ok(mut child_lock) = self.child.lock() {
            if let Some(mut child) = child_lock.take() {
                kill_and_wait_child(&mut child);
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LspDiagnosticsPayload {
    pub(crate) version: Option<u32>,
    pub(crate) diagnostics: Vec<LspDiagnostic>,
}

fn empty_diagnostics_payload() -> LspDiagnosticsPayload {
    LspDiagnosticsPayload {
        version: None,
        diagnostics: Vec::new(),
    }
}

fn diagnostics_payload_for(proc: &LspProcess, uri: &str) -> LspDiagnosticsPayload {
    proc.diagnostics
        .lock()
        .unwrap()
        .get(uri)
        .cloned()
        .unwrap_or_else(empty_diagnostics_payload)
}

fn track_file_text(proc: &LspProcess, uri: String, text: &str, version: u32) {
    proc.file_lines
        .lock()
        .unwrap()
        .insert(uri.clone(), text.lines().map(String::from).collect());
    proc.document_versions.lock().unwrap().insert(uri, version);
}

fn clear_file_state(proc: &LspProcess, uri: &str) {
    proc.file_lines.lock().unwrap().remove(uri);
    proc.diagnostics.lock().unwrap().remove(uri);
    proc.document_versions.lock().unwrap().remove(uri);
}

fn store_published_diagnostics(
    proc: &LspProcess,
    uri: &str,
    raw: &[Value],
    publish_version: Option<u32>,
) -> bool {
    let lines = {
        let file_lines = proc.file_lines.lock().unwrap();
        let Some(lines) = file_lines.get(uri).cloned() else {
            proc.diagnostics.lock().unwrap().remove(uri);
            return true;
        };
        lines
    };

    if let Some(version) = publish_version {
        let current_version = proc.document_versions.lock().unwrap().get(uri).copied();
        if current_version != Some(version) {
            return false;
        }
    } else {
        // Vector-LSP must include publishDiagnostics.params.version for complete stale-publish
        // rejection. Unversioned publishes are still accepted, but the JS side cannot prove
        // whether they belong to the currently opened document version.
    }

    let diagnostics = diagnostics_from_lsp_publish(raw, &lines);

    proc.diagnostics.lock().unwrap().insert(
        uri.to_string(),
        LspDiagnosticsPayload {
            version: publish_version,
            diagnostics,
        },
    );
    true
}

fn vector_lsp_binary_candidates(resource_dir: Option<PathBuf>) -> Vec<PathBuf> {
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
    if let Some(dir) = resource_dir {
        candidates.push(dir.join(exe));
    }
    candidates.push(PathBuf::from(format!("../vector-lsp/target/release/{exe}")));
    candidates.push(PathBuf::from(format!("../vector-lsp/target/debug/{exe}")));
    candidates.push(PathBuf::from(format!(
        "../vector-lsp/target/x86_64-pc-windows-msvc/release/{exe}"
    )));
    candidates.push(PathBuf::from(format!(
        "../vector-lsp/target/x86_64-pc-windows-msvc/debug/{exe}"
    )));
    candidates
}

fn find_vector_lsp_binary(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let candidates = vector_lsp_binary_candidates(app_handle.path().resource_dir().ok());

    for path in &candidates {
        if path.exists() {
            return Ok(path.clone());
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

fn is_current_session(active_session: &AtomicU64, session_id: u64) -> bool {
    active_session.load(Ordering::SeqCst) == session_id
}

fn drain_pending_requests(
    pending: &Mutex<HashMap<u64, oneshot::Sender<Result<Option<Value>, String>>>>,
    reason: &str,
) -> usize {
    let mut pending = pending.lock().unwrap();
    let count = pending.len();
    for (_, sender) in pending.drain() {
        let _ = sender.send(Err(reason.to_string()));
    }
    count
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

fn run_lsp_reader(
    mut reader: BufReader<ChildStdout>,
    proc: Arc<LspProcess>,
    active_session: Arc<AtomicU64>,
    app: tauri::AppHandle,
) {
    while let Some(msg) = read_lsp_msg(&mut reader) {
        if !is_current_session(&active_session, proc.session_id) {
            drain_pending_requests(&proc.pending, "stale LSP session");
            return;
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
        match msg.get("method").and_then(|m| m.as_str()) {
            Some("window/logMessage") => {
                let text = msg["params"]["message"].as_str().unwrap_or("").to_string();
                let _ = app.emit("lsp-log", &text);
                continue;
            }
            Some("textDocument/publishDiagnostics") => {}
            _ => continue,
        }
        let Some(params) = msg.get("params") else {
            continue;
        };
        let Some(uri) = params.get("uri").and_then(|u| u.as_str()) else {
            continue;
        };
        let uri = uri.to_string();
        let raw = params
            .get("diagnostics")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        let publish_version = params
            .get("version")
            .and_then(|version| version.as_u64())
            .map(|version| version.min(u64::from(u32::MAX)) as u32);

        if store_published_diagnostics(&proc, &uri, &raw, publish_version) {
            let _ = app.emit("lsp-diagnostics-changed", &uri);
        }
    }
    drain_pending_requests(&proc.pending, "LSP reader stopped");
}

fn get_lsp_proc(state: &tauri::State<'_, LspManager>) -> Result<Arc<LspProcess>, String> {
    state
        .process
        .lock()
        .unwrap()
        .as_ref()
        .map(Arc::clone)
        .ok_or_else(|| "LSP not started".into())
}

#[tauri::command]
pub(crate) async fn lsp_start(
    workspace_path: String,
    state: tauri::State<'_, LspManager>,
    config_state: tauri::State<'_, AppConfigState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let (session_id, old_proc, old_child) = state.begin_start_session();
    if let Some(old_proc) = old_proc {
        drain_pending_requests(&old_proc.pending, "LSP session restarted");
    }
    if let Some(mut old_child) = old_child {
        kill_and_wait_child(&mut old_child);
    }

    let (binary, lint_mode, schema_version, schema_path, plugin_path, debug_logging) = {
        let config = config_state.config.lock().unwrap();
        let binary = match config.vector_lsp_path.as_deref().filter(|p| !p.is_empty()) {
            Some(path) => {
                let p = PathBuf::from(path);
                if p.exists() {
                    p
                } else {
                    return Err(format!("Configured vector-lsp path does not exist: {path}. Update it in Lint Options."));
                }
            }
            None => find_vector_lsp_binary(&app_handle)?,
        };
        let lint_mode = config
            .lint_mode
            .clone()
            .unwrap_or_else(|| "basic".to_string());
        let schema_version = config.schema_version.clone().filter(|v| !v.is_empty());
        let schema_path = config.schema_path.clone().filter(|p| !p.is_empty());
        let plugin_path = config.plugin_path.clone().filter(|p| !p.is_empty());
        let debug_logging = config.debug_logging;
        (
            binary,
            lint_mode,
            schema_version,
            schema_path,
            plugin_path,
            debug_logging,
        )
    };

    let mut cmd = Command::new(&binary);
    cmd.current_dir(&workspace_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if lint_mode == "advanced" {
        if let Some(ref pp) = plugin_path {
            cmd.env("VLSP_PLUGIN_PATH", pp);
        }
        if let Some(ref sp) = schema_path {
            cmd.env("VLSP_SCHEMA_PATH", sp);
        }
    } else if let Some(ref sv) = schema_version {
        cmd.env("VLSP_SCHEMA_VARIANT", sv);
    }
    if debug_logging {
        cmd.env("VLSP_DEBUG_LOGGING", "1");
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start vector-lsp: {e}"))?;

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

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
                "capabilities": { "textDocument": { "publishDiagnostics": {} } }
            }
        }),
    ) {
        return Err(cleanup_startup_failure(
            &mut child,
            format!("Failed to send LSP initialize request: {error}"),
        ));
    }

    let (reader, initialize_response) =
        match read_initial_lsp_message(BufReader::new(stdout), Duration::from_secs(10)) {
            Ok(result) => result,
            Err(error) => {
                return Err(cleanup_startup_failure(&mut child, error));
            }
        };
    if let Err(error) = validate_initialize_response(&initialize_response) {
        return Err(cleanup_startup_failure(&mut child, error));
    }
    if !is_current_session(&state.active_session, session_id) {
        kill_and_wait_child(&mut child);
        return Ok(());
    }

    if let Err(error) = send_lsp_msg(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {}
        }),
    ) {
        return Err(cleanup_startup_failure(
            &mut child,
            format!("Failed to send LSP initialized notification: {error}"),
        ));
    }
    if !is_current_session(&state.active_session, session_id) {
        kill_and_wait_child(&mut child);
        return Ok(());
    }

    let proc = Arc::new(LspProcess {
        session_id,
        stdin: Mutex::new(stdin),
        next_id: AtomicU64::new(100),
        pending: Mutex::new(HashMap::new()),
        diagnostics: Mutex::new(HashMap::new()),
        file_lines: Mutex::new(HashMap::new()),
        document_versions: Mutex::new(HashMap::new()),
    });

    if !state.publish_started_process(session_id, Arc::clone(&proc), child) {
        return Ok(());
    }

    let app_clone = app_handle.clone();
    let active_session = Arc::clone(&state.active_session);
    std::thread::spawn(move || run_lsp_reader(reader, proc, active_session, app_clone));

    let app_stderr = app_handle.clone();
    let stderr_session = Arc::clone(&state.active_session);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        while reader.read_line(&mut line).unwrap_or(0) > 0 {
            if !is_current_session(&stderr_session, session_id) {
                return;
            }
            let trimmed = line.trim().to_string();
            if !trimmed.is_empty() {
                let _ = app_stderr.emit("lsp-log", &trimmed);
            }
            line.clear();
        }
    });

    Ok(())
}

#[tauri::command]
pub(crate) fn lsp_open_file(
    uri: String,
    text: String,
    version: u32,
    state: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    let proc = get_lsp_proc(&state)?;
    track_file_text(&proc, uri.clone(), &text, version);
    let mut stdin = proc.stdin.lock().unwrap();
    send_lsp_msg(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {
                "textDocument": { "uri": uri, "languageId": "plaintext", "version": version, "text": text }
            }
        }),
    )
}

#[tauri::command]
pub(crate) fn lsp_update_file(
    uri: String,
    version: u32,
    text: String,
    state: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    let proc = get_lsp_proc(&state)?;
    track_file_text(&proc, uri.clone(), &text, version);
    let mut stdin = proc.stdin.lock().unwrap();
    send_lsp_msg(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didChange",
            "params": {
                "textDocument": { "uri": uri, "version": version },
                "contentChanges": [{ "text": text }]
            }
        }),
    )
}

#[tauri::command]
pub(crate) fn lsp_update_file_incremental(
    uri: String,
    version: u32,
    changes: Vec<LspContentChange>,
    state: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    let proc = get_lsp_proc(&state)?;
    {
        let mut file_lines = proc.file_lines.lock().unwrap();
        if let Some(lines) = file_lines.get_mut(&uri) {
            for change in &changes {
                apply_line_change(lines, &change.range, &change.text);
            }
        }
    }
    proc.document_versions
        .lock()
        .unwrap()
        .insert(uri.clone(), version);
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
    let mut stdin = proc.stdin.lock().unwrap();
    send_lsp_msg(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didChange",
            "params": {
                "textDocument": { "uri": uri, "version": version },
                "contentChanges": content_changes
            }
        }),
    )
}

#[tauri::command]
pub(crate) fn lsp_close_file(
    uri: String,
    state: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    let proc = get_lsp_proc(&state)?;
    clear_file_state(&proc, &uri);
    let mut stdin = proc.stdin.lock().unwrap();
    send_lsp_msg(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didClose",
            "params": { "textDocument": { "uri": uri } }
        }),
    )
}

#[tauri::command]
pub(crate) fn lsp_get_diagnostics(
    uri: String,
    state: tauri::State<'_, LspManager>,
) -> LspDiagnosticsPayload {
    state
        .process
        .lock()
        .unwrap()
        .as_ref()
        .map(|proc| diagnostics_payload_for(proc, &uri))
        .unwrap_or_else(empty_diagnostics_payload)
}

#[tauri::command]
pub(crate) async fn lsp_hover(
    uri: String,
    line: u32,
    character: u32,
    state: tauri::State<'_, LspManager>,
) -> Result<Option<String>, String> {
    let proc = get_lsp_proc(&state)?;
    let id = proc.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    proc.pending.lock().unwrap().insert(id, tx);
    {
        let mut stdin = proc.stdin.lock().unwrap();
        if let Err(error) = send_lsp_msg(
            &mut stdin,
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
    state: tauri::State<'_, LspManager>,
) -> Result<Option<DefinitionLocation>, String> {
    let proc = get_lsp_proc(&state)?;
    let id = proc.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    proc.pending.lock().unwrap().insert(id, tx);
    {
        let mut stdin = proc.stdin.lock().unwrap();
        if let Err(error) = send_lsp_msg(
            &mut stdin,
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

    #[test]
    fn vector_lsp_runtime_candidates_include_packaged_and_target_triple_paths() {
        let resource_dir = PathBuf::from("bundle-resources");
        let candidates = vector_lsp_binary_candidates(Some(resource_dir.clone()));
        let rendered = candidates
            .iter()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(candidates.iter().any(|path| path
            == &resource_dir.join(if cfg!(windows) {
                "vector-lsp.exe"
            } else {
                "vector-lsp"
            })));
        assert!(rendered.contains("../vector-lsp/target/release/vector-lsp"));
        assert!(rendered.contains("../vector-lsp/target/debug/vector-lsp"));
        assert!(rendered.contains("../vector-lsp/target/x86_64-pc-windows-msvc/release/vector-lsp"));
        assert!(rendered.contains("../vector-lsp/target/x86_64-pc-windows-msvc/debug/vector-lsp"));
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
    fn session_guard_accepts_only_current_session() {
        let active = AtomicU64::new(4);
        assert!(is_current_session(&active, 4));
        assert!(!is_current_session(&active, 3));
        active.store(5, Ordering::SeqCst);
        assert!(!is_current_session(&active, 4));
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
    }

    #[test]
    fn production_startup_rechecks_session_before_publishing_process() {
        let source = include_str!("lsp_service.rs");
        let production = &source[..source.find("#[cfg(test)]").unwrap()];
        assert!(production.contains("fn publish_started_process("));
        assert!(production.contains(
            "state.publish_started_process(session_id, Arc::clone(&proc), child)"
        ));
        assert!(production.contains("let _publication = self.publication.lock().unwrap();"));
        let forbidden_process_publish =
            format!("{}{}", "*state.process.lock().unwrap()", " = Some");
        let forbidden_child_publish = format!("{}{}", "*state.child.lock().unwrap()", " = Some");
        assert!(!production.contains(&forbidden_process_publish));
        assert!(!production.contains(&forbidden_child_publish));
    }

    #[test]
    fn versioned_publish_does_not_overwrite_newer_tracked_document() {
        let (proc, mut child) = test_lsp_process(1);
        let uri = "file:///E:/Data/items.txt";
        track_file_text(&proc, uri.to_string(), "id\tvalue\n1\tfresh", 2);

        assert!(store_published_diagnostics(
            &proc,
            uri,
            &[raw_diagnostic("fresh")],
            Some(2)
        ));
        assert!(!store_published_diagnostics(
            &proc,
            uri,
            &[raw_diagnostic("stale")],
            Some(1)
        ));

        let payload = diagnostics_payload_for(&proc, uri);
        assert_eq!(payload.version, Some(2));
        assert_eq!(payload.diagnostics.len(), 1);
        assert_eq!(payload.diagnostics[0].message, "fresh");
        kill_and_wait_child(&mut child);
    }

    #[test]
    fn versioned_publish_payload_is_returned_with_version() {
        let (proc, mut child) = test_lsp_process(1);
        let uri = "file:///E:/Data/items.txt";
        track_file_text(&proc, uri.to_string(), "id\tvalue\n1\tfresh", 2);

        assert!(store_published_diagnostics(
            &proc,
            uri,
            &[raw_diagnostic("fresh")],
            Some(2)
        ));

        let payload = diagnostics_payload_for(&proc, uri);
        assert_eq!(payload.version, Some(2));
        assert_eq!(payload.diagnostics.len(), 1);
        assert_eq!(payload.diagnostics[0].message, "fresh");
        kill_and_wait_child(&mut child);
    }

    #[test]
    fn clear_file_state_removes_diagnostics_and_tracked_version() {
        let (proc, mut child) = test_lsp_process(1);
        let uri = "file:///E:/Data/items.txt";
        track_file_text(&proc, uri.to_string(), "id\tvalue\n1\tfresh", 2);
        assert!(store_published_diagnostics(
            &proc,
            uri,
            &[raw_diagnostic("fresh")],
            Some(2)
        ));

        clear_file_state(&proc, uri);

        assert!(!proc.file_lines.lock().unwrap().contains_key(uri));
        assert!(!proc.document_versions.lock().unwrap().contains_key(uri));
        assert_eq!(diagnostics_payload_for(&proc, uri), empty_diagnostics_payload());
        kill_and_wait_child(&mut child);
    }

    #[test]
    fn did_open_uses_supplied_document_version() {
        let source = include_str!("lsp_service.rs");
        let start = source.find("pub(crate) fn lsp_open_file(").unwrap();
        let end = source.find("pub(crate) fn lsp_update_file(").unwrap();
        let body = &source[start..end];
        assert!(body.contains("version: u32"));
        assert!(body.contains("track_file_text(&proc, uri.clone(), &text, version)"));
        assert!(body.contains("\"version\": version"));
        assert!(!body.contains("\"version\": 1"));
        assert!(!body.contains("&text, 1"));
    }

    #[test]
    fn publication_guard_rejects_stale_session_and_reaps_child() {
        let manager = LspManager::new();
        let (first_session, _, _) = manager.begin_start_session();
        let (second_session, _, _) = manager.begin_start_session();
        assert_eq!(first_session, 1);
        assert_eq!(second_session, 2);

        let mut child = spawn_long_running_child();
        let stdin = child.stdin.take().unwrap();
        let proc = Arc::new(LspProcess {
            session_id: first_session,
            stdin: Mutex::new(stdin),
            next_id: AtomicU64::new(100),
            pending: Mutex::new(HashMap::new()),
            diagnostics: Mutex::new(HashMap::new()),
            file_lines: Mutex::new(HashMap::new()),
            document_versions: Mutex::new(HashMap::new()),
        });
        let (tx, mut rx) = oneshot::channel();
        proc.pending.lock().unwrap().insert(7, tx);

        assert!(!manager.publish_started_process(first_session, Arc::clone(&proc), child));
        assert!(manager.process.lock().unwrap().is_none());
        assert!(manager.child.lock().unwrap().is_none());
        assert!(proc.pending.lock().unwrap().is_empty());
        assert_eq!(rx.try_recv().unwrap().unwrap_err(), "stale LSP session");
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

    fn raw_diagnostic(message: &str) -> Value {
        json!({
            "range": {
                "start": { "line": 1, "character": 2 },
                "end": { "line": 1, "character": 7 }
            },
            "severity": 2,
            "message": message
        })
    }

    fn test_lsp_process(session_id: u64) -> (Arc<LspProcess>, std::process::Child) {
        let mut child = spawn_long_running_child();
        let stdin = child.stdin.take().unwrap();
        (
            Arc::new(LspProcess {
                session_id,
                stdin: Mutex::new(stdin),
                next_id: AtomicU64::new(100),
                pending: Mutex::new(HashMap::new()),
                diagnostics: Mutex::new(HashMap::new()),
                file_lines: Mutex::new(HashMap::new()),
                document_versions: Mutex::new(HashMap::new()),
            }),
            child,
        )
    }

    #[cfg(windows)]
    fn spawn_long_running_child() -> std::process::Child {
        Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn long-running child")
    }

    #[cfg(not(windows))]
    fn spawn_long_running_child() -> std::process::Child {
        Command::new("sh")
            .args(["-c", "sleep 30"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn long-running child")
    }
}
