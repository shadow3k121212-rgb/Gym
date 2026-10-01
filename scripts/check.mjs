import { readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const required = ["index.html","src/app.js","src/styles.css","src/workout-engine.js","src/data.js","src/storage.js","src/sw.js","package.json","README.md","ARCHITECTURE.md","PRODUCT.md","BETA-RELEASE.md","SECURITY.md","backend/README.md","backend/openapi.yaml","backend/migrations/001_initial.sql",".github/workflows/ci.yml"];
for (const file of required) await access(file);

for (const file of ["src/app.js","src/sw.js","src/workout-engine.js","src/data.js","src/storage.js","scripts/build.mjs","scripts/dev.mjs"]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

const pkg = JSON.parse(await readFile("package.json","utf8"));
if (pkg.type !== "module") throw new Error("package.json must use ESM");
console.log("Static integrity + syntax checks passed.");
