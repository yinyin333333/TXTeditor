use crate::native_paths::file_path_to_string;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) vector_lsp_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) schema_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) lint_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) schema_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) plugin_path: Option<String>,
    #[serde(default)]
    pub(crate) debug_logging: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            vector_lsp_path: None,
            schema_path: None,
            lint_mode: Some("basic".to_string()),
            schema_version: Some("3.2".to_string()),
            plugin_path: None,
            debug_logging: false,
        }
    }
}

pub(crate) struct AppConfigState {
    pub(crate) config: Mutex<AppConfig>,
    pub(crate) config_path: PathBuf,
}

pub(crate) fn load_app_config_from(path: &Path) -> AppConfig {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub(crate) fn get_config(state: tauri::State<'_, AppConfigState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub(crate) fn save_config(
    config: AppConfig,
    state: tauri::State<'_, AppConfigState>,
) -> Result<(), String> {
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
pub(crate) async fn pick_file_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .blocking_pick_file()
        .map(file_path_to_string)
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_app_config_from_defaults_on_missing_or_invalid_json() {
        let dir =
            std::env::temp_dir().join(format!("txteditor-config-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let missing = dir.join("missing.json");
        let invalid = dir.join("invalid.json");
        fs::write(&invalid, "{not valid json").unwrap();

        assert!(load_app_config_from(&missing).vector_lsp_path.is_none());
        assert_eq!(
            load_app_config_from(&missing).schema_version.as_deref(),
            Some("3.2")
        );
        assert_eq!(load_app_config_from(&missing).debug_logging, false);
        assert!(load_app_config_from(&invalid).schema_path.is_none());
        assert_eq!(
            load_app_config_from(&invalid).schema_version.as_deref(),
            Some("3.2")
        );
        assert_eq!(load_app_config_from(&invalid).debug_logging, false);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn app_config_uses_camel_case_and_skips_empty_options() {
        let config = AppConfig {
            vector_lsp_path: Some("E:\\Tools\\vector-lsp.exe".to_string()),
            schema_path: None,
            lint_mode: Some("legacy".to_string()),
            schema_version: Some("3.2".to_string()),
            plugin_path: None,
            debug_logging: true,
        };
        let json = serde_json::to_string(&config).unwrap();

        assert!(json.contains("\"vectorLspPath\""));
        assert!(json.contains("\"lintMode\""));
        assert!(json.contains("\"schemaVersion\""));
        assert!(json.contains("\"debugLogging\":true"));
        assert!(!json.contains("schema_path"));
        assert!(!json.contains("schemaPath"));
        assert!(!json.contains("pluginPath"));
    }

    #[test]
    fn load_app_config_from_reads_saved_camel_case_fields() {
        let dir =
            std::env::temp_dir().join(format!("txteditor-config-load-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        fs::write(
            &path,
            r#"{"vectorLspPath":"E:\\Tools\\vector-lsp.exe","lintMode":"basic","debugLogging":true}"#,
        )
        .unwrap();

        let config = load_app_config_from(&path);
        assert_eq!(
            config.vector_lsp_path.as_deref(),
            Some("E:\\Tools\\vector-lsp.exe")
        );
        assert_eq!(config.lint_mode.as_deref(), Some("basic"));
        assert_eq!(config.debug_logging, true);

        let _ = fs::remove_dir_all(&dir);
    }
}
