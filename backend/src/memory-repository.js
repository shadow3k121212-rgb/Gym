import { createHash, randomUUID } from "node:crypto";
import { encodeSessionCursor } from "./pagination.js";

const idempotencyHash = (input) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

export class MemoryRepository {
  constructor() {
    this.users = new Map();
    this.usersByEmail = new Map();
    this.sessions = new Map();
    this.idempotency = new Map();
    this.events = new Map();
    this.eventIdempotency = new Map();
    this.authSessions = new Map();
    this.authSessionsByToken = new Map();
  }

  async health() { return true; }
  async close() {}

  async createUser({ email, passwordHash, passwordSalt }) {
    if (this.usersByEmail.has(email)) {
      const error = new Error("Email already registered.");
      error.code = "DUPLICATE_EMAIL";
      throw error;
    }
    const user = { id: randomUUID(), email, password_hash: passwordHash, password_salt: passwordSalt, status: "active", created_at: new Date().toISOString() };
    this.users.set(user.id, user);
    this.usersByEmail.set(email, user.id);
    return user;
  }

  async getUserByEmail(email) {
    const id = this.usersByEmail.get(email);
    return id ? this.users.get(id) : null;
  }

  async getUserById(userId) {
    const user = this.users.get(userId);
    return user ? { id:user.id,email:user.email,status:user.status,created_at:user.created_at } : null;
  }

  async createAuthSession({ id, familyId, userId, tokenHash, expiresAt }) {
    const session = {
      id,
      family_id:familyId,
      user_id:userId,
      token_hash:tokenHash,
      created_at:new Date().toISOString(),
      expires_at:expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt,
      last_seen_at:new Date().toISOString(),
      revoked_at:null,
      replaced_by_session_id:null,
      revocation_reason:null
    };
    this.authSessions.set(id, session);
    this.authSessionsByToken.set(tokenHash, id);
    return session;
  }

  async getAuthSession(sessionId, userId) {
    const session = this.authSessions.get(sessionId);
    if (!session || session.user_id !== userId) return null;
    return session;
  }

  async rotateAuthSession(tokenHash, replacement) {
    const id = this.authSessionsByToken.get(tokenHash);
    if (!id) return { status:"invalid" };
    const current = this.authSessions.get(id);
    if (!current) return { status:"invalid" };
    if (current.revoked_at) {
      for (const session of this.authSessions.values()) {
        if (session.family_id === current.family_id && !session.revoked_at) {
          session.revoked_at = new Date().toISOString();
          session.revocation_reason = "refresh-token-reuse";
        }
      }
      return { status:"reused" };
    }
    if (new Date(current.expires_at).getTime() <= Date.now()) {
      current.revoked_at = new Date().toISOString();
      current.revocation_reason = "expired";
      return { status:"expired" };
    }
    const next = await this.createAuthSession({
      id:replacement.id,
      familyId:current.family_id,
      userId:current.user_id,
      tokenHash:replacement.tokenHash,
      expiresAt:replacement.expiresAt
    });
    current.revoked_at = new Date().toISOString();
    current.last_seen_at = new Date().toISOString();
    current.replaced_by_session_id = next.id;
    current.revocation_reason = "rotated";
    return { status:"rotated", userId:current.user_id, familyId:current.family_id, sessionId:next.id };
  }

  async revokeAuthSessionByTokenHash(tokenHash, reason = "logout") {
    const id = this.authSessionsByToken.get(tokenHash);
    if (!id) return null;
    const session = this.authSessions.get(id);
    if (!session) return null;
    session.revoked_at = session.revoked_at || new Date().toISOString();
    session.revocation_reason = session.revocation_reason || reason;
    return { id:session.id, user_id:session.user_id };
  }

  async revokeAuthSession(userId, sessionId, reason = "user-revoked") {
    const session = this.authSessions.get(sessionId);
    if (!session || session.user_id !== userId) return null;
    session.revoked_at = session.revoked_at || new Date().toISOString();
    session.revocation_reason = session.revocation_reason || reason;
    return { id:session.id, user_id:session.user_id };
  }

  async revokeAllAuthSessions(userId, exceptSessionId = null, reason = "logout-all") {
    let count = 0;
    for (const session of this.authSessions.values()) {
      if (session.user_id === userId && !session.revoked_at && session.id !== exceptSessionId) {
        session.revoked_at = new Date().toISOString();
        session.revocation_reason = reason;
        count += 1;
      }
    }
    return count;
  }

  async listAuthSessions(userId) {
    return [...this.authSessions.values()]
      .filter((session) => session.user_id === userId)
      .sort((a,b) => b.created_at.localeCompare(a.created_at))
      .map((session) => ({
        id:session.id,
        created_at:session.created_at,
        expires_at:session.expires_at,
        last_seen_at:session.last_seen_at,
        revoked_at:session.revoked_at,
        revocation_reason:session.revocation_reason
      }));
  }

  async createSession(userId, input, idempotencyKey) {
    const idem = `${userId}:${idempotencyKey}`;
    const requestHash = idempotencyHash(input);
    const existing = this.idempotency.get(idem);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        const error = new Error("Idempotency key was already used with a different request payload.");
        error.code = "IDEMPOTENCY_CONFLICT";
        throw error;
      }
      return { existing:true, session:existing.session };
    }
    if (this.sessions.has(input.id)) {
      const error = new Error("Session already exists.");
      error.code = "23505";
      throw error;
    }
    const session = {
      id:input.id,
      user_id:userId,
      name:input.name,
      source:input.source,
      started_at:input.startedAt,
      completed_at:input.completedAt,
      exercises:input.exercises
    };
    this.sessions.set(session.id, session);
    this.idempotency.set(idem, { session, requestHash });
    return { existing:false, session };
  }

  async listSessions(userId, limit=20) {
    return (await this.listSessionsPage(userId, { limit })).sessions;
  }

  async listSessionsPage(userId, { limit=20, before=null } = {}) {
    let rows = [...this.sessions.values()].filter((s)=>s.user_id===userId);
    rows.sort((a,b) => b.started_at.localeCompare(a.started_at) || b.id.localeCompare(a.id));
    if (before) {
      rows = rows.filter((s) =>
        s.started_at < before.startedAt ||
        (s.started_at === before.startedAt && s.id < before.id)
      );
    }
    const hasMore = rows.length > limit;
    const sessions = rows.slice(0, limit).map((s)=>({
      id:s.id,name:s.name,source:s.source,started_at:s.started_at,completed_at:s.completed_at,
      volume:s.exercises.flatMap(e=>e.sets).filter(x=>x.completed).reduce((sum,x)=>sum+x.reps*x.weightKg,0),
      completed_sets:s.exercises.flatMap(e=>e.sets).filter(x=>x.completed).length
    }));
    const nextCursor = hasMore && sessions.length
      ? encodeSessionCursor({ startedAt:sessions[sessions.length - 1].started_at, id:sessions[sessions.length - 1].id })
      : null;
    return { sessions, nextCursor };
  }

  async createMovementEvent(userId,event,idempotencyKey) {
    const session=this.sessions.get(event.sessionId);
    if (!session || session.user_id!==userId) {
      const error=new Error("Session not found.");
      error.code="NOT_FOUND";
      throw error;
    }
    const key=event.sessionId + ":" + idempotencyKey;
    const requestHash=idempotencyHash(event);
    const existing=this.eventIdempotency.get(key);
    if (existing) {
      if (existing.requestHash!==requestHash) {
        const error=new Error("Idempotency key was already used with a different request payload.");
        error.code="IDEMPOTENCY_CONFLICT";
        throw error;
      }
      return { existing:true, event:existing.event };
    }
    const saved={id:randomUUID(),...event,idempotency_key:idempotencyKey,idempotency_request_hash:requestHash};
    this.events.set(saved.id,saved);
    this.eventIdempotency.set(key,{event:saved,requestHash});
    return { existing:false, event:saved };
  }
}
