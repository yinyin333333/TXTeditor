use tauri_plugin_dialog::FilePath;

pub(crate) fn file_path_to_string(path: FilePath) -> Result<String, String> {
    let path = path
        .into_path()
        .map_err(|_| "Selected path is not a local filesystem path.".to_string())?;
    Ok(path.to_string_lossy().to_string())
}
