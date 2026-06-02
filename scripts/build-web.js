import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const entry of ["index.html", "src", "fixtures"]) {
  cpSync(join(root, entry), join(dist, entry), { recursive: true });
}
console.log(dist);
