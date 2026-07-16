import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDir);

export async function buildJsonEditor({
  outfile = join(root, "generated", "codemirror-json-editor.js"),
  minify = false,
  sourcemap = !minify
} = {}) {
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [join(root, "src", "ui", "codemirror-json-editor-entry.js")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    minify,
    sourcemap,
    legalComments: "none"
  });
  return outfile;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const production = process.argv.includes("--production");
  buildJsonEditor({ minify: production, sourcemap: !production })
    .then((outfile) => console.log(outfile))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
