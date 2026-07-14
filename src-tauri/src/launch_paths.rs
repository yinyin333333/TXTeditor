use std::ffi::{OsStr, OsString};
use std::path::Path;

const TEXT_FILE_EXTENSIONS: [&str; 4] = ["txt", "tsv", "tbl", "csv"];

#[tauri::command]
pub(crate) fn startup_open_paths() -> Vec<String> {
    launch_text_paths(std::env::args_os())
}

fn launch_text_paths<I>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = OsString>,
{
    args.into_iter()
        .skip(1)
        .filter_map(normalize_launch_argument)
        .filter(|path| is_text_file_path(path))
        .collect()
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
        let paths = launch_text_paths([
            OsString::from(r"C:\Program Files\TXTeditor\TXTeditor.exe"),
            OsString::from(r"C:\D2 Mods\My Mod\monstats.txt"),
            OsString::from(r"C:\모드\데이터\아이템.TXT"),
        ]);

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
        let paths = launch_text_paths([
            OsString::from("TXTeditor.exe"),
            OsString::from("--verbose"),
            OsString::from(r"C:\D2 Mods\notes.json"),
            OsString::from(r"C:\D2 Mods\levels.tsv"),
            OsString::from(r"C:\D2 Mods\objects.tbl"),
            OsString::from(r"C:\D2 Mods\export.csv"),
        ]);

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
        let paths = launch_text_paths([
            OsString::from("TXTeditor.exe"),
            OsString::from(r#""C:\D2 Mods\My Mod\monstats.txt""#),
        ]);

        assert_eq!(paths, vec![r"C:\D2 Mods\My Mod\monstats.txt".to_string()]);
    }
}
