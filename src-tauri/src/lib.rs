use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::{DialogExt, FilePath};

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
fn write_text_file_safe(path: String, text: String, backup: bool) -> Result<SavePayload, String> {
    let target = PathBuf::from(&path);
    if backup && target.exists() {
        let backup_path = backup_path(&target);
        fs::copy(&target, backup_path).map_err(|err| err.to_string())?;
    }

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

fn backup_path(target: &Path) -> PathBuf {
    for index in 1..=999 {
        let mut candidate = target.to_path_buf();
        let file_name = target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("backup");
        candidate.set_file_name(format!("{file_name}.{index}.bak"));
        if !candidate.exists() {
            return candidate;
        }
    }
    let mut fallback = target.to_path_buf();
    fallback.set_extension("bak");
    fallback
}

fn file_path_to_string(path: FilePath) -> Result<String, String> {
    let path = path.into_path().map_err(|_| "Selected path is not a local filesystem path.".to_string())?;
    Ok(path.to_string_lossy().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_files_dialog,
            open_folder_dialog,
            save_file_dialog,
            read_text_file,
            write_text_file_safe,
            list_workspace_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running txteditor");
}
