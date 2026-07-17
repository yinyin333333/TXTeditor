import { TableDocument } from "./table-model.js";

const REFERENCE_VERSION_ALIASES = new Map([
  ["1.13", "1.13c"],
  ["1.13c", "1.13c"],
  ["2.4", "2.4"],
  ["3.1", "3.1"],
  ["3.2", "3.2"]
]);

const PROFILE_REFERENCE_VERSIONS = new Map([
  ["rotw", "3.2"],
  ["2.4", "2.4"]
]);

export function normalizeLintReferenceVersion(value) {
  return REFERENCE_VERSION_ALIASES.get(String(value ?? "").trim().toLowerCase()) ?? null;
}

// An explicit reference selection has the strongest authority. An invalid
// explicit value is not silently replaced with a different game version.
export function resolveLegacyLintReferenceVersion(config = {}, profile = "") {
  const explicit = String(config?.referenceVersion ?? "").trim();
  if (explicit) return normalizeLintReferenceVersion(explicit);

  const profileValue = String(profile ?? "").trim().toLowerCase();
  if (PROFILE_REFERENCE_VERSIONS.has(profileValue)) {
    return PROFILE_REFERENCE_VERSIONS.get(profileValue);
  }
  // A named but unknown profile must not inherit a coincidental Vector-LSP
  // schema version. It requires an explicit reference-data selection.
  if (profileValue) return null;

  const schemaVersion = String(config?.schemaVersion ?? "").trim();
  if (schemaVersion) {
    const normalizedSchema = normalizeLintReferenceVersion(schemaVersion);
    if (normalizedSchema) return normalizedSchema;
  }
  return null;
}

export function referenceDocumentsFromPayload(payload, expectedVersion = null) {
  if (!payload || !Array.isArray(payload.files)) {
    throw new Error("Bundled lint reference data returned an invalid payload.");
  }
  const gameVersion = normalizeLintReferenceVersion(payload.gameVersion);
  const expected = expectedVersion == null ? gameVersion : normalizeLintReferenceVersion(expectedVersion);
  if (!gameVersion || !expected || gameVersion !== expected) {
    throw new Error(`Bundled lint reference version mismatch: expected '${expectedVersion ?? "supported version"}', received '${payload.gameVersion ?? "unknown"}'.`);
  }
  const digest = String(payload.canonicalSha256 ?? "").trim().toLowerCase();
  if (!digest) throw new Error(`Bundled lint reference data for '${gameVersion}' has no verified digest.`);

  return payload.files.map((file) => {
    const name = referenceFileName(file?.name);
    const doc = TableDocument.fromText(name, String(file?.text ?? ""), {
      path: `builtin://d2r-reference/${gameVersion}/${name}`,
      encoding: file?.encoding ?? "utf-8",
      fileSizeBytes: file?.bytes ?? 0,
      autoFitInitialColumns: false
    });
    Object.defineProperties(doc, {
      lintReferenceBundled: { configurable: true, enumerable: false, value: true },
      lintReferenceVersion: { configurable: true, enumerable: false, value: gameVersion },
      lintReferenceDigest: { configurable: true, enumerable: false, value: digest },
      lintReferenceFileSha256: { configurable: true, enumerable: false, value: String(file?.sha256 ?? "").toLowerCase() }
    });
    return doc;
  });
}

function referenceFileName(value) {
  const normalized = String(value ?? "").replaceAll("\\", "/");
  const name = normalized.split("/").pop() ?? "";
  if (!/\.(txt|tsv|tbl|csv)$/i.test(name)) {
    throw new Error(`Bundled lint reference file has an unsupported name: '${value ?? ""}'.`);
  }
  return name;
}
