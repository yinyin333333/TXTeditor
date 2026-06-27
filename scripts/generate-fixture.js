import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fixturePathForSize } from "./fixture-names.mjs";

const sizeArg = Number(process.argv[2] ?? 0);
const sizes = sizeArg ? [sizeArg] : [20000, 200000];

const headers = ["id", "code", "name", "level", "rarity", "cost", "enabled", "eol"];

for (const size of sizes) {
  const out = fixturePathForSize(size);
  mkdirSync(dirname(out), { recursive: true });
  const lines = [headers.join("\t")];
  for (let i = 1; i <= size; i++) {
    lines.push([
      i,
      `itm${String(i).padStart(6, "0")}`,
      `Generated Row ${i}`,
      i % 99,
      ["normal", "magic", "rare", "set", "unique"][i % 5],
      100 + i * 3,
      i % 2,
      0
    ].join("\t"));
  }
  writeFileSync(out, lines.join("\r\n"), "utf8");
  console.log(out);
}
