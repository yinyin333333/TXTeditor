import {
  diagnosticMarkerState,
  diagnosticTextOverlayPlan
} from "../grid-render-policy.js";
import { tText } from "../../core/i18n.js";

const CALCULATION_LIMIT = 255;

export function unicodeCharacterCount(value) {
  return [...String(value ?? "")].length;
}

export function calculationMetadata(metadata) {
  const maxLength = Number(metadata?.maxLength);
  return metadata?.fieldType === "parse" && maxLength === CALCULATION_LIMIT
    ? { maxLength }
    : null;
}

export function createCellInputController({
  els,
  grid,
  activeDoc,
  hasOpenDocument,
  applyEdits,
  resolveFieldMetadata = async () => undefined,
  metadataRevision = () => "",
  focusGrid = () => grid.host?.focus?.()
}) {
  const metadataCache = new WeakMap();
  const metadataPending = new WeakMap();
  let metadataRequest = 0;
  let metadata = null;
  let editing = null;
  let dirty = false;

  function cell() {
    const doc = activeDoc();
    if (!hasOpenDocument() || doc?.kind !== "table") return null;
    const row = Math.max(0, Math.min(doc.rowCount - 1, grid.selection.focus.row));
    const column = Math.max(0, Math.min(doc.columnCount - 1, grid.selection.focus.column));
    return { doc, row, column };
  }

  function valueFor(active) {
    const directEdit = grid.editingCell?.();
    if (directEdit?.row === active.row && directEdit?.column === active.column) {
      return grid.editor.value;
    }
    return active.doc.getCell(active.row, active.column);
  }

  function sameCell(left, right) {
    return left?.doc === right?.doc && left?.row === right?.row && left?.column === right?.column;
  }

  function metadataKey(active) {
    return `${String(metadataRevision())}\u001f${active.column}\u001f${active.doc.getCell(0, active.column)}`;
  }

  function mapFor(store, doc) {
    let map = store.get(doc);
    if (!map) {
      map = new Map();
      store.set(doc, map);
    }
    return map;
  }

  async function updateMetadata(active) {
    metadata = null;
    const request = ++metadataRequest;
    if (!active || active.row === 0) return updateCounter();
    const key = metadataKey(active);
    const cache = mapFor(metadataCache, active.doc);
    if (cache.has(key)) {
      metadata = cache.get(key);
      updateCounter();
      return;
    }
    const pending = mapFor(metadataPending, active.doc);
    let task = pending.get(key);
    if (!task) {
      const columnName = active.doc.getCell(0, active.column);
      task = resolveFieldMetadata(active.doc, columnName)
        .catch(() => undefined)
        .finally(() => pending.delete(key));
      pending.set(key, task);
    }
    const result = await task;
    if (result !== undefined) cache.set(key, result);
    if (request !== metadataRequest || !sameCell(active, cell())) return;
    metadata = result ?? null;
    updateCounter();
  }

  function updateAddress(active) {
    const header = active.doc.getCell(0, active.column) || `C${active.column + 1}`;
    els.cellInputAddress.textContent = tText("cellInput.location", {
      row: active.row + 1,
      column: active.column + 1,
      header
    });
    els.cellInputAddress.title = header;
  }

  function updateCounter() {
    const calc = calculationMetadata(metadata);
    const visible = Boolean(calc && cell()?.row > 0);
    els.cellInputCount.classList.toggle("hidden", !visible);
    els.cellInputCount.classList.remove("over-limit");
    els.cellInput.removeAttribute("aria-describedby");
    if (!visible) {
      els.cellInputCount.textContent = "";
      els.cellInputCount.removeAttribute("title");
      return;
    }
    const current = unicodeCharacterCount(els.cellInput.value);
    els.cellInputCount.textContent = `${current}/${calc.maxLength}`;
    els.cellInputCount.setAttribute("aria-label", tText("cellInput.count", {
      current,
      limit: calc.maxLength
    }));
    if (current > calc.maxLength) {
      const warning = tText("cellInput.overLimit", { over: current - calc.maxLength });
      els.cellInputCount.classList.add("over-limit");
      els.cellInputCount.title = warning;
      els.cellInput.setAttribute("aria-describedby", els.cellInputCount.id);
    } else {
      els.cellInputCount.removeAttribute("title");
    }
  }

  function diagnosticColor(name) {
    const vars = {
      diagnosticRangeError: "--grid-diagnostic-range-error",
      diagnosticRangeWarning: "--grid-diagnostic-range-warning",
      diagnosticRangeInfo: "--grid-diagnostic-range-info",
      diagnosticInsertionCaretError: "--grid-diagnostic-insertion-caret-error",
      diagnosticInsertionCaretWarning: "--grid-diagnostic-insertion-caret-warning",
      diagnosticInsertionCaretInfo: "--grid-diagnostic-insertion-caret-info"
    };
    return getComputedStyle(document.documentElement).getPropertyValue(vars[name] ?? "").trim() || "#cca700";
  }

  function drawDiagnostics() {
    const active = cell();
    const canvas = els.cellInputDiagnostics;
    const input = els.cellInput;
    if (!active || els.cellInputBar.classList.contains("hidden")) return;
    const rect = input.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const scale = Math.max(1, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const diagnostics = grid.diagnosticsByCell?.get(`${active.row}:${active.column}`) ?? [];
    if (!diagnostics.length) return;
    const marker = diagnosticMarkerState(diagnostics, { x: 0, y: 0, width, height });
    if (marker) {
      ctx.fillStyle = marker.color;
      ctx.beginPath();
      ctx.moveTo(...marker.points[0]);
      ctx.lineTo(...marker.points[1]);
      ctx.lineTo(...marker.points[2]);
      ctx.closePath();
      ctx.fill();
    }
    const style = getComputedStyle(input);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 8;
    const plan = diagnosticTextOverlayPlan({
      diagnostics,
      value: input.value,
      active: true,
      textX: paddingLeft - input.scrollLeft,
      cellY: 0,
      cellHeight: height,
      maxWidth: Number.MAX_SAFE_INTEGER,
      measureText: (text) => ctx.measureText(String(text ?? "")).width
    });
    if (!plan) return;
    ctx.strokeStyle = diagnosticColor(plan.color);
    ctx.lineWidth = plan.lineWidth;
    ctx.beginPath();
    if (plan.kind === "insertion") {
      ctx.moveTo(plan.x, plan.top);
      ctx.lineTo(plan.x, plan.bottom);
    } else {
      ctx.moveTo(plan.x, plan.y);
      ctx.lineTo(plan.x + plan.width, plan.y);
    }
    ctx.stroke();
  }

  function refresh({ force = false } = {}) {
    const active = cell();
    els.cellInputBar.classList.toggle("hidden", !active);
    if (!active) {
      editing = null;
      dirty = false;
      metadata = null;
      grid.setCellInputPreview?.(null);
      return;
    }
    updateAddress(active);
    const ownsInput = document.activeElement === els.cellInput && sameCell(editing, active);
    if (force || !ownsInput) {
      els.cellInput.value = valueFor(active);
      if (!ownsInput) {
        editing = null;
        dirty = false;
        grid.setCellInputPreview?.(null);
      }
    }
    updateMetadata(active);
    updateCounter();
    requestAnimationFrame(drawDiagnostics);
  }

  function beginEdit() {
    grid.commitEdit?.();
    const active = cell();
    if (!active) return;
    editing = { ...active, original: active.doc.getCell(active.row, active.column) };
    dirty = false;
  }

  function commit() {
    if (!editing) return false;
    const target = editing;
    const value = els.cellInput.value;
    editing = null;
    grid.setCellInputPreview?.(null);
    if (dirty && target.doc === activeDoc()) {
      applyEdits([{ row: target.row, column: target.column, value }], "Edit Cell");
    }
    dirty = false;
    refresh({ force: true });
    return true;
  }

  function cancel() {
    if (!editing) return false;
    const original = editing.original;
    editing = null;
    dirty = false;
    grid.setCellInputPreview?.(null);
    els.cellInput.value = original;
    updateCounter();
    drawDiagnostics();
    return true;
  }

  function handleInput() {
    const active = cell();
    if (!sameCell(editing, active)) beginEdit();
    if (!editing) return;
    dirty = els.cellInput.value !== editing.original;
    grid.setCellInputPreview?.({
      row: editing.row,
      column: editing.column,
      value: els.cellInput.value
    });
    updateCounter();
    drawDiagnostics();
  }

  function selectTextRange(start, end) {
    const active = cell();
    if (!active) return false;
    refresh();
    els.cellInput.focus();
    const safeStart = Math.max(0, Math.min(els.cellInput.value.length, Number(start) || 0));
    const safeEnd = Math.max(safeStart, Math.min(els.cellInput.value.length, Number(end) || safeStart));
    els.cellInput.setSelectionRange(safeStart, safeEnd);
    return true;
  }

  els.cellInput.addEventListener("focus", beginEdit);
  els.cellInput.addEventListener("input", handleInput);
  els.cellInput.addEventListener("scroll", drawDiagnostics);
  els.cellInput.addEventListener("blur", commit);
  els.cellInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      focusGrid();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      focusGrid();
    }
  });
  globalThis.addEventListener?.("resize", drawDiagnostics);
  globalThis.document?.addEventListener?.("txteditor-locale-changed", () => refresh());
  if (typeof ResizeObserver === "function") new ResizeObserver(drawDiagnostics).observe(els.cellInput);

  return {
    cancel,
    commit,
    drawDiagnostics,
    refresh,
    selectTextRange
  };
}
