import { cp, mkdir, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/src", { recursive: true });
await mkdir("dist/public", { recursive: true });
await cp("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });
await cp("public", "dist/public", { recursive: true });
await writeFile("dist/version.txt", "GYM foundation 0.1.0\n", "utf8");
console.log("Built dist/");
