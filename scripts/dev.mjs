import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { join, normalize } from "node:path";

const root = process.cwd();
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".webmanifest":"application/manifest+json", ".txt":"text/plain" };

createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  const safe = normalize(join(root, pathname === "/" ? "index.html" : pathname.slice(1)));
  if (!safe.startsWith(root)) { res.writeHead(403); return res.end("Forbidden"); }
  try {
    const stat = statSync(safe);
    if (!stat.isFile()) throw new Error("not a file");
    res.writeHead(200, {"Content-Type": mime[Object.keys(mime).find((k) => safe.endsWith(k))] || "application/octet-stream"});
    createReadStream(safe).pipe(res);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}).listen(Number(process.env.PORT || 4173), () => console.log(`GYM running at http://localhost:${Number(process.env.PORT || 4173)}`));
