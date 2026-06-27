use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

const DEFAULT_MAX_WORKSPACE_FILES: usize = 20_000;
const DEFAULT_MAX_WORKSPACE_DEPTH: usize = 64;
const SKIPPED_WORKSPACE_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".runtime-smoke",
];

#[tauri::command]
pub(crate) fn list_workspace_files(path: String) -> Result<WorkspacePayload, String> {
    let mut files = Vec::new();
    let mut scan = WorkspaceScan::default();
    collect_text_files_inner(Path::new(&path), &mut files, 0, &mut scan)?;
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(WorkspacePayload {
        path,
        files,
        warning: scan.warning(),
    })
}

#[cfg(test)]
pub(crate) fn collect_text_files(
    path: &Path,
    files: &mut Vec<WorkspaceFile>,
    depth: usize,
) -> Result<(), String> {
    let mut scan = WorkspaceScan::default();
    collect_text_files_inner(path, files, depth, &mut scan)
}

fn collect_text_files_inner(
    path: &Path,
    files: &mut Vec<WorkspaceFile>,
    depth: usize,
    scan: &mut WorkspaceScan,
) -> Result<(), String> {
    if scan.is_capped(files.len()) || depth > scan.max_depth {
        scan.capped = true;
        return Ok(());
    }
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(err) if depth == 0 => return Err(err.to_string()),
        Err(_) => return Ok(()),
    };
    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let entry_path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if should_skip_dir(&entry_path) {
                scan.skipped_dirs += 1;
                continue;
            }
            collect_text_files_inner(&entry_path, files, depth + 1, scan)?;
        } else if file_type.is_file() && is_text_like(&entry_path) {
            if scan.is_capped(files.len()) {
                scan.capped = true;
                return Ok(());
            }
            files.push(workspace_file_from_entry_path(
                &entry_path,
                entry.metadata().ok(),
            ));
        }
    }
    Ok(())
}

fn should_skip_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    SKIPPED_WORKSPACE_DIRS
        .iter()
        .any(|skipped| name.eq_ignore_ascii_case(skipped))
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
        path: entry_path.to_string_lossy().to_string(),
        name,
        modified_ms,
        size,
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

struct WorkspaceScan {
    max_files: usize,
    max_depth: usize,
    capped: bool,
    skipped_dirs: usize,
}

impl Default for WorkspaceScan {
    fn default() -> Self {
        Self {
            max_files: DEFAULT_MAX_WORKSPACE_FILES,
            max_depth: DEFAULT_MAX_WORKSPACE_DEPTH,
            capped: false,
            skipped_dirs: 0,
        }
    }
}

impl WorkspaceScan {
    fn is_capped(&self, current_len: usize) -> bool {
        current_len >= self.max_files
    }

    fn warning(&self) -> Option<String> {
        if self.capped {
            Some(format!(
                "Workspace file list was limited to {} files.",
                self.max_files
            ))
        } else if self.skipped_dirs > 0 {
            Some(format!(
                "Workspace scan skipped {} generated or dependency folder(s).",
                self.skipped_dirs
            ))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn collect_text_files_includes_deep_supported_files() {
        let unique = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "txteditor-collect-deep-text-files-test-{}-{}",
            std::process::id(),
            unique
        ));
        let deep = root.join("a").join("b").join("c").join("d").join("e");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("deep.tsv"), "deep").unwrap();

        let mut files = Vec::new();
        collect_text_files(&root, &mut files, 0).unwrap();
        let names: Vec<String> = files.into_iter().map(|file| file.name).collect();

        fs::remove_dir_all(&root).unwrap();
        assert_eq!(names, vec!["deep.tsv".to_string()]);
    }

    #[test]
    fn collect_text_files_skips_generated_and_dependency_dirs() {
        let unique = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "txteditor-collect-skip-dirs-test-{}-{}",
            std::process::id(),
            unique
        ));
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("nested").join("keep.tsv"), "keep").unwrap();
        fs::write(root.join("node_modules").join("skip.tsv"), "skip").unwrap();
        fs::write(root.join(".git").join("skip.txt"), "skip").unwrap();

        let mut files = Vec::new();
        collect_text_files(&root, &mut files, 0).unwrap();
        let names: Vec<String> = files.into_iter().map(|file| file.name).collect();

        fs::remove_dir_all(&root).unwrap();
        assert_eq!(names, vec!["keep.tsv".to_string()]);
    }

    #[test]
    fn collect_text_files_reports_partial_results_when_capped() {
        let unique = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "txteditor-collect-cap-test-{}-{}",
            std::process::id(),
            unique
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.txt"), "a").unwrap();
        fs::write(root.join("b.txt"), "b").unwrap();
        fs::write(root.join("c.txt"), "c").unwrap();

        let mut files = Vec::new();
        let mut scan = WorkspaceScan {
            max_files: 2,
            max_depth: DEFAULT_MAX_WORKSPACE_DEPTH,
            capped: false,
            skipped_dirs: 0,
        };
        collect_text_files_inner(&root, &mut files, 0, &mut scan).unwrap();

        fs::remove_dir_all(&root).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(
            scan.warning(),
            Some("Workspace file list was limited to 2 files.".to_string())
        );
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
}
