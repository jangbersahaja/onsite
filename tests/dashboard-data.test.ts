import {
  addCalendarDays,
  getDashboardShiftMetrics,
  getDashboardShiftStatus,
  getScheduleWindow,
  orderDashboardShifts,
  outletScheduleDate,
} from "@/lib/dashboard-data";
import assert from "node:assert/strict";
import test from "node:test";

test("schedule window spans 6am through the next 6am in the outlet timezone", () => {
  const window = getScheduleWindow("2026-10-04", "Asia/Kuala_Lumpur");
  assert.equal(window.startAt.toISOString(), "2026-10-03T22:00:00.000Z");
  assert.equal(window.endAt.toISOString(), "2026-10-04T22:00:00.000Z");
  assert.equal(
    outletScheduleDate("2026-10-03T18:00:00.000Z", "Asia/Kuala_Lumpur"),
    "2026-10-03",
  );
  assert.equal(
    outletScheduleDate("2026-10-03T21:59:00.000Z", "Asia/Kuala_Lumpur"),
    "2026-10-03",
  );
  assert.equal(
    outletScheduleDate("2026-10-03T22:00:00.000Z", "Asia/Kuala_Lumpur"),
    "2026-10-04",
  );
  assert.equal(addCalendarDays("2026-10-04", 1), "2026-10-05");
});

test("worked and break minutes are clipped to the selected window", () => {
  const metrics = getDashboardShiftMetrics(
    "2026-10-03T23:00:00+08:00",
    "2026-10-05T07:00:00+08:00",
    [
      {
        startedAt: "2026-10-05T05:30:00+08:00",
        endedAt: "2026-10-05T06:30:00+08:00",
      },
    ],
    new Date("2026-10-03T22:00:00Z"),
    new Date("2026-10-04T22:00:00Z"),
    new Date("2026-10-04T22:00:00Z"),
  );
  assert.deepEqual(metrics, { workedMinutes: 1410, breakMinutes: 30 });
});

test("open breaks accrue through the live snapshot and status is evaluated there", () => {
  const startsAt = new Date("2026-10-04T00:00:00Z");
  const endsAt = new Date("2026-10-05T06:00:00Z");
  const evaluatedAt = new Date("2026-10-04T03:15:00Z");
  const breaks = [{ startedAt: "2026-10-04T02:45:00Z", endedAt: null }];
  assert.deepEqual(
    getDashboardShiftMetrics(
      "2026-10-04T01:00:00Z",
      null,
      breaks,
      startsAt,
      endsAt,
      evaluatedAt,
    ),
    { workedMinutes: 105, breakMinutes: 30 },
  );
  assert.equal(
    getDashboardShiftStatus("2026-10-04T01:00:00Z", null, breaks, evaluatedAt),
    "on_break",
  );
  assert.equal(
    getDashboardShiftStatus(
      "2026-10-04T01:00:00Z",
      null,
      breaks,
      new Date("2026-10-04T04:00:00Z"),
    ),
    "on_break",
  );
});

test("status changes to finished after clock-out and before an active shift", () => {
  const evaluatedAt = new Date("2026-10-04T06:00:00Z");
  assert.equal(
    getDashboardShiftStatus(
      "2026-10-04T01:00:00Z",
      "2026-10-04T05:59:00Z",
      [],
      evaluatedAt,
    ),
    "finished",
  );
  assert.equal(
    getDashboardShiftStatus("2026-10-04T07:00:00Z", null, [], evaluatedAt),
    "finished",
  );
});

test("dashboard shifts are ordered by status and then staff name", () => {
  const shifts = orderDashboardShifts([
    { status: "finished" as const, employeeName: "Zara" },
    { status: "on_break" as const, employeeName: "Ben" },
    { status: "on_shift" as const, employeeName: "Zoe" },
    { status: "on_shift" as const, employeeName: "Amy" },
    { status: "finished" as const, employeeName: "Cara" },
  ]);

  assert.deepEqual(
    shifts.map(({ status, employeeName }) => `${status}:${employeeName}`),
    [
      "on_shift:Amy",
      "on_shift:Zoe",
      "on_break:Ben",
      "finished:Cara",
      "finished:Zara",
    ],
  );
});
