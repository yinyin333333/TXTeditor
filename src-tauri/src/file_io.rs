use crate::native_paths::file_path_to_string;
use serde::Serialize;
use std::fs;
use std::fs::OpenOptions;
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
pub(crate) fn write_text_file_safe(
    path: String,
    text: String,
    encoding: Option<String>,
) -> Result<SavePayload, String> {
    let target = PathBuf::from(&path);
    let temp = unique_temp_path_for(&target)?;
    let encoding = normalize_encoding(encoding.as_deref());
    let bytes = encode_text(&text, &encoding)?;

    {
        let write_result = (|| -> Result<(), String> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|err| err.to_string())?;
            file.write_all(&bytes).map_err(|err| err.to_string())?;
            file.sync_all().map_err(|err| err.to_string())?;
            Ok(())
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
    }

    replace_file_with_temp(&target, &temp)?;
    sync_parent_dir(&target);

    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled.txt")
        .to_string();
    Ok(SavePayload {
        path,
        name,
        encoding,
    })
}

fn unique_temp_path_for(target: &Path) -> Result<PathBuf, String> {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("txteditor");
    let mut last_error = None;
    for attempt in 0..1000 {
        let candidate = parent.join(format!(".{}.{}.{}.tmp", name, std::process::id(), attempt));
        if candidate.exists() {
            continue;
        }
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(_) => {
                let _ = fs::remove_file(&candidate);
                return Ok(candidate);
            }
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    Err(last_error.unwrap_or_else(|| "Unable to create a unique temporary save path".to_string()))
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
    let has_utf8_bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    match String::from_utf8(bytes) {
        Ok(text) => Ok((
            text,
            if has_utf8_bom { "utf-8-bom" } else { "utf-8" }.to_string(),
        )),
        Err(err) => {
            let bytes = err.into_bytes();
            Ok((decode_windows_1252(&bytes), "windows-1252".to_string()))
        }
    }
}

fn normalize_encoding(encoding: Option<&str>) -> String {
    match encoding.unwrap_or("utf-8").to_ascii_lowercase().as_str() {
        "windows-1252" | "windows1252" | "cp1252" => "windows-1252".to_string(),
        "utf-8-bom" | "utf8-bom" => "utf-8-bom".to_string(),
        _ => "utf-8".to_string(),
    }
}

fn encode_text(text: &str, encoding: &str) -> Result<Vec<u8>, String> {
    match encoding {
        "windows-1252" => encode_windows_1252(text),
        "utf-8-bom" => {
            let mut bytes = vec![0xEF, 0xBB, 0xBF];
            bytes.extend_from_slice(text.as_bytes());
            Ok(bytes)
        }
        _ => Ok(text.as_bytes().to_vec()),
    }
}

fn decode_windows_1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| char::from_u32(windows_1252_code_point(*byte)).unwrap_or('\u{FFFD}'))
        .collect()
}

fn encode_windows_1252(text: &str) -> Result<Vec<u8>, String> {
    text.chars()
        .map(|ch| {
            let code = ch as u32;
            if code <= 0x7F || (0xA0..=0xFF).contains(&code) {
                Ok(code as u8)
            } else {
                windows_1252_byte(code).ok_or_else(|| {
                    format!("Character U+{code:04X} cannot be saved as Windows-1252")
                })
            }
        })
        .collect()
}

fn windows_1252_code_point(byte: u8) -> u32 {
    match byte {
        0x80 => 0x20AC,
        0x82 => 0x201A,
        0x83 => 0x0192,
        0x84 => 0x201E,
        0x85 => 0x2026,
        0x86 => 0x2020,
        0x87 => 0x2021,
        0x88 => 0x02C6,
        0x89 => 0x2030,
        0x8A => 0x0160,
        0x8B => 0x2039,
        0x8C => 0x0152,
        0x8E => 0x017D,
        0x91 => 0x2018,
        0x92 => 0x2019,
        0x93 => 0x201C,
        0x94 => 0x201D,
        0x95 => 0x2022,
        0x96 => 0x2013,
        0x97 => 0x2014,
        0x98 => 0x02DC,
        0x99 => 0x2122,
        0x9A => 0x0161,
        0x9B => 0x203A,
        0x9C => 0x0153,
        0x9E => 0x017E,
        0x9F => 0x0178,
        _ => u32::from(byte),
    }
}

fn windows_1252_byte(code: u32) -> Option<u8> {
    match code {
        0x20AC => Some(0x80),
        0x201A => Some(0x82),
        0x0192 => Some(0x83),
        0x201E => Some(0x84),
        0x2026 => Some(0x85),
        0x2020 => Some(0x86),
        0x2021 => Some(0x87),
        0x02C6 => Some(0x88),
        0x2030 => Some(0x89),
        0x0160 => Some(0x8A),
        0x2039 => Some(0x8B),
        0x0152 => Some(0x8C),
        0x017D => Some(0x8E),
        0x2018 => Some(0x91),
        0x2019 => Some(0x92),
        0x201C => Some(0x93),
        0x201D => Some(0x94),
        0x2022 => Some(0x95),
        0x2013 => Some(0x96),
        0x2014 => Some(0x97),
        0x02DC => Some(0x98),
        0x2122 => Some(0x99),
        0x0161 => Some(0x9A),
        0x203A => Some(0x9B),
        0x0153 => Some(0x9C),
        0x017E => Some(0x9E),
        0x0178 => Some(0x9F),
        _ => None,
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
    encoding: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_text_reports_utf8_or_windows_1252() {
        let (utf8, utf8_encoding) = decode_text("hello".as_bytes().to_vec()).unwrap();
        assert_eq!(utf8, "hello");
        assert_eq!(utf8_encoding, "utf-8");

        let (windows_1252, windows_1252_encoding) =
            decode_text(vec![0x93, 0x80, 0x85, 0x97]).unwrap();
        assert_eq!(windows_1252, "\u{201C}\u{20AC}\u{2026}\u{2014}");
        assert_eq!(windows_1252_encoding, "windows-1252");

        let (bom, bom_encoding) = decode_text(vec![0xEF, 0xBB, 0xBF, b'i', b'd']).unwrap();
        assert_eq!(bom, "\u{FEFF}id");
        assert_eq!(bom_encoding, "utf-8-bom");
    }

    #[test]
    fn encode_text_preserves_windows_1252_and_rejects_unrepresentable_text() {
        assert_eq!(
            encode_text("\u{201C}\u{20AC}\u{2026}\u{2014}", "windows-1252").unwrap(),
            vec![0x93, 0x80, 0x85, 0x97]
        );
        assert!(encode_text("\u{1F642}", "windows-1252")
            .unwrap_err()
            .contains("Windows-1252"));
        assert_eq!(
            encode_text("id", "utf-8-bom").unwrap(),
            vec![0xEF, 0xBB, 0xBF, b'i', b'd']
        );
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
        assert_eq!(results[2].as_ref().unwrap().encoding, "windows-1252");

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

        let first =
            write_text_file_safe(target_string.clone(), "id\n1\n".to_string(), None).unwrap();
        assert_eq!(first.path, target_string);
        assert_eq!(first.name, "items.txt");
        assert_eq!(fs::read_to_string(&target).unwrap(), "id\n1\n");
        assert!(!dir.join(".items.txt.tmp").exists());

        let second =
            write_text_file_safe(target_string.clone(), "id\n2\n".to_string(), None).unwrap();
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

        let payload =
            write_text_file_safe(target_string.clone(), "fresh\n".to_string(), None).unwrap();

        assert_eq!(payload.path, target_string);
        assert_eq!(payload.name, "new-file.txt");
        assert_eq!(fs::read_to_string(&target).unwrap(), "fresh\n");
        assert!(!dir.join(".new-file.txt.tmp").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_text_file_safe_round_trips_windows_1252_without_overwriting_sibling_tmp() {
        let dir = std::env::temp_dir().join(format!(
            "txteditor-safe-write-encoding-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("legacy.txt");
        let sibling_tmp = dir.join(".legacy.txt.tmp");
        fs::write(&target, vec![0x93, 0x80, 0x85, 0x97]).unwrap();
        fs::write(&sibling_tmp, "do-not-touch").unwrap();
        let target_string = target.to_string_lossy().to_string();

        let payload = write_text_file_safe(
            target_string.clone(),
            "\u{201C}\u{20AC}\u{2026}\u{2014}".to_string(),
            Some("windows-1252".to_string()),
        )
        .unwrap();

        assert_eq!(payload.path, target_string);
        assert_eq!(payload.encoding, "windows-1252");
        assert_eq!(fs::read(&target).unwrap(), vec![0x93, 0x80, 0x85, 0x97]);
        assert_eq!(fs::read_to_string(&sibling_tmp).unwrap(), "do-not-touch");

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
