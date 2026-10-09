import { createHash, randomUUID } from "node:crypto";
import { encodeSessionCursor } from "./pagination.js";

const idempotencyHash = (input) => createHash("sha256").update(JSON.stringify(input)).digest("hex");

export class MemoryRepository {
  constructor() {
    this.users = new Map();
    this.usersByEmail = new Map();
    this.tenants = new Map();
    this.tenantMemberships = new Map();
    this.tenantInvitations = new Map();
    this.tenantInvitationsByHash = new Map();
    this.sessions = new Map();
    this.idempotency = new Map();
    this.events = new Map();
    this.eventIdempotency = new Map();
    this.authSessions = new Map();
    this.authSessionsByToken = new Map();
    this.passwordResetTokens = new Map();
    this.passwordResetByHash = new Map();
    this.accountDeletionAudit = [];
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
    const tenant = {
      id:user.id,
      name:(email.split("@")[0].slice(0, 60) || "Athlete") + " Personal",
      slug:"personal-" + user.id.replaceAll("-", ""),
      kind:"personal",
      tenant_status:"active",
      created_by_user_id:user.id,
      created_at:user.created_at
    };
    this.tenants.set(tenant.id, tenant);
    this.tenantMemberships.set(tenant.id + ":" + user.id, {
      tenant_id:tenant.id,
      user_id:user.id,
      role:"owner",
      status:"active",
      joined_at:user.created_at
    });
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

  async listTenantsForUser(userId) {
    return [...this.tenantMemberships.values()]
      .filter((membership) => membership.user_id === userId && membership.status === "active")
      .map((membership) => {
        const tenant = this.tenants.get(membership.tenant_id);
        return tenant && tenant.tenant_status === "active"
          ? {
              id:tenant.id,
              name:tenant.name,
              slug:tenant.slug,
              kind:tenant.kind,
              tenant_status:tenant.tenant_status,
              role:membership.role,
              membership_status:membership.status,
              created_at:tenant.created_at
            }
          : null;
      })
      .filter(Boolean)
      .sort((a,b) => (a.kind === "personal" ? 0 : 1) - (b.kind === "personal" ? 0 : 1) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  }

  async createGymTenant(userId, { name, slug }) {
    const user = this.users.get(userId);
    if (!user || user.status !== "active") {
      const error = new Error("Account is not active.");
      error.code = "NOT_FOUND";
      throw error;
    }
    if ([...this.tenants.values()].some((tenant) => tenant.slug === slug)) {
      const error = new Error("Workspace slug already exists.");
      error.code = "TENANT_SLUG_CONFLICT";
      throw error;
    }
    const id = randomUUID();
    const tenant = {
      id,name,slug,kind:"gym",tenant_status:"active",
      created_by_user_id:userId,created_at:new Date().toISOString()
    };
    this.tenants.set(id, tenant);
    this.tenantMemberships.set(id + ":" + userId, {
      tenant_id:id,user_id:userId,role:"owner",status:"active",joined_at:tenant.created_at
    });
    return {
      id,name,slug,kind:"gym",tenant_status:"active",
      role:"owner",membership_status:"active",created_at:tenant.created_at
    };
  }

  async requireTenantManager(userId, tenantId) {
    const tenant=this.tenants.get(tenantId);
    const membership=this.tenantMemberships.get(tenantId+":"+userId);
    if (!tenant || tenant.kind!=="gym" || tenant.tenant_status!=="active" || !membership || membership.status!=="active") {
      const error=new Error("Workspace not found.");error.code="NOT_FOUND";throw error;
    }
    if (!["owner","admin"].includes(membership.role)) {
      const error=new Error("Owner or admin permission is required for this workspace action.");error.code="FORBIDDEN";throw error;
    }
    return {...tenant,role:membership.role};
  }

  async listTenantMembers(actorUserId,tenantId,{limit=20,before=null}={}) {
    await this.requireTenantManager(actorUserId,tenantId);
    let rows=[...this.tenantMemberships.values()]
      .filter((m)=>m.tenant_id===tenantId)
      .map((m)=>{
        const person=this.users.get(m.user_id);
        return person ? {
          tenant_id:m.tenant_id,user_id:m.user_id,email:person.email,role:m.role,
          membership_status:m.status,joined_at:m.joined_at
        } : null;
      }).filter(Boolean);
    if(before) rows=rows.filter((m)=>m.joined_at<before.startedAt || (m.joined_at===before.startedAt && m.user_id<before.id));
    rows.sort((a,b)=>b.joined_at.localeCompare(a.joined_at)||b.user_id.localeCompare(a.user_id));
    const hasMore=rows.length>limit;
    const members=rows.slice(0,limit);
    const last=members[members.length-1];
    return {members,nextCursor:hasMore&&last?encodeSessionCursor({startedAt:last.joined_at,id:last.user_id}):null};
  }

  async listTenantInvitations(actorUserId,tenantId,{limit=20,before=null}={}) {
    await this.requireTenantManager(actorUserId,tenantId);
    let rows=[...this.tenantInvitations.values()].filter((i)=>i.tenant_id===tenantId).map((i)=>({
      id:i.id,tenant_id:i.tenant_id,email:i.email,role:i.role,invited_by_user_id:i.invited_by_user_id,
      expires_at:i.expires_at,accepted_at:i.accepted_at,revoked_at:i.revoked_at,created_at:i.created_at,
      status:i.accepted_at?"accepted":i.revoked_at?"revoked":Date.parse(i.expires_at)<=Date.now()?"expired":"pending"
    }));
    if(before) rows=rows.filter((i)=>i.created_at<before.startedAt || (i.created_at===before.startedAt && i.id<before.id));
    rows.sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
    const hasMore=rows.length>limit;
    const invitations=rows.slice(0,limit);
    const last=invitations[invitations.length-1];
    return {invitations,nextCursor:hasMore&&last?encodeSessionCursor({startedAt:last.created_at,id:last.id}):null};
  }

  async createTenantInvitation({actorUserId,tenantId,id,email,role,tokenHash,expiresAt}) {
    const actor=await this.requireTenantManager(actorUserId,tenantId);
    if(actor.role==="admin"&&role==="admin"){
      const error=new Error("Admins may invite coaches and members, but only an owner may invite another admin.");
      error.code="TENANT_ROLE_FORBIDDEN";throw error;
    }
    const normalizedEmail=String(email).toLowerCase();
    const existingMember=[...this.tenantMemberships.values()].map((m)=>({m,u:this.users.get(m.user_id)}))
      .find((entry)=>entry.m.tenant_id===tenantId&&entry.u?.email.toLowerCase()===normalizedEmail);
    if(existingMember?.m.status==="active"){
      const error=new Error("This person is already an active workspace member.");
      error.code="TENANT_MEMBERSHIP_EXISTS";throw error;
    }
    if(existingMember?.m.status==="suspended"){
      const error=new Error("This person's workspace membership is suspended.");
      error.code="TENANT_MEMBERSHIP_SUSPENDED";throw error;
    }
    const now=new Date().toISOString();
    for(const invite of this.tenantInvitations.values()){
      if(invite.tenant_id===tenantId&&invite.email.toLowerCase()===normalizedEmail&&!invite.accepted_at&&!invite.revoked_at){
        invite.revoked_at=now;
      }
    }
    const tenantInvite={
      id,tenant_id:tenantId,email:normalizedEmail,role,token_hash:tokenHash,
      invited_by_user_id:actorUserId,
      expires_at:expiresAt instanceof Date?expiresAt.toISOString():new Date(expiresAt).toISOString(),
      accepted_at:null,revoked_at:null,created_at:now
    };
    this.tenantInvitations.set(id,tenantInvite);
    this.tenantInvitationsByHash.set(tokenHash,id);
    return {
      id,tenant_id:tenantId,email:normalizedEmail,role,invited_by_user_id:actorUserId,
      expires_at:tenantInvite.expires_at,accepted_at:null,revoked_at:null,created_at:now,
      status:"pending",tenant:{id:actor.id,name:actor.name,slug:actor.slug}
    };
  }

  async revokeTenantInvitation(actorUserId,tenantId,invitationId) {
    const actor=await this.requireTenantManager(actorUserId,tenantId);
    const invite=this.tenantInvitations.get(invitationId);
    if(!invite||invite.tenant_id!==tenantId){const error=new Error("Invitation not found.");error.code="NOT_FOUND";throw error;}
    if(invite.accepted_at){const error=new Error("An accepted invitation cannot be revoked.");error.code="TENANT_INVITATION_FINAL";throw error;}
    if(actor.role==="admin"&&invite.role==="admin"){
      const error=new Error("Only an owner may revoke an admin invitation.");error.code="TENANT_ROLE_FORBIDDEN";throw error;
    }
    if(!invite.revoked_at) invite.revoked_at=new Date().toISOString();
    return {
      id:invite.id,tenant_id:invite.tenant_id,email:invite.email,role:invite.role,
      invited_by_user_id:invite.invited_by_user_id,expires_at:invite.expires_at,
      accepted_at:invite.accepted_at,revoked_at:invite.revoked_at,created_at:invite.created_at,status:"revoked"
    };
  }

  async acceptTenantInvitation(userId,tokenHash) {
    const inviteId=this.tenantInvitationsByHash.get(tokenHash);
    const invite=inviteId?this.tenantInvitations.get(inviteId):null;
    if(!invite||invite.accepted_at||invite.revoked_at||Date.parse(invite.expires_at)<=Date.now()){
      const error=new Error("Invitation is invalid, expired, or already used.");error.code="INVALID_INVITATION";throw error;
    }
    const user=this.users.get(userId);
    const tenant=this.tenants.get(invite.tenant_id);
    if(!user||user.status!=="active"||!tenant||tenant.tenant_status!=="active"){
      const error=new Error("Account or workspace is not active.");error.code="NOT_FOUND";throw error;
    }
    if(user.email.toLowerCase()!==invite.email.toLowerCase()){
      const error=new Error("This invitation was sent to a different email address.");error.code="INVITATION_EMAIL_MISMATCH";throw error;
    }
    const key=invite.tenant_id+":"+userId;
    const existing=this.tenantMemberships.get(key);
    if(existing?.status==="active"){
      const error=new Error("You are already a workspace member.");error.code="TENANT_MEMBERSHIP_EXISTS";throw error;
    }
    if(existing?.status==="suspended"){
      const error=new Error("Your workspace membership is suspended.");error.code="TENANT_MEMBERSHIP_SUSPENDED";throw error;
    }
    const now=new Date().toISOString();
    if(existing){
      existing.role=invite.role;existing.status="active";existing.invited_by_user_id=invite.invited_by_user_id;existing.joined_at=now;
    }else{
      this.tenantMemberships.set(key,{
        tenant_id:invite.tenant_id,user_id:userId,role:invite.role,status:"active",
        invited_by_user_id:invite.invited_by_user_id,joined_at:now
      });
    }
    invite.accepted_at=now;
    return {
      id:tenant.id,name:tenant.name,slug:tenant.slug,kind:tenant.kind,
      tenant_status:tenant.tenant_status,role:invite.role,membership_status:"active",created_at:tenant.created_at
    };
  }

  async createPasswordResetToken({ id, userId, tokenHash, expiresAt }) {
    for (const token of this.passwordResetTokens.values()) {
      if (token.user_id === userId && !token.used_at) token.used_at = new Date().toISOString();
    }
    const token = {
      id,
      user_id:userId,
      token_hash:tokenHash,
      created_at:new Date().toISOString(),
      expires_at:expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt,
      used_at:null
    };
    this.passwordResetTokens.set(id, token);
    this.passwordResetByHash.set(tokenHash, id);
    return token;
  }

  async resetPassword(tokenHash, passwordHash, passwordSalt) {
    const id = this.passwordResetByHash.get(tokenHash);
    const token = id ? this.passwordResetTokens.get(id) : null;
    if (!token || token.used_at || new Date(token.expires_at).getTime() <= Date.now()) return null;
    const user = this.users.get(token.user_id);
    if (!user || user.status !== "active") return null;
    token.used_at = new Date().toISOString();
    user.password_hash = passwordHash;
    user.password_salt = passwordSalt;
    user.updated_at = new Date().toISOString();
    for (const session of this.authSessions.values()) {
      if (session.user_id === user.id && !session.revoked_at) {
        session.revoked_at = new Date().toISOString();
        session.revocation_reason = "password-reset";
      }
    }
    return { id:user.id,email:user.email,status:user.status };
  }

  async deleteAccount(userId) {
    const user = this.users.get(userId);
    if (!user) return false;

    const soleOwnedGym = [...this.tenantMemberships.values()].some((membership) => {
      if (membership.user_id !== userId || membership.role !== "owner" || membership.status !== "active") return false;
      const tenant = this.tenants.get(membership.tenant_id);
      if (!tenant || tenant.kind !== "gym") return false;
      return ![...this.tenantMemberships.values()].some((other) =>
        other.tenant_id === tenant.id && other.user_id !== userId &&
        other.role === "owner" && other.status === "active"
      );
    });
    if (soleOwnedGym) {
      const error = new Error("Transfer gym workspace ownership before deleting this account.");
      error.code = "TENANT_OWNER_REQUIRED";
      throw error;
    }

    const sessionIds = new Set(
      [...this.sessions.values()]
        .filter((session) => session.user_id === userId)
        .map((session) => session.id)
    );

    for (const [id,event] of this.events) {
      if (sessionIds.has(event.sessionId)) this.events.delete(id);
    }
    for (const [key,value] of this.eventIdempotency) {
      if (sessionIds.has(value.event?.sessionId)) this.eventIdempotency.delete(key);
    }

    for (const [id,session] of this.authSessions) {
      if (session.user_id === userId) {
        this.authSessions.delete(id);
        this.authSessionsByToken.delete(session.token_hash);
      }
    }
    for (const [id,token] of this.passwordResetTokens) {
      if (token.user_id === userId) {
        this.passwordResetTokens.delete(id);
        this.passwordResetByHash.delete(token.token_hash);
      }
    }
    for (const [id,session] of this.sessions) if (session.user_id === userId) this.sessions.delete(id);
    for (const [key,value] of this.idempotency) if (value.session?.user_id === userId) this.idempotency.delete(key);

    this.usersByEmail.delete(user.email);
    this.users.delete(userId);
    for (const [key,membership] of this.tenantMemberships) {
      if (membership.user_id === userId || membership.tenant_id === userId) this.tenantMemberships.delete(key);
    }
    for (const invite of this.tenantInvitations.values()) {
      if (invite.invited_by_user_id===userId) invite.invited_by_user_id=null;
    }
    for (const [tenantId,tenant] of this.tenants) {
      if (tenant.kind === "personal" && tenant.id === userId) this.tenants.delete(tenantId);
      else if (tenant.created_by_user_id === userId) tenant.created_by_user_id = null;
    }
    this.accountDeletionAudit.push({
      id:randomUUID(),
      event_type:"account-deleted",
      occurred_at:new Date().toISOString(),
      subject_digest:createHash("sha256").update(userId).digest("hex")
    });
    return true;
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

  async touchAuthSession(sessionId, userId) {
    const session = this.authSessions.get(sessionId);
    if (session && session.user_id === userId && !session.revoked_at) {
      session.last_seen_at = new Date().toISOString();
    }
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
      expiresAt:current.expires_at
    });
    current.revoked_at = new Date().toISOString();
    current.last_seen_at = new Date().toISOString();
    current.replaced_by_session_id = next.id;
    current.revocation_reason = "rotated";
    return { status:"rotated", userId:current.user_id, familyId:current.family_id, sessionId:next.id, expiresAt:current.expires_at };
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
        revocation_reason:session.revocation_reason,
        status:session.revoked_at ? "revoked" : new Date(session.expires_at).getTime() <= Date.now() ? "expired" : "active"
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
