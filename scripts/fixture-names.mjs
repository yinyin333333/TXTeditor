import { join } from "node:path";

export function fixtureSizeLabel(size) {
  const numericSize = Number(size);
  return numericSize % 1000 === 0 ? `${numericSize / 1000}k` : String(numericSize);
}

export function fixtureNameForSize(size) {
  return `d2_${fixtureSizeLabel(size)}.tsv`;
}

export function fixturePathForSize(size, root = process.cwd()) {
  return join(root, "fixtures", fixtureNameForSize(size));
}
