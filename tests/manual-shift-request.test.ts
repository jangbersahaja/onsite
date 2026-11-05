import assert from "node:assert/strict";
import test from "node:test";
import {
  manualShiftRequestSchema,
  manualShiftReviewSchema,
  parseStoredBreaks,
  serializeBreaks,
  toManualBreaks,
} from "../lib/manual-shift-request";

const outletId = "7b6f2a52-2d0e-4c53-9d1f-0f4f6c2a9e11";

const validRequest = {
  outletId,
  clockInAt: "2026-10-03T09:00",
  clockOutAt: "2026-10-03T17:00",
  breaks: [
    {
      startedAt: "2026-10-03T01:00:00.000Z",
      endedAt: "2026-10-03T01:30:00.000Z",
    },
  ],
  reasonCode: "forgot_clock_in",
  reason: "Worked the lunch rush without a phone.",
};

test("a valid past-shift request is accepted", () => {
  assert.equal(manualShiftRequestSchema.safeParse(validRequest).success, true);
});

test("breaks are optional", () => {
  const { breaks: _breaks, ...withoutBreaks } = validRequest;
  assert.equal(manualShiftRequestSchema.safeParse(withoutBreaks).success, true);
});

test("an unknown reason code is rejected", () => {
  const result = manualShiftRequestSchema.safeParse({
    ...validRequest,
    reasonCode: "made_up",
  });
  assert.equal(result.success, false);
});

test("a reason shorter than 3 characters is rejected", () => {
  const result = manualShiftRequestSchema.safeParse({
    ...validRequest,
    reason: "  ab ",
  });
  assert.equal(result.success, false);
});

test("local times must use the YYYY-MM-DDTHH:mm shape", () => {
  const result = manualShiftRequestSchema.safeParse({
    ...validRequest,
    clockInAt: "2026-10-03 09:00",
  });
  assert.equal(result.success, false);
});

test("break times must carry an offset", () => {
  const result = manualShiftRequestSchema.safeParse({
    ...validRequest,
    breaks: [{ startedAt: "2026-10-03T12:00", endedAt: "2026-10-03T12:30" }],
  });
  assert.equal(result.success, false);
});

test("unknown keys are rejected", () => {
  const result = manualShiftRequestSchema.safeParse({
    ...validRequest,
    status: "approved",
  });
  assert.equal(result.success, false);
});

test("rejecting a request without a note fails", () => {
  const result = manualShiftReviewSchema.safeParse({
    requestId: "2c1f4e8a-9b3d-4f6e-8a7c-5d2b1e0f9a33",
    outletId,
    decision: "reject",
    reason: "   ",
  });
  assert.equal(result.success, false);
});

test("approving without a note is allowed", () => {
  const result = manualShiftReviewSchema.safeParse({
    requestId: "2c1f4e8a-9b3d-4f6e-8a7c-5d2b1e0f9a33",
    outletId,
    decision: "approve",
    reason: "",
  });
  assert.equal(result.success, true);
});

test("breaks survive a serialise and parse round trip", () => {
  const breaks = toManualBreaks(validRequest.breaks);
  const stored = serializeBreaks(breaks);
  assert.deepEqual(stored, [
    {
      startedAt: "2026-10-03T01:00:00.000Z",
      endedAt: "2026-10-03T01:30:00.000Z",
    },
  ]);
  assert.deepEqual(parseStoredBreaks(stored), breaks);
});

test("malformed stored break rows are skipped", () => {
  const parsed = parseStoredBreaks([
    {
      startedAt: "2026-10-03T01:00:00.000Z",
      endedAt: "2026-10-03T01:30:00.000Z",
    },
    { startedAt: "not a date", endedAt: "2026-10-03T01:30:00.000Z" },
    { startedAt: 42, endedAt: "2026-10-03T01:30:00.000Z" },
    null,
    "break",
  ]);
  assert.equal(parsed.length, 1);
});

test("non-array stored breaks yield no breaks", () => {
  assert.deepEqual(parseStoredBreaks(null), []);
  assert.deepEqual(parseStoredBreaks({ startedAt: "x" }), []);
});
