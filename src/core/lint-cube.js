import { clean, normalizeToken } from "./lint-table.js";

const CUBE_INPUT_FLAG_MODIFIERS = new Set([
  "low", "nor", "hiq", "mag", "rar", "set", "uni", "crf", "tmp", "eth",
  "noe", "nos", "upg", "nru", "bas", "exc", "eli", "id", "sock"
]);

const CUBE_OUTPUT_FLAG_MODIFIERS = new Set([
  "low", "nor", "hiq", "mag", "set", "rar", "uni", "crf", "tmp", "eth",
  "mod", "uns", "rem", "reg", "exc", "eli", "rep", "rch"
]);
const CUBE_OUTPUT_PARAMETER_MODIFIERS = new Set(["qty", "pre", "suf", "sock", "lvl"]);

export function cubeInputCount(raw) {
  return parseCubeInput(raw).effectiveQty;
}

// Cube input tokens are intentionally not trimmed or case-folded. The game
// accepts an optional exact outer quote and both qty=N and qty,N, then keeps a
// successfully parsed prefix when a later modifier is not recognized.
export function parseCubeInput(value) {
  const source = String(value ?? "");
  if (!source) return { raw: "", formula: "", code: "", qualifiers: [], qty: null, storedQty: 0, effectiveQty: 1, ignoredSuffix: null };
  const formula = exactOuterUnquote(source);
  const parts = formula.split(",");
  const qualifiers = [];
  let index = 0;
  let qty = null;
  let code = "";
  let ignoredSuffix = null;

  const leadingQty = parseInputQty(parts, index);
  if (leadingQty) {
    qty = leadingQty.value;
    qualifiers.push(leadingQty.raw);
    index += leadingQty.consumed;
  }
  code = parts[index] ?? "";
  index += 1;

  for (; index < parts.length; index += 1) {
    const token = parts[index];
    const parsedQty = parseInputQty(parts, index);
    if (parsedQty) {
      qty = parsedQty.value;
      qualifiers.push(parsedQty.raw);
      index += parsedQty.consumed - 1;
      continue;
    }
    if (CUBE_INPUT_FLAG_MODIFIERS.has(token)) {
      qualifiers.push(token);
      continue;
    }
    if (token.startsWith("sock=")) qualifiers.push("sock");
    ignoredSuffix = {
      raw: parts.slice(index).join(","),
      token,
      reason: token === "" ? "empty-modifier" : "unknown-modifier"
    };
    break;
  }

  const storedQty = unsignedByteValue(qty);
  return {
    raw: source,
    formula,
    code,
    qualifiers,
    qty,
    storedQty,
    effectiveQty: storedQty || 1,
    ignoredSuffix
  };
}

export function parseCubeItem(value) {
  const raw = clean(value);
  if (!raw) return { raw: "", code: "", qualifiers: [], qty: null };
  const quoted = raw.match(/"(.+)"/);
  const formula = quoted ? quoted[1] : raw;
  const parts = formula.split(",").map((part) => clean(part)).filter(Boolean);
  let code = parts[0] ?? "";
  const qualifiers = [];
  let qty = null;
  if (/^qty=\d+$/i.test(code)) {
    qty = Number(code.split("=")[1]);
    code = parts[1] ?? "";
    qualifiers.push(normalizeToken(parts[0]));
    qualifiers.push(...parts.slice(2).map(normalizeToken));
  } else {
    qualifiers.push(...parts.slice(1).map(normalizeToken));
  }
  for (const qualifier of qualifiers) {
    if (/^qty=\d+$/.test(qualifier)) qty = Number(qualifier.split("=")[1]);
  }
  return { raw, code, qualifiers, qty };
}

// Cube outputs use a different binary decoder from inputs. In particular, the
// output decoder keeps modifier spelling/spacing exact and accepts both `=` and
// the following comma token as the parameter separator.
export function parseCubeOutput(value) {
  const source = String(value ?? "");
  if (!source) return { raw: "", formula: "", code: "", modifiers: [], ignoredSuffix: null };
  const formula = exactOuterUnquote(source);
  const parts = formula.split(",");
  const code = parts[0] ?? "";
  const modifiers = [];
  let ignoredSuffix = null;

  for (let index = 1; index < parts.length; index += 1) {
    const token = parts[index];
    const equalsIndex = token.indexOf("=");
    const hasEqualsParameter = equalsIndex >= 0;
    const name = hasEqualsParameter ? token.slice(0, equalsIndex) : token;

    if (CUBE_OUTPUT_PARAMETER_MODIFIERS.has(name)) {
      if (hasEqualsParameter) {
        const parameter = token.slice(equalsIndex + 1);
        if (!parameter) {
          ignoredSuffix = ignoredOutputSuffix(parts, index, "missing-parameter");
          break;
        }
        modifiers.push({ raw: token, name, value: parameter, separator: "=" });
        continue;
      }

      const parameter = parts[index + 1];
      if (parameter === undefined || parameter === "") {
        ignoredSuffix = ignoredOutputSuffix(parts, index, "missing-parameter");
        break;
      }
      modifiers.push({ raw: `${token},${parameter}`, name, value: parameter, separator: "," });
      index += 1;
      continue;
    }

    if (!hasEqualsParameter && CUBE_OUTPUT_FLAG_MODIFIERS.has(name)) {
      modifiers.push({ raw: token, name, value: null, separator: null });
      continue;
    }

    ignoredSuffix = ignoredOutputSuffix(parts, index, "unknown-modifier");
    break;
  }

  return { raw: source, formula, code, modifiers, ignoredSuffix };
}

export function inputColumns(row, table) {
  const values = [];
  for (let index = 1; index <= 7; index += 1) {
    const columnName = `input ${index}`;
    if (table.hasColumn(columnName) && String(row.get(columnName) ?? "") !== "") values.push(columnName);
  }
  return values;
}

function exactOuterUnquote(value) {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) return value.slice(1, -1);
  return value;
}

function parseInputQty(parts, index) {
  const token = parts[index];
  if (token?.startsWith("qty=")) return { raw: token, value: token.slice(4), consumed: 1 };
  if (token === "qty" && parts[index + 1] !== undefined) return { raw: `${token},${parts[index + 1]}`, value: parts[index + 1], consumed: 2 };
  return null;
}

function unsignedByteValue(value) {
  if (!/^[0-9]+$/.test(String(value ?? ""))) return 0;
  return Number(BigInt(value) % 256n);
}

function ignoredOutputSuffix(parts, index, reason) {
  return {
    raw: parts.slice(index).join(","),
    token: parts[index],
    reason
  };
}
