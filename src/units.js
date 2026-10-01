const KG_PER_LB = 0.45359237;

export function normalizeUnit(unit) {
  return unit === "lb" ? "lb" : "kg";
}

export function toDisplayWeight(weightKg, unit = "kg") {
  const value = Number(weightKg);
  if (!Number.isFinite(value)) return 0;
  return normalizeUnit(unit) === "lb" ? value / KG_PER_LB : value;
}

export function toKg(displayWeight, unit = "kg") {
  const value = Number(displayWeight);
  if (!Number.isFinite(value)) return 0;
  return normalizeUnit(unit) === "lb" ? value * KG_PER_LB : value;
}

export function displayUnit(unit = "kg") {
  return normalizeUnit(unit);
}

export function weightInputStep(unit = "kg") {
  return normalizeUnit(unit) === "lb" ? 1 : 0.5;
}

export function toDisplayVolume(volumeKg, unit = "kg") {
  const value = Number(volumeKg);
  if (!Number.isFinite(value)) return 0;
  return normalizeUnit(unit) === "lb" ? value / KG_PER_LB : value;
}
