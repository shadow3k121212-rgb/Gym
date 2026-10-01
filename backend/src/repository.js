import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";

const idempotencyHash = (input) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

export class PostgresRepository {
  constructor(config = {}) {
    this.pool = new Pool({
      connectionString: config.connectionString ?? process.env.DATABASE_URL,
      max: Number(config.maxConnections ?? process.env.DB_POOL_MAX ?? 10),
      ssl: config.ssl ?? (process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined)
    });
  }

  async close() {
    await this.pool.end();
  }

  async health() {
    const result = await this.pool.query("select 1 as ok");
    return result.rows[0].ok === 1;
  }

  async createUser({ email, passwordHash, passwordSalt }) {
    const result = await this.pool.query(
      "insert into users (id, email, password_hash, password_salt) values ($1,$2,$3,$4) returning id,email,created_at",
      [randomUUID(), email, passwordHash, passwordSalt]
    );
    return result.rows[0];
  }

  async getUserByEmail(email) {
    const result = await this.pool.query(
      "select id,email,password_hash,password_salt,status from users where email=$1 limit 1",
      [email]
    );
    return result.rows[0] ?? null;
  }

  async getUserById(userId) {
    const result = await this.pool.query(
      "select id,email,created_at,status from users where id=$1 limit 1",
      [userId]
    );
    return result.rows[0] ?? null;
  }

  async createSession(userId, input, idempotencyKey) {
    const client = await this.pool.connect();
    const requestHash = idempotencyHash(input);
    try {
      await client.query("begin");
      const inserted = await client.query(
        `insert into workout_sessions
          (id,user_id,name,source,started_at,completed_at,idempotency_key,idempotency_request_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (user_id,idempotency_key) do nothing
         returning id,name,started_at,completed_at,source,idempotency_request_hash`,
        [input.id,userId,input.name,input.source,input.startedAt,input.completedAt,idempotencyKey,requestHash]
      );

      if (!inserted.rowCount) {
        const existing = await client.query(
          `select id,name,started_at,completed_at,source,idempotency_request_hash
           from workout_sessions
           where user_id=$1 and idempotency_key=$2
           for update`,
          [userId, idempotencyKey]
        );
        if (!existing.rowCount) throw new Error("Idempotency replay could not be resolved.");
        const row = existing.rows[0];
        if (row.idempotency_request_hash && row.idempotency_request_hash !== requestHash) {
          const error = new Error("Idempotency key was already used with a different request payload.");
          error.code = "IDEMPOTENCY_CONFLICT";
          throw error;
        }
        if (!row.idempotency_request_hash) {
          await client.query("update workout_sessions set idempotency_request_hash=$1 where id=$2", [requestHash, row.id]);
        }
        await client.query("commit");
        return { existing: true, session: row };
      }

      for (const exercise of input.exercises) {
        for (const set of exercise.sets) {
          await client.query(
            "insert into workout_sets (id,session_id,exercise_id,set_index,reps,load_value,load_unit,completed_at,rpe) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [randomUUID(),input.id,exercise.exerciseId,set.index,set.reps,set.weightKg,"kg",set.completedAt,set.rpe]
          );
        }
      }

      const session = inserted.rows[0];
      await client.query("commit");
      return { existing: false, session };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listSessions(userId, limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const result = await this.pool.query(
      `select ws.id,ws.name,ws.source,ws.started_at,ws.completed_at,
        coalesce(sum(case when wset.completed_at is not null then wset.reps*wset.load_value else 0 end),0) as volume,
        count(wset.id) filter (where wset.completed_at is not null) as completed_sets
       from workout_sessions ws
       left join workout_sets wset on wset.session_id=ws.id
       where ws.user_id=$1
       group by ws.id
       order by ws.started_at desc
       limit $2`,
      [userId, safeLimit]
    );
    return result.rows;
  }

  async createMovementEvent(userId, event) {
    const result = await this.pool.query(
      `insert into movement_events
       (id,session_id,exercise_id,schema_version,source,occurred_at,confidence,model,metrics_json)
       select $1,$2,$3,$4,$5,$6,$7,$8,$9
       where exists (select 1 from workout_sessions where id=$2 and user_id=$10)
       returning id,session_id,exercise_id,schema_version,source,occurred_at,confidence,model,metrics_json`,
      [randomUUID(),event.sessionId,event.exerciseId,event.schemaVersion,event.source,event.timestamp,event.confidence,event.model,event.metrics,userId]
    );
    if (!result.rowCount) {
      const error = new Error("Session not found.");
      error.code = "NOT_FOUND";
      throw error;
    }
    return result.rows[0];
  }
}
