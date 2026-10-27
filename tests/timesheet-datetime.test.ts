import {
  datePart,
  relinkShiftToDate,
  suggestBreak,
  suggestClockOut,
  withDatePart,
} from "@/lib/timesheet-datetime";
import assert from "node:assert/strict";
import test from "node:test";

test("date part is read only from complete local values", () => {
  assert.equal(datePart("2026-10-27T09:00"), "2026-10-27");
  assert.equal(datePart(""), null);
  assert.equal(datePart("2026-10-27"), null);
});

test("changing the date keeps the time", () => {
  assert.equal(
    withDatePart("2026-10-27T09:15", "2026-10-28"),
    "2026-10-28T09:15",
  );
});

test("clock-out is suggested eight hours after clock-in on the same day", () => {
  assert.equal(suggestClockOut("2026-10-27T09:00"), "2026-10-27T17:00");
  assert.equal(suggestClockOut("2026-10-27T20:00"), "2026-10-27T23:59");
  assert.equal(suggestClockOut(""), "");
});

test("first break starts at clock-in and ends 30 minutes later", () => {
  assert.deepEqual(suggestBreak("2026-10-27T09:00", ""), {
    startedAt: "2026-10-27T09:00",
    endedAt: "2026-10-27T09:30",
  });
});

test("next break starts at the previous break end on the same day", () => {
  assert.deepEqual(suggestBreak("2026-10-27T09:00", "2026-10-27T12:30"), {
    startedAt: "2026-10-27T12:30",
    endedAt: "2026-10-27T13:00",
  });
});

test("previous break end on another day is ignored", () => {
  assert.deepEqual(suggestBreak("2026-10-27T09:00", "2026-10-26T12:30"), {
    startedAt: "2026-10-27T09:00",
    endedAt: "2026-10-27T09:30",
  });
});

test("break suggestions are empty until clock-in is set", () => {
  assert.deepEqual(suggestBreak("", "2026-10-27T12:30"), {
    startedAt: "",
    endedAt: "",
  });
});

test("moving clock-in moves same-day clock-out and breaks", () => {
  const result = relinkShiftToDate({
    fromDate: "2026-10-27",
    clockIn: "2026-10-28T09:00",
    clockOutAt: "2026-10-27T17:00",
    breaks: [
      { id: "a", startedAt: "2026-10-27T12:00", endedAt: "2026-10-27T12:30" },
    ],
  });

  assert.equal(result.clockOutAt, "2026-10-28T17:00");
  assert.deepEqual(result.breaks, [
    { id: "a", startedAt: "2026-10-28T12:00", endedAt: "2026-10-28T12:30" },
  ]);
});

test("values on other dates are kept when clock-in moves", () => {
  const result = relinkShiftToDate({
    fromDate: "2026-10-27",
    clockIn: "2026-10-28T09:00",
    clockOutAt: "2026-10-29T01:00",
    breaks: [
      { id: null, startedAt: "2026-10-27T23:00", endedAt: "2026-10-28T00:30" },
    ],
  });

  assert.equal(result.clockOutAt, "2026-10-29T01:00");
  assert.deepEqual(result.breaks, [
    { id: null, startedAt: "2026-10-28T23:00", endedAt: "2026-10-28T00:30" },
  ]);
});

test("empty clock-out is suggested when clock-in is set", () => {
  const result = relinkShiftToDate({
    fromDate: null,
    clockIn: "2026-10-27T09:00",
    clockOutAt: "",
    breaks: [],
  });

  assert.equal(result.clockOutAt, "2026-10-27T17:00");
});

test("clock-out is kept when there is no previous clock-in date", () => {
  const result = relinkShiftToDate({
    fromDate: null,
    clockIn: "2026-10-28T09:00",
    clockOutAt: "2026-10-27T17:00",
    breaks: [],
  });

  assert.equal(result.clockOutAt, "2026-10-27T17:00");
});
