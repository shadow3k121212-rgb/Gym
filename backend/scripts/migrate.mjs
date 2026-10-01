import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query("begin");
  await client.query(`create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`);
  const dir = new URL("../migrations/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const version = file.split("_")[0];
    const existing = await client.query("select 1 from schema_migrations where version=$1", [version]);
    if (existing.rowCount) continue;
    const sql = await readFile(join(dir.pathname, file), "utf8");
    await client.query(sql);
    await client.query("insert into schema_migrations(version) values ($1)", [version]);
    console.log(`applied ${file}`);
  }
  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
