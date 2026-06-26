export function estimateTextWidth(value) {
  let width = 0;
  for (const char of String(value)) {
    if (char === "\t") width += 16;
    else if (char === " " || char === "." || char === "," || char === "'" || char === "`") width += 4;
    else if (/[A-Z0-9_@#%&]/.test(char)) width += 8;
    else if (char.charCodeAt(0) > 0x7f) width += 12;
    else width += 7;
  }
  return width;
}

export function initialHeaderColumnWidth(header, { min = 56, max = 420, padding = 24 } = {}) {
  return clampValue(Math.ceil(estimateTextWidth(header) + padding), min, max);
}

export function autoFitColumnWidth(rows = [], column = 0, sampleLimit = 300, { min = 72, max = 420, padding = 28, charWidth = 8 } = {}) {
  let width = min;
  const last = Math.min(rows.length, sampleLimit);
  for (let row = 0; row < last; row += 1) {
    width = Math.max(width, padding + String(rows[row]?.[column] ?? "").length * charWidth);
  }
  return Math.min(max, width);
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
