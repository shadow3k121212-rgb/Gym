INSERT INTO exercises (id, slug, name, muscle_group, equipment)
VALUES
  ('bench', 'barbell-bench-press', 'Barbell Bench Press', 'Chest', 'Barbell'),
  ('row', 'chest-supported-row', 'Chest-Supported Row', 'Back', 'Machine'),
  ('ohp', 'overhead-press', 'Overhead Press', 'Shoulders', 'Barbell'),
  ('pullup', 'pull-up', 'Pull-Up', 'Back', 'Bodyweight'),
  ('squat', 'back-squat', 'Back Squat', 'Legs', 'Barbell'),
  ('rdl', 'romanian-deadlift', 'Romanian Deadlift', 'Posterior', 'Barbell')
ON CONFLICT (id) DO UPDATE SET
  name=excluded.name,
  slug=excluded.slug,
  muscle_group=excluded.muscle_group,
  equipment=excluded.equipment;
