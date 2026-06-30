const tableFileStates = new WeakMap();

const FILE_STATE_FIELDS = ["name", "path", "handle", "lineEnding", "finalNewline", "encoding", "dirty", "fileSizeBytes", "estimatedCellCount", "largeFileMode", "largeFileReasons"];

export function resetTableFileState(doc, name = "Untitled.txt", meta = {}) {
  const state = {
    name,
    path: meta.path ?? "",
    handle: meta.handle ?? null,
    lineEnding: meta.lineEnding ?? "\n",
    finalNewline: meta.finalNewline ?? false,
    encoding: meta.encoding ?? "utf-8",
    dirty: meta.dirty ?? false,
    revision: meta.revision ?? 0,
    fileSizeBytes: Math.max(0, Math.floor(Number(meta.fileSizeBytes ?? meta.sizeBytes) || 0)),
    estimatedCellCount: Math.max(0, Math.floor(Number(meta.estimatedCellCount) || 0)),
    largeFileMode: Boolean(meta.largeFileMode),
    largeFileReasons: Array.isArray(meta.largeFileReasons) ? [...meta.largeFileReasons] : []
  };
  tableFileStates.set(doc, state);
  defineTableFileStateAccessors(doc);
  return state;
}

export function tableFileState(doc) {
  let state = tableFileStates.get(doc);
  if (!state) state = resetTableFileState(doc);
  return state;
}

export function markTableContentDirty(doc) {
  const state = tableFileState(doc);
  state.dirty = true;
  state.revision += 1;
}

export function markTableSaved(doc, revision = tableFileState(doc).revision) {
  const state = tableFileState(doc);
  if (state.revision === revision) state.dirty = false;
}

function defineTableFileStateAccessors(doc) {
  for (const field of FILE_STATE_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(doc, field);
    if (descriptor?.get && descriptor?.set) continue;
    Object.defineProperty(doc, field, {
      configurable: true,
      enumerable: true,
      get() {
        return tableFileState(this)[field];
      },
      set(value) {
        tableFileState(this)[field] = field === "dirty" || field === "finalNewline" || field === "largeFileMode" ? Boolean(value) : value;
      }
    });
  }
}
