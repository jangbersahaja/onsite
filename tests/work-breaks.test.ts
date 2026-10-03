import {
  getCompletedBreakMinutes,
  getWorkedMinutes,
  validateBreakIntervals,
} from "@/lib/work-breaks";
import assert from "node:assert/strict";
import test from "node:test";

test("worked minutes subtract completed breaks and leave open breaks uncounted", () => {
  const breaks = [
    {
      startedAt: "2026-10-03T10:00:00.000Z",
      endedAt: "2026-10-03T10:15:00.000Z",
    },
    {
      startedAt: "2026-10-03T12:00:00.000Z",
      endedAt: "2026-10-03T12:30:00.000Z",
    },
    { startedAt: "2026-10-03T14:00:00.000Z", endedAt: null },
  ];

  assert.equal(getCompletedBreakMinutes(breaks), 45);
  assert.equal(
    getWorkedMinutes(
      "2026-10-03T09:00:00.000Z",
      "2026-10-03T17:00:00.000Z",
      breaks,
    ),
    435,
  );
  assert.equal(
    getWorkedMinutes("2026-10-03T09:00:00.000Z", null, breaks),
    null,
  );
});

test("break minutes merge overlaps and ignore invalid intervals", () => {
  assert.equal(
    getCompletedBreakMinutes([
      {
        startedAt: "2026-10-03T10:00:00.000Z",
        endedAt: "2026-10-03T10:20:00.000Z",
      },
      {
        startedAt: "2026-10-03T10:10:00.000Z",
        endedAt: "2026-10-03T10:30:00.000Z",
      },
      {
        startedAt: "2026-10-03T11:00:00.000Z",
        endedAt: "2026-10-03T10:00:00.000Z",
      },
    ]),
    30,
  );
});

test("break schedules must be ordered, non-overlapping, and inside the shift", () => {
  const shiftStart = "2026-10-03T09:00:00.000Z";
  const shiftEnd = "2026-10-03T17:00:00.000Z";
  const firstBreak = {
    startedAt: "2026-10-03T10:00:00.000Z",
    endedAt: "2026-10-03T10:15:00.000Z",
  };

  assert.equal(
    validateBreakIntervals([firstBreak], shiftStart, shiftEnd),
    true,
  );
  assert.equal(
    validateBreakIntervals(
      [
        firstBreak,
        {
          startedAt: "2026-10-03T10:10:00.000Z",
          endedAt: "2026-10-03T10:30:00.000Z",
        },
      ],
      shiftStart,
      shiftEnd,
    ),
    false,
  );
  assert.equal(
    validateBreakIntervals(
      [
        {
          startedAt: "2026-10-03T16:50:00.000Z",
          endedAt: "2026-10-03T17:10:00.000Z",
        },
      ],
      shiftStart,
      shiftEnd,
    ),
    false,
  );
  assert.equal(
    validateBreakIntervals(
      [firstBreak, { startedAt: "2026-10-03T11:00:00.000Z", endedAt: null }],
      shiftStart,
      null,
    ),
    true,
  );
});
