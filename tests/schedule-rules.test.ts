import {
  addMonths,
  dateRangeKeys,
  endOfMonth,
  evaluateAttendance,
  findScheduleConflicts,
  punctualityRate,
  shiftLocalDateTimes,
  shiftSpanMinutes,
  startOfWeek,
  summarizeAttendance,
  validateShiftTimes,
} from "@/lib/schedule-rules";
import assert from "node:assert/strict";
import test from "node:test";

const at = (time: string) => new Date(`2026-11-02T${time}:00Z`);

test("shift spans wrap past midnight", () => {
  assert.equal(shiftSpanMinutes("09:00", "17:00"), 480);
  assert.equal(shiftSpanMinutes("22:00", "06:00"), 480);
  assert.deepEqual(shiftLocalDateTimes("2026-11-30", "22:00", "02:00"), {
    start: "2026-11-30T22:00",
    end: "2026-12-01T02:00",
  });
});

test("shift validation rejects bad lengths and breaks", () => {
  assert.equal(
    validateShiftTimes({
      startTime: "09:00",
      endTime: "17:00",
      breakMinutes: 60,
    }),
    null,
  );
  assert.match(
    validateShiftTimes({
      startTime: "09:00",
      endTime: "09:05",
      breakMinutes: 0,
    })!,
    /at least/,
  );
  assert.match(
    validateShiftTimes({
      startTime: "06:00",
      endTime: "23:30",
      breakMinutes: 0,
    })!,
    /longer than/,
  );
  assert.match(
    validateShiftTimes({
      startTime: "09:00",
      endTime: "10:00",
      breakMinutes: 60,
    })!,
    /Break/,
  );
  assert.match(
    validateShiftTimes({
      startTime: "9:00",
      endTime: "10:00",
      breakMinutes: 0,
    })!,
    /valid/,
  );
});

test("calendar helpers use Monday weeks and month bounds", () => {
  assert.equal(startOfWeek("2026-11-05"), "2026-11-02");
  assert.equal(startOfWeek("2026-11-08"), "2026-11-02");
  assert.equal(startOfWeek("2026-11-02"), "2026-11-02");
  assert.equal(endOfMonth("2028-02-10"), "2028-02-29");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-01");
  assert.equal(addMonths("2026-01-31", -1), "2025-12-01");
  assert.deepEqual(dateRangeKeys("2026-10-30", "2026-11-02"), [
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
    "2026-11-02",
  ]);
});

test("conflicts are found only for the same staff member", () => {
  assert.deepEqual(
    findScheduleConflicts([
      { userId: "a", startAt: at("09:00"), endAt: at("13:00") },
      { userId: "b", startAt: at("10:00"), endAt: at("14:00") },
      { userId: "a", startAt: at("13:00"), endAt: at("17:00") },
      { userId: "a", startAt: at("12:00"), endAt: at("14:00") },
    ]),
    [
      [0, 3],
      [2, 3],
    ],
  );
});

const shift = {
  id: "s1",
  userId: "a",
  startAt: at("09:00"),
  endAt: at("17:00"),
};

test("on-time completed shift has no flags", () => {
  const { results, unscheduled } = evaluateAttendance(
    [shift],
    [
      {
        id: "w1",
        userId: "a",
        clockInAt: at("09:03"),
        clockOutAt: at("17:05"),
        workedMinutes: 422,
      },
    ],
    at("20:00"),
  );
  const result = results.get("s1")!;
  assert.equal(result.status, "completed");
  assert.deepEqual(result.flags, []);
  assert.equal(result.lateMinutes, 3);
  assert.equal(result.overtimeMinutes, 0);
  assert.equal(unscheduled.length, 0);
});

test("early clock-in is reported without flagging", () => {
  const early = evaluateAttendance(
    [shift],
    [
      {
        id: "w1",
        userId: "a",
        clockInAt: at("08:45"),
        clockOutAt: at("17:00"),
        workedMinutes: 495,
      },
    ],
    at("20:00"),
  ).results.get("s1")!;
  assert.deepEqual(early.flags, []);
  assert.equal(early.earlyMinutes, 15);
  assert.equal(early.lateMinutes, 0);
});

test("late arrival, early leave and overtime are flagged", () => {
  const late = evaluateAttendance(
    [shift],
    [
      {
        id: "w1",
        userId: "a",
        clockInAt: at("09:20"),
        clockOutAt: at("16:30"),
        workedMinutes: 430,
      },
    ],
    at("20:00"),
  ).results.get("s1")!;
  assert.deepEqual(late.flags, ["late", "left_early"]);
  assert.equal(late.lateMinutes, 20);
  assert.equal(late.earlyLeaveMinutes, 30);

  const overtime = evaluateAttendance(
    [shift],
    [
      {
        id: "w1",
        userId: "a",
        clockInAt: at("08:55"),
        clockOutAt: at("18:10"),
        workedMinutes: 555,
      },
    ],
    at("20:00"),
  ).results.get("s1")!;
  assert.deepEqual(overtime.flags, ["overtime"]);
  assert.equal(overtime.overtimeMinutes, 70);
});

test("missing sessions become upcoming, not clocked in, then absent", () => {
  assert.equal(
    evaluateAttendance([shift], [], at("09:04")).results.get("s1")!.status,
    "upcoming",
  );
  const pending = evaluateAttendance([shift], [], at("09:30")).results.get(
    "s1",
  )!;
  assert.equal(pending.status, "not_clocked_in");
  assert.equal(pending.lateMinutes, 30);
  const absent = evaluateAttendance([shift], [], at("17:00")).results.get(
    "s1",
  )!;
  assert.equal(absent.status, "absent");
  assert.deepEqual(absent.flags, ["absent"]);
});

test("open sessions are in progress and split sessions merge", () => {
  const open = evaluateAttendance(
    [shift],
    [
      {
        id: "w1",
        userId: "a",
        clockInAt: at("09:00"),
        clockOutAt: null,
        workedMinutes: null,
      },
    ],
    at("12:00"),
  ).results.get("s1")!;
  assert.equal(open.status, "in_progress");
  assert.equal(open.clockOutAt, null);

  const split = evaluateAttendance(
    [shift],
    [
      {
        id: "w2",
        userId: "a",
        clockInAt: at("13:00"),
        clockOutAt: at("17:00"),
        workedMinutes: 240,
      },
      {
        id: "w1",
        userId: "a",
        clockInAt: at("09:00"),
        clockOutAt: at("12:00"),
        workedMinutes: 180,
      },
    ],
    at("20:00"),
  ).results.get("s1")!;
  assert.deepEqual(split.sessionIds, ["w1", "w2"]);
  assert.equal(split.workedMinutes, 420);
  assert.deepEqual(split.flags, []);
});

test("sessions far from any shift are unscheduled", () => {
  const { results, unscheduled } = evaluateAttendance(
    [shift],
    [
      {
        id: "w1",
        userId: "a",
        clockInAt: at("21:00"),
        clockOutAt: at("23:00"),
        workedMinutes: 120,
      },
      {
        id: "w2",
        userId: "b",
        clockInAt: at("09:00"),
        clockOutAt: at("17:00"),
        workedMinutes: 480,
      },
    ],
    at("23:30"),
  );
  assert.equal(results.get("s1")!.status, "absent");
  assert.deepEqual(
    unscheduled.map((session) => session.id),
    ["w1", "w2"],
  );
});

test("sessions attach to the shift they overlap most", () => {
  const morning = {
    id: "m",
    userId: "a",
    startAt: at("06:00"),
    endAt: at("10:00"),
  };
  const evening = {
    id: "e",
    userId: "a",
    startAt: at("11:00"),
    endAt: at("15:00"),
  };
  const { results } = evaluateAttendance(
    [morning, evening],
    [
      {
        id: "w1",
        userId: "a",
        clockInAt: at("09:30"),
        clockOutAt: at("15:00"),
        workedMinutes: 330,
      },
    ],
    at("20:00"),
  );
  assert.deepEqual(results.get("e")!.sessionIds, ["w1"]);
  assert.equal(results.get("m")!.status, "absent");
});

test("summary totals punctuality and exceptions per staff", () => {
  const shifts = [
    { ...shift, breakMinutes: 60 },
    {
      ...shift,
      id: "s2",
      startAt: at("18:00"),
      endAt: at("22:00"),
      breakMinutes: 0,
    },
    { ...shift, id: "s3", userId: "b", breakMinutes: 0 },
  ];
  const { results, unscheduled } = evaluateAttendance(
    shifts,
    [
      {
        id: "w1",
        userId: "a",
        clockInAt: at("09:30"),
        clockOutAt: at("17:00"),
        workedMinutes: 390,
      },
      {
        id: "w9",
        userId: "c",
        clockInAt: at("09:00"),
        clockOutAt: at("10:00"),
        workedMinutes: 60,
      },
    ],
    at("23:00"),
  );
  const summary = summarizeAttendance(
    shifts.map((item) => ({
      ...item,
      attendance: results.get(item.id) ?? null,
    })),
    unscheduled,
  );
  const a = summary.find((row) => row.userId === "a")!;
  assert.equal(a.scheduledShifts, 2);
  assert.equal(a.scheduledMinutes, 420 + 240);
  assert.equal(a.late, 1);
  assert.equal(a.lateMinutes, 30);
  assert.equal(a.absent, 1);
  assert.equal(punctualityRate(a), 0);
  const c = summary.find((row) => row.userId === "c")!;
  assert.equal(c.unscheduled, 1);
  assert.equal(c.unscheduledMinutes, 60);
  assert.equal(punctualityRate(c), null);
});

test("summary totals early clock-in minutes without counting them as late", () => {
  const { results, unscheduled } = evaluateAttendance(
    [shift],
    [
      {
        id: "w1",
        userId: "a",
        clockInAt: at("08:45"),
        clockOutAt: at("17:00"),
        workedMinutes: 495,
      },
    ],
    at("20:00"),
  );
  const summary = summarizeAttendance(
    [{ ...shift, breakMinutes: 0, attendance: results.get("s1")! }],
    unscheduled,
  );
  const a = summary.find((row) => row.userId === "a")!;
  assert.equal(a.earlyMinutes, 15);
  assert.equal(a.late, 0);
});

test("break compliance compares total break minutes with the planned length", () => {
  const breakFlags = (completedBreaks: number[], breakMinutes = 60) =>
    evaluateAttendance(
      [{ ...shift, breakMinutes }],
      completedBreaks.map((minutes, index) => ({
        id: `w${index}`,
        userId: "a",
        clockInAt: at(index === 0 ? "09:00" : "13:00"),
        clockOutAt: at(index === 0 ? "13:00" : "17:00"),
        workedMinutes: 0,
        completedBreakMinutes: minutes,
      })),
      at("20:00"),
    )
      .results.get("s1")!
      .flags.filter((flag) => flag.endsWith("_break"));

  assert.deepEqual(breakFlags([60]), []);
  assert.deepEqual(breakFlags([55]), []);
  assert.deepEqual(breakFlags([65]), []);
  assert.deepEqual(breakFlags([54]), ["short_break"]);
  assert.deepEqual(breakFlags([25, 20]), ["short_break"]);
  assert.deepEqual(breakFlags([40, 30]), ["long_break"]);
  assert.deepEqual(breakFlags([66]), ["long_break"]);
  assert.deepEqual(breakFlags([0]), ["missed_break"]);
  assert.deepEqual(breakFlags([0], 0), []);
});

test("summary totals break minutes and flagged worked shifts only", () => {
  const { results, unscheduled } = evaluateAttendance(
    [{ ...shift, breakMinutes: 60 }],
    [
      {
        id: "w1",
        userId: "a",
        clockInAt: at("09:00"),
        clockOutAt: at("17:00"),
        workedMinutes: 420,
        completedBreakMinutes: 30,
      },
    ],
    at("20:00"),
  );
  const summary = summarizeAttendance(
    [
      {
        ...shift,
        breakMinutes: 60,
        attendance: results.get("s1")!,
      },
      {
        ...shift,
        id: "s2",
        breakMinutes: 60,
        attendance: {
          ...results.get("s1")!,
          sessionIds: [],
          status: "absent",
          flags: ["absent"],
          plannedBreakMinutes: 60,
          actualBreakMinutes: 0,
        },
      },
    ],
    unscheduled,
  );
  const a = summary.find((row) => row.userId === "a")!;
  assert.equal(a.workedShifts, 1);
  assert.equal(a.breakPlannedMinutes, 60);
  assert.equal(a.breakActualMinutes, 30);
  assert.equal(a.breakIssues, 1);
});
