import assert from "node:assert/strict";
import test from "node:test";
import { buildShiftCorrectionRequests } from "../lib/shift-correction";

// Stand-in converter: maps "YYYY-MM-DDTHH:mm" to a readable token.
const toISO = (local: string) => `iso:${local}`;

const original = {
  clockInAt: "2026-10-03T09:00",
  clockOutAt: "2026-10-03T17:00",
  breaks: [
    { id: "b1", startedAt: "2026-10-03T12:00", endedAt: "2026-10-03T12:30" },
    { id: "b2", startedAt: "2026-10-03T15:00", endedAt: "2026-10-03T15:15" },
  ],
};

test("no changes produce no requests", () => {
  assert.deepEqual(buildShiftCorrectionRequests(original, original, toISO), []);
});

test("changing clock-in produces one clock_in request", () => {
  const requests = buildShiftCorrectionRequests(
    original,
    { ...original, clockInAt: "2026-10-03T08:45" },
    toISO,
  );
  assert.deepEqual(requests, [
    {
      event: "clock_in",
      requestedAt: "iso:2026-10-03T08:45",
      workBreakId: null,
      breakStartedAt: null,
      breakEndedAt: null,
    },
  ]);
});

test("clock-in moved past the old clock-out sends clock_out first", () => {
  const requests = buildShiftCorrectionRequests(
    original,
    {
      clockInAt: "2026-10-03T18:00",
      clockOutAt: "2026-10-03T19:00",
      breaks: original.breaks,
    },
    toISO,
  );
  assert.deepEqual(
    requests.map((request) => request.event),
    ["clock_out", "clock_in"],
  );
});

test("an open shift can get a clock-out", () => {
  const requests = buildShiftCorrectionRequests(
    { ...original, clockOutAt: "" },
    { ...original, clockOutAt: "2026-10-03T17:30" },
    toISO,
  );
  assert.deepEqual(requests, [
    {
      event: "clock_out",
      requestedAt: "iso:2026-10-03T17:30",
      workBreakId: null,
      breakStartedAt: null,
      breakEndedAt: null,
    },
  ]);
});

test("removed breaks are deleted before updates and adds", () => {
  const requests = buildShiftCorrectionRequests(
    original,
    {
      ...original,
      breaks: [
        {
          id: "b1",
          startedAt: "2026-10-03T12:10",
          endedAt: "2026-10-03T12:30",
        },
        {
          id: null,
          startedAt: "2026-10-03T13:00",
          endedAt: "2026-10-03T13:20",
        },
      ],
    },
    toISO,
  );
  assert.deepEqual(
    requests.map((request) => [request.event, request.workBreakId]),
    [
      ["break_delete", "b2"],
      ["break_update", "b1"],
      ["break_add", null],
    ],
  );
  assert.equal(requests[1].breakStartedAt, "iso:2026-10-03T12:10");
  assert.equal(requests[2].breakEndedAt, "iso:2026-10-03T13:20");
});

test("an open break keeps a null end", () => {
  const openShift = {
    ...original,
    breaks: [{ id: "b1", startedAt: "2026-10-03T12:00", endedAt: "" }],
  };
  const requests = buildShiftCorrectionRequests(
    openShift,
    {
      ...openShift,
      breaks: [{ id: "b1", startedAt: "2026-10-03T12:05", endedAt: "" }],
    },
    toISO,
  );
  assert.deepEqual(requests, [
    {
      event: "break_update",
      requestedAt: "iso:2026-10-03T12:05",
      workBreakId: "b1",
      breakStartedAt: "iso:2026-10-03T12:05",
      breakEndedAt: null,
    },
  ]);
});
