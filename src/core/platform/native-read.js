import { normalizeNativeReadResult } from "./file-payloads.js";

export async function readNativeTextFiles(paths, invoke) {
  if (!paths.length) return [];
  const results = await invoke("read_text_files", { paths });
  return results.map((entry, index) => normalizeNativeReadResult(entry, paths[index], true));
}
