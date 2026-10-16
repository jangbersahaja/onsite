import {
  canChangeShiftFor,
  canDeleteShift,
  hasOverlap,
  validateManualShift,
} from "@/lib/timesheet-create-rules";
import assert from "node:assert/strict";
import test from "node:test";

const at = (value: string) => new Date(value);
const now = at("2026-06-10T12:00:00Z");

test("overlap is detected against closed and open shifts", () => {
  const existing = [
    { start: at("2026-06-01T09:00:00Z"), end: at("2026-06-01T17:00:00Z") },
    { start: at("2026-06-05T09:00:00Z"), end: null },
  ];

  assert.equal(
    hasOverlap(
      { start: at("2026-06-01T16:00:00Z"), end: at("2026-06-01T18:00:00Z") },
      existing,
    ),
    true,
  );
  assert.equal(
    hasOverlap(
      { start: at("2026-06-05T20:00:00Z"), end: at("2026-06-05T21:00:00Z") },
      existing,
    ),
    true,
  );
});

test("touching shifts are not overlaps", () => {
  const existing = [
    { start: at("2026-06-01T09:00:00Z"), end: at("2026-06-01T17:00:00Z") },
  ];

  assert.equal(
    hasOverlap(
      { start: at("2026-06-01T17:00:00Z"), end: at("2026-06-01T18:00:00Z") },
      existing,
    ),
    false,
  );
  assert.equal(
    hasOverlap(
      { start: at("2026-06-01T08:00:00Z"), end: at("2026-06-01T09:00:00Z") },
      existing,
    ),
    false,
  );
});

test("manual shift requires a clock out and ordered times", () => {
  const clockInAt = at("2026-06-01T09:00:00Z");
  assert.equal(
    validateManualShift({ clockInAt, clockOutAt: null, breaks: [], now }),
    "Clock out is required.",
  );
  assert.equal(
    validateManualShift({
      clockInAt,
      clockOutAt: at("2026-06-01T08:00:00Z"),
      breaks: [],
      now,
    }),
    "Clock out must be after clock in.",
  );
});

test("manual shift rejects future times and open breaks", () => {
  const clockInAt = at("2026-06-01T09:00:00Z");
  assert.equal(
    validateManualShift({
      clockInAt,
      clockOutAt: at("2026-06-11T09:00:00Z"),
      breaks: [],
      now,
    }),
    "Times cannot be in the future.",
  );
  assert.equal(
    validateManualShift({
      clockInAt,
      clockOutAt: at("2026-06-01T17:00:00Z"),
      breaks: [{ startedAt: at("2026-06-01T12:00:00Z"), endedAt: null }],
      now,
    }),
    "Breaks must have an end time.",
  );
});

test("manual shift rejects breaks outside the shift", () => {
  assert.equal(
    validateManualShift({
      clockInAt: at("2026-06-01T09:00:00Z"),
      clockOutAt: at("2026-06-01T17:00:00Z"),
      breaks: [
        {
          startedAt: at("2026-06-01T16:30:00Z"),
          endedAt: at("2026-06-01T17:30:00Z"),
        },
      ],
      now,
    }),
    "Breaks must be ordered, non-overlapping, and within the shift.",
  );
});

test("valid manual shift passes", () => {
  assert.equal(
    validateManualShift({
      clockInAt: at("2026-06-01T09:00:00Z"),
      clockOutAt: at("2026-06-01T17:00:00Z"),
      breaks: [
        {
          startedAt: at("2026-06-01T12:00:00Z"),
          endedAt: at("2026-06-01T12:30:00Z"),
        },
      ],
      now,
    }),
    null,
  );
});

test("backoffice users cannot change their own shifts, super admins can", () => {
  assert.equal(
    canChangeShiftFor({ userId: "a", isSuperAdmin: false }, "a"),
    false,
  );
  assert.equal(
    canChangeShiftFor({ userId: "a", isSuperAdmin: false }, "b"),
    true,
  );
  assert.equal(
    canChangeShiftFor({ userId: "a", isSuperAdmin: true }, "a"),
    true,
  );
});

test("only closed shifts can be deleted", () => {
  assert.equal(canDeleteShift({ clockOutAt: null }), false);
  assert.equal(
    canDeleteShift({ clockOutAt: at("2026-06-01T17:00:00Z") }),
    true,
  );
});
