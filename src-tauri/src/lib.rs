use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;

// ── app configuration ──────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    vector_lsp_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    schema_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    lint_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    schema_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plugin_path: Option<String>,
    #[serde(default)]
    debug_logging: bool,
}

struct AppConfigState {
    config: Mutex<AppConfig>,
    config_path: PathBuf,
}

fn load_app_config_from(path: &Path) -> AppConfig {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn get_config(state: tauri::State<'_, AppConfigState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(config: AppConfig, state: tauri::State<'_, AppConfigState>) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    let path = &state.config_path;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, json).map_err(|e| e.to_string())?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

#[tauri::command]
async fn pick_file_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .blocking_pick_file()
        .map(file_path_to_string)
        .transpose()
}

// ── vector-lsp binding ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
struct LspDiagnostic {
    row: u32,
    col: u32,
    severity: String,
    message: String,
    code: Option<String>,
}

struct LspProcess {
    stdin: Mutex<ChildStdin>,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Option<Value>>>>,
    diagnostics: Mutex<HashMap<String, Vec<LspDiagnostic>>>,
    file_lines: Mutex<HashMap<String, Vec<String>>>,
}

struct LspManager {
    process: Mutex<Option<Arc<LspProcess>>>,
    child: Mutex<Option<std::process::Child>>,
}

impl LspManager {
    fn new() -> Self {
        Self { process: Mutex::new(None), child: Mutex::new(None) }
    }
}

fn send_lsp_msg(stdin: &mut ChildStdin, msg: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    stdin.write_all(header.as_bytes()).map_err(|e| e.to_string())?;
    stdin.write_all(&body).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn read_lsp_msg<R: BufRead>(reader: &mut R) -> Option<Value> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(val) = trimmed.strip_prefix("Content-Length: ") {
            content_length = val.parse().ok();
        }
    }
    let length = content_length?;
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).ok()?;
    serde_json::from_slice(&body).ok()
}

fn path_to_uri(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/') {
        format!("file://{normalized}")
    } else {
        format!("file:///{normalized}")
    }
}

fn find_vector_lsp_binary() -> Result<PathBuf, String> {
    let exe = if cfg!(windows) { "vector-lsp.exe" } else { "vector-lsp" };

    let mut candidates: Vec<PathBuf> = Vec::new();

    // Bundled distribution: vector-lsp sits next to the installed TXTeditor binary.
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            candidates.push(dir.join(exe));
        }
    }

    // Dev-time fallback: sibling repo checked out at ../vector-lsp.
    candidates.push(PathBuf::from(format!("../vector-lsp/target/release/{exe}")));
    candidates.push(PathBuf::from(format!("../vector-lsp/target/debug/{exe}")));

    for path in &candidates {
        if path.exists() {
            return Ok(path.clone());
        }
    }
    Err(format!(
        "vector-lsp binary not found. Set a path in Settings or build it in ../vector-lsp. Tried: {}",
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
    ))
}

fn count_tabs_before(line: &str, char_offset: usize) -> usize {
    line.get(..char_offset.min(line.len()))
        .unwrap_or("")
        .chars()
        .filter(|&c| c == '\t')
        .count()
}

fn run_lsp_reader(
    stdout: std::process::ChildStdout,
    proc: Arc<LspProcess>,
    app: tauri::AppHandle,
) {
    let mut reader = BufReader::new(stdout);
    while let Some(msg) = read_lsp_msg(&mut reader) {
        // Route responses (have id, no method) to pending request waiters
        if msg.get("id").is_some() && msg.get("method").is_none() {
            if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                let sender = proc.pending.lock().unwrap().remove(&id);
                if let Some(tx) = sender {
                    let result = msg.get("result").cloned();
                    let _ = tx.send(result);
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
        let Some(params) = msg.get("params") else { continue };
        let Some(uri) = params.get("uri").and_then(|u| u.as_str()) else { continue };
        let uri = uri.to_string();
        let raw = params.get("diagnostics").and_then(|d| d.as_array()).cloned().unwrap_or_default();

        let lines = proc.file_lines.lock().unwrap().get(&uri).cloned().unwrap_or_else(|| {
            let path = uri.strip_prefix("file:///")
                .or_else(|| uri.strip_prefix("file://"))
                .unwrap_or(&uri);
            std::fs::read_to_string(path)
                .unwrap_or_default()
                .lines()
                .map(String::from)
                .collect()
        });

        let diagnostics: Vec<LspDiagnostic> = raw.iter().filter_map(|d| {
            let line = d["range"]["start"]["line"].as_u64()? as u32;
            let character = d["range"]["start"]["character"].as_u64()? as usize;
            let col = lines.get(line as usize)
                .map(|l| count_tabs_before(l, character) as u32)
                .unwrap_or(0);
            let severity = match d["severity"].as_u64().unwrap_or(2) {
                1 => "error",
                3 | 4 => "info",
                _ => "warning",
            }.to_string();
            let message = d["message"].as_str().unwrap_or("").to_string();
            let code = d["code"].as_str().map(String::from)
                .or_else(|| d["code"].as_u64().map(|n| n.to_string()));
            Some(LspDiagnostic { row: line, col, severity, message, code })
        }).collect();

        proc.diagnostics.lock().unwrap().insert(uri.clone(), diagnostics);
        let _ = app.emit("lsp-diagnostics-changed", &uri);
    }
}

fn get_lsp_proc(state: &tauri::State<'_, LspManager>) -> Result<Arc<LspProcess>, String> {
    state.process.lock().unwrap().as_ref().map(Arc::clone).ok_or_else(|| "LSP not started".into())
}

#[tauri::command]
async fn lsp_start(
    workspace_path: String,
    state: tauri::State<'_, LspManager>,
    config_state: tauri::State<'_, AppConfigState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Kill previous child process if one is running.
    {
        let mut child_lock = state.child.lock().unwrap();
        if let Some(mut old_child) = child_lock.take() {
            let _ = old_child.kill();
        }
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
            None => find_vector_lsp_binary()?,
        };
        let lint_mode = config.lint_mode.clone().unwrap_or_else(|| "basic".to_string());
        let schema_version = config.schema_version.clone().filter(|v| !v.is_empty());
        let schema_path = config.schema_path.clone().filter(|p| !p.is_empty());
        let plugin_path = config.plugin_path.clone().filter(|p| !p.is_empty());
        let debug_logging = config.debug_logging;
        (binary, lint_mode, schema_version, schema_path, plugin_path, debug_logging)
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
    } else {
        if let Some(ref sv) = schema_version {
            cmd.env("VLSP_SCHEMA_VARIANT", sv);
        }
    }
    if debug_logging {
        cmd.env("VLSP_DEBUG_LOGGING", "1");
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to start vector-lsp: {e}"))?;

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let root_uri = path_to_uri(&workspace_path);
    send_lsp_msg(&mut stdin, &json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "processId": std::process::id(),
            "rootUri": root_uri,
            "capabilities": { "textDocument": { "publishDiagnostics": {} } }
        }
    }))?;

    let mut reader = BufReader::new(stdout);
    read_lsp_msg(&mut reader); // consume initialize response

    send_lsp_msg(&mut stdin, &json!({
        "jsonrpc": "2.0",
        "method": "initialized",
        "params": {}
    }))?;

    let proc = Arc::new(LspProcess {
        stdin: Mutex::new(stdin),
        next_id: AtomicU64::new(100),
        pending: Mutex::new(HashMap::new()),
        diagnostics: Mutex::new(HashMap::new()),
        file_lines: Mutex::new(HashMap::new()),
    });

    *state.process.lock().unwrap() = Some(Arc::clone(&proc));
    // Store child so it can be killed on the next restart.
    *state.child.lock().unwrap() = Some(child);

    let app_clone = app_handle.clone();
    std::thread::spawn(move || run_lsp_reader(reader.into_inner(), proc, app_clone));

    let app_stderr = app_handle.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        while reader.read_line(&mut line).unwrap_or(0) > 0 {
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
fn lsp_open_file(
    uri: String,
    text: String,
    state: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    let proc = get_lsp_proc(&state)?;
    proc.file_lines.lock().unwrap().insert(uri.clone(), text.lines().map(String::from).collect());
    let mut stdin = proc.stdin.lock().unwrap();
    send_lsp_msg(&mut stdin, &json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didOpen",
        "params": {
            "textDocument": { "uri": uri, "languageId": "plaintext", "version": 1, "text": text }
        }
    }))
}

#[tauri::command]
fn lsp_update_file(
    uri: String,
    version: u32,
    text: String,
    state: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    let proc = get_lsp_proc(&state)?;
    proc.file_lines.lock().unwrap().insert(uri.clone(), text.lines().map(String::from).collect());
    let mut stdin = proc.stdin.lock().unwrap();
    send_lsp_msg(&mut stdin, &json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didChange",
        "params": {
            "textDocument": { "uri": uri, "version": version },
            "contentChanges": [{ "text": text }]
        }
    }))
}

#[tauri::command]
fn lsp_close_file(
    uri: String,
    state: tauri::State<'_, LspManager>,
) -> Result<(), String> {
    let proc = get_lsp_proc(&state)?;
    proc.file_lines.lock().unwrap().remove(&uri);
    proc.diagnostics.lock().unwrap().remove(&uri);
    let mut stdin = proc.stdin.lock().unwrap();
    send_lsp_msg(&mut stdin, &json!({
        "jsonrpc": "2.0",
        "method": "textDocument/didClose",
        "params": { "textDocument": { "uri": uri } }
    }))
}

#[tauri::command]
fn lsp_get_diagnostics(
    uri: String,
    state: tauri::State<'_, LspManager>,
) -> Vec<LspDiagnostic> {
    state.process.lock().unwrap()
        .as_ref()
        .and_then(|proc| proc.diagnostics.lock().unwrap().get(&uri).cloned())
        .unwrap_or_default()
}

fn strip_markdown_for_tooltip(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut remaining = text;
    loop {
        // Find first occurrence of any marker we handle
        let d = remaining.find("$!");
        let b = remaining.find("**");
        let t = remaining.find('`');
        let first = [d, b, t].iter().filter_map(|&p| p).min();
        match first {
            None => { result.push_str(remaining); break; }
            Some(pos) => {
                result.push_str(&remaining[..pos]);
                if d == Some(pos) {
                    // $!...!$ → [...]
                    remaining = &remaining[pos + 2..];
                    match remaining.find("!$") {
                        Some(end) => {
                            result.push('[');
                            result.push_str(&remaining[..end]);
                            result.push(']');
                            remaining = &remaining[end + 2..];
                        }
                        None => { result.push_str("$!"); }
                    }
                } else if b == Some(pos) {
                    // **...** → content (strip delimiters); no closing ** → keep literal
                    remaining = &remaining[pos + 2..];
                    match remaining.find("**") {
                        Some(end) => {
                            result.push_str(&remaining[..end]);
                            remaining = &remaining[end + 2..];
                        }
                        None => { result.push_str("**"); }
                    }
                } else {
                    // `...` → content (strip backticks); no closing ` → keep literal
                    remaining = &remaining[pos + 1..];
                    match remaining.find('`') {
                        Some(end) => {
                            result.push_str(&remaining[..end]);
                            remaining = &remaining[end + 1..];
                        }
                        None => { result.push('`'); }
                    }
                }
            }
        }
    }
    result.trim().to_string()
}

#[tauri::command]
async fn lsp_hover(
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
        send_lsp_msg(&mut stdin, &json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "textDocument/hover",
            "params": {
                "textDocument": { "uri": uri },
                "position": { "line": line, "character": character }
            }
        }))?;
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
        .await
        .map_err(|_| { proc.pending.lock().unwrap().remove(&id); "hover timeout".to_string() })?
        .map_err(|_| "hover channel closed".to_string())?;
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
struct DefinitionLocation {
    uri: String,
    line: u32,
    character: u32,
}

#[tauri::command]
async fn lsp_definition(
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
        send_lsp_msg(&mut stdin, &json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "textDocument/definition",
            "params": {
                "textDocument": { "uri": uri },
                "position": { "line": line, "character": character }
            }
        }))?;
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
        .await
        .map_err(|_| { proc.pending.lock().unwrap().remove(&id); "definition timeout".to_string() })?
        .map_err(|_| "definition channel closed".to_string())?;
    let loc = result.and_then(|v| {
        let item = if v.is_array() { v.as_array()?.first()?.clone() } else { v };
        if item.is_null() { return None; }
        let target_uri = item.get("uri")
            .or_else(|| item.get("targetUri"))?
            .as_str().map(String::from)?;
        let range = item.get("range")
            .or_else(|| item.get("targetSelectionRange"))
            .or_else(|| item.get("targetRange"))?;
        let start = range.get("start")?;
        let def_line = start.get("line")?.as_u64()? as u32;
        let character = start.get("character")?.as_u64()? as u32;
        Some(DefinitionLocation { uri: target_uri, line: def_line, character })
    });
    Ok(loc)
}

// ── existing file I/O commands ─────────────────────────────────────────────

#[tauri::command]
async fn open_files_dialog(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Tabular text", &["txt", "tsv", "tbl", "csv"])
        .blocking_pick_files();
    match picked {
        Some(paths) => paths.into_iter().map(file_path_to_string).collect(),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(file_path_to_string)
        .transpose()
}

#[tauri::command]
async fn save_file_dialog(app: tauri::AppHandle, default_name: String) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .add_filter("Tabular text", &["txt", "tsv", "tbl", "csv"])
        .set_file_name(default_name)
        .blocking_save_file()
        .map(file_path_to_string)
        .transpose()
}

#[tauri::command]
fn read_text_file(path: String) -> Result<TextFilePayload, String> {
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    let (text, encoding) = decode_text(bytes)?;
    let name = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled.txt")
        .to_string();
    Ok(TextFilePayload { path, name, text, encoding })
}

#[tauri::command]
fn write_text_file_safe(path: String, text: String) -> Result<SavePayload, String> {
    let target = PathBuf::from(&path);

    let mut temp = target.clone();
    let temp_name = format!(
        ".{}.tmp",
        target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("txteditor")
    );
    temp.set_file_name(temp_name);

    {
        let mut file = fs::File::create(&temp).map_err(|err| err.to_string())?;
        file.write_all(text.as_bytes()).map_err(|err| err.to_string())?;
        file.sync_all().map_err(|err| err.to_string())?;
    }

    if target.exists() {
        fs::remove_file(&target).map_err(|err| err.to_string())?;
    }
    fs::rename(&temp, &target).map_err(|err| err.to_string())?;

    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled.txt")
        .to_string();
    Ok(SavePayload { path, name })
}

#[tauri::command]
fn list_workspace_files(path: String) -> Result<WorkspacePayload, String> {
    let mut files = Vec::new();
    collect_text_files(Path::new(&path), &mut files, 0)?;
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(WorkspacePayload { path, files })
}

fn collect_text_files(path: &Path, files: &mut Vec<WorkspaceFile>, depth: usize) -> Result<(), String> {
    if depth > 4 {
        return Ok(());
    }
    for entry in fs::read_dir(path).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            collect_text_files(&entry_path, files, depth + 1)?;
        } else if is_text_like(&entry_path) {
            let name = entry_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Untitled.txt")
                .to_string();
            files.push(WorkspaceFile {
                path: entry_path.to_string_lossy().to_string(),
                name,
            });
        }
    }
    Ok(())
}

fn is_text_like(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase()),
        Some(ext) if matches!(ext.as_str(), "txt" | "tsv" | "tbl" | "csv")
    )
}

fn decode_text(bytes: Vec<u8>) -> Result<(String, String), String> {
    match String::from_utf8(bytes) {
        Ok(text) => Ok((text, "utf-8".to_string())),
        Err(err) => {
            let bytes = err.into_bytes();
            let text: String = bytes.into_iter().map(|byte| byte as char).collect();
            Ok((text, "windows-1252-lossy".to_string()))
        }
    }
}

fn file_path_to_string(path: FilePath) -> Result<String, String> {
    let path = path.into_path().map_err(|_| "Selected path is not a local filesystem path.".to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// ── shared payload types ───────────────────────────────────────────────────

#[derive(Serialize)]
struct TextFilePayload {
    path: String,
    name: String,
    text: String,
    encoding: String,
}

#[derive(Serialize)]
struct SavePayload {
    path: String,
    name: String,
}

#[derive(Serialize)]
struct WorkspaceFile {
    path: String,
    name: String,
}

#[derive(Serialize)]
struct WorkspacePayload {
    path: String,
    files: Vec<WorkspaceFile>,
}

// ── entry point ────────────────────────────────────────────────────────────

#[tauri::command]
fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(LspManager::new())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = fs::create_dir_all(&config_dir);
            let config_path = config_dir.join("config.json");
            let config = load_app_config_from(&config_path);
            app.manage(AppConfigState {
                config: Mutex::new(config),
                config_path,
            });
            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win.emit("app-close-requested", ());
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_files_dialog,
            open_folder_dialog,
            save_file_dialog,
            read_text_file,
            write_text_file_safe,
            list_workspace_files,
            get_config,
            save_config,
            pick_file_path,
            lsp_start,
            lsp_open_file,
            lsp_update_file,
            lsp_close_file,
            lsp_get_diagnostics,
            lsp_hover,
            lsp_definition,
            close_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running txteditor");
}
