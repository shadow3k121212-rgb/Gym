const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PaginationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PaginationError";
  }
}

export function encodeSessionCursor({ startedAt, id }) {
  if (typeof startedAt !== "string" || !Number.isFinite(Date.parse(startedAt))) {
    throw new PaginationError("Cursor timestamp is invalid.");
  }
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    throw new PaginationError("Cursor id is invalid.");
  }
  return Buffer.from(JSON.stringify({
    startedAt: new Date(startedAt).toISOString(),
    id: id.toLowerCase()
  })).toString("base64url");
}

export function decodeSessionCursor(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 256) {
    throw new PaginationError("before cursor is invalid.");
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new PaginationError("before cursor is invalid.");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new PaginationError("before cursor is invalid.");
  }
  if (typeof decoded.startedAt !== "string" || !Number.isFinite(Date.parse(decoded.startedAt))) {
    throw new PaginationError("before cursor timestamp is invalid.");
  }
  if (typeof decoded.id !== "string" || !UUID_PATTERN.test(decoded.id)) {
    throw new PaginationError("before cursor id is invalid.");
  }
  return {
    startedAt: new Date(decoded.startedAt).toISOString(),
    id: decoded.id.toLowerCase()
  };
}

export function normalizePageLimit(value, fallback = 20, maximum = 100) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new PaginationError("limit must be an integer between 1 and " + maximum + ".");
  }
  return parsed;
}
