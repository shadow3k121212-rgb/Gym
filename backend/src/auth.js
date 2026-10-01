import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
  scrypt as scryptCallback
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const base64url = (value) => Buffer.from(value).toString("base64url");

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32, SCRYPT_PARAMS);
  return {
    salt: salt.toString("base64url"),
    hash: Buffer.from(derived).toString("base64url")
  };
}

export async function verifyPassword(password, saltEncoded, expectedEncoded) {
  try {
    const salt = Buffer.from(saltEncoded, "base64url");
    const expected = Buffer.from(expectedEncoded, "base64url");
    const derived = await scrypt(password, salt, expected.length, SCRYPT_PARAMS);
    return timingSafeEqual(Buffer.from(derived), expected);
  } catch {
    return false;
  }
}

function sign(input, secret) {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function issueAccessToken(userId, secret, nowMs = Date.now(), sessionId = null) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    sub: userId,
    ...(sessionId ? { sid: sessionId } : {}),
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(nowMs / 1000) + ACCESS_TTL_SECONDS
  }));
  return `${header}.${payload}.${sign(`${header}.${payload}`, secret)}`;
}

export function verifyAccessToken(token, secret, nowMs = Date.now()) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expected = sign(`${header}.${payload}`, secret);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = Math.floor(nowMs / 1000);
    if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") return null;
    if (!parsed.sub || !parsed.sid || !Number.isInteger(parsed.exp) || parsed.exp <= now) return null;
    return { userId: parsed.sub, sessionId: parsed.sid, issuedAt: parsed.iat, expiresAt: parsed.exp };
  } catch {
    return null;
  }
}

export function extractBearerToken(req) {
  const value = req.headers.authorization;
  if (!value || typeof value !== "string") return null;
  const [scheme, token] = value.split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : null;
}

export function createRefreshToken() {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function refreshExpiry(nowMs = Date.now()) {
  return new Date(nowMs + REFRESH_TTL_SECONDS * 1000);
}

export function getRefreshTtlSeconds() {
  return REFRESH_TTL_SECONDS;
}
