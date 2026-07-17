use crate::config::AppConfigState;
use crate::file_io::decode_text;
use crate::lsp_service::find_vector_lsp_binary;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

const EXPECTED_ROOT_SHA256: &str =
    "6930d9c39b5380fd4c242bae4df24a9b0115386bdc074cb8482007e2a033cab0";
const EXPECTED_DATASETS: &[(&str, &str, &str, usize, u64, &str)] = &[
    (
        "1.13",
        "1.13c",
        "113c",
        64,
        2_920_000,
        "80ae8704937825906ec456c2d843fa173b5e940300a38eb9ab67ea615b2aa71f",
    ),
    (
        "2.4",
        "2.4",
        "69270",
        85,
        4_585_088,
        "1e3e03fa3138debd1b87c6eec0a68d68fc76069842ccf6abffefa7be0d42c008",
    ),
    (
        "3.1",
        "3.1",
        "92198",
        91,
        5_077_001,
        "8479a35241ad05196fc99c2219d8bd934ee3fc7820e0c0f5553fed07847d0152",
    ),
    (
        "3.2",
        "3.2",
        "92777a",
        91,
        5_144_477,
        "7149352429c5d5ff3e641adb75ce6ff683ce4db6c390651c928f336f8dcddc75",
    ),
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceManifest {
    format_version: u32,
    total_file_count: usize,
    total_bytes: u64,
    canonical_sha256: String,
    datasets: Vec<DatasetManifest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatasetManifest {
    schema_variant: String,
    game_version: String,
    source: DatasetSource,
    resource_path: String,
    file_count: usize,
    total_bytes: u64,
    canonical_sha256: String,
    files: Vec<FileManifest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatasetSource {
    dataset_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileManifest {
    path: String,
    bytes: u64,
    encoding: String,
    sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReferenceDatasetPayload {
    schema_variant: String,
    game_version: String,
    canonical_sha256: String,
    files: Vec<ReferenceFilePayload>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceFilePayload {
    name: String,
    text: String,
    encoding: String,
    bytes: u64,
    sha256: String,
}

#[tauri::command]
pub(crate) async fn load_lint_reference_dataset(
    game_version: String,
    state: tauri::State<'_, AppConfigState>,
) -> Result<ReferenceDatasetPayload, String> {
    let configured_binary = state
        .config
        .lock()
        .map_err(|_| "Configuration lock is poisoned.".to_string())?
        .vector_lsp_path
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let binary = match configured_binary
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
        {
            Some(path) => PathBuf::from(path).canonicalize().map_err(|error| {
                format!("Configured vector-lsp path cannot be resolved: {path}: {error}")
            })?,
            None => find_vector_lsp_binary()?,
        };
        let contrib_root = binary
            .parent()
            .ok_or_else(|| "vector-lsp executable has no parent directory".to_string())?
            .join("contrib")
            .join("d2rdoc");
        load_from_contrib(&contrib_root, &game_version)
    })
    .await
    .map_err(|error| format!("Bundled reference loader task failed: {error}"))?
}

fn load_from_contrib(
    contrib_root: &Path,
    requested_version: &str,
) -> Result<ReferenceDatasetPayload, String> {
    let requested_variant = normalize_variant(requested_version)?;
    let manifest_path = contrib_root.join("reference-manifest.json");
    let manifest_bytes = std::fs::read(&manifest_path)
        .map_err(|error| format!("Cannot read '{}': {error}", manifest_path.display()))?;
    let manifest: ReferenceManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("Invalid '{}': {error}", manifest_path.display()))?;
    if manifest.format_version != 1
        || manifest.total_file_count != 331
        || manifest.total_bytes != 17_726_566
        || !manifest
            .canonical_sha256
            .eq_ignore_ascii_case(EXPECTED_ROOT_SHA256)
    {
        return Err("Bundled reference manifest inventory/digest mismatch.".to_string());
    }
    verify_manifest(&manifest)?;

    let dataset = manifest
        .datasets
        .iter()
        .find(|dataset| {
            dataset
                .schema_variant
                .eq_ignore_ascii_case(requested_variant)
        })
        .ok_or_else(|| {
            format!("Reference version '{requested_version}' is not in the manifest.")
        })?;
    let resource_root = safe_join(contrib_root, &dataset.resource_path)?;
    let mut files = dataset.files.iter().collect::<Vec<_>>();
    files.sort_by_key(|file| file.path.to_ascii_lowercase());
    let mut seen = HashSet::with_capacity(files.len());
    let mut payloads = Vec::with_capacity(files.len());
    let mut canonical = String::new();
    let mut total_bytes = 0u64;
    for file in files {
        let lower_path = file.path.replace('\\', "/").to_ascii_lowercase();
        if !seen.insert(lower_path.clone()) {
            return Err(format!(
                "Duplicate reference manifest path '{}'.",
                file.path
            ));
        }
        let path = safe_join(&resource_root, &file.path)?;
        let bytes = std::fs::read(&path)
            .map_err(|error| format!("Cannot read '{}': {error}", path.display()))?;
        let actual_hash = sha256_hex(&bytes);
        if bytes.len() as u64 != file.bytes || !actual_hash.eq_ignore_ascii_case(&file.sha256) {
            return Err(format!(
                "Bundled reference file '{}' failed size/hash verification.",
                file.path
            ));
        }
        total_bytes += bytes.len() as u64;
        canonical.push_str(&actual_hash);
        canonical.push_str("  ");
        canonical.push_str(&lower_path);
        canonical.push('\n');
        let (text, encoding) = decode_text(bytes)?;
        if encoding != file.encoding {
            return Err(format!(
                "Bundled reference file '{}' encoding mismatch: manifest={}, detected={encoding}.",
                file.path, file.encoding
            ));
        }
        payloads.push(ReferenceFilePayload {
            name: file.path.clone(),
            text,
            encoding,
            bytes: file.bytes,
            sha256: actual_hash,
        });
    }
    if total_bytes != dataset.total_bytes
        || !sha256_hex(canonical.as_bytes()).eq_ignore_ascii_case(&dataset.canonical_sha256)
    {
        return Err(format!(
            "Reference dataset '{}' aggregate verification failed.",
            dataset.game_version
        ));
    }

    Ok(ReferenceDatasetPayload {
        schema_variant: dataset.schema_variant.clone(),
        game_version: dataset.game_version.clone(),
        canonical_sha256: dataset.canonical_sha256.clone(),
        files: payloads,
    })
}

fn verify_manifest(manifest: &ReferenceManifest) -> Result<(), String> {
    if manifest.datasets.len() != EXPECTED_DATASETS.len() {
        return Err("Bundled reference manifest dataset count mismatch.".to_string());
    }
    let mut seen_variants = HashSet::with_capacity(EXPECTED_DATASETS.len());
    let mut root_canonical = String::new();
    let mut total_files = 0usize;
    let mut total_bytes = 0u64;

    for (schema_variant, game_version, dataset_id, file_count, bytes, digest) in EXPECTED_DATASETS {
        let dataset = manifest
            .datasets
            .iter()
            .find(|candidate| {
                candidate
                    .schema_variant
                    .eq_ignore_ascii_case(schema_variant)
            })
            .ok_or_else(|| format!("Reference dataset '{schema_variant}' is missing."))?;
        if !seen_variants.insert(dataset.schema_variant.to_ascii_lowercase())
            || dataset.schema_variant != *schema_variant
            || dataset.game_version != *game_version
            || dataset.source.dataset_id != *dataset_id
            || dataset.resource_path != format!("{schema_variant}/reference")
            || dataset.file_count != *file_count
            || dataset.total_bytes != *bytes
            || !dataset.canonical_sha256.eq_ignore_ascii_case(digest)
            || dataset.files.len() != dataset.file_count
        {
            return Err(format!(
                "Reference dataset '{}'/{} mapping, inventory, or digest mismatch.",
                dataset.schema_variant, dataset.game_version
            ));
        }

        let mut paths = HashSet::with_capacity(dataset.file_count);
        let mut dataset_canonical = String::new();
        let mut files = dataset.files.iter().collect::<Vec<_>>();
        files.sort_by_key(|file| file.path.to_ascii_lowercase());
        for file in files {
            let lower_path = file.path.replace('\\', "/").to_ascii_lowercase();
            if !paths.insert(lower_path.clone())
                || safe_join(Path::new("."), &file.path).is_err()
                || file.sha256.len() != 64
                || !file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
                || !matches!(file.encoding.as_str(), "utf-8" | "windows-1252")
            {
                return Err(format!(
                    "Invalid reference metadata for '{}'/{}.",
                    dataset.game_version, file.path
                ));
            }
            let hash = file.sha256.to_ascii_lowercase();
            dataset_canonical.push_str(&hash);
            dataset_canonical.push_str("  ");
            dataset_canonical.push_str(&lower_path);
            dataset_canonical.push('\n');
            root_canonical.push_str(&hash);
            root_canonical.push_str("  ");
            root_canonical.push_str(game_version);
            root_canonical.push('/');
            root_canonical.push_str(&lower_path);
            root_canonical.push('\n');
        }
        if !sha256_hex(dataset_canonical.as_bytes()).eq_ignore_ascii_case(digest) {
            return Err(format!(
                "Reference dataset '{game_version}' manifest file-list digest mismatch."
            ));
        }
        total_files += dataset.file_count;
        total_bytes += dataset.total_bytes;
    }

    if total_files != manifest.total_file_count
        || total_bytes != manifest.total_bytes
        || !sha256_hex(root_canonical.as_bytes()).eq_ignore_ascii_case(EXPECTED_ROOT_SHA256)
    {
        return Err("Bundled reference manifest aggregate mismatch.".to_string());
    }
    Ok(())
}

fn normalize_variant(value: &str) -> Result<&'static str, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1.13" | "1.13c" => Ok("1.13"),
        "2.4" => Ok("2.4"),
        "3.1" => Ok("3.1"),
        "3.2" => Ok("3.2"),
        _ => Err(format!(
            "Unsupported reference version '{value}'; choose 1.13c, 2.4, 3.1, or 3.2."
        )),
    }
}

fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || !relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(format!(
            "Unsafe bundled reference path '{}'.",
            relative.display()
        ));
    }
    Ok(root.join(relative))
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_mapping_is_explicit_and_does_not_guess() {
        assert_eq!(normalize_variant("1.13c").unwrap(), "1.13");
        assert_eq!(normalize_variant("3.2").unwrap(), "3.2");
        assert!(normalize_variant("").is_err());
        assert!(normalize_variant("latest").is_err());
    }

    #[test]
    fn resource_paths_cannot_escape_the_contrib_root() {
        let root = Path::new("C:/product/contrib/d2rdoc");
        assert!(safe_join(root, "3.2/reference").is_ok());
        assert!(safe_join(root, "../outside").is_err());
        assert!(safe_join(root, "C:/outside").is_err());
    }
}
