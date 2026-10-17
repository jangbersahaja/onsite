import {
  planBreakChange,
  type ShiftBreak,
  type ShiftTimes,
} from "@/lib/break-corrections";
import assert from "node:assert/strict";
import test from "node:test";

const at = (time: string) => new Date(`2026-10-03T${time}:00.000Z`);

const closedShift: ShiftTimes = {
  clockInAt: at("09:00"),
  clockOutAt: at("17:00"),
};

const openShift: ShiftTimes = {
  clockInAt: at("09:00"),
  clockOutAt: null,
};

const now = at("18:00");

const closedBreak: ShiftBreak = {
  id: "b1",
  startedAt: at("10:00"),
  endedAt: at("10:15"),
};

const openBreak: ShiftBreak = {
  id: "b2",
  startedAt: at("14:00"),
  endedAt: null,
};

test("adds a break inside the shift without overlapping existing breaks", () => {
  const plan = planBreakChange(
    closedShift,
    [closedBreak],
    { kind: "add", startedAt: at("12:00"), endedAt: at("12:30") },
    now,
  );
  assert.deepEqual(plan, { ok: true, target: null });
});

test("rejects an added break that overlaps an existing break", () => {
  const plan = planBreakChange(
    closedShift,
    [closedBreak],
    { kind: "add", startedAt: at("10:10"), endedAt: at("10:30") },
    now,
  );
  assert.deepEqual(plan, { ok: false, error: "break_invalid" });
});

test("rejects an added break that starts before clock-in", () => {
  const plan = planBreakChange(
    closedShift,
    [],
    { kind: "add", startedAt: at("08:00"), endedAt: at("08:30") },
    now,
  );
  assert.deepEqual(plan, { ok: false, error: "break_invalid" });
});

test("rejects an added break that ends after clock-out", () => {
  const plan = planBreakChange(
    closedShift,
    [],
    { kind: "add", startedAt: at("16:50"), endedAt: at("17:10") },
    now,
  );
  assert.deepEqual(plan, { ok: false, error: "break_invalid" });
});

test("allows adding a closed break on a shift that is still open", () => {
  const plan = planBreakChange(
    openShift,
    [],
    { kind: "add", startedAt: at("12:00"), endedAt: at("12:30") },
    now,
  );
  assert.deepEqual(plan, { ok: true, target: null });
});

test("updates the times of a closed break", () => {
  const plan = planBreakChange(
    closedShift,
    [closedBreak],
    {
      kind: "update",
      workBreakId: "b1",
      startedAt: at("10:05"),
      endedAt: at("10:20"),
    },
    now,
  );
  assert.deepEqual(plan, { ok: true, target: closedBreak });
});

test("rejects an update that moves a break onto another break", () => {
  const plan = planBreakChange(
    closedShift,
    [closedBreak, { id: "b3", startedAt: at("12:00"), endedAt: at("12:30") }],
    {
      kind: "update",
      workBreakId: "b1",
      startedAt: at("12:10"),
      endedAt: at("12:20"),
    },
    now,
  );
  assert.deepEqual(plan, { ok: false, error: "break_invalid" });
});

test("reports a missing break as not found", () => {
  const plan = planBreakChange(
    closedShift,
    [closedBreak],
    {
      kind: "update",
      workBreakId: "missing",
      startedAt: at("10:00"),
      endedAt: at("10:10"),
    },
    now,
  );
  assert.deepEqual(plan, { ok: false, error: "break_not_found" });
});

test("allows correcting the start of an open break but not setting its end", () => {
  const startOnly = planBreakChange(
    openShift,
    [openBreak],
    {
      kind: "update",
      workBreakId: "b2",
      startedAt: at("13:55"),
      endedAt: null,
    },
    now,
  );
  assert.deepEqual(startOnly, { ok: true, target: openBreak });

  const withEnd = planBreakChange(
    openShift,
    [openBreak],
    {
      kind: "update",
      workBreakId: "b2",
      startedAt: at("14:00"),
      endedAt: at("14:30"),
    },
    now,
  );
  assert.deepEqual(withEnd, { ok: false, error: "break_end_locked" });
});

test("rejects reopening a closed break", () => {
  const plan = planBreakChange(
    openShift,
    [closedBreak],
    {
      kind: "update",
      workBreakId: "b1",
      startedAt: at("10:00"),
      endedAt: null,
    },
    now,
  );
  assert.deepEqual(plan, { ok: false, error: "break_invalid" });
});

test("deletes an existing break", () => {
  const plan = planBreakChange(
    closedShift,
    [closedBreak],
    { kind: "delete", workBreakId: "b1" },
    now,
  );
  assert.deepEqual(plan, { ok: true, target: closedBreak });
});

test("reports deleting a missing break as not found", () => {
  const plan = planBreakChange(
    closedShift,
    [closedBreak],
    { kind: "delete", workBreakId: "missing" },
    now,
  );
  assert.deepEqual(plan, { ok: false, error: "break_not_found" });
});

test("rejects a break that starts in the future", () => {
  const plan = planBreakChange(
    closedShift,
    [],
    { kind: "add", startedAt: at("19:00"), endedAt: at("19:30") },
    now,
  );
  assert.deepEqual(plan, { ok: false, error: "break_in_future" });
});

test("tolerates small clock skew but rejects times beyond the tolerance", () => {
  const withinTolerance = planBreakChange(
    openShift,
    [],
    {
      kind: "add",
      startedAt: at("17:00"),
      endedAt: new Date(now.getTime() + 4 * 60_000),
    },
    now,
  );
  assert.deepEqual(withinTolerance, { ok: true, target: null });

  const beyondTolerance = planBreakChange(
    openShift,
    [],
    {
      kind: "add",
      startedAt: at("17:00"),
      endedAt: new Date(now.getTime() + 6 * 60_000),
    },
    now,
  );
  assert.deepEqual(beyondTolerance, { ok: false, error: "break_in_future" });
});
