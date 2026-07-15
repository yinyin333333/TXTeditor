use crate::native_paths::file_path_to_string;
use serde::{Deserialize, Deserializer, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri_plugin_dialog::DialogExt;

pub(crate) const DEFAULT_JSON_KEY_USAGE_ID_START: f64 = 40_000.0;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum JsonDiagnosticAction {
    Ignore,
    #[default]
    Warn,
}

impl JsonDiagnosticAction {
    pub(crate) fn as_env_value(self) -> &'static str {
        match self {
            Self::Ignore => "ignore",
            Self::Warn => "warn",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JsonDiagnosticRule {
    #[serde(default, deserialize_with = "deserialize_json_diagnostic_action")]
    pub(crate) action: JsonDiagnosticAction,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JsonKeyUsageRule {
    #[serde(
        default = "default_json_key_usage_action",
        deserialize_with = "deserialize_json_diagnostic_action"
    )]
    pub(crate) action: JsonDiagnosticAction,
    #[serde(
        default = "default_json_key_usage_id_start",
        deserialize_with = "deserialize_json_key_usage_id_start"
    )]
    pub(crate) id_start: f64,
}

impl Default for JsonKeyUsageRule {
    fn default() -> Self {
        Self {
            action: JsonDiagnosticAction::Ignore,
            id_start: DEFAULT_JSON_KEY_USAGE_ID_START,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JsonDiagnosticRules {
    #[serde(default, deserialize_with = "deserialize_json_diagnostic_rule")]
    pub(crate) duplicate_ids: JsonDiagnosticRule,
    #[serde(default, deserialize_with = "deserialize_json_diagnostic_rule")]
    pub(crate) string_format: JsonDiagnosticRule,
    #[serde(default, deserialize_with = "deserialize_json_key_usage_rule")]
    pub(crate) key_usage: JsonKeyUsageRule,
}

const fn default_json_key_usage_id_start() -> f64 {
    DEFAULT_JSON_KEY_USAGE_ID_START
}

const fn default_json_key_usage_action() -> JsonDiagnosticAction {
    JsonDiagnosticAction::Ignore
}

fn deserialize_json_diagnostic_action<'de, D>(
    deserializer: D,
) -> Result<JsonDiagnosticAction, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(match value.as_str() {
        Some("ignore") => JsonDiagnosticAction::Ignore,
        // Older TXTEditor builds exposed Error even though it ran the same
        // JSON check as Warning. Preserve the enabled rule while migrating
        // that persisted value to the two-state Off/Warning contract.
        Some("error") => JsonDiagnosticAction::Warn,
        Some("warn") => JsonDiagnosticAction::Warn,
        // Persisted editor config is migrated field-by-field. An unknown
        // future value must not disable a rule or reset unrelated settings.
        _ => JsonDiagnosticAction::Warn,
    })
}

fn deserialize_json_key_usage_id_start<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value
        .as_f64()
        .filter(|value| value.is_finite())
        .unwrap_or(DEFAULT_JSON_KEY_USAGE_ID_START))
}

fn deserialize_json_diagnostic_rule<'de, D>(deserializer: D) -> Result<JsonDiagnosticRule, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

fn deserialize_json_key_usage_rule<'de, D>(deserializer: D) -> Result<JsonKeyUsageRule, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

fn deserialize_json_diagnostic_rules<'de, D>(
    deserializer: D,
) -> Result<JsonDiagnosticRules, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

fn deserialize_json_diagnostics_enabled<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(match value {
        serde_json::Value::Bool(value) => value,
        serde_json::Value::String(value) => value.eq_ignore_ascii_case("true") || value == "1",
        _ => false,
    })
}

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
    pub(crate) reference_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) plugin_path: Option<String>,
    #[serde(default)]
    pub(crate) debug_logging: bool,
    #[serde(default, deserialize_with = "deserialize_json_diagnostics_enabled")]
    pub(crate) json_diagnostics: bool,
    #[serde(default, deserialize_with = "deserialize_json_diagnostic_rules")]
    pub(crate) json_diagnostic_rules: JsonDiagnosticRules,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            vector_lsp_path: None,
            schema_path: None,
            lint_mode: Some("basic".to_string()),
            schema_version: Some("3.2".to_string()),
            reference_version: None,
            plugin_path: None,
            debug_logging: false,
            json_diagnostics: false,
            json_diagnostic_rules: JsonDiagnosticRules::default(),
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
        assert_eq!(load_app_config_from(&missing).json_diagnostics, false);
        assert_eq!(
            load_app_config_from(&missing).json_diagnostic_rules,
            JsonDiagnosticRules::default()
        );
        assert!(load_app_config_from(&invalid).schema_path.is_none());
        assert_eq!(
            load_app_config_from(&invalid).schema_version.as_deref(),
            Some("3.2")
        );
        assert_eq!(load_app_config_from(&invalid).debug_logging, false);
        assert_eq!(load_app_config_from(&invalid).json_diagnostics, false);
        assert_eq!(
            load_app_config_from(&invalid).json_diagnostic_rules,
            JsonDiagnosticRules::default()
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn app_config_uses_camel_case_and_skips_empty_options() {
        let config = AppConfig {
            vector_lsp_path: Some("E:\\Tools\\vector-lsp.exe".to_string()),
            schema_path: None,
            lint_mode: Some("legacy".to_string()),
            schema_version: Some("3.2".to_string()),
            reference_version: None,
            plugin_path: None,
            debug_logging: true,
            json_diagnostics: true,
            json_diagnostic_rules: JsonDiagnosticRules {
                duplicate_ids: JsonDiagnosticRule {
                    action: JsonDiagnosticAction::Warn,
                },
                string_format: JsonDiagnosticRule {
                    action: JsonDiagnosticAction::Ignore,
                },
                key_usage: JsonKeyUsageRule {
                    action: JsonDiagnosticAction::Warn,
                    id_start: 56_000.5,
                },
            },
        };
        let json = serde_json::to_string(&config).unwrap();

        assert!(json.contains("\"vectorLspPath\""));
        assert!(json.contains("\"lintMode\""));
        assert!(json.contains("\"schemaVersion\""));
        assert!(json.contains("\"debugLogging\":true"));
        assert!(json.contains("\"jsonDiagnostics\":true"));
        assert!(json.contains("\"jsonDiagnosticRules\""));
        assert!(json.contains("\"duplicateIds\":{\"action\":\"warn\"}"));
        assert!(json.contains("\"stringFormat\":{\"action\":\"ignore\"}"));
        assert!(json.contains("\"keyUsage\":{\"action\":\"warn\",\"idStart\":56000.5}"));
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
            r#"{"vectorLspPath":"E:\\Tools\\vector-lsp.exe","lintMode":"basic","debugLogging":true,"jsonDiagnostics":true}"#,
        )
        .unwrap();

        let config = load_app_config_from(&path);
        assert_eq!(
            config.vector_lsp_path.as_deref(),
            Some("E:\\Tools\\vector-lsp.exe")
        );
        assert_eq!(config.lint_mode.as_deref(), Some("basic"));
        assert_eq!(config.debug_logging, true);
        assert_eq!(config.json_diagnostics, true);
        assert_eq!(
            config.json_diagnostic_rules,
            JsonDiagnosticRules::default(),
            "older configs keep the enabled master switch and receive rule defaults"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_app_config_from_reads_typed_json_rule_settings() {
        let dir = std::env::temp_dir().join(format!(
            "txteditor-json-rule-config-load-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        fs::write(
            &path,
            r#"{"jsonDiagnostics":true,"jsonDiagnosticRules":{"duplicateIds":{"action":"error"},"stringFormat":{"action":"ignore"},"keyUsage":{"action":"warn","idStart":51566}}}"#,
        )
        .unwrap();

        let config = load_app_config_from(&path);
        assert!(config.json_diagnostics);
        assert_eq!(
            config.json_diagnostic_rules,
            JsonDiagnosticRules {
                duplicate_ids: JsonDiagnosticRule {
                    action: JsonDiagnosticAction::Warn,
                },
                string_format: JsonDiagnosticRule {
                    action: JsonDiagnosticAction::Ignore,
                },
                key_usage: JsonKeyUsageRule {
                    action: JsonDiagnosticAction::Warn,
                    id_start: 51_566.0,
                },
            }
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_json_rule_fields_fall_back_without_resetting_unrelated_config() {
        let dir = std::env::temp_dir().join(format!(
            "txteditor-json-rule-config-migration-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        fs::write(
            &path,
            r#"{
                "vectorLspPath":"E:\\Tools\\vector-lsp.exe",
                "schemaVersion":"3.1",
                "jsonDiagnostics":true,
                "jsonDiagnosticRules":{
                    "duplicateIds":{"action":"future-action"},
                    "stringFormat":null,
                    "keyUsage":{"action":"error","idStart":"not-a-number"}
                }
            }"#,
        )
        .unwrap();

        let config = load_app_config_from(&path);
        assert_eq!(
            config.vector_lsp_path.as_deref(),
            Some("E:\\Tools\\vector-lsp.exe")
        );
        assert_eq!(config.schema_version.as_deref(), Some("3.1"));
        assert!(config.json_diagnostics);
        assert_eq!(
            config.json_diagnostic_rules,
            JsonDiagnosticRules {
                duplicate_ids: JsonDiagnosticRule::default(),
                string_format: JsonDiagnosticRule::default(),
                key_usage: JsonKeyUsageRule {
                    action: JsonDiagnosticAction::Warn,
                    id_start: DEFAULT_JSON_KEY_USAGE_ID_START,
                },
            }
        );

        fs::write(
            &path,
            r#"{"schemaVersion":"2.4","jsonDiagnostics":"true","jsonDiagnosticRules":null}"#,
        )
        .unwrap();
        let config = load_app_config_from(&path);
        assert!(config.json_diagnostics);
        assert_eq!(config.schema_version.as_deref(), Some("2.4"));
        assert_eq!(config.json_diagnostic_rules, JsonDiagnosticRules::default());

        let _ = fs::remove_dir_all(&dir);
    }
}
