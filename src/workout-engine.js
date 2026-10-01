export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function calculateSetVolume(set) {
  return Number(set.reps || 0) * Number(set.weightKg || 0);
}

export function calculateVolume(sets) {
  return sets.reduce((total, set) => total + calculateSetVolume(set), 0);
}

export function calculateCompletion(exercises) {
  const planned = exercises.reduce((total, exercise) => total + Number(exercise.targetSets || 0), 0);
  const completed = exercises.reduce((total, exercise) =>
    total + (exercise.sets || []).filter((set) => set.completed).length, 0);
  return planned === 0 ? 0 : clamp(completed / planned, 0, 1);
}

export function estimateOneRepMax(weightKg, reps) {
  const weight = Number(weightKg);
  const count = Number(reps);
  if (!Number.isFinite(weight) || !Number.isFinite(count) || weight <= 0 || count <= 0) return 0;
  return Number((weight * (1 + count / 30)).toFixed(1));
}

export function suggestProgression(lastWeightKg, completedSets, targetSets, incrementKg = 2.5) {
  const weight = Number(lastWeightKg);
  if (!Number.isFinite(weight) || weight <= 0 || completedSets < targetSets) return Math.max(0, weight || 0);
  return Number((weight + incrementKg).toFixed(2));
}

export function summarizeSession(exercises) {
  const sets = exercises.flatMap((exercise) => exercise.sets || []);
  const completedSets = sets.filter((set) => set.completed);
  return {
    volumeKg: calculateVolume(completedSets),
    totalSets: sets.length,
    completedSets: completedSets.length,
    completedExercises: exercises.filter((exercise) =>
      (exercise.sets || []).length > 0 && exercise.sets.every((set) => set.completed)).length,
    completion: calculateCompletion(exercises),
    estimatedOneRepMaxKg: Math.max(0, ...completedSets.map((set) => estimateOneRepMax(set.weightKg, set.reps)))
  };
}

export function getNextOpenSet(exercise) {
  return (exercise.sets || []).find((set) => !set.completed) || null;
}

export function createMovementEvent({
  sessionId,
  exerciseId,
  timestamp,
  source = "manual",
  reps,
  confidence = null,
  metrics = {},
  model = null
}) {
  return {
    schemaVersion: 1,
    sessionId,
    exerciseId,
    timestamp,
    source,
    reps: Number(reps),
    confidence,
    model,
    metrics
  };
}
