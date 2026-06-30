import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_ROWS = [20000, 200000];
const DEFAULT_COLUMNS = 8;
const BASE_HEADERS = ["id", "code", "name", "level", "rarity", "cost", "enabled", "eol"];
const RARITIES = ["normal", "magic", "rare", "set", "unique"];
const TOKENS = [
  "axe", "bow", "cap", "orb", "rune", "wolf", "fire", "cold",
  "light", "poison", "fast", "slow", "rare", "elite", "skill", "aura"
];

const { rows, columns } = parseArgs(process.argv.slice(2));

for (const rowCount of rows) {
  await writeFixture(rowCount, columns);
}

async function writeFixture(rowCount, columnCount) {
  const out = join(process.cwd(), "fixtures", `d2_${rowCount / 1000}k.tsv`);
  mkdirSync(dirname(out), { recursive: true });
  const stream = createWriteStream(out, { encoding: "utf8" });
  stream.write(headers(columnCount).join("\t"));
  for (let row = 1; row <= rowCount; row++) {
    if (!stream.write(`\r\n${rowValues(row, columnCount).join("\t")}`)) {
      await new Promise((resolve) => stream.once("drain", resolve));
    }
  }
  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on("error", reject);
  });
  console.log(`${out} (${rowCount.toLocaleString()} rows x ${columnCount.toLocaleString()} columns)`);
}

function headers(columnCount) {
  return Array.from({ length: columnCount }, (_, index) => (
    BASE_HEADERS[index] ?? `mod_${String(index + 1).padStart(4, "0")}`
  ));
}

function rowValues(row, columnCount) {
  const values = [
    row,
    `itm${String(row).padStart(6, "0")}`,
    `Generated Row ${row}`,
    row % 99,
    RARITIES[row % RARITIES.length],
    100 + row * 3,
    row % 2,
    0
  ];
  for (let column = values.length; column < columnCount; column++) {
    values.push(randomCell(row, column));
  }
  return values;
}

function randomCell(row, column) {
  const seed = mix(row, column);
  if (column % 11 === 0) return "";
  if (column % 7 === 0) return String(seed % 100000);
  if (column % 5 === 0) return `${TOKENS[seed % TOKENS.length]}${seed % 1000}`;
  return TOKENS[seed % TOKENS.length];
}

function mix(row, column) {
  let value = Math.imul(row ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(column + 1, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

function parseArgs(args) {
  let columns = DEFAULT_COLUMNS;
  const rows = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--cols" || arg === "--columns") {
      columns = positiveInteger(args[++index], "columns");
    } else {
      rows.push(positiveInteger(arg, "rows"));
    }
  }
  if (columns < BASE_HEADERS.length) {
    throw new Error(`columns must be at least ${BASE_HEADERS.length}`);
  }
  return { rows: rows.length ? rows : DEFAULT_ROWS, columns };
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}
