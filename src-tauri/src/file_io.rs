use crate::native_paths::file_path_to_string;
use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::OpenOptions;
use std::io;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
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
    recover_interrupted_write(Path::new(&path))?;
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    let size_bytes = bytes.len() as u64;
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
        size_bytes,
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
    let transaction_id = next_transaction_id();
    let temp = temp_path_for(&target, Some(&transaction_id));
    let bytes = encode_text(&text, encoding.as_deref().unwrap_or("utf-8"), true)?;

    write_complete_temp_file(&temp, &bytes).map_err(|err| err.to_string())?;
    finish_temp_write(path, &target, &temp)
}

#[tauri::command]
pub(crate) fn write_text_file_chunk_safe(
    path: String,
    text: String,
    encoding: Option<String>,
    transaction_id: Option<String>,
    first: bool,
    last: bool,
) -> Result<Option<SavePayload>, String> {
    let target = PathBuf::from(&path);
    let temp = temp_path_for(&target, transaction_id.as_deref());
    let bytes = match encode_text(&text, encoding.as_deref().unwrap_or("utf-8"), first) {
        Ok(bytes) => bytes,
        Err(err) => {
            let _ = fs::remove_file(&temp);
            return Err(err);
        }
    };
    if let Err(err) = write_temp_file_chunk(&temp, &bytes, first, last) {
        let _ = fs::remove_file(&temp);
        return Err(err.to_string());
    }
    if !last {
        return Ok(None);
    }
    finish_temp_write(path, &target, &temp).map(Some)
}

fn temp_path_for(target: &Path, transaction_id: Option<&str>) -> PathBuf {
    let mut temp = target.to_path_buf();
    let transaction_id = sanitize_transaction_id(transaction_id.unwrap_or("legacy"));
    let temp_name = format!(
        ".{}.tmp.{}",
        target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("txteditor"),
        transaction_id
    );
    temp.set_file_name(temp_name);
    temp
}

fn sanitize_transaction_id(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .take(96)
        .collect();
    if sanitized.is_empty() {
        "transaction".to_string()
    } else {
        sanitized
    }
}

fn next_transaction_id() -> String {
    static NEXT_TRANSACTION_ID: AtomicU64 = AtomicU64::new(1);
    format!(
        "{}-{}",
        std::process::id(),
        NEXT_TRANSACTION_ID.fetch_add(1, Ordering::Relaxed)
    )
}

fn write_complete_temp_file(temp: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = fs::File::create(temp)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn write_temp_file_chunk(temp: &Path, bytes: &[u8], first: bool, last: bool) -> io::Result<()> {
    let mut file = if first {
        fs::File::create(temp)?
    } else {
        OpenOptions::new().append(true).open(temp)?
    };
    file.write_all(bytes)?;
    if last {
        file.sync_all()?;
    }
    Ok(())
}

fn finish_temp_write(path: String, target: &Path, temp: &Path) -> Result<SavePayload, String> {
    if let Err(err) = replace_file_with_temp(target, temp) {
        if !journal_path_for(target).exists() {
            let _ = fs::remove_file(temp);
        }
        return Err(err);
    }
    sync_parent_dir(target);

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
    with_target_lock(target, || {
        recover_interrupted_write_locked(target)?;
        replace_file_with_temp_locked(target, temp)
    })
}

fn replace_file_with_temp_locked(target: &Path, temp: &Path) -> Result<(), String> {
    if !target.exists() {
        return fs::rename(temp, target).map_err(|err| {
            let _ = fs::remove_file(temp);
            err.to_string()
        });
    }

    let backup = backup_path_for(target);
    write_recovery_journal(target, temp, &backup)?;
    fs::rename(target, &backup).map_err(|err| {
        let _ = fs::remove_file(temp);
        let _ = fs::remove_file(journal_path_for(target));
        err.to_string()
    })?;

    match fs::rename(temp, target) {
        Ok(()) => {
            if fs::remove_file(&backup).is_ok() {
                let _ = fs::remove_file(journal_path_for(target));
            }
            Ok(())
        }
        Err(replace_err) => match fs::rename(&backup, target) {
            Ok(()) => {
                let _ = fs::remove_file(temp);
                let _ = fs::remove_file(journal_path_for(target));
                Err(format!("{}; original file was restored", replace_err))
            }
            Err(restore_err) => Err(format!(
                "{}; recovery journal retained after restore failure from {}: {}",
                replace_err,
                backup.display(),
                restore_err
            )),
        },
    }
}

#[derive(Serialize, Deserialize)]
struct SaveRecoveryJournal {
    temp_name: String,
    backup_name: String,
}

fn journal_path_for(target: &Path) -> PathBuf {
    sibling_path(target, ".save-journal")
}

fn lock_path_for(target: &Path) -> PathBuf {
    sibling_path(target, ".save-lock")
}

fn sibling_path(target: &Path, suffix: &str) -> PathBuf {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("txteditor");
    parent.join(format!(".{name}{suffix}"))
}

fn write_recovery_journal(target: &Path, temp: &Path, backup: &Path) -> Result<(), String> {
    let journal = SaveRecoveryJournal {
        temp_name: child_file_name(temp)?,
        backup_name: child_file_name(backup)?,
    };
    let bytes = serde_json::to_vec(&journal).map_err(|err| err.to_string())?;
    write_complete_temp_file(&journal_path_for(target), &bytes).map_err(|err| err.to_string())?;
    sync_parent_dir(target);
    Ok(())
}

fn child_file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "Save transaction path has no valid file name: {}",
                path.display()
            )
        })
}

fn recover_interrupted_write(target: &Path) -> Result<(), String> {
    if !journal_path_for(target).exists() {
        return Ok(());
    }
    with_target_lock(target, || recover_interrupted_write_locked(target))
}

fn recover_interrupted_write_locked(target: &Path) -> Result<(), String> {
    let journal_path = journal_path_for(target);
    if !journal_path.exists() {
        return Ok(());
    }
    let journal_bytes = fs::read(&journal_path).map_err(|err| err.to_string())?;
    let journal: SaveRecoveryJournal =
        serde_json::from_slice(&journal_bytes).map_err(|err| err.to_string())?;
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let temp = safe_journal_child(parent, &journal.temp_name)?;
    let backup = safe_journal_child(parent, &journal.backup_name)?;

    if target.exists() {
        let _ = fs::remove_file(&temp);
        let _ = fs::remove_file(&backup);
    } else if temp.exists() {
        fs::rename(&temp, target).map_err(|err| {
            format!(
                "Failed to finish interrupted save from {}: {}",
                temp.display(),
                err
            )
        })?;
        let _ = fs::remove_file(&backup);
    } else if backup.exists() {
        fs::rename(&backup, target).map_err(|err| {
            format!(
                "Failed to restore interrupted save from {}: {}",
                backup.display(),
                err
            )
        })?;
    } else {
        return Err(format!(
            "Interrupted save for {} has neither target, temp, nor backup",
            target.display()
        ));
    }

    let _ = fs::remove_file(&temp);
    let _ = fs::remove_file(&backup);
    fs::remove_file(&journal_path).map_err(|err| err.to_string())?;
    sync_parent_dir(target);
    Ok(())
}

fn safe_journal_child(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(name);
    if candidate.components().count() != 1
        || candidate.file_name().and_then(|value| value.to_str()) != Some(name)
    {
        return Err(format!("Invalid save recovery journal path: {name}"));
    }
    Ok(parent.join(candidate))
}

fn with_target_lock<T>(
    target: &Path,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let lock_path = lock_path_for(target);
    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|err| err.to_string())?;
    lock_file.try_lock().map_err(|err| {
        format!(
            "Save target is busy and was not modified: {} ({})",
            target.display(),
            err
        )
    })?;
    let result = operation();
    let unlock_result = lock_file.unlock().map_err(|err| err.to_string());
    match (result, unlock_result) {
        (Err(err), _) => Err(err),
        (Ok(_), Err(err)) => Err(err),
        (Ok(value), Ok(())) => Ok(value),
    }
}

#[cfg(test)]
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
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return decode_utf16(&bytes[2..], true).map(|text| (text, "utf-16le".to_string()));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return decode_utf16(&bytes[2..], false).map(|text| (text, "utf-16be".to_string()));
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(bytes[3..].to_vec())
            .map(|text| (text, "utf-8-bom".to_string()))
            .map_err(|err| err.to_string());
    }
    match String::from_utf8(bytes) {
        Ok(text) => Ok((text, "utf-8".to_string())),
        Err(err) => Ok((
            decode_windows_1252(&err.into_bytes()),
            "windows-1252".to_string(),
        )),
    }
}

pub(crate) fn encode_text(
    text: &str,
    encoding: &str,
    include_bom: bool,
) -> Result<Vec<u8>, String> {
    match encoding.to_ascii_lowercase().as_str() {
        "utf-8" => Ok(text.as_bytes().to_vec()),
        "utf-8-bom" => {
            let mut bytes = Vec::with_capacity(text.len() + usize::from(include_bom) * 3);
            if include_bom {
                bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            }
            bytes.extend_from_slice(text.as_bytes());
            Ok(bytes)
        }
        "windows-1252" | "windows-1252-lossy" => encode_windows_1252(text),
        "utf-16le" => Ok(encode_utf16(text, true, include_bom)),
        "utf-16be" => Ok(encode_utf16(text, false, include_bom)),
        other => Err(format!("Unsupported text encoding: {other}")),
    }
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> Result<String, String> {
    if bytes.len() % 2 != 0 {
        return Err("UTF-16 input has an odd number of bytes".to_string());
    }
    let units = bytes
        .chunks_exact(2)
        .map(|pair| {
            if little_endian {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        })
        .collect::<Vec<_>>();
    String::from_utf16(&units).map_err(|err| err.to_string())
}

fn encode_utf16(text: &str, little_endian: bool, include_bom: bool) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(text.len() * 2 + usize::from(include_bom) * 2);
    if include_bom {
        bytes.extend_from_slice(if little_endian {
            &[0xFF, 0xFE]
        } else {
            &[0xFE, 0xFF]
        });
    }
    for unit in text.encode_utf16() {
        let encoded = if little_endian {
            unit.to_le_bytes()
        } else {
            unit.to_be_bytes()
        };
        bytes.extend_from_slice(&encoded);
    }
    bytes
}

fn decode_windows_1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| char::from_u32(cp1252_code_point(*byte)).unwrap())
        .collect()
}

fn encode_windows_1252(text: &str) -> Result<Vec<u8>, String> {
    text.chars()
        .map(|character| {
            cp1252_byte(character).ok_or_else(|| {
                format!(
                    "Character {character} (U+{:04X}) cannot be encoded as Windows-1252",
                    character as u32
                )
            })
        })
        .collect()
}

fn cp1252_code_point(byte: u8) -> u32 {
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
        _ => byte as u32,
    }
}

fn cp1252_byte(character: char) -> Option<u8> {
    let code_point = character as u32;
    if code_point <= 0x7F || (0xA0..=0xFF).contains(&code_point) {
        return Some(code_point as u8);
    }
    if (0x80..=0x9F).contains(&code_point)
        && !matches!(code_point, 0x0080 | 0x0082..=0x008C | 0x008E | 0x0091..=0x009C | 0x009E..=0x009F)
    {
        return Some(code_point as u8);
    }
    Some(match code_point {
        0x20AC => 0x80,
        0x201A => 0x82,
        0x0192 => 0x83,
        0x201E => 0x84,
        0x2026 => 0x85,
        0x2020 => 0x86,
        0x2021 => 0x87,
        0x02C6 => 0x88,
        0x2030 => 0x89,
        0x0160 => 0x8A,
        0x2039 => 0x8B,
        0x0152 => 0x8C,
        0x017D => 0x8E,
        0x2018 => 0x91,
        0x2019 => 0x92,
        0x201C => 0x93,
        0x201D => 0x94,
        0x2022 => 0x95,
        0x2013 => 0x96,
        0x2014 => 0x97,
        0x02DC => 0x98,
        0x2122 => 0x99,
        0x0161 => 0x9A,
        0x203A => 0x9B,
        0x0153 => 0x9C,
        0x017E => 0x9E,
        0x0178 => 0x9F,
        _ => return None,
    })
}

#[derive(Serialize)]
pub(crate) struct TextFilePayload {
    path: String,
    name: String,
    text: String,
    encoding: String,
    size_bytes: u64,
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
        assert_eq!(lossy_encoding, "windows-1252");
    }

    #[test]
    fn encoding_round_trips_cp1252_and_utf16_bom_fixtures() {
        let fixtures = [
            vec![0x80, 0x91, 0x92, 0x96, 0xE9],
            vec![0xFF, 0xFE, b'A', 0, b'\t', 0, b'B', 0],
            vec![0xFE, 0xFF, 0, b'A', 0, b'\t', 0, b'B'],
        ];

        for original in fixtures {
            let (text, encoding) = decode_text(original.clone()).unwrap();
            let encoded = encode_text(&text, &encoding, true).unwrap();
            assert_eq!(encoded, original, "encoding={encoding}");
        }
        assert!(encode_text("\u{80}", "windows-1252", true).is_err());
        assert_eq!(
            encode_text("\u{81}", "windows-1252", true).unwrap(),
            vec![0x81]
        );
    }

    #[test]
    fn native_save_and_save_as_preserve_detected_encoding() {
        let dir = std::env::temp_dir().join(format!(
            "txteditor-encoding-save-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let fixtures = [
            ("cp1252.txt", vec![b'A', 0x80, 0xE9]),
            ("utf16le.txt", vec![0xFF, 0xFE, b'A', 0, b'B', 0]),
            ("utf16be.txt", vec![0xFE, 0xFF, 0, b'A', 0, b'B']),
        ];

        for (name, original) in fixtures {
            let target = dir.join(name);
            fs::write(&target, &original).unwrap();
            let payload = read_text_file(target.to_string_lossy().to_string()).unwrap();

            write_text_file_safe(
                target.to_string_lossy().to_string(),
                payload.text.clone(),
                Some(payload.encoding.clone()),
            )
            .unwrap();
            assert_eq!(fs::read(&target).unwrap(), original, "normal save: {name}");

            let save_as = dir.join(format!("copy-{name}"));
            let edited = format!("{}C", payload.text);
            write_text_file_safe(
                save_as.to_string_lossy().to_string(),
                edited.clone(),
                Some(payload.encoding.clone()),
            )
            .unwrap();
            assert_eq!(
                fs::read(&save_as).unwrap(),
                encode_text(&edited, &payload.encoding, true).unwrap(),
                "save as: {name}"
            );
        }

        let _ = fs::remove_dir_all(&dir);
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
    fn write_text_file_chunk_safe_appends_and_replaces_on_last_chunk() {
        let dir =
            std::env::temp_dir().join(format!("txteditor-chunk-write-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("items.txt");
        fs::write(&target, "old").unwrap();
        let target_string = target.to_string_lossy().to_string();

        let first = write_text_file_chunk_safe(
            target_string.clone(),
            "id\n".to_string(),
            None,
            None,
            true,
            false,
        )
        .unwrap();
        assert!(first.is_none());
        assert_eq!(fs::read_to_string(&target).unwrap(), "old");
        assert_eq!(
            fs::read_to_string(dir.join(".items.txt.tmp.legacy")).unwrap(),
            "id\n"
        );

        let payload = write_text_file_chunk_safe(
            target_string.clone(),
            "1\n".to_string(),
            None,
            None,
            false,
            true,
        )
        .unwrap()
        .unwrap();

        assert_eq!(payload.path, target_string);
        assert_eq!(payload.name, "items.txt");
        assert_eq!(fs::read_to_string(&target).unwrap(), "id\n1\n");
        assert!(!dir.join(".items.txt.tmp.legacy").exists());

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

    #[test]
    fn chunk_transactions_for_the_same_target_never_share_temp_bytes() {
        let dir = std::env::temp_dir().join(format!(
            "txteditor-concurrent-save-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("items.txt");
        let target_string = target.to_string_lossy().to_string();
        fs::write(&target, "old").unwrap();

        write_text_file_chunk_safe(
            target_string.clone(),
            "A-1\n".to_string(),
            None,
            Some("transaction-a".to_string()),
            true,
            false,
        )
        .unwrap();
        write_text_file_chunk_safe(
            target_string.clone(),
            "B-1\n".to_string(),
            None,
            Some("transaction-b".to_string()),
            true,
            false,
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(temp_path_for(&target, Some("transaction-a"))).unwrap(),
            "A-1\n"
        );
        assert_eq!(
            fs::read_to_string(temp_path_for(&target, Some("transaction-b"))).unwrap(),
            "B-1\n"
        );

        write_text_file_chunk_safe(
            target_string.clone(),
            "A-2\n".to_string(),
            None,
            Some("transaction-a".to_string()),
            false,
            true,
        )
        .unwrap();
        write_text_file_chunk_safe(
            target_string,
            "B-2\n".to_string(),
            None,
            Some("transaction-b".to_string()),
            false,
            true,
        )
        .unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "B-1\nB-2\n");
        assert!(!temp_path_for(&target, Some("transaction-a")).exists());
        assert!(!temp_path_for(&target, Some("transaction-b")).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn busy_target_lock_rejects_without_changing_target_or_leaving_temp() {
        let dir =
            std::env::temp_dir().join(format!("txteditor-busy-save-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("items.txt");
        fs::write(&target, "old").unwrap();
        let lock = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(lock_path_for(&target))
            .unwrap();
        lock.try_lock().unwrap();

        let error = write_text_file_safe(
            target.to_string_lossy().to_string(),
            "new".to_string(),
            None,
        )
        .err()
        .expect("busy save should fail");

        assert!(error.contains("Save target is busy"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "old");
        assert_eq!(
            fs::read_dir(&dir)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp."))
                .count(),
            0
        );
        lock.unlock().unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn interrupted_replace_recovery_keeps_one_complete_version() {
        let base =
            std::env::temp_dir().join(format!("txteditor-recovery-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();

        for (case, target_exists, temp_exists, backup_exists, expected) in [
            ("before-backup", true, true, false, "old"),
            ("after-backup", false, true, true, "new"),
            ("after-replace", true, false, true, "new"),
            ("before-journal-delete", true, false, false, "new"),
        ] {
            let dir = base.join(case);
            fs::create_dir_all(&dir).unwrap();
            let target = dir.join("items.txt");
            let temp = dir.join(".items.txt.tmp.recovery");
            let backup = dir.join(".items.txt.bak.recovery");
            if target_exists {
                fs::write(
                    &target,
                    if case == "before-backup" {
                        "old"
                    } else {
                        "new"
                    },
                )
                .unwrap();
            }
            if temp_exists {
                fs::write(&temp, "new").unwrap();
            }
            if backup_exists {
                fs::write(&backup, "old").unwrap();
            }
            write_recovery_journal(&target, &temp, &backup).unwrap();

            recover_interrupted_write(&target).unwrap();

            assert_eq!(
                fs::read_to_string(&target).unwrap(),
                expected,
                "case={case}"
            );
            assert!(!temp.exists(), "case={case}");
            assert!(!backup.exists(), "case={case}");
            assert!(!journal_path_for(&target).exists(), "case={case}");
        }

        let _ = fs::remove_dir_all(&base);
    }
}
