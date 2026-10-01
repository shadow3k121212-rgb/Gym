import { createHash, randomUUID } from "node:crypto";

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
    return [...this.sessions.values()].filter((s)=>s.user_id===userId).sort((a,b)=>b.started_at.localeCompare(a.started_at)).slice(0,Math.min(Math.max(Number(limit)||20,1),50)).map((s)=>({
      id:s.id,name:s.name,source:s.source,started_at:s.started_at,completed_at:s.completed_at,
      volume:s.exercises.flatMap(e=>e.sets).filter(x=>x.completed).reduce((sum,x)=>sum+x.reps*x.weightKg,0),
      completed_sets:s.exercises.flatMap(e=>e.sets).filter(x=>x.completed).length
    }));
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
