use std::path::Path;

pub(crate) const ENCODING: &str = "animdata-d2";

const BUCKET_COUNT: usize = 256;
const RECORD_SIZE: usize = 160;
const NAME_SIZE: usize = 7;
const FRAME_DATA_SIZE: usize = 144;
const COLUMN_COUNT: usize = 3 + FRAME_DATA_SIZE;
const MAX_RECORDS: usize = 5000;

pub(crate) fn is_animdata_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("animdata.d2"))
}

pub(crate) fn decode(bytes: &[u8]) -> Result<String, String> {
    let mut offset = 0usize;
    let mut records = Vec::new();

    for bucket in 0..BUCKET_COUNT {
        let count_bytes = take(bytes, &mut offset, 4).map_err(|_| {
            format!("Invalid animdata.d2: bucket {bucket} is missing its record count")
        })?;
        let count = u32::from_le_bytes(count_bytes.try_into().unwrap()) as usize;
        if records
            .len()
            .checked_add(count)
            .is_none_or(|total| total > MAX_RECORDS)
        {
            return Err(format!(
                "Invalid animdata.d2: more than {MAX_RECORDS} records are declared"
            ));
        }
        let byte_count = count.checked_mul(RECORD_SIZE).ok_or_else(|| {
            format!("Invalid animdata.d2: bucket {bucket} record count is too large")
        })?;
        let bucket_bytes = take(bytes, &mut offset, byte_count)
            .map_err(|_| format!("Invalid animdata.d2: bucket {bucket} records are truncated"))?;
        for (record_index, record) in bucket_bytes.chunks_exact(RECORD_SIZE).enumerate() {
            validate_binary_record(record, bucket, record_index)?;
            records.push(record);
        }
    }

    if offset != bytes.len() {
        return Err(format!(
            "Invalid animdata.d2: {} trailing byte(s) remain after the 256 buckets",
            bytes.len() - offset
        ));
    }

    let mut text = String::with_capacity(records.len().saturating_mul(300));
    append_header(&mut text);
    for record in records {
        text.push_str("\r\n");
        text.push_str(std::str::from_utf8(&record[..NAME_SIZE]).unwrap());
        text.push('\t');
        text.push_str(&u32::from_le_bytes(record[8..12].try_into().unwrap()).to_string());
        text.push('\t');
        text.push_str(&u32::from_le_bytes(record[12..16].try_into().unwrap()).to_string());
        for value in &record[16..] {
            text.push('\t');
            text.push_str(&value.to_string());
        }
    }
    text.push_str("\r\n");
    Ok(text)
}

pub(crate) fn encode(text: &str) -> Result<Vec<u8>, String> {
    let normalized = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = normalized.lines();
    let header = lines
        .next()
        .ok_or_else(|| "Cannot save animdata.d2: the table is empty".to_string())?;
    validate_header(header)?;

    let mut buckets: Vec<Vec<[u8; RECORD_SIZE]>> = (0..BUCKET_COUNT).map(|_| Vec::new()).collect();
    let mut record_count = 0usize;
    for (line_index, line) in lines.enumerate() {
        let row_number = line_index + 2;
        if line.is_empty() {
            return Err(format!(
                "Cannot save animdata.d2: row {row_number} is empty"
            ));
        }
        record_count += 1;
        if record_count > MAX_RECORDS {
            return Err(format!(
                "Cannot save animdata.d2: at most {MAX_RECORDS} records are supported"
            ));
        }
        let (record, bucket) = encode_record(line, row_number)?;
        buckets[bucket].push(record);
    }

    let capacity = BUCKET_COUNT * 4 + record_count * RECORD_SIZE;
    let mut bytes = Vec::with_capacity(capacity);
    for bucket in buckets {
        bytes.extend_from_slice(&(bucket.len() as u32).to_le_bytes());
        for record in bucket {
            bytes.extend_from_slice(&record);
        }
    }
    Ok(bytes)
}

fn encode_record(line: &str, row_number: usize) -> Result<([u8; RECORD_SIZE], usize), String> {
    let fields = line.split('\t').collect::<Vec<_>>();
    if fields.len() != COLUMN_COUNT {
        return Err(format!(
            "Cannot save animdata.d2: row {row_number} has {} columns; expected {COLUMN_COUNT}",
            fields.len()
        ));
    }

    let name = fields[0].as_bytes();
    if name.len() != NAME_SIZE || !name.iter().all(u8::is_ascii_graphic) {
        return Err(format!(
            "Cannot save animdata.d2: row {row_number} CofName must be exactly 7 printable ASCII characters"
        ));
    }

    let mut record = [0u8; RECORD_SIZE];
    record[..NAME_SIZE].copy_from_slice(name);
    let frames_per_direction = parse_u32(fields[1], row_number, "FramesPerDirection")?;
    let animation_speed = parse_u32(fields[2], row_number, "AnimationSpeed")?;
    record[8..12].copy_from_slice(&frames_per_direction.to_le_bytes());
    record[12..16].copy_from_slice(&animation_speed.to_le_bytes());
    for (index, value) in fields[3..].iter().enumerate() {
        record[16 + index] = value.parse::<u8>().map_err(|_| {
            format!(
                "Cannot save animdata.d2: row {row_number} FrameData{index:03} must be an integer from 0 to 255"
            )
        })?;
    }

    Ok((record, record_hash(&record) as usize))
}

fn parse_u32(value: &str, row_number: usize, field: &str) -> Result<u32, String> {
    value.parse::<u32>().map_err(|_| {
        format!(
            "Cannot save animdata.d2: row {row_number} {field} must be an integer from 0 to 4294967295"
        )
    })
}

fn validate_binary_record(record: &[u8], bucket: usize, record_index: usize) -> Result<(), String> {
    let display_index = record_index + 1;
    if record[7] != 0 {
        return Err(format!(
            "Invalid animdata.d2: bucket {bucket} record {display_index} has no CofName terminator"
        ));
    }
    if !record[..NAME_SIZE].iter().all(u8::is_ascii_graphic) {
        return Err(format!(
            "Invalid animdata.d2: bucket {bucket} record {display_index} has a non-ASCII CofName"
        ));
    }
    let actual_bucket = record_hash(record) as usize;
    if actual_bucket != bucket {
        return Err(format!(
            "Invalid animdata.d2: bucket {bucket} record {display_index} belongs in bucket {actual_bucket}"
        ));
    }
    Ok(())
}

fn record_hash(record: &[u8]) -> u8 {
    record[..8].iter().fold(0u8, |hash, value| {
        hash.wrapping_add(value.to_ascii_uppercase())
    })
}

fn validate_header(header: &str) -> Result<(), String> {
    let expected = expected_headers();
    let actual = header.split('\t').collect::<Vec<_>>();
    if actual == expected {
        return Ok(());
    }
    Err(format!(
        "Cannot save animdata.d2: header must contain the original {COLUMN_COUNT} AnimData columns in order"
    ))
}

fn append_header(text: &mut String) {
    text.push_str(&expected_headers().join("\t"));
}

fn expected_headers() -> Vec<String> {
    let mut headers = vec![
        "CofName".to_string(),
        "FramesPerDirection".to_string(),
        "AnimationSpeed".to_string(),
    ];
    headers.extend((0..FRAME_DATA_SIZE).map(|index| format!("FrameData{index:03}")));
    headers
}

fn take<'a>(bytes: &'a [u8], offset: &mut usize, count: usize) -> Result<&'a [u8], ()> {
    let end = offset.checked_add(count).ok_or(())?;
    let slice = bytes.get(*offset..end).ok_or(())?;
    *offset = end;
    Ok(slice)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_text() -> String {
        let mut text = String::new();
        append_header(&mut text);
        text.push('\n');
        text.push_str("A1NUHTH\t12\t256");
        for index in 0..FRAME_DATA_SIZE {
            text.push('\t');
            text.push_str(&(index % 256).to_string());
        }
        text.push('\n');
        text
    }

    #[test]
    fn text_binary_text_round_trip_is_stable() {
        let first = encode(&sample_text()).unwrap();
        assert_eq!(first.len(), BUCKET_COUNT * 4 + RECORD_SIZE);
        let extracted = decode(&first).unwrap();
        let second = encode(&extracted).unwrap();
        assert_eq!(second, first);
        assert!(extracted.starts_with("CofName\tFramesPerDirection\tAnimationSpeed"));
        assert!(extracted.contains("\r\nA1NUHTH\t12\t256\t0\t1\t2"));
    }

    #[test]
    fn invalid_cells_are_rejected_before_binary_output() {
        let invalid_name = sample_text().replace("A1NUHTH", "SHORT");
        assert!(encode(&invalid_name).unwrap_err().contains("exactly 7"));

        let invalid_frame = sample_text().replacen("\t0\t1\t2", "\t999\t1\t2", 1);
        assert!(encode(&invalid_frame).unwrap_err().contains("0 to 255"));

        let invalid_header = sample_text().replacen("CofName", "Name", 1);
        assert!(encode(&invalid_header).unwrap_err().contains("header"));
    }

    #[test]
    fn truncated_or_misbucketed_binary_is_rejected() {
        assert!(decode(&[0, 0, 0]).unwrap_err().contains("bucket 0"));

        let mut bytes = encode(&sample_text()).unwrap();
        let populated_bucket = record_hash(b"A1NUHTH\0") as usize;
        let record_offset = populated_bucket * 4 + 4;
        bytes[record_offset] = b'Z';
        assert!(decode(&bytes).unwrap_err().contains("belongs in bucket"));
    }

    #[test]
    fn only_the_named_animdata_binary_is_detected() {
        assert!(is_animdata_path(Path::new(
            r"C:\mod\data\global\animdata.d2"
        )));
        assert!(is_animdata_path(Path::new("ANIMDATA.D2")));
        assert!(!is_animdata_path(Path::new("other.d2")));
    }

    #[test]
    fn optional_real_fixture_round_trips_byte_for_byte() {
        let Ok(path) = std::env::var("TXTEDITOR_ANIMDATA_FIXTURE") else {
            return;
        };
        let original = std::fs::read(path).unwrap();
        let text = decode(&original).unwrap();
        let packed = encode(&text).unwrap();
        assert_eq!(packed, original);
    }
}
