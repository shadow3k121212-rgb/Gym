import { readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const required = [
  "index.html","src/app.js","src/styles.css","src/workout-engine.js","src/data.js","src/storage.js","src/sync-queue.js","src/units.js","src/history-sync.js","src/api.js","src/account.js","src/sw.js",
  "package.json","README.md","ARCHITECTURE.md","PRODUCT.md","BETA-RELEASE.md","SECURITY.md",
  "backend/README.md","public/runtime-config.js","backend/openapi.yaml","backend/server.mjs","backend/src/server.js","backend/src/auth.js",
  "backend/src/validation.js","backend/src/pagination.js","backend/src/repository.js","backend/src/memory-repository.js",
  "backend/migrations/001_initial.sql","backend/migrations/002_auth.sql","backend/migrations/003_seed_exercises.sql","backend/migrations/004_session_idempotency_hash.sql","backend/migrations/005_movement_event_idempotency.sql","backend/migrations/006_movement_event_reps.sql","backend/migrations/007_auth_sessions.sql","backend/migrations/008_password_reset.sql","backend/migrations/009_account_deletion_audit.sql",
  ".github/workflows/ci.yml"
];
for (const file of required) await access(file);
const appSource = await readFile("src/app.js", "utf8");
if (/(^|[^$])\$\([^)]*\)\.forEach/.test(appSource)) {
  throw new Error("Use $$() for selector collections; $() returns one element.");
}

for (const file of [
  "src/app.js","src/sw.js","src/workout-engine.js","src/data.js","src/storage.js","src/sync-queue.js","src/units.js","src/history-sync.js",
  "backend/server.mjs","backend/src/server.js","backend/src/auth.js","backend/src/validation.js",
  "backend/src/pagination.js","backend/src/repository.js","backend/src/memory-repository.js","backend/scripts/migrate.mjs","backend/scripts/verify-schema.mjs",
  "scripts/build.mjs","scripts/dev.mjs"
]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (pkg.type !== "module") throw new Error("package.json must use ESM");
const backendPkg = JSON.parse(await readFile("backend/package.json", "utf8"));
if (backendPkg.type !== "module") throw new Error("backend package must use ESM");

for (const migration of [
  "backend/migrations/001_initial.sql",
  "backend/migrations/002_auth.sql",
  "backend/migrations/003_seed_exercises.sql",
  "backend/migrations/004_session_idempotency_hash.sql",
  "backend/migrations/005_movement_event_idempotency.sql",
  "backend/migrations/006_movement_event_reps.sql",
  "backend/migrations/007_auth_sessions.sql",
  "backend/migrations/008_password_reset.sql",
  "backend/migrations/009_account_deletion_audit.sql"
]) {
  const sql = await readFile(migration, "utf8");
  if (/^\s*BEGIN;|\bCOMMIT;\s*$/im.test(sql)) {
    throw new Error(`Migration ${migration} must not own the transaction; migrate.mjs does.`);
  }
}

console.log("Static integrity + syntax checks passed.");
