import { getDayKey, getTodaySummary } from "@/lib/clock-today";
import assert from "node:assert/strict";
import test from "node:test";

const tz = "Asia/Kuala_Lumpur";

test("getDayKey uses the outlet time zone, not UTC", () => {
  // 2026-03-10 23:30 UTC is already 2026-03-11 in Kuala Lumpur (UTC+8).
  assert.equal(getDayKey("2026-03-10T23:30:00Z", tz), "2026-03-11");
});

test("sums worked and break minutes for today's completed shifts", () => {
  const summary = getTodaySummary(
    [
      {
        clockInAt: "2026-03-11T01:00:00Z", // 09:00 KL
        clockOutAt: "2026-03-11T05:00:00Z", // 13:00 KL, 4h gross
        breaks: [
          {
            startedAt: "2026-03-11T03:00:00Z",
            endedAt: "2026-03-11T03:30:00Z",
          },
        ],
      },
    ],
    new Date("2026-03-11T08:00:00Z"),
    tz,
  );
  assert.deepEqual(summary, {
    shiftCount: 1,
    workedMinutes: 210,
    breakMinutes: 30,
  });
});

test("open shift and open break count up to now", () => {
  const summary = getTodaySummary(
    [
      {
        clockInAt: "2026-03-11T01:00:00Z",
        clockOutAt: null,
        breaks: [{ startedAt: "2026-03-11T02:00:00Z", endedAt: null }],
      },
    ],
    new Date("2026-03-11T03:00:00Z"),
    tz,
  );
  assert.deepEqual(summary, {
    shiftCount: 1,
    workedMinutes: 60,
    breakMinutes: 60,
  });
});

test("ignores shifts from other days", () => {
  const summary = getTodaySummary(
    [
      {
        clockInAt: "2026-03-10T01:00:00Z",
        clockOutAt: "2026-03-10T09:00:00Z",
        breaks: [],
      },
    ],
    new Date("2026-03-11T03:00:00Z"),
    tz,
  );
  assert.deepEqual(summary, {
    shiftCount: 0,
    workedMinutes: 0,
    breakMinutes: 0,
  });
});
