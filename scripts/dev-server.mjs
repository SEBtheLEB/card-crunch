import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..", "dist");
const port = Math.max(1, Number(process.env.PORT) || 4183);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://localhost:${port}`);
    const requested = decodeURIComponent(url.pathname);
    const candidate = resolve(root, `.${requested === "/" ? "/index.html" : requested}`);
    const safeCandidate = candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : "";
    let file = safeCandidate;
    if (!file || !await isFile(file)) file = resolve(root, "index.html");
    const body = await readFile(file);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes[extname(file).toLowerCase()] || "application/octet-stream"
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Card Crunch dev server error: ${error.message}`);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Card Crunch available at http://localhost:${port}`);
});

async function isFile(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}
