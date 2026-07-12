use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[tauri::command]
pub(crate) fn list_workspace_files(path: String) -> Result<WorkspacePayload, String> {
    let mut files = Vec::new();
    collect_text_files(Path::new(&path), &mut files, 0)?;
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(WorkspacePayload { path, files })
}

pub(crate) fn collect_text_files(
    path: &Path,
    files: &mut Vec<WorkspaceFile>,
    _depth: usize,
) -> Result<(), String> {
    let root = fs::canonicalize(path).map_err(|err| err.to_string())?;
    let mut visited_directories = HashSet::new();
    let mut visited_files = HashSet::new();
    collect_text_files_inner(
        &root,
        &root,
        files,
        &mut visited_directories,
        &mut visited_files,
    )
}

fn collect_text_files_inner(
    root: &Path,
    path: &Path,
    files: &mut Vec<WorkspaceFile>,
    visited_directories: &mut HashSet<PathBuf>,
    visited_files: &mut HashSet<PathBuf>,
) -> Result<(), String> {
    let canonical_directory = fs::canonicalize(path).map_err(|err| err.to_string())?;
    if !canonical_directory.starts_with(root)
        || !visited_directories.insert(canonical_directory.clone())
    {
        return Ok(());
    }
    let mut entries = fs::read_dir(&canonical_directory)
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            collect_text_files_inner(root, &entry_path, files, visited_directories, visited_files)?;
        } else if is_text_like(&entry_path) {
            let canonical_file = fs::canonicalize(&entry_path).map_err(|err| err.to_string())?;
            if canonical_file.starts_with(root) && visited_files.insert(canonical_file) {
                files.push(workspace_file_from_entry_path(
                    &entry_path,
                    entry.metadata().ok(),
                ));
            }
        }
    }
    Ok(())
}

fn workspace_file_from_entry_path(
    entry_path: &Path,
    metadata: Option<fs::Metadata>,
) -> WorkspaceFile {
    let modified_ms = metadata
        .as_ref()
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis().min(u64::MAX as u128) as u64);
    let size = metadata.as_ref().map(|value| value.len());
    let name = entry_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled.txt")
        .to_string();
    WorkspaceFile {
        path: user_facing_path(entry_path),
        name,
        modified_ms,
        size,
    }
}

fn user_facing_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(path) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{path}");
        }
        if let Some(path) = value.strip_prefix(r"\\?\") {
            return path.to_string();
        }
    }
    value.into_owned()
}

fn is_text_like(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase()),
        Some(ext) if matches!(ext.as_str(), "txt" | "tsv" | "tbl" | "csv")
    )
}

#[derive(Serialize)]
pub(crate) struct WorkspaceFile {
    path: String,
    pub(crate) name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    modified_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
}

#[derive(Serialize)]
pub(crate) struct WorkspacePayload {
    path: String,
    files: Vec<WorkspaceFile>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[cfg(windows)]
    fn create_directory_cycle_link(target: &Path, link: &Path) -> Result<(), String> {
        if std::os::windows::fs::symlink_dir(target, link).is_ok() {
            return Ok(());
        }
        let output = std::process::Command::new("cmd.exe")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(link)
            .arg(target)
            .output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }

    #[cfg(unix)]
    fn create_directory_cycle_link(target: &Path, link: &Path) -> Result<(), String> {
        std::os::unix::fs::symlink(target, link).map_err(|error| error.to_string())
    }

    #[cfg(not(any(windows, unix)))]
    fn create_directory_cycle_link(_target: &Path, _link: &Path) -> Result<(), String> {
        Err("directory links are unsupported on this test platform".to_string())
    }

    #[cfg(windows)]
    fn remove_directory_cycle_link(link: &Path) {
        let _ = fs::remove_dir(link);
    }

    #[cfg(not(windows))]
    fn remove_directory_cycle_link(link: &Path) {
        let _ = fs::remove_file(link);
    }

    #[test]
    fn collect_text_files_recurses_and_filters_supported_extensions() {
        let unique = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "txteditor-collect-text-files-test-{}-{}",
            std::process::id(),
            unique
        ));
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("a.txt"), "a").unwrap();
        fs::write(root.join("b.md"), "b").unwrap();
        fs::write(root.join("sub").join("c.csv"), "c").unwrap();

        let mut files = Vec::new();
        collect_text_files(&root, &mut files, 0).unwrap();
        let mut names: Vec<String> = files.into_iter().map(|file| file.name).collect();
        names.sort();

        fs::remove_dir_all(&root).unwrap();
        assert_eq!(names, vec!["a.txt".to_string(), "c.csv".to_string()]);
    }

    #[test]
    fn list_workspace_files_returns_sorted_payload_with_metadata() {
        let unique = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "txteditor-list-workspace-files-test-{}-{}",
            std::process::id(),
            unique
        ));
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("z.tbl"), "z").unwrap();
        fs::write(root.join("a.txt"), "alpha").unwrap();
        fs::write(root.join("nested").join("m.tsv"), "middle").unwrap();
        fs::write(root.join("ignored.md"), "ignored").unwrap();
        let root_string = root.to_string_lossy().to_string();

        let payload = list_workspace_files(root_string.clone()).unwrap();
        let names: Vec<String> = payload.files.iter().map(|file| file.name.clone()).collect();

        assert_eq!(payload.path, root_string);
        assert_eq!(
            names,
            vec![
                "a.txt".to_string(),
                "m.tsv".to_string(),
                "z.tbl".to_string()
            ]
        );
        assert!(payload
            .files
            .iter()
            .all(|file| file.path.contains(&root_string)));
        assert!(payload
            .files
            .iter()
            .all(|file| !file.path.starts_with(r"\\?\")));
        assert!(payload.files.iter().all(|file| file.modified_ms.is_some()));
        assert_eq!(
            payload
                .files
                .iter()
                .map(|file| file.size)
                .collect::<Vec<Option<u64>>>(),
            vec![Some(5), Some(6), Some(1)]
        );

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn workspace_depth_policy_never_silently_omits_depth_five_and_six() {
        let unique = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "txteditor-workspace-depth-test-{}-{}",
            std::process::id(),
            unique
        ));
        let mut directory = root.clone();
        for depth in 1..=6 {
            directory = directory.join(format!("d{depth}"));
            fs::create_dir_all(&directory).unwrap();
            fs::write(
                directory.join(format!("depth-{depth}.txt")),
                depth.to_string(),
            )
            .unwrap();
        }
        let root_string = root.to_string_lossy().to_string();

        let payload = list_workspace_files(root_string).unwrap();
        let names = payload
            .files
            .iter()
            .map(|file| file.name.as_str())
            .collect::<HashSet<_>>();
        let serialized = serde_json::to_value(&payload).unwrap();
        let truncation_reported = serialized
            .get("truncated")
            .and_then(serde_json::Value::as_bool)
            == Some(true);
        let depth_five_and_six_are_listed =
            names.contains("depth-5.txt") && names.contains("depth-6.txt");

        fs::remove_dir_all(&root).unwrap();

        assert!(
            names.contains("depth-4.txt"),
            "depth 4 boundary file must be listed"
        );
        assert!(
            depth_five_and_six_are_listed || truncation_reported,
            "depth 5/6 files were omitted without a truncation signal in WorkspacePayload"
        );
    }

    #[test]
    fn workspace_directory_cycle_does_not_return_duplicate_physical_files() {
        let unique = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "txteditor-workspace-cycle-test-{}-{}",
            std::process::id(),
            unique
        ));
        let nested = root.join("nested");
        let back = nested.join("back-to-root");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("one.txt"), "one").unwrap();
        if let Err(error) = create_directory_cycle_link(&root, &back) {
            fs::remove_dir_all(&root).unwrap();
            eprintln!("skipping directory-cycle assertion: {error}");
            return;
        }

        let mut files = Vec::new();
        collect_text_files(&root, &mut files, 0).unwrap();
        let physical_files = files
            .iter()
            .filter_map(|file| fs::canonicalize(&file.path).ok())
            .collect::<HashSet<_>>();
        let returned_count = files.len();
        remove_directory_cycle_link(&back);
        fs::remove_dir_all(&root).unwrap();

        assert_eq!(
            returned_count,
            physical_files.len(),
            "a junction/symlink cycle returned the same physical file more than once"
        );
    }
}
