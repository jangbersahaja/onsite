import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDutyBoard, type DutyBoardData } from "@/lib/clock-duty";

const ME = "me";
const AMY = "amy";
const BEN = "ben";

function shift(id: string, userId: string, startAt: string, endAt: string) {
  return {
    id,
    outletId: "outlet-1",
    userId,
    date: "2025-06-10",
    startAt,
    endAt,
    startTime: startAt.slice(11, 16),
    endTime: endAt.slice(11, 16),
    endsNextDay: false,
    breakMinutes: 0,
    note: null,
    template: null,
  };
}

function data(overrides: Partial<DutyBoardData>): DutyBoardData {
  return {
    today: "2025-06-10",
    currentUserId: ME,
    staff: [
      { userId: ME, name: "Me", photoUrl: null },
      { userId: AMY, name: "Amy", photoUrl: null },
      { userId: BEN, name: "Ben", photoUrl: null },
    ],
    shifts: [],
    sessions: [],
    ...overrides,
  };
}

describe("buildDutyBoard", () => {
  const now = new Date("2025-06-10T10:00:00.000Z");

  it("derives upcoming, late, on break, completed and absent shift states", () => {
    const board = buildDutyBoard(
      data({
        shifts: [
          shift("s-up", ME, "2025-06-10T12:00:00.000Z", "2025-06-10T16:00:00.000Z"),
          shift("s-late", AMY, "2025-06-10T08:00:00.000Z", "2025-06-10T12:00:00.000Z"),
          shift("s-break", BEN, "2025-06-10T09:00:00.000Z", "2025-06-10T13:00:00.000Z"),
          shift("s-done", ME, "2025-06-10T06:00:00.000Z", "2025-06-10T08:00:00.000Z"),
          shift("s-absent", AMY, "2025-06-10T04:00:00.000Z", "2025-06-10T06:00:00.000Z"),
        ],
        sessions: [
          {
            id: "sess-ben",
            userId: BEN,
            clockInAt: "2025-06-10T09:00:00.000Z",
            clockOutAt: null,
            breaks: [{ startedAt: "2025-06-10T09:30:00.000Z", endedAt: null }],
          },
          {
            id: "sess-me",
            userId: ME,
            clockInAt: "2025-06-10T06:00:00.000Z",
            clockOutAt: "2025-06-10T08:00:00.000Z",
            breaks: [],
          },
        ],
      }),
      now,
    );

    const states = Object.fromEntries(
      board.shifts.map((row) => [row.shift.id, row.state]),
    );
    assert.equal(states["s-up"], "upcoming");
    assert.equal(states["s-late"], "late");
    assert.equal(states["s-break"], "on_break");
    assert.equal(states["s-done"], "completed");
    assert.equal(states["s-absent"], "absent");

    const upcoming = board.shifts.find((row) => row.shift.id === "s-up");
    assert.equal(upcoming?.startsInMinutes, 120);

    const late = board.shifts.find((row) => row.shift.id === "s-late");
    assert.equal(late?.lateMinutes, 120);
  });

  it("lists open sessions as on duty, including unscheduled ones", () => {
    const board = buildDutyBoard(
      data({
        sessions: [
          {
            id: "sess-amy",
            userId: AMY,
            clockInAt: "2025-06-10T09:45:00.000Z",
            clockOutAt: null,
            breaks: [],
          },
        ],
      }),
      now,
    );

    assert.equal(board.onDuty.length, 1);
    assert.equal(board.onDuty[0].state, "on_duty");
    assert.equal(board.onDuty[0].person.name, "Amy");
    assert.equal(board.onDuty[0].shiftId, null);
    assert.equal(board.onDuty[0].person.isCurrentUser, false);
  });

  it("only includes shifts dated today on the shift list", () => {
    const board = buildDutyBoard(
      data({
        shifts: [
          { ...shift("s-yday", ME, "2025-06-09T12:00:00.000Z", "2025-06-09T16:00:00.000Z"), date: "2025-06-09" },
        ],
      }),
      now,
    );

    assert.deepEqual(board.shifts, []);
  });
});
