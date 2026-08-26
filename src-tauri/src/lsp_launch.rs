use crate::config::{AppConfig, JsonDiagnosticRules};
use std::path::PathBuf;
use std::process::Command;

pub(crate) fn find_vector_lsp_binary() -> Result<PathBuf, String> {
    let exe = if cfg!(windows) {
        "vector-lsp.exe"
    } else {
        "vector-lsp"
    };

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            candidates.push(dir.join(exe));
        }
    }
    candidates.push(PathBuf::from(format!("../vector-lsp/target/release/{exe}")));
    candidates.push(PathBuf::from(format!("../vector-lsp/target/debug/{exe}")));

    for path in &candidates {
        if path.exists() {
            return path.canonicalize().map_err(|error| {
                format!(
                    "Failed to resolve vector-lsp binary '{}': {error}",
                    path.display()
                )
            });
        }
    }
    Err(format!(
        "vector-lsp binary not found. Set a path in Settings or build it in ../vector-lsp. Tried: {}",
        candidates
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

#[derive(Clone, Debug)]
pub(crate) struct EditorLaunchSpec {
    pub(crate) binary: PathBuf,
    lint_mode: String,
    schema_version: Option<String>,
    reference_version: Option<String>,
    schema_path: Option<PathBuf>,
    plugin_path: Option<PathBuf>,
    debug_logging: bool,
    json_diagnostics: bool,
    json_diagnostic_rules: JsonDiagnosticRules,
}

impl EditorLaunchSpec {
    pub(crate) fn resolve(config: &AppConfig) -> Result<Self, String> {
        let binary = match config
            .vector_lsp_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
        {
            Some(path) => canonical_existing_path(path, "Configured vector-lsp path")?,
            None => find_vector_lsp_binary()?,
        };
        let lint_mode = config
            .lint_mode
            .as_deref()
            .filter(|mode| *mode == "advanced")
            .unwrap_or("basic")
            .to_string();
        let (schema_version, schema_path, plugin_path) = if lint_mode == "advanced" {
            (
                None,
                resolve_optional_path(config.schema_path.as_deref(), "Schema path")?,
                resolve_optional_path(config.plugin_path.as_deref(), "Plugin path")?,
            )
        } else {
            (
                Some(
                    config
                        .schema_version
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or("3.3")
                        .to_string(),
                ),
                None,
                None,
            )
        };
        let reference_version = config
            .reference_version
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                (lint_mode == "basic")
                    .then(|| schema_version.clone())
                    .flatten()
            });
        Ok(Self {
            binary,
            lint_mode,
            schema_version,
            reference_version,
            schema_path,
            plugin_path,
            debug_logging: config.debug_logging,
            json_diagnostics: config.json_diagnostics,
            json_diagnostic_rules: config.json_diagnostic_rules,
        })
    }

    pub(crate) fn summary(&self) -> String {
        let schema = self
            .schema_path
            .as_ref()
            .map(|path| format!("path:{}", path.display()))
            .or_else(|| {
                self.schema_version
                    .as_ref()
                    .map(|version| format!("variant:{version}"))
            })
            .unwrap_or_else(|| "none".to_string());
        format!(
            "vector-lsp editor launch: executable={} mode={} schema={} reference={} encoding=auto transport=stdio singleShot=false pluginPath={} jsonDiagnostics={} jsonRules=duplicateIds:{},stringFormat:{},keyUsage:{}@{}",
            self.binary.display(),
            self.lint_mode,
            schema,
            self.reference_version.as_deref().unwrap_or("disabled"),
            self.plugin_path
                .as_ref()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| "none".to_string()),
            self.json_diagnostics,
            self.json_diagnostic_rules
                .duplicate_ids
                .action
                .as_env_value(),
            self.json_diagnostic_rules
                .string_format
                .action
                .as_env_value(),
            self.json_diagnostic_rules
                .key_usage
                .action
                .as_env_value(),
            self.json_diagnostic_rules.key_usage.id_start
        )
    }
}

fn canonical_existing_path(path: &str, label: &str) -> Result<PathBuf, String> {
    PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("{label} does not exist or cannot be resolved: {path}: {error}"))
}

fn resolve_optional_path(path: Option<&str>, label: &str) -> Result<Option<PathBuf>, String> {
    path.map(str::trim)
        .filter(|path| !path.is_empty())
        .map(|path| canonical_existing_path(path, label))
        .transpose()
}

pub(crate) fn configure_editor_command(command: &mut Command, spec: &EditorLaunchSpec) {
    const SANITIZED_ENVIRONMENT: &[&str] = &[
        "VLSP_IO_TYPE",
        "VLSP_SINGLE_SHOT",
        "VLSP_DELIMITER",
        "VLSP_EXTENSION",
        "VLSP_SCHEMA_LOADER",
        "VLSP_SCHEMA_PATH",
        "VLSP_SCHEMA_VARIANT",
        "VLSP_REFERENCE_VARIANT",
        "VLSP_PLUGIN_PATH",
        "VLSP_PLUGIN_TIMEOUT_MS",
        "VLSP_WORKSPACE_PATH",
        "VLSP_ENCODING",
        "VLSP_LOCALE",
        "VLSP_DEBUG_LOGGING",
        "VLSP_JSON_DIAGNOSTICS",
        "VLSP_JSON_DUPLICATE_IDS_ACTION",
        "VLSP_JSON_STRING_FORMAT_ACTION",
        "VLSP_JSON_KEY_USAGE_ACTION",
        "VLSP_JSON_KEY_USAGE_ID_START",
    ];
    command.arg("--editor-mode");
    for name in SANITIZED_ENVIRONMENT {
        command.env_remove(name);
    }
    command.env("VLSP_ENCODING", "auto");
    if let Some(path) = &spec.schema_path {
        command.env("VLSP_SCHEMA_PATH", path);
    }
    if let Some(version) = &spec.schema_version {
        command.env("VLSP_SCHEMA_VARIANT", version);
    }
    if let Some(version) = &spec.reference_version {
        command.env("VLSP_REFERENCE_VARIANT", version);
    }
    if let Some(path) = &spec.plugin_path {
        command.env("VLSP_PLUGIN_PATH", path);
    }
    if spec.debug_logging {
        command.env("VLSP_DEBUG_LOGGING", "1");
    }
    if spec.json_diagnostics {
        command.env("VLSP_JSON_DIAGNOSTICS", "true");
        command.env(
            "VLSP_JSON_DUPLICATE_IDS_ACTION",
            spec.json_diagnostic_rules
                .duplicate_ids
                .action
                .as_env_value(),
        );
        command.env(
            "VLSP_JSON_STRING_FORMAT_ACTION",
            spec.json_diagnostic_rules
                .string_format
                .action
                .as_env_value(),
        );
        command.env(
            "VLSP_JSON_KEY_USAGE_ACTION",
            spec.json_diagnostic_rules.key_usage.action.as_env_value(),
        );
        command.env(
            "VLSP_JSON_KEY_USAGE_ID_START",
            spec.json_diagnostic_rules.key_usage.id_start.to_string(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn editor_launch_defaults_match_the_ui_and_resolve_absolute_paths() {
        let binary = std::env::current_exe().unwrap();
        let config = AppConfig {
            vector_lsp_path: Some(binary.to_string_lossy().to_string()),
            ..Default::default()
        };

        let spec = EditorLaunchSpec::resolve(&config).unwrap();

        assert!(spec.binary.is_absolute());
        assert_eq!(spec.lint_mode, "basic");
        assert_eq!(spec.schema_version.as_deref(), Some("3.3"));
        assert_eq!(spec.reference_version.as_deref(), Some("3.3"));
        assert!(spec.schema_path.is_none());
        assert!(spec.plugin_path.is_none());
        assert!(canonical_existing_path(".", "cwd").unwrap().is_absolute());
    }

    #[test]
    fn editor_command_forces_lifecycle_and_sanitizes_inherited_settings() {
        let spec = EditorLaunchSpec {
            binary: std::env::current_exe().unwrap(),
            lint_mode: "basic".to_string(),
            schema_version: Some("3.2".to_string()),
            reference_version: Some("3.2".to_string()),
            schema_path: None,
            plugin_path: None,
            debug_logging: false,
            json_diagnostics: false,
            json_diagnostic_rules: JsonDiagnosticRules::default(),
        };
        let mut command = Command::new(&spec.binary);
        command.env("VLSP_SINGLE_SHOT", "true");
        command.env("VLSP_IO_TYPE", "tcp");
        command.env("VLSP_PLUGIN_TIMEOUT_MS", "60000");
        command.env("VLSP_LOCALE", "inherited-locale");
        command.env("VLSP_JSON_DIAGNOSTICS", "true");
        command.env("VLSP_JSON_DUPLICATE_IDS_ACTION", "error");
        command.env("VLSP_JSON_STRING_FORMAT_ACTION", "error");
        command.env("VLSP_JSON_KEY_USAGE_ACTION", "error");
        command.env("VLSP_JSON_KEY_USAGE_ID_START", "1");

        configure_editor_command(&mut command, &spec);

        assert_eq!(
            command
                .get_args()
                .map(|argument| argument.to_string_lossy().to_string())
                .collect::<Vec<_>>(),
            vec!["--editor-mode"]
        );
        let environment = command
            .get_envs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().to_string(),
                    value.map(|value| value.to_string_lossy().to_string()),
                )
            })
            .collect::<HashMap<_, _>>();
        assert_eq!(environment.get("VLSP_IO_TYPE"), Some(&None));
        assert_eq!(environment.get("VLSP_SINGLE_SHOT"), Some(&None));
        assert_eq!(environment.get("VLSP_PLUGIN_TIMEOUT_MS"), Some(&None));
        assert_eq!(environment.get("VLSP_LOCALE"), Some(&None));
        assert_eq!(
            environment.get("VLSP_ENCODING"),
            Some(&Some("auto".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_SCHEMA_VARIANT"),
            Some(&Some("3.2".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_REFERENCE_VARIANT"),
            Some(&Some("3.2".to_string()))
        );
        assert_eq!(environment.get("VLSP_JSON_DIAGNOSTICS"), Some(&None));
        for name in [
            "VLSP_JSON_DUPLICATE_IDS_ACTION",
            "VLSP_JSON_STRING_FORMAT_ACTION",
            "VLSP_JSON_KEY_USAGE_ACTION",
            "VLSP_JSON_KEY_USAGE_ID_START",
        ] {
            assert_eq!(environment.get(name), Some(&None), "{name}");
        }
    }

    #[test]
    fn editor_command_enables_json_diagnostics_only_when_configured() {
        let rules = JsonDiagnosticRules {
            duplicate_ids: crate::config::JsonDiagnosticRule {
                action: crate::config::JsonDiagnosticAction::Warn,
            },
            string_format: crate::config::JsonDiagnosticRule {
                action: crate::config::JsonDiagnosticAction::Ignore,
            },
            key_usage: crate::config::JsonKeyUsageRule {
                action: crate::config::JsonDiagnosticAction::Warn,
                id_start: 51_566.5,
            },
        };
        let spec = EditorLaunchSpec {
            binary: std::env::current_exe().unwrap(),
            lint_mode: "basic".to_string(),
            schema_version: Some("3.2".to_string()),
            reference_version: Some("3.2".to_string()),
            schema_path: None,
            plugin_path: None,
            debug_logging: false,
            json_diagnostics: true,
            json_diagnostic_rules: rules,
        };
        let mut command = Command::new(&spec.binary);
        configure_editor_command(&mut command, &spec);
        let environment = command
            .get_envs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().to_string(),
                    value.map(|value| value.to_string_lossy().to_string()),
                )
            })
            .collect::<HashMap<_, _>>();

        assert_eq!(
            environment.get("VLSP_JSON_DIAGNOSTICS"),
            Some(&Some("true".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_JSON_DUPLICATE_IDS_ACTION"),
            Some(&Some("warn".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_JSON_STRING_FORMAT_ACTION"),
            Some(&Some("ignore".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_JSON_KEY_USAGE_ACTION"),
            Some(&Some("warn".to_string()))
        );
        assert_eq!(
            environment.get("VLSP_JSON_KEY_USAGE_ID_START"),
            Some(&Some("51566.5".to_string()))
        );
    }

    #[test]
    fn advanced_editor_mode_never_guesses_a_reference_version() {
        let binary = std::env::current_exe().unwrap();
        let config = AppConfig {
            vector_lsp_path: Some(binary.to_string_lossy().to_string()),
            lint_mode: Some("advanced".to_string()),
            schema_path: Some(binary.to_string_lossy().to_string()),
            schema_version: Some("3.2".to_string()),
            reference_version: None,
            ..Default::default()
        };

        let spec = EditorLaunchSpec::resolve(&config).unwrap();
        assert_eq!(spec.lint_mode, "advanced");
        assert!(spec.reference_version.is_none());

        let mut command = Command::new(&spec.binary);
        configure_editor_command(&mut command, &spec);
        let environment = command
            .get_envs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().to_string(),
                    value.map(|value| value.to_string_lossy().to_string()),
                )
            })
            .collect::<HashMap<_, _>>();
        assert_eq!(environment.get("VLSP_REFERENCE_VARIANT"), Some(&None));
    }
}
