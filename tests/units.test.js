import test from "node:test";
import assert from "node:assert/strict";
import { toDisplayWeight, toDisplayVolume, toKg, weightInputStep } from "../src/units.js";

test("converts weights to pounds and back without losing canonical kg semantics", () => {
  const pounds = toDisplayWeight(100, "lb");
  assert.ok(Math.abs(pounds - 220.462262) < 0.0001);
  assert.ok(Math.abs(toKg(pounds, "lb") - 100) < 0.000001);
});

test("keeps kilograms as the canonical display when selected", () => {
  assert.equal(toDisplayWeight(72.5, "kg"), 72.5);
  assert.equal(toDisplayVolume(1450, "kg"), 1450);
});

test("uses practical input steps for each unit system", () => {
  assert.equal(weightInputStep("kg"), 0.5);
  assert.equal(weightInputStep("lb"), 1);
});
