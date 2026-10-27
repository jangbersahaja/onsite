import { getOffDayDateKeys } from "@/lib/timesheet-off-days";
import assert from "node:assert/strict";
import test from "node:test";

test("off days start at the onsite tracking start date when no filter is set", () => {
  assert.deepEqual(
    getOffDayDateKeys({
      today: "2026-09-28",
      workedDateKeys: ["2026-09-26"],
    }),
    ["2026-09-27", "2026-09-28"],
  );
});

test("off days never include dates before the onsite tracking start date", () => {
  assert.deepEqual(
    getOffDayDateKeys({
      from: "2026-09-20",
      to: "2026-09-27",
      today: "2026-10-27",
      workedDateKeys: [],
    }),
    ["2026-09-26", "2026-09-27"],
  );
});

test("off days stop at the To filter", () => {
  assert.deepEqual(
    getOffDayDateKeys({
      from: "2026-09-26",
      to: "2026-09-27",
      today: "2026-10-27",
      workedDateKeys: [],
    }),
    ["2026-09-26", "2026-09-27"],
  );
});

test("off days are capped at today even when To is in the future", () => {
  assert.deepEqual(
    getOffDayDateKeys({
      to: "2026-12-31",
      today: "2026-09-27",
      workedDateKeys: [],
    }),
    ["2026-09-26", "2026-09-27"],
  );
});

test("worked dates are excluded from off days", () => {
  assert.deepEqual(
    getOffDayDateKeys({
      from: "2026-09-26",
      to: "2026-09-29",
      today: "2026-10-27",
      workedDateKeys: ["2026-09-27", "2026-09-29"],
    }),
    ["2026-09-26", "2026-09-28"],
  );
});

test("off days are empty when the range ends before it starts", () => {
  assert.deepEqual(
    getOffDayDateKeys({
      from: "2026-10-01",
      to: "2026-09-30",
      today: "2026-10-27",
      workedDateKeys: [],
    }),
    [],
  );
});
