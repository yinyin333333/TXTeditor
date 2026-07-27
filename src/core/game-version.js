export const GAME_VERSIONS = ["3.2", "3.1", "2.4", "1.13c"];

const LEGACY_FAMILIES = {
  "3.2": "RotW",
  "3.1": "RotW",
  "2.4": "2.4",
  "1.13c": "1.13c"
};

const VECTOR_SCHEMAS = {
  "3.2": "3.2",
  "3.1": "3.1",
  "2.4": "2.4",
  "1.13c": "1.13"
};

export function normalizeGameVersion(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "1.13") return "1.13c";
  return GAME_VERSIONS.find((version) => version.toLowerCase() === text) ?? null;
}

export function legacyRuleFamilyForGameVersion(version) {
  return LEGACY_FAMILIES[normalizeGameVersion(version)] ?? "RotW";
}

export function vectorSchemaForGameVersion(version) {
  return VECTOR_SCHEMAS[normalizeGameVersion(version)] ?? "3.2";
}

export function legacyGameVersion(config = {}, profile = "RotW") {
  const explicit = normalizeGameVersion(config.gameVersion);
  if (explicit) return explicit;
  const family = String(profile ?? "").trim();
  if (family === "2.4" || family === "1.13c") return family;
  const reference = normalizeGameVersion(config.referenceVersion);
  if (reference === "3.1" || reference === "3.2") return reference;
  const schema = normalizeGameVersion(config.schemaVersion);
  return schema === "3.1" || schema === "3.2" ? schema : "3.2";
}

export function vectorGameVersion(config = {}) {
  const explicit = normalizeGameVersion(config.gameVersion);
  if (explicit) return explicit;
  const schema = normalizeGameVersion(config.schemaVersion);
  if (schema) return schema;
  return normalizeGameVersion(config.referenceVersion) ?? "3.2";
}

export function canonicalGameVersionConfig(config = {}, version) {
  const gameVersion = normalizeGameVersion(version) ?? "3.2";
  return {
    ...config,
    gameVersion,
    schemaVersion: vectorSchemaForGameVersion(gameVersion),
    referenceVersion: gameVersion
  };
}
