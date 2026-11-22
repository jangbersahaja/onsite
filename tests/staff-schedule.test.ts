import {
  nextScheduledShift,
  scheduleCalendarFile,
  toStaffScheduledShift,
  type StaffScheduledShift,
} from "@/lib/staff-schedule";
import assert from "node:assert/strict";
import test from "node:test";

const morning: StaffScheduledShift = {
  id: "morning",
  outletId: "outlet-1",
  date: "2026-11-22",
  startAt: "2026-11-22T01:00:00.000Z",
  endAt: "2026-11-22T09:00:00.000Z",
  startTime: "09:00",
  endTime: "17:00",
  endsNextDay: false,
  breakMinutes: 60,
  note: "Opening, stock count",
  template: { name: "Opening; AM", code: "AM", color: "amber" },
};

const overnight: StaffScheduledShift = {
  ...morning,
  id: "overnight",
  date: "2026-11-23",
  startAt: "2026-11-23T14:00:00.000Z",
  endAt: "2026-11-23T22:00:00.000Z",
  startTime: "22:00",
  endTime: "06:00",
  endsNextDay: true,
};

test("staff serializer excludes management and attendance fields", () => {
  const serialized = toStaffScheduledShift(
    {
      ...morning,
      userId: "staff-1",
      templateId: "template-1",
      status: "published",
      attendance: {
        status: "completed",
        flags: [],
        sessionIds: ["session-1"],
        clockInAt: morning.startAt,
        clockOutAt: morning.endAt,
        lateMinutes: 0,
        earlyMinutes: 0,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        workedMinutes: 420,
        plannedBreakMinutes: 60,
        actualBreakMinutes: 60,
      },
    },
    { name: "Opening", code: "AM", color: "not-allowed" },
  );

  assert.equal("userId" in serialized, false);
  assert.equal("status" in serialized, false);
  assert.equal("attendance" in serialized, false);
  assert.equal("templateId" in serialized, false);
  assert.equal(serialized.template?.color, "slate");
});

test("next shift ignores completed shifts and keeps an in-progress shift", () => {
  assert.equal(
    nextScheduledShift([morning, overnight], "2026-11-22T10:00:00.000Z"),
    overnight,
  );
  assert.equal(
    nextScheduledShift([morning, overnight], "2026-11-22T08:00:00.000Z"),
    morning,
  );
});

test("calendar export uses UTC event times and escaped text", () => {
  const calendar = scheduleCalendarFile(
    [morning],
    "Cafe, Central",
    new Date("2026-11-21T12:30:00.000Z"),
  );

  assert.match(calendar, /DTSTAMP:20261121T123000Z/);
  assert.match(calendar, /DTSTART:20261122T010000Z/);
  assert.match(calendar, /DTEND:20261122T090000Z/);
  assert.match(calendar, /SUMMARY:Opening\\; AM/);
  assert.match(calendar, /LOCATION:Cafe\\, Central/);
  assert.match(
    calendar,
    /DESCRIPTION:Opening\\, stock count\\nUnpaid break: 60 minutes/,
  );
  assert.match(calendar, /UID:morning@onsite/);
  assert.ok(calendar.endsWith("\r\n"));
});
