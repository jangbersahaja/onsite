import {
  addCalendarDays,
  dashboardRowFlags,
  getDashboardShiftMetrics,
  getDashboardShiftStatus,
  getScheduleWindow,
  getTimelineSpan,
  groupDashboardSessions,
  orderDashboardShifts,
  outletScheduleDate,
  scheduledRowStatus,
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

test("absent and not clocked in rows lead, upcoming rows sit before finished", () => {
  const shifts = orderDashboardShifts([
    { status: "finished" as const, employeeName: "Dan" },
    { status: "upcoming" as const, employeeName: "Eli" },
    { status: "on_shift" as const, employeeName: "Cara" },
    { status: "not_clocked_in" as const, employeeName: "Ben" },
    { status: "absent" as const, employeeName: "Amy" },
  ]);

  assert.deepEqual(
    shifts.map(({ status, employeeName }) => `${status}:${employeeName}`),
    [
      "absent:Amy",
      "not_clocked_in:Ben",
      "on_shift:Cara",
      "upcoming:Eli",
      "finished:Dan",
    ],
  );
});

test("scheduled shifts without a clock-in map to upcoming, not clocked in, or absent", () => {
  assert.equal(scheduledRowStatus("upcoming"), "upcoming");
  assert.equal(scheduledRowStatus("not_clocked_in"), "not_clocked_in");
  assert.equal(scheduledRowStatus("absent"), "absent");
});

test("row flags are ordered by importance and drop the absent flag on absent rows", () => {
  assert.deepEqual(
    dashboardRowFlags(["overtime", "late", "missed_break"], "on_shift"),
    ["late", "missed_break", "overtime"],
  );
  assert.deepEqual(dashboardRowFlags(["absent"], "absent"), []);
});

test("timeline span maps a shift to percentages of the 06:00-06:00 window", () => {
  const windowStart = "2026-10-03T22:00:00.000Z";
  const windowEnd = "2026-10-04T22:00:00.000Z";
  const evaluatedAt = "2026-10-04T10:00:00.000Z";
  assert.deepEqual(
    getTimelineSpan(
      windowStart,
      "2026-10-04T10:00:00.000Z",
      windowStart,
      windowEnd,
      evaluatedAt,
    ),
    { left: 0, width: 50 },
  );
});

test("timeline span returns null for an interval outside the window", () => {
  assert.equal(
    getTimelineSpan(
      "2026-10-04T23:00:00.000Z",
      "2026-10-05T01:00:00.000Z",
      "2026-10-03T22:00:00.000Z",
      "2026-10-04T22:00:00.000Z",
      "2026-10-05T02:00:00.000Z",
    ),
    null,
  );
});

test("timeline span ends an open interval at the evaluation time", () => {
  const span = getTimelineSpan(
    "2026-10-03T22:00:00.000Z",
    null,
    "2026-10-03T22:00:00.000Z",
    "2026-10-04T22:00:00.000Z",
    "2026-10-04T04:00:00.000Z",
  );
  assert.deepEqual(span, { left: 0, width: 25 });
});

function session(
  id: string,
  clockInAt: string,
  clockOutAt: string | null,
  overrides: Partial<Parameters<typeof groupDashboardSessions>[0][number]> = {},
) {
  return {
    id,
    userId: "user-1",
    employeeName: "Maryfat",
    profilePhotoUrl: null,
    clockInAt,
    clockOutAt,
    clockInLocal: clockInAt.slice(11, 16),
    clockOutLocal: clockOutAt ? clockOutAt.slice(11, 16) : null,
    status: "finished" as const,
    workedMinutes: 60,
    breakMinutes: 0,
    breaks: [],
    schedule: null,
    unscheduled: false,
    ...overrides,
  };
}

test("one person's sessions in a day form a single row with combined totals", () => {
  const schedule = {
    startAt: "2026-10-04T01:00:00Z",
    endAt: "2026-10-04T08:00:00Z",
    flags: ["late" as const],
  };
  const [row] = groupDashboardSessions([
    session("second", "2026-10-04T08:14:00Z", "2026-10-04T08:51:00Z", {
      workedMinutes: 37,
      unscheduled: true,
    }),
    session("first", "2026-10-04T01:16:00Z", "2026-10-04T08:03:00Z", {
      workedMinutes: 406,
      schedule,
    }),
  ]);

  assert.equal(row.id, "first");
  assert.deepEqual(
    row.sessions.map((item) => item.id),
    ["first", "second"],
  );
  assert.equal(row.workedMinutes, 443);
  assert.equal(row.clockOutLocal, "08:51");
  assert.deepEqual(row.schedules, [schedule]);
  assert.equal(row.unscheduled, false);
});

test("a person is only unscheduled when none of their sessions match a shift", () => {
  const [row] = groupDashboardSessions([
    session("only", "2026-10-04T10:00:00Z", "2026-10-04T11:00:00Z", {
      unscheduled: true,
    }),
  ]);
  assert.equal(row.unscheduled, true);
  assert.deepEqual(row.schedules, []);
});

test("a live session keeps the combined row on shift or on break", () => {
  const [onShift] = groupDashboardSessions([
    session("done", "2026-10-04T01:00:00Z", "2026-10-04T03:00:00Z"),
    session("live", "2026-10-04T04:00:00Z", null, { status: "on_shift" }),
  ]);
  assert.equal(onShift.status, "on_shift");
  assert.equal(onShift.clockOutAt, null);
  assert.equal(onShift.clockOutLocal, null);

  const [onBreak] = groupDashboardSessions([
    session("live", "2026-10-04T04:00:00Z", null, { status: "on_shift" }),
    session("break", "2026-10-04T05:00:00Z", null, { status: "on_break" }),
  ]);
  assert.equal(onBreak.status, "on_break");
});

test("sessions for different people stay in separate rows", () => {
  const rows = groupDashboardSessions([
    session("a", "2026-10-04T01:00:00Z", "2026-10-04T02:00:00Z"),
    session("b", "2026-10-04T01:00:00Z", "2026-10-04T02:00:00Z", {
      userId: "user-2",
      employeeName: "Hazriq",
    }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.employeeName),
    ["Maryfat", "Hazriq"],
  );
});
