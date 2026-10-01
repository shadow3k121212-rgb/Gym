import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  const requiredTables = [
    "schema_migrations", "users", "user_preferences", "exercises",
    "workout_plans", "workout_plan_exercises", "workout_sessions",
    "workout_sets", "movement_events", "consents", "auth_sessions"
  ];

  for (const table of requiredTables) {
    const result = await client.query("select 1 from information_schema.tables where table_schema='public' and table_name=$1", [table]);
    if (!result.rowCount) throw new Error("Missing table: " + table);
  }

  const requiredColumns = [
    ["workout_sessions", "completed_at"],
    ["workout_sessions", "idempotency_request_hash"],
    ["movement_events", "reps"],
    ["movement_events", "idempotency_key"],
    ["movement_events", "idempotency_request_hash"],
    ["auth_sessions", "token_hash"],
    ["auth_sessions", "expires_at"],
    ["auth_sessions", "revoked_at"],
    ["auth_sessions", "family_id"]
  ];

  for (const [table, column] of requiredColumns) {
    const result = await client.query("select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2", [table, column]);
    if (!result.rowCount) throw new Error("Missing column: " + table + "." + column);
  }

  const indexes = await client.query("select indexname from pg_indexes where schemaname='public' and indexname in ($1,$2)", ["workout_sessions_user_idempotency_idx", "movement_events_session_idempotency_idx"]);
  if (indexes.rowCount !== 2) throw new Error("Required idempotency indexes are missing.");

  const migrations = await client.query("select version from schema_migrations order by version");
  const versions = migrations.rows.map((row) => row.version);
  const expected = ["001", "002", "003", "004", "005", "006", "007"];
  if (JSON.stringify(versions) !== JSON.stringify(expected)) throw new Error("Unexpected migration ledger: " + versions.join(","));

  console.log("Database schema verification passed.");
} finally {
  client.release();
  await pool.end();
}
