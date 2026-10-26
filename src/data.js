export const EXERCISES = [
  { id: "bench", name: "Barbell Bench Press", muscle: "Chest", equipment: "Barbell", level: "Intermediate", targetSets: 4, targetReps: 8, loadKg: 70, cues: ["Brace", "Control down", "Drive evenly"] },
  { id: "row", name: "Chest-Supported Row", muscle: "Back", equipment: "Machine", level: "Beginner", targetSets: 3, targetReps: 10, loadKg: 45, cues: ["Chest supported", "Pull elbows", "Pause"] },
  { id: "ohp", name: "Overhead Press", muscle: "Shoulders", equipment: "Barbell", level: "Intermediate", targetSets: 3, targetReps: 8, loadKg: 42.5, cues: ["Ribs down", "Press straight", "Lock out"] },
  { id: "pullup", name: "Pull-Up", muscle: "Back", equipment: "Bodyweight", level: "Intermediate", targetSets: 3, targetReps: 8, loadKg: 0, cues: ["Start long", "Drive elbows", "Control down"] },
  { id: "squat", name: "Back Squat", muscle: "Legs", equipment: "Barbell", level: "Intermediate", targetSets: 4, targetReps: 6, loadKg: 90, cues: ["Brace", "Knees track", "Stand tall"] },
  { id: "rdl", name: "Romanian Deadlift", muscle: "Posterior", equipment: "Barbell", level: "Intermediate", targetSets: 3, targetReps: 8, loadKg: 75, cues: ["Hips back", "Lats tight", "Stand tall"] }
];

export const WORKOUT = ["bench", "row", "ohp", "pullup"];

export const SAMPLE_HISTORY = [
  { id: "sample-1", date: "2026-09-28", name: "Lower Strength", volumeKg: 11240, sets: 12, source: "sample" },
  { id: "sample-2", date: "2026-09-29", name: "Upper Volume", volumeKg: 8900, sets: 14, source: "sample" },
  { id: "sample-3", date: "2026-09-30", name: "Full Body", volumeKg: 12560, sets: 16, source: "sample" }
];

export function getExercise(id) {
  return EXERCISES.find((exercise) => exercise.id === id) || null;
}

export function createEmptySession() {
  return {
    id: globalThis.crypto?.randomUUID?.() || `session-${Date.now()}`,
    name: "Upper Strength",
    startedAt: new Date().toISOString(),
    completedAt: null,
    source: "manual",
    exercises: WORKOUT.map((exerciseId) => {
      const exercise = getExercise(exerciseId);
      return {
        exerciseId,
        sets: Array.from({ length: exercise.targetSets }, (_, index) => ({
          index: index + 1,
          reps: exercise.targetReps,
          weightKg: exercise.loadKg,
          completed: false,
          completedAt: null,
          rpe: null
        }))
      };
    })
  };
}
