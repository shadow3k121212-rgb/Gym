const SOURCES = new Set(["manual", "camera", "wearable"]);
const UNITS = new Set(["kg", "lb"]);

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export function normalizeEmail(value) {
  if (typeof value !== "string") throw new ValidationError("Email is required.");
  const email = value.trim().toLowerCase();
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254) {
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

function numberInRange(value, min, max, label) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < min || next > max) {
    throw new ValidationError(`${label} is outside the allowed range.`);
  }
  return next;
}

export function validateSession(input) {
  if (!input || typeof input !== "object") throw new ValidationError("Session body is required.");
  if (typeof input.id !== "string" || input.id.length < 8 || input.id.length > 80) {
    throw new ValidationError("Session id is invalid.");
  }
  if (typeof input.startedAt !== "string" || Number.isNaN(Date.parse(input.startedAt))) {
    throw new ValidationError("startedAt must be an ISO date-time.");
  }
  if (!SOURCES.has(input.source)) throw new ValidationError("Unsupported session source.");
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 120)) {
    throw new ValidationError("Session name is invalid.");
  }
  if (!Array.isArray(input.exercises) || input.exercises.length > 50) {
    throw new ValidationError("Session exercises are invalid.");
  }

  const exercises = input.exercises.map((exercise) => {
    if (!exercise || typeof exercise.exerciseId !== "string" || exercise.exerciseId.length > 80) {
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
        return {
          index: index + 1,
          reps: numberInRange(set.reps, 0, 1000, "Reps"),
          weightKg: numberInRange(set.weightKg, 0, 1000, "Load"),
          completed: Boolean(set.completed),
          completedAt: set.completedAt ? new Date(set.completedAt).toISOString() : null,
          rpe: set.rpe === null || set.rpe === undefined || set.rpe === "" ? null : numberInRange(set.rpe, 1, 10, "RPE")
        };
      })
    };
  });

  return {
    id: input.id,
    startedAt: new Date(input.startedAt).toISOString(),
    source: input.source,
    name: typeof input.name === "string" ? input.name.slice(0, 120) : "Workout",
    exercises
  };
}

export function validateMovementEvent(input) {
  if (!input || typeof input !== "object") throw new ValidationError("Movement event is required.");
  if (typeof input.sessionId !== "string" || input.sessionId.length < 8 || input.sessionId.length > 80) {
    throw new ValidationError("sessionId is invalid.");
  }
  if (typeof input.exerciseId !== "string" || input.exerciseId.length < 1 || input.exerciseId.length > 80) {
    throw new ValidationError("exerciseId is invalid.");
  }
  if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1 || input.schemaVersion > 100) {
    throw new ValidationError("schemaVersion is invalid.");
  }
  if (!SOURCES.has(input.source)) throw new ValidationError("Unsupported movement source.");
  if (typeof input.timestamp !== "string" || Number.isNaN(Date.parse(input.timestamp))) {
    throw new ValidationError("timestamp must be an ISO date-time.");
  }
  numberInRange(input.reps, 0, 1000, "Reps");
  if (input.confidence !== null && input.confidence !== undefined) numberInRange(input.confidence, 0, 1, "Confidence");
  if (input.model !== null && input.model !== undefined && typeof input.model !== "string") {
    throw new ValidationError("Model must be a string.");
  }
  if (input.metrics !== undefined && (!input.metrics || typeof input.metrics !== "object" || Array.isArray(input.metrics))) {
    throw new ValidationError("Metrics must be an object.");
  }
  return {
    sessionId: input.sessionId,
    exerciseId: input.exerciseId,
    schemaVersion: input.schemaVersion,
    source: input.source,
    timestamp: new Date(input.timestamp).toISOString(),
    reps: Number(input.reps),
    confidence: input.confidence === undefined ? null : input.confidence,
    model: input.model === undefined ? null : input.model,
    metrics: input.metrics || {}
  };
}
