export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function calculateVolume(sets) {
  return sets.reduce((total, set) => total + Number(set.reps || 0) * Number(set.weightKg || 0), 0);
}

export function calculateCompletion(exercises) {
  const planned = exercises.reduce((n, exercise) => n + exercise.targetSets, 0);
  const completed = exercises.reduce((n, exercise) => n + exercise.completedSets, 0);
  return planned === 0 ? 0 : clamp(completed / planned, 0, 1);
}

export function suggestProgression(lastWeightKg, completedSets, targetSets, incrementKg = 2.5) {
  if (completedSets < targetSets || lastWeightKg <= 0) return lastWeightKg;
  return Number((lastWeightKg + incrementKg).toFixed(2));
}

export function summarizeSession(exercises) {
  const sets = exercises.flatMap((exercise) => exercise.sets || []);
  return {
    volumeKg: calculateVolume(sets),
    totalSets: sets.length,
    completedExercises: exercises.filter((e) => e.completedSets >= e.targetSets).length,
    completion: calculateCompletion(exercises)
  };
}

export function createMovementEvent({
  sessionId,
  exerciseId,
  timestamp,
  source = "manual",
  reps,
  confidence = null,
  metrics = {}
}) {
  return {
    schemaVersion: 1,
    sessionId,
    exerciseId,
    timestamp,
    source,
    reps,
    confidence,
    metrics
  };
}
