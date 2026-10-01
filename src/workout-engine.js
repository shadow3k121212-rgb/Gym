export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function calculateSetVolume(set) {
  return Number(set.reps || 0) * Number(set.weightKg || 0);
}

export function calculateVolume(sets) {
  return sets.reduce((total, set) => total + calculateSetVolume(set), 0);
}

export function completedCount(exercise) {
  const sets = exercise.sets || [];
  if (sets.some((set) => typeof set.completed === "boolean")) {
    return sets.filter((set) => set.completed).length;
  }
  return Number(exercise.completedSets ?? sets.length ?? 0);
}

export function calculateCompletion(exercises) {
  const planned = exercises.reduce((total, exercise) => total + Number(exercise.targetSets || 0), 0);
  const completed = exercises.reduce((total, exercise) => total + completedCount(exercise), 0);
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
  const allSets = exercises.flatMap((exercise) => exercise.sets || []);
  const hasExplicitCompletion = allSets.some((set) => typeof set.completed === "boolean");
  const completedSets = hasExplicitCompletion ? allSets.filter((set) => set.completed) : allSets;
  const totalSets = exercises.reduce((total, exercise) =>
    total + Number(exercise.targetSets ?? (exercise.sets || []).length), 0);
  return {
    volumeKg: calculateVolume(completedSets),
    totalSets,
    completedSets: completedSets.length,
    completedExercises: exercises.filter((exercise) =>
      Number(exercise.targetSets || 0) > 0 && completedCount(exercise) >= Number(exercise.targetSets)).length,
    completion: totalSets === 0 ? 0 : clamp(completedSets.length / totalSets, 0, 1),
    estimatedOneRepMaxKg: Math.max(0, ...completedSets.map((set) => estimateOneRepMax(set.weightKg, set.reps)))
  };
}

export function getNextOpenSet(exercise) {
  return (exercise.sets || []).find((set) => !set.completed) || null;
}

export function createMovementEvent({ sessionId, exerciseId, timestamp, source = "manual", reps, confidence = null, metrics = {}, model = null }) {
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
