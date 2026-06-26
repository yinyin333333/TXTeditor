import fs from "node:fs";
import path from "node:path";

export const BASELINE_FOLDER_NAME = "TXTeditor-0.4.3-pr";

export function baselineCandidates({ currentRoot = process.cwd(), env = process.env } = {}) {
  const candidates = [];
  if (env.TXTEDITOR_BASELINE_DIR) candidates.push(["TXTEDITOR_BASELINE_DIR", env.TXTEDITOR_BASELINE_DIR]);
  candidates.push(["sibling", path.resolve(currentRoot, "..", BASELINE_FOLDER_NAME)]);
  return candidates;
}

export function resolveBaselineDir(options = {}) {
  for (const [source, candidate] of baselineCandidates(options)) {
    if (candidate && fs.existsSync(candidate)) {
      return {
        path: path.resolve(candidate),
        source
      };
    }
  }
  return null;
}

export function requireBaselineDir(options = {}) {
  const resolved = resolveBaselineDir(options);
  if (resolved) return resolved;
  const tried = baselineCandidates(options).map(([source, candidate]) => `${source}: ${candidate}`).join("; ");
  throw new Error(`Baseline directory not found. Set TXTEDITOR_BASELINE_DIR or place ${BASELINE_FOLDER_NAME} beside this snapshot. Tried ${tried}`);
}
