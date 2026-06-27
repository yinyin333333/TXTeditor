const tableFileStates = new WeakMap();

const FILE_STATE_FIELDS = ["name", "path", "fileKey", "handle", "lineEnding", "finalNewline", "encoding", "dirty"];

export function resetTableFileState(doc, name = "Untitled.txt", meta = {}) {
  const state = {
    name,
    path: meta.path ?? "",
    fileKey: meta.fileKey ?? "",
    handle: meta.handle ?? null,
    lineEnding: meta.lineEnding ?? "\n",
    finalNewline: meta.finalNewline ?? false,
    encoding: meta.encoding ?? "utf-8",
    dirty: meta.dirty ?? false
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
  tableFileState(doc).dirty = true;
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
        tableFileState(this)[field] = field === "dirty" || field === "finalNewline" ? Boolean(value) : value;
      }
    });
  }
}
