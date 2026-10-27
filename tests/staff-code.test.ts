import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeStaffCode,
  STAFF_CODE_MAX_LENGTH,
  staffCodeKey,
} from "../lib/staff-code";

test("normalizeStaffCode treats blank input as no staff code", () => {
  assert.deepEqual(normalizeStaffCode(undefined), { value: null });
  assert.deepEqual(normalizeStaffCode(null), { value: null });
  assert.deepEqual(normalizeStaffCode("   "), { value: null });
});

test("normalizeStaffCode trims valid codes", () => {
  assert.deepEqual(normalizeStaffCode("  YDM-001 "), { value: "YDM-001" });
  assert.deepEqual(normalizeStaffCode("a_b-9"), { value: "a_b-9" });
});

test("normalizeStaffCode enforces the length limit", () => {
  const atLimit = "A".repeat(STAFF_CODE_MAX_LENGTH);
  assert.deepEqual(normalizeStaffCode(atLimit), { value: atLimit });

  const tooLong = "A".repeat(STAFF_CODE_MAX_LENGTH + 1);
  assert.deepEqual(normalizeStaffCode(tooLong), {
    error: `Staff code must be ${STAFF_CODE_MAX_LENGTH} characters or fewer.`,
  });
});

test("normalizeStaffCode rejects spaces, symbols, and leading separators", () => {
  for (const value of ["bad code", "ydm/001", "-lead", "_lead", "émile"]) {
    assert.ok(
      "error" in normalizeStaffCode(value),
      `expected ${value} to fail`,
    );
  }
});

test("staffCodeKey trims and lowercases for case-insensitive matching", () => {
  assert.equal(staffCodeKey("  YDM-001 "), "ydm-001");
  assert.equal(staffCodeKey("ydm-001"), staffCodeKey("YDM-001"));
});
