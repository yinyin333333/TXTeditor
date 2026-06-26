import { normalizeNativeReadResult } from "./file-payloads.js";

export async function readNativeTextFiles(paths, invoke) {
  if (!paths.length) return [];
  try {
    const results = await invoke("read_text_files", { paths });
    return results.map((entry, index) => normalizeNativeReadResult(entry, paths[index], true));
  } catch {
    return readNativeTextFilesOneByOne(paths, invoke);
  }
}

async function readNativeTextFilesOneByOne(paths, invoke) {
  const results = [];
  for (const path of paths) {
    try {
      const payload = await invoke("read_text_file", { path });
      results.push({ path, payload, bulkRead: false });
    } catch (error) {
      results.push({ path, error: error instanceof Error ? error.message : String(error), bulkRead: false });
    }
  }
  return results;
}
