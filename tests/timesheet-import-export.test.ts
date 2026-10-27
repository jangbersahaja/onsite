import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImportedShift,
  buildTimesheetImportExport,
  parseTimesheetImportCsv,
  type ImportCells,
  type ImportRecord,
} from "../lib/timesheet-import";

const TZ = "Asia/Kuala_Lumpur"; // UTC+08:00, no DST
const NOW = new Date("2026-12-31T00:00:00Z");

function record(overrides: Partial<ImportCells> = {}): ImportRecord {
  const cells: ImportCells = {
    staff_code: "YDM-001",
    clock_in_date: "2026-10-03",
    clock_in_time: "09:00",
    clock_out_date: "2026-10-03",
    clock_out_time: "17:00",
    break_1_start: "",
    break_1_end: "",
    break_2_start: "",
    break_2_end: "",
    break_3_start: "",
    break_3_end: "",
    ...overrides,
  };
  return { rowNumber: 2, cells };
}

test("export writes a closed shift with break datetimes in outlet time", () => {
  const csv = buildTimesheetImportExport([
    {
      staffCode: "YDM-001",
      timezone: TZ,
      clockInAt: "2026-10-03T01:00:00.000Z", // 09:00 KL
      clockOutAt: "2026-10-03T10:00:00.000Z", // 18:00 KL
      breaks: [
        {
          startedAt: "2026-10-03T04:00:00.000Z", // 12:00 KL
          endedAt: "2026-10-03T04:30:00.000Z", // 12:30 KL
        },
      ],
    },
  ]);
  assert.equal(
    csv,
    "staff_code,clock_in_date,clock_in_time,clock_out_date,clock_out_time," +
      "break_1_start_date,break_1_start_time,break_1_end_date,break_1_end_time," +
      "break_2_start_date,break_2_start_time,break_2_end_date,break_2_end_time," +
      "break_3_start_date,break_3_start_time,break_3_end_date,break_3_end_time\r\n" +
      "YDM-001,2026-10-03,09:00,2026-10-03,18:00," +
      "2026-10-03,12:00,2026-10-03,12:30" +
      ",,,,,,,,\r\n",
  );
});

test("export leaves out open shifts because the import needs a clock out", () => {
  const csv = buildTimesheetImportExport([
    {
      staffCode: "YDM-001",
      timezone: TZ,
      clockInAt: new Date("2026-10-03T01:00:00.000Z"),
      clockOutAt: null,
      breaks: [],
    },
  ]);
  assert.equal(csv.includes("YDM-001"), false);
  assert.ok(csv.startsWith("staff_code,"));
});

test("export round-trips through the importer with the same instants", () => {
  const shift = {
    staffCode: "YDM-002",
    timezone: TZ,
    clockInAt: new Date("2026-10-03T14:00:00.000Z"), // 22:00 KL
    clockOutAt: new Date("2026-10-03T18:00:00.000Z"), // 02:00 KL next day
    breaks: [
      {
        startedAt: new Date("2026-10-03T15:30:00.000Z"), // 23:30 KL
        endedAt: new Date("2026-10-03T16:15:00.000Z"), // 00:15 KL
      },
      {
        startedAt: new Date("2026-10-03T16:30:00.000Z"), // 00:30 KL
        endedAt: new Date("2026-10-03T16:40:00.000Z"), // 00:40 KL
      },
      {
        startedAt: new Date("2026-10-03T17:00:00.000Z"), // 01:00 KL
        endedAt: new Date("2026-10-03T17:10:00.000Z"), // 01:10 KL
      },
      {
        startedAt: new Date("2026-10-03T17:20:00.000Z"), // 01:20 KL
        endedAt: new Date("2026-10-03T17:25:00.000Z"), // 01:25 KL
      },
    ],
  };

  const csv = buildTimesheetImportExport([shift]);
  assert.match(
    csv,
    /break_4_start_date,break_4_start_time,break_4_end_date,break_4_end_time/,
  );

  const parsed = parseTimesheetImportCsv(csv);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.records.length, 1);

  const result = buildImportedShift(parsed.records[0], TZ, NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.staffCode, "YDM-002");
  assert.equal(result.clockInAt.toISOString(), shift.clockInAt.toISOString());
  assert.equal(result.clockOutAt.toISOString(), shift.clockOutAt.toISOString());
  assert.deepEqual(
    result.breaks.map((item) => [
      item.startedAt.toISOString(),
      item.endedAt?.toISOString(),
    ]),
    shift.breaks.map((item) => [
      item.startedAt.toISOString(),
      item.endedAt.toISOString(),
    ]),
  );
});

test("buildImportedShift accepts full datetime break cells", () => {
  const result = buildImportedShift(
    record({
      clock_in_time: "22:00",
      clock_out_date: "2026-10-04",
      clock_out_time: "02:00",
      break_1_start: "2026-10-03 23:30",
      break_1_end: "2026-10-04 00:15",
    }),
    TZ,
    NOW,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.breaks[0].startedAt.toISOString(),
    "2026-10-03T15:30:00.000Z",
  );
  assert.equal(
    result.breaks[0].endedAt?.toISOString(),
    "2026-10-03T16:15:00.000Z",
  );
});

test("buildImportedShift combines break date and time columns", () => {
  const result = buildImportedShift(
    record({
      clock_in_time: "22:00",
      clock_out_date: "2026-10-04",
      clock_out_time: "02:00",
      break_1_start_date: "2026-10-03",
      break_1_start_time: "23:30",
      break_1_end_date: "2026-10-04",
      break_1_end_time: "00:15",
    }),
    TZ,
    NOW,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.breaks[0].startedAt.toISOString(),
    "2026-10-03T15:30:00.000Z",
  );
  assert.equal(
    result.breaks[0].endedAt?.toISOString(),
    "2026-10-03T16:15:00.000Z",
  );
});

test("buildImportedShift requires both date and time for a break edge", () => {
  const result = buildImportedShift(
    record({
      break_1_start_date: "2026-10-03",
      break_1_end_date: "2026-10-03",
      break_1_end_time: "12:30",
    }),
    TZ,
    NOW,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(
    result.error,
    "break_1_start_date and break_1_start_time must both be filled in.",
  );
});

test("buildImportedShift rejects a legacy break cell mixed with date columns", () => {
  const result = buildImportedShift(
    record({
      break_1_start: "2026-10-03 12:00",
      break_1_start_date: "2026-10-03",
      break_1_start_time: "12:00",
      break_1_end: "2026-10-03 12:30",
    }),
    TZ,
    NOW,
  );
  assert.equal(result.ok, false);
});

test("buildImportedShift rejects an impossible break datetime", () => {
  const result = buildImportedShift(
    record({
      break_1_start: "2026-02-30 12:00",
      break_1_end: "2026-02-30 12:30",
    }),
    TZ,
    NOW,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rowNumber, 2);
});

test("export orders rows by clock-in time, earliest first", () => {
  const csv = buildTimesheetImportExport([
    {
      staffCode: "YDM-001",
      timezone: TZ,
      clockInAt: "2026-10-19T01:00:00.000Z",
      clockOutAt: "2026-10-19T10:00:00.000Z",
      breaks: [],
    },
    {
      staffCode: "YDM-001",
      timezone: TZ,
      clockInAt: "2026-10-02T01:00:00.000Z",
      clockOutAt: "2026-10-02T10:00:00.000Z",
      breaks: [],
    },
  ]);
  const dates = csv
    .trim()
    .split("\r\n")
    .slice(1)
    .map((line) => line.split(",")[1]);
  assert.deepEqual(dates, ["2026-10-02", "2026-10-19"]);
});

test("parseTimesheetImportCsv accepts break pairs up to the import limit", () => {
  const headers =
    "staff_code,clock_in_date,clock_in_time,clock_out_date,clock_out_time,break_10_start,break_10_end";
  const ok = parseTimesheetImportCsv(
    `${headers}\nYDM-001,2026-10-03,09:00,2026-10-03,17:00,,\n`,
  );
  assert.equal(ok.ok, true);

  const tooMany = parseTimesheetImportCsv(
    "staff_code,clock_in_date,clock_in_time,clock_out_date,clock_out_time,break_11_start\nYDM-001,2026-10-03,09:00,2026-10-03,17:00,\n",
  );
  assert.deepEqual(tooMany, {
    ok: false,
    error: "Unknown column: break_11_start.",
  });
});
