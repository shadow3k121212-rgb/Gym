import { readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const required = [
  "index.html","src/app.js","src/styles.css","src/workout-engine.js","src/data.js","src/storage.js","src/units.js","src/api.js","src/account.js","src/sw.js",
  "package.json","README.md","ARCHITECTURE.md","PRODUCT.md","BETA-RELEASE.md","SECURITY.md",
  "backend/README.md","public/runtime-config.js","backend/openapi.yaml","backend/server.mjs","backend/src/server.js","backend/src/auth.js",
  "backend/src/validation.js","backend/src/repository.js","backend/src/memory-repository.js",
  "backend/migrations/001_initial.sql","backend/migrations/002_auth.sql","backend/migrations/003_seed_exercises.sql","backend/migrations/004_session_idempotency_hash.sql","backend/migrations/005_movement_event_idempotency.sql",
  ".github/workflows/ci.yml"
];
for (const file of required) await access(file);
for (const file of [
  "src/app.js","src/sw.js","src/workout-engine.js","src/data.js","src/storage.js","src/units.js",
  "backend/server.mjs","backend/src/server.js","backend/src/auth.js","backend/src/validation.js",
  "backend/src/repository.js","backend/src/memory-repository.js","backend/scripts/migrate.mjs",
  "scripts/build.mjs","scripts/dev.mjs"
]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (pkg.type !== "module") throw new Error("package.json must use ESM");
const backendPkg = JSON.parse(await readFile("backend/package.json", "utf8"));
if (backendPkg.type !== "module") throw new Error("backend package must use ESM");
console.log("Static integrity + syntax checks passed.");
