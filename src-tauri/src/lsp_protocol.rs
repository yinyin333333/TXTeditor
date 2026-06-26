use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::ChildStdin;

pub(crate) fn send_lsp_msg(stdin: &mut ChildStdin, msg: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    stdin
        .write_all(header.as_bytes())
        .map_err(|e| e.to_string())?;
    stdin.write_all(&body).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn read_lsp_msg<R: BufRead>(reader: &mut R) -> Option<Value> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(val) = trimmed.strip_prefix("Content-Length: ") {
            content_length = val.parse().ok();
        }
    }
    let length = content_length?;
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).ok()?;
    serde_json::from_slice(&body).ok()
}

pub(crate) fn path_to_uri(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if let Some(unc_path) = normalized.strip_prefix("//") {
        return format!("file://{}", encode_file_uri_path(unc_path));
    }
    let encoded = encode_file_uri_path(&normalized);
    if normalized.starts_with('/') {
        format!("file://{encoded}")
    } else {
        format!("file:///{encoded}")
    }
}

fn encode_file_uri_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut encoded = String::new();
    for (index, byte) in bytes.iter().enumerate() {
        let drive_colon = index == 1 && bytes[0].is_ascii_alphabetic() && *byte == b':';
        if byte.is_ascii_alphanumeric()
            || matches!(*byte, b'-' | b'.' | b'_' | b'~' | b'/')
            || drive_colon
        {
            encoded.push(*byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

pub(crate) fn uri_to_path(uri: &str) -> Result<PathBuf, String> {
    let Some(rest) = uri.trim().strip_prefix("file://") else {
        return Err("Only file:// URIs can be converted to paths".to_string());
    };

    if rest.starts_with('/') {
        let decoded = decode_file_uri_component(rest)?;
        let path = if decoded.len() >= 3
            && decoded.as_bytes()[0] == b'/'
            && is_windows_drive_path(&decoded[1..])
        {
            decoded[1..].to_string()
        } else {
            decoded
        };
        return Ok(PathBuf::from(path));
    }

    let Some((host, path)) = rest.split_once('/') else {
        return Err("file URI must include a path".to_string());
    };
    if host.is_empty() {
        return Err("file URI host is empty".to_string());
    }
    let decoded_path = decode_file_uri_component(&format!("/{path}"))?;
    #[cfg(windows)]
    let unc_path = format!("\\\\{}{}", host, decoded_path.replace('/', "\\"));
    #[cfg(not(windows))]
    let unc_path = format!("//{}{}", host, decoded_path);
    Ok(PathBuf::from(unc_path))
}

fn is_windows_drive_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn decode_file_uri_component(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hi = bytes
                .get(index + 1)
                .copied()
                .and_then(hex_value)
                .ok_or_else(|| format!("Invalid percent escape in file URI: {value}"))?;
            let lo = bytes
                .get(index + 2)
                .copied()
                .and_then(hex_value)
                .ok_or_else(|| format!("Invalid percent escape in file URI: {value}"))?;
            decoded.push((hi << 4) | lo);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded)
        .map_err(|_| "file URI contains invalid UTF-8 percent encoding".to_string())
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[derive(Deserialize)]
pub(crate) struct LspPosition {
    pub(crate) line: u32,
    pub(crate) character: u32,
}

#[derive(Deserialize)]
pub(crate) struct LspRange {
    pub(crate) start: LspPosition,
    pub(crate) end: LspPosition,
}

#[derive(Deserialize)]
pub(crate) struct LspContentChange {
    pub(crate) range: LspRange,
    pub(crate) text: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct LspDiagnostic {
    pub(crate) row: u32,
    pub(crate) col: u32,
    pub(crate) severity: String,
    pub(crate) message: String,
    pub(crate) code: Option<String>,
}

fn count_tabs_before(line: &str, char_offset: usize) -> usize {
    line.get(..char_offset.min(line.len()))
        .unwrap_or("")
        .chars()
        .filter(|&c| c == '\t')
        .count()
}

pub(crate) fn diagnostics_from_lsp_publish(raw: &[Value], lines: &[String]) -> Vec<LspDiagnostic> {
    raw.iter()
        .filter_map(|d| {
            let line = d["range"]["start"]["line"].as_u64()? as u32;
            let character = d["range"]["start"]["character"].as_u64()? as usize;
            let col = lines
                .get(line as usize)
                .map(|l| count_tabs_before(l, character) as u32)
                .unwrap_or(0);
            let severity = match d["severity"].as_u64().unwrap_or(2) {
                1 => "error",
                3 | 4 => "info",
                _ => "warning",
            }
            .to_string();
            let message = d["message"].as_str().unwrap_or("").to_string();
            let code = d["code"]
                .as_str()
                .map(String::from)
                .or_else(|| d["code"].as_u64().map(|n| n.to_string()));
            Some(LspDiagnostic {
                row: line,
                col,
                severity,
                message,
                code,
            })
        })
        .collect()
}

pub(crate) fn apply_line_change(lines: &mut Vec<String>, range: &LspRange, new_text: &str) {
    let sl = range.start.line as usize;
    let sc = range.start.character as usize;
    let el = range.end.line as usize;
    let ec = range.end.character as usize;

    let prefix: String = lines
        .get(sl)
        .map(|l| l.chars().take(sc).collect())
        .unwrap_or_default();
    let suffix: String = lines
        .get(el)
        .map(|l| l.chars().skip(ec.min(l.chars().count())).collect())
        .unwrap_or_default();

    let new_lines: Vec<&str> = new_text.split('\n').collect();
    let replacement: Vec<String> = match new_lines.as_slice() {
        [] | [""] => vec![format!("{prefix}{suffix}")],
        [only] => vec![format!("{prefix}{}{suffix}", only.trim_end_matches('\r'))],
        [first, rest @ ..] => {
            let mut v = vec![format!("{prefix}{}", first.trim_end_matches('\r'))];
            for mid in &rest[..rest.len() - 1] {
                v.push(mid.trim_end_matches('\r').to_string());
            }
            v.push(format!(
                "{}{suffix}",
                rest.last().unwrap().trim_end_matches('\r')
            ));
            v
        }
    };

    while lines.len() <= el {
        lines.push(String::new());
    }
    lines.splice(sl..=el, replacement);
}

pub(crate) fn strip_markdown_for_tooltip(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut remaining = text;
    loop {
        let d = remaining.find("$!");
        let b = remaining.find("**");
        let t = remaining.find('`');
        let first = [d, b, t].iter().filter_map(|&p| p).min();
        match first {
            None => {
                result.push_str(remaining);
                break;
            }
            Some(pos) => {
                result.push_str(&remaining[..pos]);
                if d == Some(pos) {
                    remaining = &remaining[pos + 2..];
                    match remaining.find("!$") {
                        Some(end) => {
                            result.push('[');
                            result.push_str(&remaining[..end]);
                            result.push(']');
                            remaining = &remaining[end + 2..];
                        }
                        None => {
                            result.push_str("$!");
                        }
                    }
                } else if b == Some(pos) {
                    remaining = &remaining[pos + 2..];
                    match remaining.find("**") {
                        Some(end) => {
                            result.push_str(&remaining[..end]);
                            remaining = &remaining[end + 2..];
                        }
                        None => {
                            result.push_str("**");
                        }
                    }
                } else {
                    remaining = &remaining[pos + 1..];
                    match remaining.find('`') {
                        Some(end) => {
                            result.push_str(&remaining[..end]);
                            remaining = &remaining[end + 1..];
                        }
                        None => {
                            result.push('`');
                        }
                    }
                }
            }
        }
    }
    result.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn read_lsp_msg_parses_content_length_frames() {
        let body = r#"{"jsonrpc":"2.0","id":7,"result":{"ok":true}}"#;
        let frame = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let mut reader = Cursor::new(frame.into_bytes());
        let value = read_lsp_msg(&mut reader).expect("valid LSP frame");
        assert_eq!(value["id"], 7);
        assert_eq!(value["result"]["ok"], true);
    }

    #[test]
    fn path_to_uri_normalizes_windows_and_absolute_paths() {
        assert_eq!(
            path_to_uri(r"C:\Games\TXT\data.txt"),
            "file:///C:/Games/TXT/data.txt"
        );
        assert_eq!(
            path_to_uri(r"C:\Games\TXT\data file#100%.txt"),
            "file:///C:/Games/TXT/data%20file%23100%25.txt"
        );
        assert_eq!(
            path_to_uri("/home/user/한글 data.txt"),
            "file:///home/user/%ED%95%9C%EA%B8%80%20data.txt"
        );
        assert_eq!(
            path_to_uri(r"\\server\share\data file.txt"),
            "file://server/share/data%20file.txt"
        );
    }

    #[test]
    fn uri_to_path_decodes_file_uri_paths() {
        let windows = uri_to_path("file:///C:/Games/TXT/data%20file%23100%25.txt").unwrap();
        assert_eq!(
            windows.to_string_lossy().replace('\\', "/"),
            "C:/Games/TXT/data file#100%.txt"
        );

        let unicode = uri_to_path("file:///C:/Games/TXT/%ED%95%9C%EA%B8%80.txt").unwrap();
        assert_eq!(
            unicode.to_string_lossy().replace('\\', "/"),
            "C:/Games/TXT/\u{D55C}\u{AE00}.txt"
        );

        let posix = uri_to_path("file:///home/user/data%20file%23100%25.txt").unwrap();
        assert_eq!(
            posix.to_string_lossy().replace('\\', "/"),
            "/home/user/data file#100%.txt"
        );
    }

    #[test]
    fn uri_to_path_handles_unc_file_uri_deterministically() {
        let path = uri_to_path("file://server/share/data%20file.txt").unwrap();
        assert_eq!(
            path.to_string_lossy().replace('\\', "/"),
            "//server/share/data file.txt"
        );
    }

    #[test]
    fn uri_to_path_rejects_invalid_percent_encoding() {
        assert!(uri_to_path("file:///C:/bad%ZZ.txt")
            .unwrap_err()
            .contains("Invalid percent escape"));
    }

    #[test]
    fn apply_line_change_replaces_single_and_multi_line_ranges() {
        let mut lines = vec![
            "alpha\tone".to_string(),
            "beta\ttwo".to_string(),
            "gamma\tthree".to_string(),
        ];
        apply_line_change(
            &mut lines,
            &LspRange {
                start: LspPosition {
                    line: 1,
                    character: 5,
                },
                end: LspPosition {
                    line: 1,
                    character: 8,
                },
            },
            "updated",
        );
        assert_eq!(lines[1], "beta\tupdated");

        apply_line_change(
            &mut lines,
            &LspRange {
                start: LspPosition {
                    line: 0,
                    character: 5,
                },
                end: LspPosition {
                    line: 2,
                    character: 5,
                },
            },
            "A\nB",
        );
        assert_eq!(lines, vec!["alphaA".to_string(), "B\tthree".to_string()]);
    }

    #[test]
    fn diagnostics_from_lsp_publish_preserves_payload_shape_and_tab_columns() {
        let lines = vec!["code\tname\tvalue".to_string(), "plain".to_string()];
        let raw = vec![
            serde_json::json!({
                "range": { "start": { "line": 0, "character": 10 } },
                "severity": 1,
                "message": "bad value",
                "code": 42
            }),
            serde_json::json!({
                "range": { "start": { "line": 1, "character": 3 } },
                "severity": 4,
                "message": "note",
                "code": "hint"
            }),
            serde_json::json!({ "message": "missing range" }),
        ];

        assert_eq!(
            diagnostics_from_lsp_publish(&raw, &lines),
            vec![
                LspDiagnostic {
                    row: 0,
                    col: 2,
                    severity: "error".to_string(),
                    message: "bad value".to_string(),
                    code: Some("42".to_string()),
                },
                LspDiagnostic {
                    row: 1,
                    col: 0,
                    severity: "info".to_string(),
                    message: "note".to_string(),
                    code: Some("hint".to_string()),
                },
            ]
        );
    }

    #[test]
    fn strip_markdown_for_tooltip_keeps_values_without_markers() {
        assert_eq!(
            strip_markdown_for_tooltip("  **Damage** $!min!$ `code`  "),
            "Damage [min] code"
        );
        assert_eq!(
            strip_markdown_for_tooltip("  **Damage** `$!min!$`  "),
            "Damage $!min!$"
        );
        assert_eq!(strip_markdown_for_tooltip("plain tooltip"), "plain tooltip");
    }
}
