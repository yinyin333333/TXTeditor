use crate::native_paths::file_path_to_string;
use serde::Serialize;
use std::fs;
use std::io;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub(crate) async fn open_files_dialog(app: tauri::AppHandle) -> Result<Vec<String>, String> {
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
pub(crate) async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(file_path_to_string)
        .transpose()
}

#[tauri::command]
pub(crate) async fn save_file_dialog(
    app: tauri::AppHandle,
    default_name: String,
) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .add_filter("Tabular text", &["txt", "tsv", "tbl", "csv"])
        .set_file_name(default_name)
        .blocking_save_file()
        .map(file_path_to_string)
        .transpose()
}

#[tauri::command]
pub(crate) fn read_text_file(path: String) -> Result<TextFilePayload, String> {
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    let (text, encoding) = decode_text(bytes)?;
    let name = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled.txt")
        .to_string();
    Ok(TextFilePayload {
        path,
        name,
        text,
        encoding,
    })
}

#[tauri::command]
pub(crate) fn read_text_files(paths: Vec<String>) -> Vec<Result<TextFilePayload, String>> {
    paths.into_iter().map(read_text_file).collect()
}

#[tauri::command]
pub(crate) fn write_text_file_safe(path: String, text: String) -> Result<SavePayload, String> {
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
        file.write_all(text.as_bytes())
            .map_err(|err| err.to_string())?;
        file.sync_all().map_err(|err| err.to_string())?;
    }

    replace_file_with_temp(&target, &temp)?;
    sync_parent_dir(&target);

    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled.txt")
        .to_string();
    Ok(SavePayload { path, name })
}

fn backup_path_for(target: &Path) -> PathBuf {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("txteditor");
    for attempt in 0..1000 {
        let candidate = parent.join(format!(".{}.bak.{}.{}", name, std::process::id(), attempt));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!(".{}.bak.{}", name, std::process::id()))
}

fn replace_file_with_temp(target: &Path, temp: &Path) -> Result<(), String> {
    replace_file_with_temp_ops(
        target,
        temp,
        |from, to| fs::rename(from, to),
        |path| fs::remove_file(path),
    )
}

fn replace_file_with_temp_ops<R, D>(
    target: &Path,
    temp: &Path,
    mut rename: R,
    mut remove_file: D,
) -> Result<(), String>
where
    R: FnMut(&Path, &Path) -> io::Result<()>,
    D: FnMut(&Path) -> io::Result<()>,
{
    if !target.exists() {
        return rename(temp, target).map_err(|err| {
            let _ = remove_file(temp);
            err.to_string()
        });
    }

    let backup = backup_path_for(target);
    rename(target, &backup).map_err(|err| {
        let _ = remove_file(temp);
        err.to_string()
    })?;

    match rename(temp, target) {
        Ok(()) => {
            let _ = remove_file(&backup);
            Ok(())
        }
        Err(replace_err) => {
            let restore_result = rename(&backup, target);
            let _ = remove_file(temp);
            match restore_result {
                Ok(()) => Err(format!("{}; original file was restored", replace_err)),
                Err(restore_err) => Err(format!(
                    "{}; failed to restore original file from {}: {}",
                    replace_err,
                    backup.display(),
                    restore_err
                )),
            }
        }
    }
}

#[cfg(unix)]
fn sync_parent_dir(target: &Path) {
    if let Some(parent) = target.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
}

#[cfg(not(unix))]
fn sync_parent_dir(_target: &Path) {}

pub(crate) fn decode_text(bytes: Vec<u8>) -> Result<(String, String), String> {
    match String::from_utf8(bytes) {
        Ok(text) => Ok((text, "utf-8".to_string())),
        Err(err) => {
            let bytes = err.into_bytes();
            let text: String = bytes.into_iter().map(|byte| byte as char).collect();
            Ok((text, "windows-1252-lossy".to_string()))
        }
    }
}

#[derive(Serialize)]
pub(crate) struct TextFilePayload {
    path: String,
    name: String,
    text: String,
    encoding: String,
}

#[derive(Serialize)]
pub(crate) struct SavePayload {
    path: String,
    name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_text_reports_utf8_or_lossy_windows_1252() {
        let (utf8, utf8_encoding) = decode_text("hello".as_bytes().to_vec()).unwrap();
        assert_eq!(utf8, "hello");
        assert_eq!(utf8_encoding, "utf-8");

        let (lossy, lossy_encoding) = decode_text(vec![b'A', 0xE9]).unwrap();
        assert_eq!(lossy.chars().next(), Some('A'));
        assert_eq!(lossy.chars().nth(1).map(|ch| ch as u32), Some(0xE9));
        assert_eq!(lossy_encoding, "windows-1252-lossy");
    }

    #[test]
    fn read_text_file_returns_payload_with_name_text_and_encoding() {
        let dir =
            std::env::temp_dir().join(format!("txteditor-read-file-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("skills.tsv");
        fs::write(&target, "id\tname\n1\tSkill\n").unwrap();
        let target_string = target.to_string_lossy().to_string();

        let payload = read_text_file(target_string.clone()).unwrap();
        assert_eq!(payload.path, target_string);
        assert_eq!(payload.name, "skills.tsv");
        assert_eq!(payload.text, "id\tname\n1\tSkill\n");
        assert_eq!(payload.encoding, "utf-8");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_text_files_preserves_order_and_per_file_errors() {
        let dir =
            std::env::temp_dir().join(format!("txteditor-bulk-read-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let first = dir.join("a.txt");
        let missing = dir.join("missing.txt");
        let second = dir.join("b.tbl");
        fs::write(&first, "a\n").unwrap();
        fs::write(&second, vec![b'b', 0xE9]).unwrap();

        let results = read_text_files(vec![
            first.to_string_lossy().to_string(),
            missing.to_string_lossy().to_string(),
            second.to_string_lossy().to_string(),
        ]);

        assert_eq!(results.len(), 3);
        assert_eq!(results[0].as_ref().unwrap().name, "a.txt");
        assert_eq!(results[0].as_ref().unwrap().text, "a\n");
        assert!(results[1].is_err());
        assert_eq!(results[2].as_ref().unwrap().name, "b.tbl");
        assert_eq!(results[2].as_ref().unwrap().encoding, "windows-1252-lossy");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_text_file_safe_writes_over_existing_file_and_returns_save_payload() {
        let dir =
            std::env::temp_dir().join(format!("txteditor-safe-write-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("items.txt");
        fs::write(&target, "old").unwrap();
        let target_string = target.to_string_lossy().to_string();

        let first = write_text_file_safe(target_string.clone(), "id\n1\n".to_string()).unwrap();
        assert_eq!(first.path, target_string);
        assert_eq!(first.name, "items.txt");
        assert_eq!(fs::read_to_string(&target).unwrap(), "id\n1\n");
        assert!(!dir.join(".items.txt.tmp").exists());

        let second = write_text_file_safe(target_string.clone(), "id\n2\n".to_string()).unwrap();
        assert_eq!(second.path, target_string);
        assert_eq!(second.name, "items.txt");
        assert_eq!(fs::read_to_string(&target).unwrap(), "id\n2\n");
        assert!(!dir.join(".items.txt.tmp").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_text_file_safe_creates_new_file_without_leaving_temp_file() {
        let dir = std::env::temp_dir().join(format!(
            "txteditor-safe-write-new-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("new-file.txt");
        let target_string = target.to_string_lossy().to_string();

        let payload = write_text_file_safe(target_string.clone(), "fresh\n".to_string()).unwrap();

        assert_eq!(payload.path, target_string);
        assert_eq!(payload.name, "new-file.txt");
        assert_eq!(fs::read_to_string(&target).unwrap(), "fresh\n");
        assert!(!dir.join(".new-file.txt.tmp").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn replace_file_with_temp_restores_original_when_replacement_rename_fails() {
        let dir = std::env::temp_dir().join(format!(
            "txteditor-safe-write-failure-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("items.txt");
        let temp = dir.join(".items.txt.tmp");
        fs::write(&target, "old").unwrap();
        fs::write(&temp, "new").unwrap();
        let mut rename_calls = 0;

        let result = replace_file_with_temp_ops(
            &target,
            &temp,
            |from, to| {
                rename_calls += 1;
                if rename_calls == 2 {
                    Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        "simulated replacement failure",
                    ))
                } else {
                    fs::rename(from, to)
                }
            },
            |path| fs::remove_file(path),
        );

        assert!(result.unwrap_err().contains("original file was restored"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "old");
        assert!(!temp.exists());
        let backup_count = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".bak."))
            .count();
        assert_eq!(backup_count, 0);

        let _ = fs::remove_dir_all(&dir);
    }
}
