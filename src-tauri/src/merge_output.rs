use crate::file_io::{encode_text, write_text_file_safe};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const OUTPUT_EXISTS_PREFIX: &str = "MERGE_OUTPUT_EXISTS:";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergeOutputFile {
    relative_path: String,
    text: String,
    encoding: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergeOutputPayload {
    path: String,
    file_count: usize,
}

#[tauri::command]
pub(crate) fn write_merge_output_safe(
    output_path: String,
    kind: String,
    files: Vec<MergeOutputFile>,
    overwrite: Option<bool>,
    protected_paths: Option<Vec<String>>,
) -> Result<MergeOutputPayload, String> {
    let target = absolute_path(Path::new(&output_path))?;
    validate_protected_target(
        &target,
        &kind,
        protected_paths.as_deref().unwrap_or_default(),
    )?;
    match kind.as_str() {
        "file" => write_file_output(output_path, &target, files, overwrite.unwrap_or(false)),
        "folder" => write_folder_output(output_path, &target, files, overwrite.unwrap_or(false)),
        other => Err(format!("Unsupported merge output kind: {other}")),
    }
}

fn write_file_output(
    output_path: String,
    target: &Path,
    files: Vec<MergeOutputFile>,
    overwrite: bool,
) -> Result<MergeOutputPayload, String> {
    if files.len() != 1 {
        return Err("A file merge must contain exactly one output file.".to_string());
    }
    if target.is_dir() {
        return Err(format!("Merge output is a directory: {}", target.display()));
    }
    if target.exists() && !overwrite {
        return Err(format!("{OUTPUT_EXISTS_PREFIX}{}", target.display()));
    }
    let file = files.into_iter().next().unwrap();
    write_text_file_safe(output_path.clone(), file.text, Some(file.encoding))?;
    Ok(MergeOutputPayload {
        path: output_path,
        file_count: 1,
    })
}

fn write_folder_output(
    output_path: String,
    target: &Path,
    files: Vec<MergeOutputFile>,
    overwrite: bool,
) -> Result<MergeOutputPayload, String> {
    if target.is_file() {
        return Err(format!("Merge output is a file: {}", target.display()));
    }
    if target.exists() && !overwrite {
        return Err(format!("{OUTPUT_EXISTS_PREFIX}{}", target.display()));
    }
    if files.is_empty() {
        return Err("Merge folder output must contain at least one file.".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| format!("Merge output has no parent directory: {}", target.display()))?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let stage = unique_sibling_path(target, "merge-stage");
    let backup = unique_sibling_path(target, "merge-backup");
    if stage.exists() {
        fs::remove_dir_all(&stage).map_err(|error| error.to_string())?;
    }
    fs::create_dir(&stage).map_err(|error| error.to_string())?;

    let write_result = write_staged_files(&stage, &files);
    if let Err(error) = write_result {
        let _ = fs::remove_dir_all(&stage);
        return Err(error);
    }

    let target_existed = target.exists();
    if target_existed {
        fs::rename(target, &backup).map_err(|error| {
            let _ = fs::remove_dir_all(&stage);
            format!("Cannot stage existing output folder for replacement: {error}")
        })?;
    }

    match fs::rename(&stage, target) {
        Ok(()) => {
            if target_existed {
                fs::remove_dir_all(&backup).map_err(|error| {
                    format!(
                        "Merge output was saved, but the previous output backup could not be removed ({}): {error}",
                        backup.display()
                    )
                })?;
            }
            sync_parent_dir(target);
            Ok(MergeOutputPayload {
                path: output_path,
                file_count: files.len(),
            })
        }
        Err(replace_error) => {
            let _ = fs::remove_dir_all(&stage);
            if target_existed {
                match fs::rename(&backup, target) {
                    Ok(()) => Err(format!(
                        "Could not replace merge output folder; the previous output was restored: {replace_error}"
                    )),
                    Err(restore_error) => Err(format!(
                        "Could not replace merge output folder ({replace_error}); failed to restore backup {}: {restore_error}",
                        backup.display()
                    )),
                }
            } else {
                Err(format!(
                    "Could not publish merge output folder: {replace_error}"
                ))
            }
        }
    }
}

fn write_staged_files(stage: &Path, files: &[MergeOutputFile]) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    for file in files {
        let relative = safe_relative_path(&file.relative_path)?;
        let key = relative
            .to_string_lossy()
            .replace('\\', "/")
            .to_ascii_lowercase();
        if !seen.insert(key) {
            return Err(format!(
                "Duplicate merge output relative path: {}",
                file.relative_path
            ));
        }
        let target = stage.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let bytes = encode_text(&file.text, &file.encoding, true)?;
        let mut handle = fs::File::create(&target).map_err(|error| error.to_string())?;
        handle
            .write_all(&bytes)
            .map_err(|error| error.to_string())?;
        handle.sync_all().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.trim().is_empty() || path.is_absolute() {
        return Err(format!("Invalid merge output relative path: {value}"));
    }
    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Unsafe merge output relative path: {value}"));
            }
        }
    }
    if safe.as_os_str().is_empty() {
        return Err(format!("Invalid merge output relative path: {value}"));
    }
    Ok(safe)
}

fn validate_protected_target(
    target: &Path,
    kind: &str,
    protected_paths: &[String],
) -> Result<(), String> {
    let target_identity = resolve_path_identity(target)?;
    for protected in protected_paths {
        if protected.trim().is_empty() {
            continue;
        }
        let protected = absolute_path(Path::new(protected))?;
        let protected_identity = resolve_path_identity(&protected)?;
        if paths_equal(&target_identity, &protected_identity) {
            return Err(format!(
                "Merge output must not overwrite input path: {}",
                protected.display()
            ));
        }
        if kind == "folder" && path_is_descendant(&target_identity, &protected_identity) {
            return Err(format!(
                "Merge output folder must not be inside input folder: {}",
                protected.display()
            ));
        }
        if kind == "folder" && path_is_descendant(&protected_identity, &target_identity) {
            return Err(format!(
                "Merge output folder must not contain input folder: {}",
                protected.display()
            ));
        }
    }
    Ok(())
}

fn resolve_path_identity(path: &Path) -> Result<PathBuf, String> {
    let normalized = absolute_path(path)?;
    let mut cursor = normalized.as_path();
    let mut suffix = Vec::<OsString>::new();
    loop {
        match fs::symlink_metadata(cursor) {
            Ok(_) => {
                let mut resolved = cursor.canonicalize().map_err(|error| {
                    format!("Cannot resolve merge path '{}': {error}", cursor.display())
                })?;
                for component in suffix.iter().rev() {
                    resolved.push(component);
                }
                return Ok(normalize_lexically(&resolved));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let name = cursor.file_name().ok_or_else(|| {
                    format!("Cannot resolve merge path '{}'.", normalized.display())
                })?;
                suffix.push(name.to_os_string());
                cursor = cursor.parent().ok_or_else(|| {
                    format!("Cannot resolve merge path '{}'.", normalized.display())
                })?;
            }
            Err(error) => {
                return Err(format!(
                    "Cannot inspect merge path '{}': {error}",
                    cursor.display()
                ));
            }
        }
    }
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    comparable_components(left) == comparable_components(right)
}

fn path_is_descendant(path: &Path, parent: &Path) -> bool {
    let path = comparable_components(path);
    let parent = comparable_components(parent);
    path.len() > parent.len() && path.starts_with(&parent)
}

fn comparable_components(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| {
            let value = component.as_os_str().to_string_lossy().into_owned();
            if cfg!(windows) {
                value.to_ascii_lowercase()
            } else {
                value
            }
        })
        .collect()
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        return Ok(normalize_lexically(path));
    }
    Ok(normalize_lexically(
        &std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(path),
    ))
}

fn normalize_lexically(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}

fn unique_sibling_path(target: &Path, label: &str) -> PathBuf {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("txteditor-merge");
    for _ in 0..1000 {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".{name}.{label}.{}.{}", std::process::id(), id));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!(".{name}.{label}.{}", std::process::id()))
}

#[cfg(unix)]
fn sync_parent_dir(target: &Path) {
    if let Some(parent) = target.parent() {
        if let Ok(directory) = fs::File::open(parent) {
            let _ = directory.sync_all();
        }
    }
}

#[cfg(not(unix))]
fn sync_parent_dir(_target: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "txteditor-merge-output-{label}-{}-{}",
            std::process::id(),
            NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    static NEXT_TEST_ID: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn rejects_parent_traversal() {
        assert!(safe_relative_path("../skills.txt").is_err());
        assert!(safe_relative_path("global/../../skills.txt").is_err());
    }

    #[test]
    fn folder_output_is_staged_before_publish() {
        let root = temp_root("publish");
        let target = root.join("result");
        let payload = write_folder_output(
            target.to_string_lossy().into_owned(),
            &target,
            vec![MergeOutputFile {
                relative_path: "global/excel/skills.txt".to_string(),
                text: "skill\tvalue\nx\t1\n".to_string(),
                encoding: "utf-8".to_string(),
            }],
            false,
        )
        .unwrap();
        assert_eq!(payload.file_count, 1);
        assert_eq!(
            fs::read_to_string(target.join("global/excel/skills.txt")).unwrap(),
            "skill\tvalue\nx\t1\n"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn existing_folder_requires_explicit_overwrite() {
        let root = temp_root("overwrite");
        let target = root.join("result");
        fs::create_dir(&target).unwrap();
        let error = write_folder_output(
            target.to_string_lossy().into_owned(),
            &target,
            vec![],
            false,
        )
        .unwrap_err();
        assert!(error.starts_with(OUTPUT_EXISTS_PREFIX));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn empty_folder_output_is_rejected_before_publish() {
        let root = temp_root("empty");
        let target = root.join("result");
        let error = write_folder_output(
            target.to_string_lossy().into_owned(),
            &target,
            vec![],
            false,
        )
        .unwrap_err();
        assert!(error.contains("at least one file"));
        assert!(!target.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn output_inside_input_folder_is_rejected() {
        let root = temp_root("protected");
        let target = root.join("input/result");
        let error = validate_protected_target(
            &target,
            "folder",
            &[root.join("input").to_string_lossy().into_owned()],
        )
        .unwrap_err();
        assert!(error.contains("must not be inside input folder"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn output_containing_input_folder_is_rejected() {
        let root = temp_root("protected-parent");
        let target = root.join("result");
        let input = target.join("mods/a");
        let error =
            validate_protected_target(&target, "folder", &[input.to_string_lossy().into_owned()])
                .unwrap_err();
        assert!(error.contains("must not contain input folder"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_output_parent_cannot_bypass_input_protection() {
        use std::os::unix::fs::symlink;

        let root = temp_root("protected-symlink");
        let input = root.join("input");
        fs::create_dir(&input).unwrap();
        let alias = root.join("alias");
        symlink(&input, &alias).unwrap();
        let target = alias.join("result");
        let error =
            validate_protected_target(&target, "folder", &[input.to_string_lossy().into_owned()])
                .unwrap_err();
        assert!(error.contains("must not be inside input folder"));
        let _ = fs::remove_dir_all(root);
    }
}
