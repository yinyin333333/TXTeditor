import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT ?? 5173);
const types = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".tsv", "text/plain"],
  [".txt", "text/plain"],
  [".json", "application/json"]
]);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const safePath = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, safePath === "\\" || safePath === "/" ? "index.html" : safePath);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  res.setHeader("Content-Type", types.get(extname(file)) ?? "application/octet-stream");
  createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log(`TXTeditor running at http://localhost:${port}`);
});
