use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
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
#[serde(rename_all = "camelCase")]
pub(crate) struct LspDiagnostic {
    pub(crate) row: u32,
    pub(crate) end_row: u32,
    pub(crate) col: u32,
    pub(crate) start_character: u32,
    pub(crate) end_character: u32,
    pub(crate) cell_start_character: u32,
    pub(crate) cell_end_character: u32,
    pub(crate) severity: String,
    pub(crate) message: String,
    pub(crate) code: Option<String>,
    pub(crate) data: Option<Value>,
}

fn json_u32(value: &Value) -> Option<u32> {
    value.as_u64().map(|n| n.min(u64::from(u32::MAX)) as u32)
}

#[cfg(test)]
fn utf16_len(text: &str) -> u32 {
    text.encode_utf16().count().min(u32::MAX as usize) as u32
}

fn utf16_offset_to_byte_index(line: &str, utf16_offset: u32) -> usize {
    let mut offset = 0u32;
    for (byte_index, ch) in line.char_indices() {
        if offset >= utf16_offset {
            return byte_index;
        }
        let next_offset = offset.saturating_add(ch.len_utf16() as u32);
        if next_offset > utf16_offset {
            return byte_index;
        }
        offset = next_offset;
    }
    line.len()
}

struct LineCellBoundaries {
    tabs: Vec<u32>,
    line_end: u32,
}

impl LineCellBoundaries {
    fn new(line: &str) -> Self {
        let mut tabs = Vec::new();
        let mut offset = 0u32;
        for ch in line.chars() {
            if ch == '\t' {
                tabs.push(offset);
            }
            offset = offset.saturating_add(ch.len_utf16() as u32);
        }
        Self {
            tabs,
            line_end: offset,
        }
    }

    fn cell_bounds(&self, utf16_offset: u32) -> (u32, u32, u32) {
        let col = self.tabs.partition_point(|tab| *tab < utf16_offset);
        if let Some(cell_end) = self.tabs.get(col).copied() {
            let cell_start = col
                .checked_sub(1)
                .and_then(|previous| self.tabs.get(previous))
                .map_or(0, |tab| tab.saturating_add(1));
            return (col as u32, cell_start.min(cell_end), cell_end);
        }
        let cell_start = self.tabs.last().map_or(0, |tab| tab.saturating_add(1));
        (col as u32, cell_start.min(self.line_end), self.line_end)
    }
}

pub(crate) fn diagnostics_from_lsp_publish(raw: &[Value], lines: &[String]) -> Vec<LspDiagnostic> {
    let mut boundaries_by_line = HashMap::<u32, Option<LineCellBoundaries>>::new();
    raw.iter()
        .filter_map(|d| {
            let line = json_u32(&d["range"]["start"]["line"])?;
            let start_character = json_u32(&d["range"]["start"]["character"])?;
            let end_row = json_u32(&d["range"]["end"]["line"]).unwrap_or(line);
            let end_character =
                json_u32(&d["range"]["end"]["character"]).unwrap_or(start_character);
            let boundaries = boundaries_by_line.entry(line).or_insert_with(|| {
                lines
                    .get(line as usize)
                    .map(|line| LineCellBoundaries::new(line))
            });
            let (col, cell_start_character, cell_end_character) = boundaries
                .as_ref()
                .map(|boundaries| boundaries.cell_bounds(start_character))
                .unwrap_or((0, 0, 0));
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
            let data = d.get("data").filter(|value| !value.is_null()).cloned();
            Some(LspDiagnostic {
                row: line,
                end_row,
                col,
                start_character,
                end_character,
                cell_start_character,
                cell_end_character,
                severity,
                message,
                code,
                data,
            })
        })
        .collect()
}

pub(crate) fn apply_line_change(lines: &mut Vec<String>, range: &LspRange, new_text: &str) {
    let sl = range.start.line as usize;
    let el = range.end.line as usize;

    let prefix: String = lines
        .get(sl)
        .map(|l| l[..utf16_offset_to_byte_index(l, range.start.character)].to_string())
        .unwrap_or_default();
    let suffix: String = lines
        .get(el)
        .map(|l| l[utf16_offset_to_byte_index(l, range.end.character)..].to_string())
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

fn protect_fenced_code_blocks(text: &str) -> (String, Vec<String>) {
    let mut protected = String::with_capacity(text.len());
    let mut blocks = Vec::new();
    let mut cursor = 0;

    while cursor < text.len() {
        let at_line_start =
            cursor == 0 || text.as_bytes().get(cursor.wrapping_sub(1)) == Some(&b'\n');
        let remaining = &text[cursor..];
        let fence_len = if at_line_start {
            remaining.bytes().take_while(|byte| *byte == b'`').count()
        } else {
            0
        };
        if fence_len < 3 {
            let ch = remaining.chars().next().unwrap();
            protected.push(ch);
            cursor += ch.len_utf8();
            continue;
        }
        let Some(open_line_end_offset) = remaining.find('\n') else {
            protected.push_str(remaining);
            break;
        };
        let content_start = cursor + open_line_end_offset + 1;
        let mut line_start = content_start;
        let mut closing = None;
        while line_start <= text.len() {
            let line_end = text[line_start..]
                .find('\n')
                .map(|offset| line_start + offset)
                .unwrap_or(text.len());
            let line = text[line_start..line_end].trim_end_matches('\r');
            let ticks = line.bytes().take_while(|byte| *byte == b'`').count();
            if ticks >= fence_len && line[ticks..].trim().is_empty() {
                closing = Some((line_start, line_end));
                break;
            }
            if line_end == text.len() {
                break;
            }
            line_start = line_end + 1;
        }
        let Some((closing_start, closing_end)) = closing else {
            protected.push_str(&text[cursor..content_start]);
            cursor = content_start;
            continue;
        };
        let mut content_end = closing_start;
        if content_end > content_start && text.as_bytes()[content_end - 1] == b'\n' {
            content_end -= 1;
            if content_end > content_start && text.as_bytes()[content_end - 1] == b'\r' {
                content_end -= 1;
            }
        }
        let token = format!("\u{e000}{}\u{e001}", blocks.len());
        protected.push_str(&token);
        blocks.push(text[content_start..content_end].to_string());
        cursor = closing_end;
    }

    (protected, blocks)
}

pub(crate) fn strip_markdown_for_tooltip(text: &str) -> String {
    let (protected_text, fenced_blocks) = protect_fenced_code_blocks(text);
    let mut result = String::with_capacity(protected_text.len());
    let mut remaining = protected_text.as_str();
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
    let mut plain = result.trim().to_string();
    for (index, block) in fenced_blocks.into_iter().enumerate() {
        plain = plain.replace(&format!("\u{e000}{index}\u{e001}"), &block);
    }
    plain
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

        let mut unicode_lines = vec!["a\u{1F642}c".to_string()];
        apply_line_change(
            &mut unicode_lines,
            &LspRange {
                start: LspPosition {
                    line: 0,
                    character: 1,
                },
                end: LspPosition {
                    line: 0,
                    character: 3,
                },
            },
            "B",
        );
        assert_eq!(unicode_lines, vec!["aBc".to_string()]);
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
                    end_row: 0,
                    col: 2,
                    start_character: 10,
                    end_character: 10,
                    cell_start_character: 10,
                    cell_end_character: 15,
                    severity: "error".to_string(),
                    message: "bad value".to_string(),
                    code: Some("42".to_string()),
                    data: None,
                },
                LspDiagnostic {
                    row: 1,
                    end_row: 1,
                    col: 0,
                    start_character: 3,
                    end_character: 3,
                    cell_start_character: 0,
                    cell_end_character: 5,
                    severity: "info".to_string(),
                    message: "note".to_string(),
                    code: Some("hint".to_string()),
                    data: None,
                },
            ]
        );
    }

    #[test]
    fn repeated_same_row_ranges_match_individual_conversion() {
        let line = "한글\tcalc\t🙂alpha\tomega".to_string();
        let raw = vec![
            serde_json::json!({
                "range": {
                    "start": { "line": 0, "character": utf16_len("한") },
                    "end": { "line": 0, "character": utf16_len("한글") }
                },
                "message": "first cell"
            }),
            serde_json::json!({
                "range": {
                    "start": { "line": 0, "character": utf16_len("한글") },
                    "end": { "line": 0, "character": utf16_len("한글") }
                },
                "message": "zero width at tab boundary"
            }),
            serde_json::json!({
                "range": {
                    "start": { "line": 0, "character": utf16_len("한글\tcalc\t🙂") },
                    "end": { "line": 0, "character": utf16_len("한글\tcalc\t🙂a") }
                },
                "message": "after surrogate pair"
            }),
            serde_json::json!({
                "range": {
                    "start": { "line": 0, "character": utf16_len("한글\tcalc\t🙂alpha\t") },
                    "end": { "line": 0, "character": utf16_len("한글\tcalc\t🙂alpha\to") }
                },
                "message": "last cell"
            }),
        ];
        let lines = [line.clone()];

        let converted_together = diagnostics_from_lsp_publish(&raw, &lines);
        let converted_individually = raw
            .iter()
            .flat_map(|diagnostic| {
                diagnostics_from_lsp_publish(std::slice::from_ref(diagnostic), &lines)
            })
            .collect::<Vec<_>>();

        assert_eq!(converted_together, converted_individually);
        assert_eq!(
            converted_together
                .iter()
                .map(|diagnostic| (
                    diagnostic.col,
                    diagnostic.cell_start_character,
                    diagnostic.cell_end_character,
                ))
                .collect::<Vec<_>>(),
            vec![
                (0, 0, utf16_len("한글")),
                (0, 0, utf16_len("한글")),
                (
                    2,
                    utf16_len("한글\tcalc\t"),
                    utf16_len("한글\tcalc\t🙂alpha"),
                ),
                (3, utf16_len("한글\tcalc\t🙂alpha\t"), utf16_len(&line),),
            ]
        );
    }

    #[test]
    fn diagnostics_from_lsp_publish_preserves_precise_cell_ranges() {
        let line = "description\tcalc\tskill('A'.blvl)+skill(B'.blvl)".to_string();
        let start = utf16_len("description\tcalc\tskill('A'.blvl)+skill(B");
        let end = start + 1;
        let raw = vec![serde_json::json!({
            "range": {
                "start": { "line": 0, "character": start },
                "end": { "line": 0, "character": end }
            },
            "severity": 1,
            "message": "Invalid calc formula",
            "code": "calcCheck"
        })];

        let diagnostics = diagnostics_from_lsp_publish(&raw, &[line.clone()]);

        assert_eq!(
            diagnostics,
            vec![LspDiagnostic {
                row: 0,
                end_row: 0,
                col: 2,
                start_character: start,
                end_character: end,
                cell_start_character: utf16_len("description\tcalc\t"),
                cell_end_character: utf16_len(&line),
                severity: "error".to_string(),
                message: "Invalid calc formula".to_string(),
                code: Some("calcCheck".to_string()),
                data: None,
            }]
        );
    }

    #[test]
    fn diagnostics_from_lsp_publish_supports_full_cell_ranges() {
        let line = "code\tvalue".to_string();
        let raw = vec![serde_json::json!({
            "range": {
                "start": { "line": 0, "character": utf16_len("code\t") },
                "end": { "line": 0, "character": utf16_len(&line) }
            },
            "message": "full cell"
        })];

        let diagnostic = diagnostics_from_lsp_publish(&raw, &[line]).remove(0);

        assert_eq!(diagnostic.col, 1);
        assert_eq!(diagnostic.start_character, 5);
        assert_eq!(diagnostic.end_character, 10);
        assert_eq!(diagnostic.cell_start_character, 5);
        assert_eq!(diagnostic.cell_end_character, 10);
        assert_eq!(diagnostic.severity, "warning");
        assert_eq!(diagnostic.data, None);
    }

    #[test]
    fn diagnostics_from_lsp_publish_preserves_structured_data() {
        let line = "code\tmin(5,1+skill('Fire Ball'.blvl)/5".to_string();
        let insertion = utf16_len(&line);
        let data = serde_json::json!({
            "rule": "calcCheck",
            "kind": "missing-token",
            "expected": ")",
            "actual": "EOF",
            "insertionPoint": insertion,
            "insertText": ")",
            "hint": "Insert ')' at the end of this expression."
        });
        let raw = vec![serde_json::json!({
            "range": {
                "start": { "line": 0, "character": insertion },
                "end": { "line": 0, "character": insertion }
            },
            "severity": 1,
            "message": "calcCheck: Missing ')' before end of formula",
            "code": "calc.expected-rparen.eof",
            "data": data
        })];

        let diagnostic = diagnostics_from_lsp_publish(&raw, &[line.clone()]).remove(0);

        assert_eq!(diagnostic.col, 1);
        assert_eq!(diagnostic.start_character, insertion);
        assert_eq!(diagnostic.end_character, insertion);
        assert_eq!(diagnostic.cell_start_character, utf16_len("code\t"));
        assert_eq!(diagnostic.cell_end_character, utf16_len(&line));
        assert_eq!(
            diagnostic.data,
            Some(serde_json::json!({
                "rule": "calcCheck",
                "kind": "missing-token",
                "expected": ")",
                "actual": "EOF",
                "insertionPoint": insertion,
                "insertText": ")",
                "hint": "Insert ')' at the end of this expression."
            }))
        );
    }

    #[test]
    fn diagnostics_from_lsp_publish_handles_utf16_offsets_with_non_ascii_text() {
        let line = "\u{D55C}\u{AE00}\tcalc\t\u{AC12}\u{1F642}tail".to_string();
        let cell_start = utf16_len("\u{D55C}\u{AE00}\tcalc\t");
        let start = cell_start + utf16_len("\u{AC12}\u{1F642}");
        let end = start + utf16_len("t");
        let raw = vec![serde_json::json!({
            "range": {
                "start": { "line": 0, "character": start },
                "end": { "line": 0, "character": end }
            },
            "message": "unicode range"
        })];

        let diagnostic = diagnostics_from_lsp_publish(&raw, &[line.clone()]).remove(0);

        assert_eq!(diagnostic.col, 2);
        assert_eq!(diagnostic.start_character, 11);
        assert_eq!(diagnostic.end_character, 12);
        assert_eq!(diagnostic.cell_start_character, cell_start);
        assert_eq!(diagnostic.cell_end_character, utf16_len(&line));
        assert_eq!(diagnostic.data, None);
    }

    #[test]
    fn diagnostics_from_lsp_publish_clamps_malformed_offsets_to_cell_boundaries() {
        let raw = vec![serde_json::json!({
            "range": {
                "start": { "line": 0, "character": 99 },
                "end": { "line": 0, "character": 1 }
            },
            "message": "out of range"
        })];

        let diagnostic = diagnostics_from_lsp_publish(&raw, &["a\tb".to_string()]).remove(0);

        assert_eq!(diagnostic.col, 1);
        assert_eq!(diagnostic.start_character, 99);
        assert_eq!(diagnostic.end_character, 1);
        assert_eq!(diagnostic.cell_start_character, 2);
        assert_eq!(diagnostic.cell_end_character, 3);
        assert_eq!(diagnostic.data, None);
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

    #[test]
    fn strip_markdown_for_tooltip_preserves_fenced_cell_values_verbatim() {
        let text =
            "**Cell value**\n\n````text\n a```$!b!$**c** \n````\n\n**Character count: 16/255**";
        let plain = strip_markdown_for_tooltip(text);
        assert!(plain.contains(" a```$!b!$**c** "));
        assert!(plain.contains("Character count: 16/255"));
    }
    #[test]
    fn diagnostics_preserve_the_lsp_end_line_for_json_ranges() {
        let raw = vec![serde_json::json!({
            "range": {
                "start": { "line": 2, "character": 3 },
                "end": { "line": 4, "character": 5 }
            },
            "message": "multi-line JSON range"
        })];
        let lines = vec![String::new(); 5];
        let diagnostics = diagnostics_from_lsp_publish(&raw, &lines);
        assert_eq!(diagnostics[0].row, 2);
        assert_eq!(diagnostics[0].end_row, 4);
    }
}
