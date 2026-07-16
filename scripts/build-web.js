import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildJsonEditor } from "./build-json-editor.js";

const root = process.cwd();
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const entry of ["index.html", "src", "fixtures"]) {
  const src = join(root, entry);
  if (existsSync(src)) cpSync(src, join(dist, entry), { recursive: true });
}
await buildJsonEditor({
  outfile: join(dist, "generated", "codemirror-json-editor.js"),
  minify: true,
  sourcemap: false
});
console.log(dist);
