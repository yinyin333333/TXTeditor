use crate::lsp_protocol::{path_to_uri, uri_to_path};
use globset::{GlobBuilder, GlobMatcher};
use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub(crate) const WATCHED_FILES_METHOD: &str = "workspace/didChangeWatchedFiles";

const WATCH_CREATE: u8 = 1;
const WATCH_CHANGE: u8 = 2;
const WATCH_DELETE: u8 = 4;
const WATCH_ALL: u8 = WATCH_CREATE | WATCH_CHANGE | WATCH_DELETE;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct WatchedFileChange {
    pub(crate) uri: String,
    #[serde(rename = "type")]
    pub(crate) kind: u8,
}

pub(crate) type WatchChangeSink = Arc<dyn Fn(Vec<WatchedFileChange>) + Send + Sync>;
pub(crate) type WatchErrorSink = Arc<dyn Fn(String) + Send + Sync>;

pub(crate) struct WatchRegistry {
    registrations: HashMap<String, ManagedRegistration>,
}

impl WatchRegistry {
    pub(crate) fn new() -> Self {
        Self {
            registrations: HashMap::new(),
        }
    }

    pub(crate) fn register(
        &mut self,
        params: &Value,
        default_base: &Path,
        changes: WatchChangeSink,
        errors: WatchErrorSink,
    ) -> Result<(), String> {
        let params: RegistrationParams = serde_json::from_value(params.clone())
            .map_err(|error| format!("Invalid registration parameters: {error}"))?;
        if params.registrations.is_empty() {
            return Err("Registration request did not include any registrations".to_string());
        }

        let mut ids = HashSet::new();
        let mut prepared = Vec::new();
        for registration in params.registrations {
            if registration.method != WATCHED_FILES_METHOD {
                return Err(format!(
                    "Unsupported dynamic registration method '{}'",
                    registration.method
                ));
            }
            if registration.id.trim().is_empty() {
                return Err("Dynamic registration id must not be empty".to_string());
            }
            if self.registrations.contains_key(&registration.id)
                || !ids.insert(registration.id.clone())
            {
                return Err(format!(
                    "Dynamic registration id '{}' is already installed",
                    registration.id
                ));
            }
            let options: RegistrationOptions =
                serde_json::from_value(registration.register_options.ok_or_else(|| {
                    "Watched-files registration options are required".to_string()
                })?)
                .map_err(|error| format!("Invalid watched-files registration options: {error}"))?;
            prepared.push((
                registration.id,
                ManagedRegistration::new(options, default_base, changes.clone(), errors.clone())?,
            ));
        }

        self.registrations.extend(prepared);
        Ok(())
    }

    pub(crate) fn unregister(&mut self, params: &Value) -> Result<(), String> {
        let params: UnregistrationParams = serde_json::from_value(params.clone())
            .map_err(|error| format!("Invalid unregistration parameters: {error}"))?;
        for unregistration in &params.unregisterations {
            if unregistration.method != WATCHED_FILES_METHOD {
                return Err(format!(
                    "Unsupported dynamic unregistration method '{}'",
                    unregistration.method
                ));
            }
        }
        for unregistration in params.unregisterations {
            self.registrations.remove(&unregistration.id);
        }
        Ok(())
    }

    pub(crate) fn clear(&mut self) {
        self.registrations.clear();
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.registrations.len()
    }
}

struct ManagedRegistration {
    _watcher: RecommendedWatcher,
    active: Arc<AtomicBool>,
}

impl Drop for ManagedRegistration {
    fn drop(&mut self) {
        self.active.store(false, Ordering::SeqCst);
    }
}

impl ManagedRegistration {
    fn new(
        options: RegistrationOptions,
        default_base: &Path,
        changes: WatchChangeSink,
        errors: WatchErrorSink,
    ) -> Result<Self, String> {
        if options.watchers.is_empty() {
            return Err("Watched-files registration did not include any watchers".to_string());
        }

        let mut patterns = Vec::new();
        let mut roots = HashMap::<String, (PathBuf, bool)>::new();
        for watcher in options.watchers {
            let (base, pattern) = watcher.glob_pattern.resolve(default_base)?;
            if !base.is_dir() {
                return Err(format!(
                    "Watched-files base directory does not exist: {}",
                    base.display()
                ));
            }
            let recursive =
                pattern.contains("**") || pattern.contains('/') || pattern.contains('\\');
            let root_key = normalized_path(&base);
            roots
                .entry(root_key)
                .and_modify(|(_, current_recursive)| *current_recursive |= recursive)
                .or_insert_with(|| (base.clone(), recursive));
            patterns.push(CompiledPattern::new(
                base,
                &pattern,
                watcher.kind.unwrap_or(WATCH_ALL),
            )?);
        }
        let patterns = Arc::new(patterns);
        let callback_patterns = Arc::clone(&patterns);
        let callback_changes = Arc::clone(&changes);
        let callback_errors = Arc::clone(&errors);
        let active = Arc::new(AtomicBool::new(true));
        let callback_active = Arc::clone(&active);
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<Event>| match result {
                Ok(event) => {
                    if !callback_active.load(Ordering::SeqCst) {
                        return;
                    }
                    let changes = changes_for_event(&event, &callback_patterns);
                    if !changes.is_empty() && callback_active.load(Ordering::SeqCst) {
                        callback_changes(changes);
                    }
                }
                Err(error) if callback_active.load(Ordering::SeqCst) => {
                    callback_errors(format!("File watcher error: {error}"));
                }
                Err(_) => {}
            })
            .map_err(|error| format!("Could not create file watcher: {error}"))?;

        let mut roots = roots.into_values().collect::<Vec<_>>();
        roots.sort_by_key(|root| normalized_path(&root.0));
        for (root, recursive) in roots {
            if let Err(error) = watcher.watch(
                &root,
                if recursive {
                    RecursiveMode::Recursive
                } else {
                    RecursiveMode::NonRecursive
                },
            ) {
                active.store(false, Ordering::SeqCst);
                return Err(format!("Could not watch '{}': {error}", root.display()));
            }
        }

        Ok(Self {
            _watcher: watcher,
            active,
        })
    }
}

#[derive(Deserialize)]
struct RegistrationParams {
    registrations: Vec<Registration>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registration {
    id: String,
    method: String,
    register_options: Option<Value>,
}

#[derive(Deserialize)]
struct RegistrationOptions {
    watchers: Vec<WatcherOptions>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatcherOptions {
    glob_pattern: RegistrationGlobPattern,
    kind: Option<u8>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RegistrationGlobPattern {
    String(String),
    Relative(RelativePattern),
}

impl RegistrationGlobPattern {
    fn resolve(self, default_base: &Path) -> Result<(PathBuf, String), String> {
        match self {
            Self::String(pattern) => Ok((default_base.to_path_buf(), pattern)),
            Self::Relative(relative) => {
                let uri = match relative.base_uri {
                    BaseUri::Uri(uri) => uri,
                    BaseUri::WorkspaceFolder(folder) => folder.uri,
                };
                Ok((uri_to_path(&uri)?, relative.pattern))
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelativePattern {
    base_uri: BaseUri,
    pattern: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum BaseUri {
    Uri(String),
    WorkspaceFolder(WorkspaceFolder),
}

#[derive(Deserialize)]
struct WorkspaceFolder {
    uri: String,
    #[allow(dead_code)]
    name: String,
}

#[derive(Deserialize)]
struct UnregistrationParams {
    #[serde(rename = "unregisterations", alias = "unregistrations")]
    unregisterations: Vec<Unregistration>,
}

#[derive(Deserialize)]
struct Unregistration {
    id: String,
    method: String,
}

struct CompiledPattern {
    base: PathBuf,
    normalized_base: String,
    matcher: GlobMatcher,
    kinds: u8,
}

impl CompiledPattern {
    fn new(base: PathBuf, pattern: &str, kinds: u8) -> Result<Self, String> {
        if kinds == 0 || kinds & !WATCH_ALL != 0 {
            return Err(format!("Invalid watched-files kind bitmask: {kinds}"));
        }
        let matcher = GlobBuilder::new(&pattern.replace('\\', "/"))
            .case_insensitive(cfg!(windows))
            .literal_separator(true)
            .backslash_escape(false)
            .build()
            .map_err(|error| format!("Invalid watched-files glob '{pattern}': {error}"))?
            .compile_matcher();
        Ok(Self {
            normalized_base: normalized_path(&base),
            base,
            matcher,
            kinds,
        })
    }

    fn matches(&self, path: &Path, kind: u8) -> bool {
        self.kinds & watch_bit_for_change(kind) != 0
            && relative_path(&self.base, &self.normalized_base, path)
                .is_some_and(|relative| self.matcher.is_match(relative))
    }
}

fn changes_for_event(event: &Event, patterns: &[CompiledPattern]) -> Vec<WatchedFileChange> {
    let mut changes = HashMap::<String, WatchedFileChange>::new();
    for (path, kind) in raw_event_changes(event) {
        if !patterns.iter().any(|pattern| pattern.matches(&path, kind)) {
            continue;
        }
        let key = normalized_path(&path);
        changes.insert(
            key,
            WatchedFileChange {
                uri: path_to_uri(&path.to_string_lossy()),
                kind,
            },
        );
    }
    let mut changes = changes.into_values().collect::<Vec<_>>();
    changes.sort_by(|left, right| left.uri.cmp(&right.uri));
    changes
}

fn raw_event_changes(event: &Event) -> Vec<(PathBuf, u8)> {
    match event.kind {
        EventKind::Access(_) => Vec::new(),
        EventKind::Create(_) => event.paths.iter().cloned().map(|path| (path, 1)).collect(),
        EventKind::Remove(_) => event.paths.iter().cloned().map(|path| (path, 3)).collect(),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() >= 2 => {
            let mut changes = Vec::with_capacity(event.paths.len());
            changes.push((event.paths[0].clone(), 3));
            changes.extend(event.paths[1..].iter().cloned().map(|path| (path, 1)));
            changes
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            event.paths.iter().cloned().map(|path| (path, 3)).collect()
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            event.paths.iter().cloned().map(|path| (path, 1)).collect()
        }
        EventKind::Modify(_) | EventKind::Any | EventKind::Other => {
            event.paths.iter().cloned().map(|path| (path, 2)).collect()
        }
    }
}

fn watch_bit_for_change(kind: u8) -> u8 {
    match kind {
        1 => WATCH_CREATE,
        3 => WATCH_DELETE,
        _ => WATCH_CHANGE,
    }
}

fn relative_path(base: &Path, normalized_base: &str, path: &Path) -> Option<String> {
    if let Ok(relative) = path.strip_prefix(base) {
        return Some(relative.to_string_lossy().replace('\\', "/"));
    }
    let normalized = normalized_path(path);
    let prefix = format!("{normalized_base}/");
    normalized
        .strip_prefix(&prefix)
        .map(ToString::to_string)
        .or_else(|| (normalized == normalized_base).then(String::new))
}

fn normalized_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    let value = value.trim_end_matches('/').to_string();
    if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, RemoveKind};

    fn pattern(base: &Path, glob: &str, kinds: u8) -> CompiledPattern {
        CompiledPattern::new(base.to_path_buf(), glob, kinds).unwrap()
    }

    #[test]
    fn watcher_globs_are_relative_case_insensitive_and_kind_filtered() {
        let base = PathBuf::from("C:/mods/example/data");
        let json = pattern(
            &base,
            "local/lng/strings/*.[jJ][sS][oO][nN]",
            WATCH_CREATE | WATCH_CHANGE,
        );
        assert!(json.matches(
            Path::new("c:/MODS/example/data/local/lng/strings/skills.JSON"),
            2
        ));
        assert!(!json.matches(
            Path::new("C:/mods/example/data/local/lng/strings/metadata/ignored.json"),
            2
        ));
        assert!(!json.matches(
            Path::new("C:/mods/example/data/local/lng/strings/skills.json"),
            3
        ));
    }

    #[test]
    fn notify_events_map_create_change_delete_and_rename_pairs() {
        let base = PathBuf::from("C:/workspace");
        let patterns = vec![pattern(&base, "**/*.json", WATCH_ALL)];
        let created = Event::new(EventKind::Create(CreateKind::File)).add_path(base.join("a.json"));
        assert_eq!(changes_for_event(&created, &patterns)[0].kind, 1);

        let changed = Event::new(EventKind::Modify(ModifyKind::Data(
            notify::event::DataChange::Content,
        )))
        .add_path(base.join("a.json"));
        assert_eq!(changes_for_event(&changed, &patterns)[0].kind, 2);

        let deleted = Event::new(EventKind::Remove(RemoveKind::File)).add_path(base.join("a.json"));
        assert_eq!(changes_for_event(&deleted, &patterns)[0].kind, 3);

        let renamed = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(base.join("a.json"))
            .add_path(base.join("b.json"));
        let changes = changes_for_event(&renamed, &patterns);
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].kind, 3);
        assert_eq!(changes[1].kind, 1);
    }

    #[test]
    fn registration_and_spec_typo_unregistration_are_atomic() {
        let base = std::env::temp_dir().join(format!(
            "txteditor-watch-registration-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&base).unwrap();
        let base_uri = path_to_uri(&base.to_string_lossy());
        let mut registry = WatchRegistry::new();
        let changes: WatchChangeSink = Arc::new(|_| {});
        let errors: WatchErrorSink = Arc::new(|_| {});
        registry
            .register(
                &serde_json::json!({
                    "registrations": [
                        {
                            "id": "watch-1",
                            "method": WATCHED_FILES_METHOD,
                            "registerOptions": { "watchers": [{
                                "globPattern": { "baseUri": base_uri, "pattern": "**/*.json" }
                            }]}
                        },
                        {
                            "id": "watch-2",
                            "method": WATCHED_FILES_METHOD,
                            "registerOptions": { "watchers": [{
                                "globPattern": { "baseUri": base_uri, "pattern": "*.txt" }
                            }]}
                        }
                    ]
                }),
                &base,
                changes,
                errors,
            )
            .unwrap();
        assert_eq!(registry.len(), 2);
        assert!(registry
            .unregister(&serde_json::json!({
                "unregisterations": [
                    { "id": "watch-1", "method": WATCHED_FILES_METHOD },
                    { "id": "watch-2", "method": "unsupported/method" }
                ]
            }))
            .is_err());
        assert_eq!(registry.len(), 2);
        registry
            .unregister(&serde_json::json!({
                "unregisterations": [
                    { "id": "watch-1", "method": WATCHED_FILES_METHOD },
                    { "id": "watch-2", "method": WATCHED_FILES_METHOD }
                ]
            }))
            .unwrap();
        assert_eq!(registry.len(), 0);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn native_watcher_observes_late_directories_and_stops_after_clear() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "txteditor-native-watch-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&base).unwrap();
        let base_uri = path_to_uri(&base.to_string_lossy());
        let (sender, receiver) = std::sync::mpsc::channel();
        let changes: WatchChangeSink = Arc::new(move |batch| {
            let _ = sender.send(batch);
        });
        let errors: WatchErrorSink = Arc::new(|message| panic!("{message}"));
        let mut registry = WatchRegistry::new();
        registry
            .register(
                &serde_json::json!({
                    "registrations": [{
                        "id": "native-watch",
                        "method": WATCHED_FILES_METHOD,
                        "registerOptions": { "watchers": [{
                            "globPattern": {
                                "baseUri": base_uri,
                                "pattern": "local/lng/strings/*.[jJ][sS][oO][nN]"
                            }
                        }]}
                    }]
                }),
                &base,
                changes,
                errors,
            )
            .unwrap();

        let strings = base.join("local/lng/strings");
        std::fs::create_dir_all(&strings).unwrap();
        let target = strings.join("item-names.json");
        std::fs::write(&target, "[]").unwrap();
        let target_uri = path_to_uri(&target.to_string_lossy());
        let received_target = |timeout: std::time::Duration| {
            let deadline = std::time::Instant::now() + timeout;
            loop {
                let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now())
                else {
                    return false;
                };
                match receiver.recv_timeout(remaining) {
                    Ok(batch) => {
                        if batch
                            .iter()
                            .any(|change| change.uri.eq_ignore_ascii_case(&target_uri))
                        {
                            return true;
                        }
                    }
                    Err(_) => return false,
                }
            }
        };
        assert!(received_target(std::time::Duration::from_secs(5)));

        registry.clear();
        while receiver.try_recv().is_ok() {}
        let after_clear = strings.join("after-clear.json");
        std::fs::write(&after_clear, "[]").unwrap();
        let after_clear_uri = path_to_uri(&after_clear.to_string_lossy());
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(750);
        while let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now()) {
            match receiver.recv_timeout(remaining) {
                Ok(batch) => assert!(!batch
                    .iter()
                    .any(|change| change.uri.eq_ignore_ascii_case(&after_clear_uri))),
                Err(_) => break,
            }
        }
        std::fs::remove_dir_all(base).unwrap();
    }
}
