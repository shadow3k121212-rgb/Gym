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
