import {
  NUMERIC_BOUNDS,
  PROFILE_ACCEPTED_COLUMNS,
  PROFILE_NON_STANDARD_COLUMNS,
  PROFILE_NUMERIC_BOUNDS
} from "./lint-rule-data.js";

export function acceptedColumnsForProfile(profile, fileName) {
  return new Set(PROFILE_ACCEPTED_COLUMNS[profile]?.[fileName] ?? []);
}

export function nonStandardColumnsForProfile(profile, fileName) {
  return new Set(PROFILE_NON_STANDARD_COLUMNS[profile]?.[fileName] ?? []);
}

export function numericBoundsForProfile(profile, fileName) {
  const base = NUMERIC_BOUNDS[fileName];
  const override = PROFILE_NUMERIC_BOUNDS[profile]?.[fileName];
  if (!base) return override;
  if (!override) return base;
  return { ...base, ...override };
}
