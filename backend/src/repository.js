import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { encodeSessionCursor } from "./pagination.js";

const idempotencyHash = (input) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

export class PostgresRepository {
  constructor(config = {}) {
    this.pool = new Pool({
      connectionString: config.connectionString ?? process.env.DATABASE_URL,
      max: Number(config.maxConnections ?? process.env.DB_POOL_MAX ?? 10),
      ssl: config.ssl ?? (process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" }
        : undefined)
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

  async listTenantsForUser(userId) {
    const result = await this.pool.query(
      `select t.id,t.name,t.slug,t.kind,t.status as tenant_status,
        tm.role,tm.status as membership_status,t.created_at
       from tenant_memberships tm
       join tenants t on t.id=tm.tenant_id
       where tm.user_id=$1 and tm.status='active' and t.status='active'
       order by case when t.kind='personal' then 0 else 1 end, t.created_at asc, t.id asc`,
      [userId]
    );
    return result.rows;
  }

  async createGymTenant(userId, { name, slug }) {
    const client = await this.pool.connect();
    const id = randomUUID();
    try {
      await client.query("begin");
      const result = await client.query(
        `insert into tenants (id,name,slug,kind,status,created_by_user_id)
         values ($1,$2,$3,'gym','active',$4)
         returning id,name,slug,kind,status as tenant_status,created_at`,
        [id,name,slug,userId]
      );
      await client.query(
        `insert into tenant_memberships (tenant_id,user_id,role,status)
         values ($1,$2,'owner','active')`,
        [id,userId]
      );
      await client.query("commit");
      return {
        ...result.rows[0],
        role:"owner",
        membership_status:"active"
      };
    } catch (error) {
      await client.query("rollback");
      if (error?.code === "23505" && error?.constraint === "tenants_slug_key") {
        const conflict = new Error("Workspace slug already exists.");
        conflict.code = "TENANT_SLUG_CONFLICT";
        throw conflict;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async createPasswordResetToken({ id, userId, tokenHash, expiresAt }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "update password_reset_tokens set used_at=now() where user_id=$1 and used_at is null",
        [userId]
      );
      const result = await client.query(
        `insert into password_reset_tokens (id,user_id,token_hash,expires_at)
         values ($1,$2,$3,$4)
         returning id,user_id,created_at,expires_at`,
        [id,userId,tokenHash,expiresAt]
      );
      await client.query("commit");
      return result.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async resetPassword(tokenHash, passwordHash, passwordSalt) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const token = await client.query(
        `update password_reset_tokens
         set used_at=now()
         where token_hash=$1 and used_at is null and expires_at > now()
         returning id,user_id`,
        [tokenHash]
      );
      if (!token.rowCount) {
        await client.query("rollback");
        return null;
      }
      const userId = token.rows[0].user_id;
      const user = await client.query(
        "update users set password_hash=$1,password_salt=$2,updated_at=now() where id=$3 and status='active' returning id,email,status",
        [passwordHash,passwordSalt,userId]
      );
      if (!user.rowCount) {
        await client.query("rollback");
        return null;
      }
      await client.query(
        "update auth_sessions set revoked_at=coalesce(revoked_at,now()), revocation_reason=coalesce(revocation_reason,'password-reset') where user_id=$1 and revoked_at is null",
        [userId]
      );
      await client.query("commit");
      return user.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteAccount(userId) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const soleOwnership = await client.query(
        `select t.id,t.name
         from tenants t
         join tenant_memberships tm on tm.tenant_id=t.id
         where tm.user_id=$1 and tm.role='owner' and tm.status='active' and t.kind='gym'
           and not exists (
             select 1 from tenant_memberships other_owner
             where other_owner.tenant_id=t.id and other_owner.role='owner'
               and other_owner.status='active' and other_owner.user_id<>$1
           )
         limit 1
         for update of t`,
        [userId]
      );
      if (soleOwnership.rowCount) {
        await client.query("rollback");
        const error = new Error("Transfer gym workspace ownership before deleting this account.");
        error.code = "TENANT_OWNER_REQUIRED";
        throw error;
      }
      const deleted = await client.query(
        "delete from users where id=$1 returning id",
        [userId]
      );
      if (!deleted.rowCount) {
        await client.query("rollback");
        return false;
      }
      const digest = createHash("sha256").update(userId).digest("hex");
      await client.query(
        "insert into account_deletion_audit (id,event_type,subject_digest) values ($1,'account-deleted',$2)",
        [randomUUID(),digest]
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createAuthSession({ id, familyId, userId, tokenHash, expiresAt }) {
    const result = await this.pool.query(
      `insert into auth_sessions (id,family_id,user_id,token_hash,expires_at)
       values ($1,$2,$3,$4,$5)
       returning id,family_id,user_id,created_at,expires_at,last_seen_at,revoked_at,replaced_by_session_id,revocation_reason`,
      [id,familyId,userId,tokenHash,expiresAt]
    );
    return result.rows[0];
  }

  async getAuthSession(sessionId, userId) {
    const result = await this.pool.query(
      `select id,family_id,user_id,created_at,expires_at,last_seen_at,revoked_at,replaced_by_session_id,revocation_reason
       from auth_sessions where id=$1 and user_id=$2 limit 1`,
      [sessionId,userId]
    );
    return result.rows[0] ?? null;
  }

  async touchAuthSession(sessionId, userId) {
    await this.pool.query(
      "update auth_sessions set last_seen_at=now() where id=$1 and user_id=$2 and revoked_at is null",
      [sessionId,userId]
    );
  }

  async rotateAuthSession(tokenHash, replacement) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query(
        `select id,family_id,user_id,expires_at,revoked_at
         from auth_sessions
         where token_hash=$1
         for update`,
        [tokenHash]
      );
      if (!current.rowCount) {
        await client.query("rollback");
        return { status:"invalid" };
      }

      const row = current.rows[0];
      if (row.revoked_at) {
        await client.query(
          "update auth_sessions set revoked_at=coalesce(revoked_at,now()), revocation_reason=coalesce(revocation_reason,'refresh-token-reuse') where family_id=$1 and revoked_at is null",
          [row.family_id]
        );
        await client.query("commit");
        return { status:"reused" };
      }

      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query(
          "update auth_sessions set revoked_at=now(), revocation_reason='expired' where id=$1 and revoked_at is null",
          [row.id]
        );
        await client.query("commit");
        return { status:"expired" };
      }

      await client.query(
        `insert into auth_sessions (id,family_id,user_id,token_hash,expires_at)
         values ($1,$2,$3,$4,$5)`,
        [replacement.id,row.family_id,row.user_id,replacement.tokenHash,row.expires_at]
      );
      await client.query(
        "update auth_sessions set revoked_at=now(),last_seen_at=now(),replaced_by_session_id=$1,revocation_reason='rotated' where id=$2",
        [replacement.id,row.id]
      );
      await client.query("commit");
      return { status:"rotated", userId:row.user_id, familyId:row.family_id, sessionId:replacement.id, expiresAt:row.expires_at };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeAuthSessionByTokenHash(tokenHash, reason = "logout") {
    const result = await this.pool.query(
      "update auth_sessions set revoked_at=coalesce(revoked_at,now()), revocation_reason=coalesce(revocation_reason,$2) where token_hash=$1 returning id,user_id",
      [tokenHash,reason]
    );
    return result.rows[0] ?? null;
  }

  async revokeAuthSession(userId, sessionId, reason = "user-revoked") {
    const result = await this.pool.query(
      "update auth_sessions set revoked_at=coalesce(revoked_at,now()), revocation_reason=coalesce(revocation_reason,$3) where id=$1 and user_id=$2 returning id,user_id",
      [sessionId,userId,reason]
    );
    return result.rows[0] ?? null;
  }

  async revokeAllAuthSessions(userId, exceptSessionId = null, reason = "logout-all") {
    const params = [userId,reason];
    const condition = exceptSessionId ? "and id <> $3" : "";
    if (exceptSessionId) params.push(exceptSessionId);
    const result = await this.pool.query(
      `update auth_sessions set revoked_at=coalesce(revoked_at,now()), revocation_reason=coalesce(revocation_reason,$2)
       where user_id=$1 and revoked_at is null ${condition}`,
      params
    );
    return result.rowCount;
  }

  async listAuthSessions(userId) {
    const result = await this.pool.query(
      `select id,created_at,expires_at,last_seen_at,revoked_at,revocation_reason,
        case
          when revoked_at is not null then 'revoked'
          when expires_at <= now() then 'expired'
          else 'active'
        end as status
       from auth_sessions where user_id=$1 order by created_at desc`,
      [userId]
    );
    return result.rows;
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
    return (await this.listSessionsPage(userId, { limit })).sessions;
  }

  async listSessionsPage(userId, { limit = 20, before = null } = {}) {
    const params = [userId];
    const conditions = ["ws.user_id = $1"];
    if (before) {
      params.push(before.startedAt, before.id);
      conditions.push("((ws.started_at, ws.id) < ($2::timestamptz, $3::uuid))");
    }
    const limitIndex = params.length + 1;
    params.push(limit + 1);
    const result = await this.pool.query(
      `select ws.id,ws.name,ws.source,ws.started_at,ws.completed_at,
        coalesce(sum(case when wset.completed_at is not null then wset.reps*wset.load_value else 0 end),0) as volume,
        count(wset.id) filter (where wset.completed_at is not null) as completed_sets
       from workout_sessions ws
       left join workout_sets wset on wset.session_id=ws.id
       where ${conditions.join(" and ")}
       group by ws.id
       order by ws.started_at desc, ws.id desc
       limit ${limitIndex}`,
      params
    );
    const hasMore = result.rows.length > limit;
    const sessions = result.rows.slice(0, limit);
    const nextCursor = hasMore && sessions.length
      ? encodeSessionCursor({ startedAt: sessions[sessions.length - 1].started_at, id: sessions[sessions.length - 1].id })
      : null;
    return { sessions, nextCursor };
  }

  async createMovementEvent(userId, event, idempotencyKey) {
    const client = await this.pool.connect();
    const requestHash = idempotencyHash(event);
    try {
      await client.query("begin");
      const inserted = await client.query(
        `insert into movement_events
          (id,session_id,exercise_id,schema_version,source,occurred_at,reps,confidence,model,metrics_json,idempotency_key,idempotency_request_hash)
         select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
         where exists (select 1 from workout_sessions where id=$2 and user_id=$13)
         on conflict (session_id,idempotency_key) do nothing
         returning id,session_id,exercise_id,schema_version,source,occurred_at,reps,confidence,model,metrics_json,idempotency_key,idempotency_request_hash`,
        [randomUUID(),event.sessionId,event.exerciseId,event.schemaVersion,event.source,event.timestamp,event.reps,event.confidence,event.model,event.metrics,idempotencyKey,requestHash,userId]
      );
      if (!inserted.rowCount) {
        const owned = await client.query(
          "select 1 from workout_sessions where id=$1 and user_id=$2",
          [event.sessionId, userId]
        );
        if (!owned.rowCount) {
          const error = new Error("Session not found.");
          error.code = "NOT_FOUND";
          throw error;
        }
        const existing = await client.query(
          `select id,session_id,exercise_id,schema_version,source,occurred_at,reps,confidence,model,metrics_json,idempotency_key,idempotency_request_hash
           from movement_events
           where session_id=$1 and idempotency_key=$2
           for update`,
          [event.sessionId,idempotencyKey]
        );
        if (!existing.rowCount) throw new Error("Movement-event replay could not be resolved.");
        const row = existing.rows[0];
        if (row.idempotency_request_hash && row.idempotency_request_hash !== requestHash) {
          const error = new Error("Idempotency key was already used with a different request payload.");
          error.code = "IDEMPOTENCY_CONFLICT";
          throw error;
        }
        if (!row.idempotency_request_hash) {
          await client.query("update movement_events set idempotency_request_hash=$1 where id=$2", [requestHash,row.id]);
        }
        await client.query("commit");
        return { existing:true, event:row };
      }
      const eventRow=inserted.rows[0];
      await client.query("commit");
      return { existing:false, event:eventRow };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
