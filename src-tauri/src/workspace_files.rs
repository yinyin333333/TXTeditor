use serde::Serialize;
use std::fs;
use std::path::Path;
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
    depth: usize,
) -> Result<(), String> {
    if depth > 4 {
        return Ok(());
    }
    for entry in fs::read_dir(path).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            collect_text_files(&entry_path, files, depth + 1)?;
        } else if is_text_like(&entry_path) {
            files.push(workspace_file_from_entry_path(
                &entry_path,
                entry.metadata().ok(),
            ));
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
