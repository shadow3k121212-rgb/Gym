import test from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  slugifyTenantName,
  validateTenantName,
  validateTenantSlug
} from "../src/validation.js";

test("normalizes workspace names while preserving readable Unicode characters", () => {
  assert.equal(validateTenantName("  North   Side Fitness  "), "North Side Fitness");
  assert.equal(validateTenantName("Café Strength"), "Café Strength");
});

test("rejects empty, overlong and control-character workspace names", () => {
  assert.throws(() => validateTenantName("  "), ValidationError);
  assert.throws(() => validateTenantName("x".repeat(81)), ValidationError);
  assert.throws(() => validateTenantName("Central\nFitness"), ValidationError);
});

test("generates predictable ASCII slugs from workspace names", () => {
  assert.equal(slugifyTenantName("  North   Side Fitness  "), "north-side-fitness");
  assert.equal(slugifyTenantName("Café Strength"), "cafe-strength");
  assert.equal(slugifyTenantName("東京"), "gym-workspace");
});

test("accepts only bounded lowercase URL-safe slugs", () => {
  assert.equal(validateTenantSlug("central-fitness"), "central-fitness");
  for (const slug of ["A-slug", "has spaces", "-leading", "trailing-", "x", "a".repeat(63)]) {
    assert.throws(() => validateTenantSlug(slug), ValidationError);
  }
});
