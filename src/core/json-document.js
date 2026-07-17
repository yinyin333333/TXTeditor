export class JsonDocument {
  constructor(name = "Untitled.json", text = "", meta = {}) {
    this.kind = "json";
    this.name = name;
    this.path = meta.path ?? "";
    this.handle = meta.handle ?? null;
    this.encoding = meta.encoding ?? "utf-8";
    this.text = String(text ?? "");
    this.dirty = Boolean(meta.dirty);
    this.revision = Math.max(0, Math.floor(Number(meta.revision) || 0));
    this.savedRevision = this.dirty ? Math.max(0, this.revision - 1) : this.revision;
    this.editorState = null;
    this.activeDiagnosticId = null;
    this.externalChange = null;
    this.lastObservedDiskExists = true;
    this.lastObservedDiskText = this.text;
    this.lastObservedDiskEncoding = this.encoding;
    this.lastWrittenText = this.text;
    this.lastWrittenEncoding = this.encoding;
    this.pendingWriteText = null;
    this.pendingWriteEncoding = null;
    this.refreshTextMetadata();
  }

  static fromText(name, text, meta = {}) {
    return new JsonDocument(name, text, meta);
  }

  snapshotTextChunks() {
    return [this.text];
  }

  toText() {
    return this.text;
  }

  applyEditorText(text) {
    const next = String(text ?? "");
    if (next === this.text) return false;
    this.text = next;
    this.revision += 1;
    this.dirty = true;
    this.externalChange = null;
    this.refreshTextMetadata();
    return true;
  }

  markSaved(revision, { text = this.text, encoding = this.encoding } = {}) {
    this.lastWrittenText = String(text ?? "");
    this.lastWrittenEncoding = encoding || this.encoding;
    this.observeDiskState({
      exists: true,
      text: this.lastWrittenText,
      encoding: this.lastWrittenEncoding
    });
    this.pendingWriteText = null;
    this.pendingWriteEncoding = null;
    if (this.revision === revision) {
      this.savedRevision = revision;
      this.dirty = false;
    }
  }

  beginWrite({ text = this.text, encoding = this.encoding } = {}) {
    this.pendingWriteText = String(text ?? "");
    this.pendingWriteEncoding = encoding || this.encoding;
  }

  cancelWrite() {
    this.pendingWriteText = null;
    this.pendingWriteEncoding = null;
  }

  reloadFromDisk(text, { encoding = this.encoding } = {}) {
    this.text = String(text ?? "");
    this.encoding = encoding || this.encoding;
    this.revision += 1;
    this.savedRevision = this.revision;
    this.dirty = false;
    this.editorState = null;
    this.activeDiagnosticId = null;
    this.externalChange = null;
    this.lastWrittenText = this.text;
    this.lastWrittenEncoding = this.encoding;
    this.observeDiskState({ exists: true, text: this.text, encoding: this.encoding });
    this.pendingWriteText = null;
    this.pendingWriteEncoding = null;
    this.refreshTextMetadata();
  }

  observeDiskState({ exists = true, text = null, encoding = this.encoding } = {}) {
    this.lastObservedDiskExists = Boolean(exists);
    if (!this.lastObservedDiskExists) {
      this.lastObservedDiskText = null;
      this.lastObservedDiskEncoding = null;
      return;
    }
    if (text != null) this.lastObservedDiskText = String(text);
    this.lastObservedDiskEncoding = encoding || this.encoding;
  }

  matchesObservedDiskState({ exists = true, text = null, encoding = this.encoding } = {}) {
    const sourceExists = Boolean(exists);
    if (sourceExists !== this.lastObservedDiskExists) return false;
    if (!sourceExists) return true;
    return text != null
      && String(text) === this.lastObservedDiskText
      && (encoding || this.encoding) === this.lastObservedDiskEncoding;
  }

  noteExternalChange(payload) {
    this.externalChange = payload;
  }

  keepLocalAfterExternalChange(payload = this.externalChange) {
    if (payload) {
      this.observeDiskState({
        exists: payload.deleted !== true,
        text: payload.text,
        encoding: payload.encoding || this.encoding
      });
    }
    this.externalChange = null;
    this.dirty = true;
  }

  refreshTextMetadata() {
    this.lineEnding = detectLineEnding(this.text);
    this.finalNewline = /(?:\r\n|\r|\n)$/.test(this.text);
    this.hasBom = String(this.encoding).toLowerCase() === "utf-8-bom";
  }
}

export function detectLineEnding(text) {
  const source = String(text ?? "");
  const crlf = source.indexOf("\r\n");
  const lf = source.indexOf("\n");
  const cr = source.indexOf("\r");
  if (crlf >= 0 && (lf < 0 || crlf <= lf) && (cr < 0 || crlf <= cr)) return "\r\n";
  if (lf >= 0 && (cr < 0 || lf < cr)) return "\n";
  if (cr >= 0) return "\r";
  return "\n";
}

export function lspRangeToJsonOffsets(text, range = {}) {
  const source = String(text ?? "");
  const start = lspPositionToJsonOffset(source, range.start ?? range);
  const end = lspPositionToJsonOffset(source, range.end ?? range.start ?? range);
  return { start, end: Math.max(start, end) };
}

export function lspPositionToJsonOffset(text, position = {}) {
  const source = String(text ?? "");
  const targetLine = Math.max(0, Math.floor(Number(position.line) || 0));
  const targetCharacter = Math.max(0, Math.floor(Number(position.character) || 0));
  const starts = jsonLineStarts(source);
  const lineIndex = Math.min(targetLine, Math.max(0, starts.length - 1));
  let start = starts[lineIndex] ?? 0;
  if (lineIndex === 0 && source.startsWith("\u{feff}")) start += 1;
  let end = starts[lineIndex + 1] ?? source.length;
  while (end > start && (source[end - 1] === "\n" || source[end - 1] === "\r")) end -= 1;
  return start + Math.min(targetCharacter, end - start);
}

function jsonLineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\r") {
      if (text[index + 1] === "\n") index += 1;
      starts.push(index + 1);
    } else if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}
