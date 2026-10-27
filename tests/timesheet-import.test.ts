import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImportedShift,
  buildTimesheetImportTemplate,
  parseCsvRows,
  parseTimesheetImportCsv,
  TIMESHEET_IMPORT_HEADERS,
  type ImportCells,
  type ImportRecord,
} from "../lib/timesheet-import";

const TZ = "Asia/Kuala_Lumpur"; // UTC+08:00, no DST
const NOW = new Date("2026-12-31T00:00:00Z");

function record(
  overrides: Partial<ImportCells> = {},
  rowNumber = 2,
): ImportRecord {
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
  return { rowNumber, cells };
}

test("parseCsvRows handles quoted commas, escaped quotes, and CRLF", () => {
  const rows = parseCsvRows('a,"b,c","say ""hi"""\r\n1,2,3\r\n');
  assert.deepEqual(rows, [
    ["a", "b,c", 'say "hi"'],
    ["1", "2", "3"],
  ]);
});

test("parseCsvRows strips a leading byte order mark", () => {
  assert.deepEqual(parseCsvRows("\uFEFFstaff_code,clock_in_date\n"), [
    ["staff_code", "clock_in_date"],
  ]);
});

test("parseCsvRows throws on an unclosed quoted value", () => {
  assert.throws(() => parseCsvRows('a,"unclosed\n'), /unclosed quoted value/);
});

test("parseTimesheetImportCsv rejects an empty file", () => {
  const result = parseTimesheetImportCsv("");
  assert.equal(result.ok, false);
});

test("parseTimesheetImportCsv reports missing required columns", () => {
  const result = parseTimesheetImportCsv(
    "staff_code,clock_in_date\nYDM-001,2026-10-03\n",
  );
  assert.deepEqual(result, {
    ok: false,
    error: "Missing columns: clock_in_time, clock_out_date, clock_out_time.",
  });
});

test("parseTimesheetImportCsv reports unknown and duplicate columns", () => {
  const headers = TIMESHEET_IMPORT_HEADERS.join(",");
  const unknown = parseTimesheetImportCsv(`${headers},notes\n`);
  assert.deepEqual(unknown, { ok: false, error: "Unknown column: notes." });

  const duplicate = parseTimesheetImportCsv(`${headers},staff_code\n`);
  assert.deepEqual(duplicate, {
    ok: false,
    error: "Duplicate column: staff_code.",
  });
});

test("parseTimesheetImportCsv matches headers case-insensitively and numbers rows from line 2", () => {
  const csv =
    "STAFF_CODE,clock_in_date,clock_in_time,clock_out_date,clock_out_time\n" +
    "YDM-001,2026-10-03,09:00,2026-10-03,17:00\n" +
    ",,,,\n" +
    "YDM-002,2026-10-03,10:00,2026-10-03,18:00\n";
  const result = parseTimesheetImportCsv(csv);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.records.map((item) => item.rowNumber),
    [2, 4],
  );
  assert.equal(result.records[0].cells.staff_code, "YDM-001");
});

test("parseTimesheetImportCsv reports a header-only file as having no shift rows", () => {
  const result = parseTimesheetImportCsv(buildTimesheetImportTemplate());
  assert.deepEqual(result, { ok: false, error: "The file has no shift rows." });
});

test("buildImportedShift reads times in the outlet timezone", () => {
  const result = buildImportedShift(record(), TZ, NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.staffCode, "YDM-001");
  assert.equal(result.clockInAt.toISOString(), "2026-10-03T01:00:00.000Z");
  assert.equal(result.clockOutAt.toISOString(), "2026-10-03T09:00:00.000Z");
  assert.deepEqual(result.breaks, []);
});

test("buildImportedShift walks breaks past midnight onto the next day", () => {
  const result = buildImportedShift(
    record({
      clock_in_time: "22:00",
      clock_out_date: "2026-10-04",
      clock_out_time: "02:00",
      break_1_start: "23:30",
      break_1_end: "00:15",
    }),
    TZ,
    NOW,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.breaks.length, 1);
  assert.equal(
    result.breaks[0].startedAt.toISOString(),
    "2026-10-03T15:30:00.000Z",
  );
  assert.equal(
    result.breaks[0].endedAt?.toISOString(),
    "2026-10-03T16:15:00.000Z",
  );
});

test("buildImportedShift rejects a break that starts before clock in", () => {
  const result = buildImportedShift(
    record({ break_1_start: "08:00", break_1_end: "08:30" }),
    TZ,
    NOW,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /Breaks must be ordered/);
});

test("buildImportedShift requires both halves of a break", () => {
  const result = buildImportedShift(
    record({ break_1_start: "12:00" }),
    TZ,
    NOW,
  );
  assert.deepEqual(result, {
    ok: false,
    rowNumber: 2,
    staffCode: "YDM-001",
    error: "break_1_start and break_1_end must both be filled in.",
  });
});

test("buildImportedShift rejects a clock out before clock in", () => {
  const result = buildImportedShift(
    record({ clock_in_time: "17:00", clock_out_time: "09:00" }),
    TZ,
    NOW,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "Clock out must be after clock in.");
});

test("buildImportedShift rejects times in the future", () => {
  const result = buildImportedShift(
    record(),
    TZ,
    new Date("2026-10-03T05:00:00Z"),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "Times cannot be in the future.");
});

test("buildImportedShift rejects malformed dates and times", () => {
  const badDate = buildImportedShift(
    record({ clock_in_date: "03/10/2026" }),
    TZ,
    NOW,
  );
  assert.equal(badDate.ok, false);
  if (!badDate.ok) {
    assert.equal(
      badDate.error,
      "clock_in_date must be a date in YYYY-MM-DD format.",
    );
  }

  const badTime = buildImportedShift(
    record({ clock_out_time: "5pm" }),
    TZ,
    NOW,
  );
  assert.equal(badTime.ok, false);
  if (!badTime.ok) {
    assert.equal(badTime.error, "clock_out_time must be 24-hour HH:MM.");
  }
});

test("buildImportedShift rejects a missing or invalid staff code", () => {
  const missing = buildImportedShift(record({ staff_code: "" }), TZ, NOW);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error, "staff_code is required.");

  const invalid = buildImportedShift(
    record({ staff_code: "bad code!" }),
    TZ,
    NOW,
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.staffCode, null);
    assert.match(invalid.error, /Staff code can only use/);
  }
});

test("buildTimesheetImportTemplate writes only the header row", () => {
  const template = buildTimesheetImportTemplate();
  assert.ok(template.endsWith("\r\n"));
  assert.equal(template.trimEnd(), TIMESHEET_IMPORT_HEADERS.join(","));
});
