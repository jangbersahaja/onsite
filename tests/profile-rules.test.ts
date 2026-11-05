import {
  isValidDisplayName,
  isValidEmail,
  isValidNewPassword,
  normalizeDisplayName,
  normalizeEmail,
} from "@/lib/profile-rules";
import assert from "node:assert/strict";
import test from "node:test";

test("display names are trimmed, collapsed, and bounded", () => {
  assert.equal(normalizeDisplayName("  Ahmad   Razali "), "Ahmad Razali");
  assert.equal(isValidDisplayName("   "), false);
  assert.equal(isValidDisplayName("A"), true);
  assert.equal(isValidDisplayName("a".repeat(101)), false);
});

test("emails are normalized to lowercase and validated", () => {
  assert.equal(normalizeEmail("  Staff@Example.COM "), "staff@example.com");
  assert.equal(isValidEmail("staff@example.com"), true);
  assert.equal(isValidEmail("staff@example"), false);
  assert.equal(isValidEmail("staff name@example.com"), false);
});

test("new passwords need 12 to 128 characters", () => {
  assert.equal(isValidNewPassword("short"), false);
  assert.equal(isValidNewPassword("a".repeat(12)), true);
  assert.equal(isValidNewPassword("a".repeat(129)), false);
});
