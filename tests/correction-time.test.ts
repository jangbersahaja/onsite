import { getCorrectionTimeError } from "@/lib/correction-time";
import assert from "node:assert/strict";
import test from "node:test";

const now = new Date("2026-10-06T10:00:00.000Z");

test("manual correction accepts a small clock skew but rejects future times", () => {
  assert.equal(
    getCorrectionTimeError(
      "clock_in",
      new Date("2026-10-06T10:04:00.000Z"),
      null,
      now,
      5 * 60_000,
    ),
    null,
  );
  assert.equal(
    getCorrectionTimeError(
      "clock_in",
      new Date("2026-10-06T10:06:00.000Z"),
      null,
      now,
      5 * 60_000,
    ),
    "future",
  );
});

test("correction punches cannot reverse shift order", () => {
  const afterShift = new Date("2026-10-06T17:00:00.000Z");
  const shift = {
    clockInAt: new Date("2026-10-06T08:00:00.000Z"),
    clockOutAt: new Date("2026-10-06T16:00:00.000Z"),
  };

  assert.equal(
    getCorrectionTimeError(
      "clock_in",
      new Date("2026-10-06T16:00:00.000Z"),
      shift,
      afterShift,
    ),
    "out_of_order",
  );
  assert.equal(
    getCorrectionTimeError(
      "clock_out",
      new Date("2026-10-06T08:00:00.000Z"),
      shift,
      afterShift,
    ),
    "out_of_order",
  );
});

test("clock-out corrections after the clock-in remain valid", () => {
  const afterShift = new Date("2026-10-06T17:00:00.000Z");
  assert.equal(
    getCorrectionTimeError(
      "clock_out",
      new Date("2026-10-06T15:00:00.000Z"),
      {
        clockInAt: new Date("2026-10-06T08:00:00.000Z"),
        clockOutAt: null,
      },
      afterShift,
    ),
    null,
  );
});
