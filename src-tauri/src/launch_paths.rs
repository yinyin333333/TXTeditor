use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const TEXT_FILE_EXTENSIONS: [&str; 4] = ["txt", "tsv", "tbl", "csv"];

#[derive(Default)]
pub(crate) struct PendingOpenPaths {
    paths: Mutex<Vec<String>>,
}

impl PendingOpenPaths {
    pub(crate) fn extend(&self, paths: Vec<String>) {
        self.paths
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .extend(paths);
    }

    fn take(&self) -> Vec<String> {
        std::mem::take(
            &mut *self
                .paths
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        )
    }
}

#[tauri::command]
pub(crate) fn startup_open_paths() -> Vec<String> {
    let cwd = std::env::current_dir().unwrap_or_default();
    launch_text_paths(std::env::args_os(), &cwd)
}

#[tauri::command]
pub(crate) fn take_pending_open_paths(pending: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    pending.take()
}

pub(crate) fn forwarded_open_paths(args: Vec<String>, cwd: &str) -> Vec<String> {
    launch_text_paths(args.into_iter().map(OsString::from), Path::new(cwd))
}

fn launch_text_paths<I>(args: I, cwd: &Path) -> Vec<String>
where
    I: IntoIterator<Item = OsString>,
{
    args.into_iter()
        .skip(1)
        .filter_map(normalize_launch_argument)
        .filter(|path| is_text_file_path(path))
        .map(|path| resolve_launch_path(path, cwd))
        .collect()
}

fn resolve_launch_path(path: String, cwd: &Path) -> String {
    let candidate = PathBuf::from(&path);
    if candidate.is_absolute() || cwd.as_os_str().is_empty() {
        return path;
    }
    cwd.join(candidate).to_string_lossy().into_owned()
}

fn normalize_launch_argument(argument: OsString) -> Option<String> {
    let value = argument.to_string_lossy();
    let trimmed = value.trim();
    let unquoted = trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(trimmed);
    (!unquoted.is_empty()).then(|| unquoted.to_string())
}

fn is_text_file_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            TEXT_FILE_EXTENSIONS
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_windows_paths_with_spaces_unicode_and_uppercase_extensions() {
        let paths = launch_text_paths(
            [
                OsString::from(r"C:\Program Files\TXTeditor\TXTeditor.exe"),
                OsString::from(r"C:\D2 Mods\My Mod\monstats.txt"),
                OsString::from(r"C:\모드\데이터\아이템.TXT"),
            ],
            Path::new(""),
        );

        assert_eq!(
            paths,
            vec![
                r"C:\D2 Mods\My Mod\monstats.txt".to_string(),
                r"C:\모드\데이터\아이템.TXT".to_string(),
            ]
        );
    }

    #[test]
    fn ignores_executable_flags_and_unsupported_files() {
        let paths = launch_text_paths(
            [
                OsString::from("TXTeditor.exe"),
                OsString::from("--verbose"),
                OsString::from(r"C:\D2 Mods\notes.json"),
                OsString::from(r"C:\D2 Mods\levels.tsv"),
                OsString::from(r"C:\D2 Mods\objects.tbl"),
                OsString::from(r"C:\D2 Mods\export.csv"),
            ],
            Path::new(""),
        );

        assert_eq!(
            paths,
            vec![
                r"C:\D2 Mods\levels.tsv".to_string(),
                r"C:\D2 Mods\objects.tbl".to_string(),
                r"C:\D2 Mods\export.csv".to_string(),
            ]
        );
    }

    #[test]
    fn accepts_an_outer_quote_pair_from_manual_launch_forwarders() {
        let paths = launch_text_paths(
            [
                OsString::from("TXTeditor.exe"),
                OsString::from(r#""C:\D2 Mods\My Mod\monstats.txt""#),
            ],
            Path::new(""),
        );

        assert_eq!(paths, vec![r"C:\D2 Mods\My Mod\monstats.txt".to_string()]);
    }

    #[test]
    fn resolves_relative_forwarded_paths_against_the_secondary_working_directory() {
        let paths = forwarded_open_paths(
            vec![
                "TXTeditor.exe".to_string(),
                "data\\global\\excel\\skills.txt".to_string(),
                "--flag".to_string(),
            ],
            r"C:\D2 Mods\My Mod",
        );

        assert_eq!(
            paths,
            vec![r"C:\D2 Mods\My Mod\data\global\excel\skills.txt".to_string()]
        );
    }

    #[test]
    fn resolves_initial_and_forwarded_relative_paths_with_the_same_rule() {
        let cwd = Path::new(r"C:\D2 Mods\My Mod");
        let initial = launch_text_paths(
            [
                OsString::from("TXTeditor.exe"),
                OsString::from(r"data\global\excel\skills.txt"),
            ],
            cwd,
        );
        let forwarded = forwarded_open_paths(
            vec![
                "TXTeditor.exe".to_string(),
                r"data\global\excel\skills.txt".to_string(),
            ],
            cwd.to_str().unwrap(),
        );

        assert_eq!(initial, forwarded);
        assert_eq!(
            initial,
            vec![r"C:\D2 Mods\My Mod\data\global\excel\skills.txt".to_string()]
        );
    }

    #[test]
    fn pending_paths_are_drained_once() {
        let pending = PendingOpenPaths::default();
        pending.extend(vec!["a.txt".to_string(), "b.txt".to_string()]);

        assert_eq!(
            pending.take(),
            vec!["a.txt".to_string(), "b.txt".to_string()]
        );
        assert!(pending.take().is_empty());
    }
}
