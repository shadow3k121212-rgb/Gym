const SOURCES = new Set(["manual", "camera", "wearable"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export function normalizeEmail(value) {
  if (typeof value !== "string") throw new ValidationError("Email is required.");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ValidationError("Enter a valid email address.");
  }
  return email;
}

export function validatePassword(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) {
    throw new ValidationError("Password must be 12–128 characters.");
  }
  return value;
}

export function validateTenantName(value) {
  if (typeof value !== "string") throw new ValidationError("Workspace name is required.");
  const name = value.trim().replace(/\\s+/g, " ");
  if (name.length < 2 || name.length > 80 || /[\\u0000-\\u001f\\u007f]/.test(name)) {
    throw new ValidationError("Workspace name must be 2–80 printable characters.");
  }
  return name;
}

export function validateTenantSlug(value) {
  if (typeof value !== "string") throw new ValidationError("Workspace slug is required.");
  const slug = value.trim();
  if (slug.length < 2 || slug.length > 62 || !/^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])$/.test(slug)) {
    throw new ValidationError("Workspace slug must be 2–62 lowercase letters, numbers, or hyphens and start/end with a letter or number.");
  }
  return slug;
}

export function slugifyTenantName(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 62)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : "gym-workspace";
}

function isoDate(value, label) {
  if (typeof value !== "string") throw new ValidationError(label + " must be an ISO date-time.");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new ValidationError(label + " must be an ISO date-time.");
  return new Date(timestamp).toISOString();
}

function numberInRange(value, min, max, label) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < min || next > max) {
    throw new ValidationError(label + " is outside the allowed range.");
  }
  return next;
}

function uuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ValidationError(label + " must be a UUID.");
  }
  return value.toLowerCase();
}

export function validateSession(input) {
  if (!input || typeof input !== "object") throw new ValidationError("Session body is required.");
  const id = uuid(input.id, "Session id");
  const startedAt = isoDate(input.startedAt, "startedAt");
  const completedAt = input.completedAt == null ? null : isoDate(input.completedAt, "completedAt");
  if (completedAt && new Date(completedAt) < new Date(startedAt)) {
    throw new ValidationError("completedAt cannot be before startedAt.");
  }

  if (!SOURCES.has(input.source)) throw new ValidationError("Unsupported session source.");
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 120)) {
    throw new ValidationError("Session name is invalid.");
  }
  if (!Array.isArray(input.exercises) || input.exercises.length > 50) {
    throw new ValidationError("Session exercises are invalid.");
  }

  const exercises = input.exercises.map((exercise) => {
    if (!exercise || typeof exercise.exerciseId !== "string" || exercise.exerciseId.length < 1 || exercise.exerciseId.length > 80) {
      throw new ValidationError("Exercise id is invalid.");
    }
    if (!Array.isArray(exercise.sets) || exercise.sets.length > 50) {
      throw new ValidationError("Exercise sets are invalid.");
    }
    return {
      exerciseId: exercise.exerciseId,
      sets: exercise.sets.map((set, index) => {
        if (!set || Number(set.index) !== index + 1) {
          throw new ValidationError("Set indexes must be sequential.");
        }
        const completed = Boolean(set.completed);
        const completedAtForSet = set.completedAt ? isoDate(set.completedAt, "completedAt") : null;
        if (completed && !completedAtForSet) {
          throw new ValidationError("Completed sets must include completedAt.");
        }
        if (!completed && completedAtForSet) {
          throw new ValidationError("Incomplete sets cannot include completedAt.");
        }
        if (completedAtForSet && new Date(completedAtForSet) < new Date(startedAt)) {
          throw new ValidationError("Set completedAt cannot be before startedAt.");
        }
        if (completedAtForSet && completedAt && new Date(completedAtForSet) > new Date(completedAt)) {
          throw new ValidationError("Set completedAt cannot be after session completedAt.");
        }
        return {
          index: index + 1,
          reps: numberInRange(set.reps, 0, 1000, "Reps"),
          weightKg: numberInRange(set.weightKg, 0, 1000, "Load"),
          completed,
          completedAt: completedAtForSet,
          rpe: set.rpe === null || set.rpe === undefined || set.rpe === "" ? null : numberInRange(set.rpe, 1, 10, "RPE")
        };
      })
    };
  });

  return {
    id,
    startedAt,
    completedAt,
    source: input.source,
    name: typeof input.name === "string" ? input.name.slice(0, 120) : "Workout",
    exercises
  };
}

export function validateMovementEvent(input) {
  if (!input || typeof input !== "object") throw new ValidationError("Movement event is required.");
  const sessionId = uuid(input.sessionId, "sessionId");
  if (typeof input.exerciseId !== "string" || input.exerciseId.length < 1 || input.exerciseId.length > 80) {
    throw new ValidationError("exerciseId is invalid.");
  }
  if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1 || input.schemaVersion > 100) {
    throw new ValidationError("schemaVersion is invalid.");
  }
  if (!SOURCES.has(input.source)) throw new ValidationError("Unsupported movement source.");
  const timestamp = isoDate(input.timestamp, "timestamp");
  const reps = numberInRange(input.reps, 0, 1000, "Reps");
  if (input.confidence !== null && input.confidence !== undefined) numberInRange(input.confidence, 0, 1, "Confidence");
  if (input.model !== null && input.model !== undefined && typeof input.model !== "string") {
    throw new ValidationError("Model must be a string.");
  }
  if (input.model && input.model.length > 120) throw new ValidationError("Model is too long.");
  if (input.metrics !== undefined && (!input.metrics || typeof input.metrics !== "object" || Array.isArray(input.metrics))) {
    throw new ValidationError("Metrics must be an object.");
  }
  return {
    sessionId,
    exerciseId: input.exerciseId,
    schemaVersion: input.schemaVersion,
    source: input.source,
    timestamp,
    reps,
    confidence: input.confidence === undefined ? null : input.confidence,
    model: input.model === undefined ? null : input.model,
    metrics: input.metrics || {}
  };
}
