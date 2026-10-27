import {
  formatOutletDateTime,
  isDateOnly,
  outletDateTimeToISOString,
  serializeCsv,
} from "@/lib/outlet-time";
import { normalizeStaffCode } from "@/lib/staff-code";
import {
  validateManualShift,
  type ManualBreak,
} from "@/lib/timesheet-create-rules";

export const TIMESHEET_IMPORT_REQUIRED_HEADERS = [
  "staff_code",
  "clock_in_date",
  "clock_in_time",
  "clock_out_date",
  "clock_out_time",
] as const;

export const TIMESHEET_IMPORT_MAX_ROWS = 500;
export const TIMESHEET_IMPORT_MAX_BYTES = 1_000_000;
/** The template shows three break pairs; files may use up to this many. */
export const TIMESHEET_IMPORT_MAX_BREAKS = 10;
const TEMPLATE_BREAK_PAIRS = 3;

/** Date and time columns for one break's start and end. */
function breakColumns(index: number) {
  return [
    `break_${index}_start_date`,
    `break_${index}_start_time`,
    `break_${index}_end_date`,
    `break_${index}_end_time`,
  ];
}

export const TIMESHEET_IMPORT_HEADERS = [
  ...TIMESHEET_IMPORT_REQUIRED_HEADERS,
  ...Array.from({ length: TEMPLATE_BREAK_PAIRS }, (_, index) =>
    breakColumns(index + 1),
  ).flat(),
];

// Legacy single-cell break columns (break_N_start) are still accepted.
const breakHeaderPattern = /^break_(\d+)_(start|end)(_date|_time)?$/;

function isImportHeader(header: string) {
  if ((TIMESHEET_IMPORT_HEADERS as readonly string[]).includes(header)) {
    return true;
  }
  const match = breakHeaderPattern.exec(header);
  if (!match) return false;
  const index = Number(match[1]);
  return index >= 1 && index <= TIMESHEET_IMPORT_MAX_BREAKS;
}

export type ImportCells = Record<string, string>;

export type ImportRecord = {
  rowNumber: number;
  cells: ImportCells;
};

export type ParsedImportRow =
  | {
      ok: true;
      rowNumber: number;
      staffCode: string;
      clockInAt: Date;
      clockOutAt: Date;
      breaks: ManualBreak[];
    }
  | {
      ok: false;
      rowNumber: number;
      staffCode: string | null;
      error: string;
    };

const timePattern = /^\d{2}:\d{2}$/;

/**
 * Parses RFC 4180 CSV text. Handles quoted fields, escaped quotes, CRLF or LF
 * line endings, and a leading byte order mark. Rows are returned unfiltered.
 */
export function parseCsvRows(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStarted = false;
    } else {
      field += char;
      fieldStarted = true;
    }
  }

  if (inQuotes) throw new Error("The file has an unclosed quoted value.");
  if (fieldStarted || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Checks the header row and turns data rows into keyed records. */
export function parseTimesheetImportCsv(
  text: string,
): { ok: true; records: ImportRecord[] } | { ok: false; error: string } {
  let rows: string[][];
  try {
    rows = parseCsvRows(text);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not read the file.",
    };
  }

  const [headerRow, ...dataRows] = rows;
  if (!headerRow) return { ok: false, error: "The file is empty." };

  const headers = headerRow.map((header) => header.trim().toLowerCase());
  const unknown = headers.filter((header) => !isImportHeader(header));
  if (unknown.length) {
    return {
      ok: false,
      error: `Unknown column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`,
    };
  }
  const duplicates = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  if (duplicates.length) {
    return {
      ok: false,
      error: `Duplicate column: ${duplicates[0]}.`,
    };
  }
  const missing = TIMESHEET_IMPORT_REQUIRED_HEADERS.filter(
    (header) => !headers.includes(header),
  );
  if (missing.length) {
    return {
      ok: false,
      error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
    };
  }

  const records: ImportRecord[] = [];
  dataRows.forEach((cells, index) => {
    const values: ImportCells = Object.fromEntries(
      TIMESHEET_IMPORT_HEADERS.map((header) => [header, ""]),
    );
    headers.forEach((header, column) => {
      values[header] = (cells[column] ?? "").trim();
    });
    if (Object.values(values).every((value) => value === "")) return;
    records.push({ rowNumber: index + 2, cells: values });
  });

  if (!records.length) {
    return { ok: false, error: "The file has no shift rows." };
  }
  if (records.length > TIMESHEET_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      error: `Import up to ${TIMESHEET_IMPORT_MAX_ROWS} rows at a time.`,
    };
  }
  return { ok: true, records };
}

function addOneDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

function outletInstant(date: string, time: string, timezone: string) {
  return new Date(outletDateTimeToISOString(`${date}T${time}`, timezone));
}

/**
 * Resolves a break time-of-day to the first occurrence on or after `after`,
 * starting from `date`. This lets breaks cross midnight without extra columns.
 */
function resolveBreakInstant(
  date: string,
  time: string,
  after: Date,
  timezone: string,
) {
  let day = date;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const instant = outletInstant(day, time, timezone);
    if (instant.getTime() >= after.getTime()) {
      return { instant, day };
    }
    day = addOneDay(day);
  }
  throw new Error("Break times must fall within the shift.");
}

const dateTimeCellPattern = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/;

function isBreakTime(value: string) {
  return timePattern.test(value) || dateTimeCellPattern.test(value);
}

/**
 * Reads one break cell. A full `YYYY-MM-DD HH:MM` value is used as written.
 * A bare `HH:MM` value is resolved from `day` the same way as before.
 */
function resolveBreakCell(
  cell: string,
  day: string,
  after: Date,
  timezone: string,
) {
  const dateTime = dateTimeCellPattern.exec(cell);
  if (dateTime) {
    return {
      instant: outletInstant(dateTime[1], dateTime[2], timezone),
      day: dateTime[1],
    };
  }
  return resolveBreakInstant(day, cell, after, timezone);
}

type BreakCellRead = { value: string } | { error: string };

/**
 * Reads one break edge from the date and time columns, or from the legacy
 * single cell when the date and time columns are empty.
 */
function readBreakCell(
  cells: ImportCells,
  index: number,
  edge: "start" | "end",
): BreakCellRead {
  const legacy = cells[`break_${index}_${edge}`] ?? "";
  const date = cells[`break_${index}_${edge}_date`] ?? "";
  const time = cells[`break_${index}_${edge}_time`] ?? "";
  if (!date && !time) return { value: legacy };
  if (legacy) {
    return {
      error: `break_${index}_${edge} cannot be used with break_${index}_${edge}_date.`,
    };
  }
  if (!date || !time) {
    return {
      error: `break_${index}_${edge}_date and break_${index}_${edge}_time must both be filled in.`,
    };
  }
  if (!isDateOnly(date) || !timePattern.test(time)) {
    return {
      error: `Break ${index} ${edge} must be a YYYY-MM-DD date and 24-hour HH:MM time.`,
    };
  }
  return { value: `${date} ${time}` };
}

/** Turns one CSV record into a shift. Times are read in the outlet timezone. */
export function buildImportedShift(
  record: ImportRecord,
  timezone: string,
  now: Date,
): ParsedImportRow {
  const { rowNumber, cells } = record;
  const fail = (error: string, staffCode: string | null = null) => ({
    ok: false as const,
    rowNumber,
    staffCode,
    error,
  });

  const staff = normalizeStaffCode(cells.staff_code);
  if ("error" in staff) return fail(staff.error);
  if (staff.value === null) return fail("staff_code is required.");
  const staffCode = staff.value;

  if (!isDateOnly(cells.clock_in_date)) {
    return fail(
      "clock_in_date must be a date in YYYY-MM-DD format.",
      staffCode,
    );
  }
  if (!isDateOnly(cells.clock_out_date)) {
    return fail(
      "clock_out_date must be a date in YYYY-MM-DD format.",
      staffCode,
    );
  }
  if (!timePattern.test(cells.clock_in_time)) {
    return fail("clock_in_time must be 24-hour HH:MM.", staffCode);
  }
  if (!timePattern.test(cells.clock_out_time)) {
    return fail("clock_out_time must be 24-hour HH:MM.", staffCode);
  }

  let clockInAt: Date;
  let clockOutAt: Date;
  try {
    clockInAt = outletInstant(
      cells.clock_in_date,
      cells.clock_in_time,
      timezone,
    );
    clockOutAt = outletInstant(
      cells.clock_out_date,
      cells.clock_out_time,
      timezone,
    );
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Enter a valid outlet time.",
      staffCode,
    );
  }

  const breaks: ManualBreak[] = [];
  let previous = clockInAt;
  let breakDay = cells.clock_in_date;
  try {
    for (let index = 1; index <= TIMESHEET_IMPORT_MAX_BREAKS; index += 1) {
      const startRead = readBreakCell(cells, index, "start");
      const endRead = readBreakCell(cells, index, "end");
      if ("error" in startRead) return fail(startRead.error, staffCode);
      if ("error" in endRead) return fail(endRead.error, staffCode);
      const startCell = startRead.value;
      const endCell = endRead.value;
      if (!startCell && !endCell) continue;
      if (!startCell || !endCell) {
        return fail(
          `break_${index}_start and break_${index}_end must both be filled in.`,
          staffCode,
        );
      }
      if (!isBreakTime(startCell) || !isBreakTime(endCell)) {
        return fail(
          `Break ${index} times must be HH:MM or YYYY-MM-DD HH:MM (24-hour).`,
          staffCode,
        );
      }
      const start = resolveBreakCell(startCell, breakDay, previous, timezone);
      const end = resolveBreakCell(endCell, start.day, start.instant, timezone);
      breaks.push({ startedAt: start.instant, endedAt: end.instant });
      previous = end.instant;
      breakDay = end.day;
    }
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Break times are invalid.",
      staffCode,
    );
  }

  const shiftError = validateManualShift({
    clockInAt,
    clockOutAt,
    breaks,
    now,
  });
  if (shiftError) return fail(shiftError, staffCode);

  return { ok: true, rowNumber, staffCode, clockInAt, clockOutAt, breaks };
}

export function buildTimesheetImportTemplate() {
  return `${serializeCsv([...TIMESHEET_IMPORT_HEADERS], [])}\r\n`;
}

export type TimesheetExportShift = {
  staffCode: string | null;
  timezone: string;
  clockInAt: Date | string;
  clockOutAt: Date | string | null;
  breaks: { startedAt: Date | string; endedAt: Date | string | null }[];
};

type ClosedExportShift = TimesheetExportShift & { clockOutAt: Date | string };

function splitOutletDateTime(value: Date | string, timezone: string) {
  const [date, time] = formatOutletDateTime(value, timezone).split("T");
  return { date, time };
}

function splitBreakCell(value: Date | string | null, timezone: string) {
  if (value === null) return { date: "", time: "" };
  return splitOutletDateTime(value, timezone);
}

/**
 * Writes closed shifts in the import layout, with each break start and end split
 * into date and time columns, so the file can be edited and imported again.
 * Open shifts are left out because the import requires a clock out.
 */
export function buildTimesheetImportExport(shifts: TimesheetExportShift[]) {
  const closed = shifts
    .filter((shift): shift is ClosedExportShift => shift.clockOutAt !== null)
    .sort(
      (a, b) =>
        new Date(a.clockInAt).getTime() - new Date(b.clockInAt).getTime(),
    );
  const pairs = Math.max(
    TEMPLATE_BREAK_PAIRS,
    ...closed.map((shift) => shift.breaks.length),
  );
  const breakHeaders = Array.from({ length: pairs }, (_, index) =>
    breakColumns(index + 1),
  ).flat();
  const headers = [...TIMESHEET_IMPORT_REQUIRED_HEADERS, ...breakHeaders];

  const rows = closed.map((shift) => {
    const clockIn = splitOutletDateTime(shift.clockInAt, shift.timezone);
    const clockOut = splitOutletDateTime(shift.clockOutAt, shift.timezone);
    const breakCells: string[] = [];
    for (let index = 0; index < pairs; index += 1) {
      const interval = shift.breaks[index];
      const start = splitBreakCell(interval?.startedAt ?? null, shift.timezone);
      const end = splitBreakCell(interval?.endedAt ?? null, shift.timezone);
      breakCells.push(start.date, start.time, end.date, end.time);
    }
    return [
      shift.staffCode ?? "",
      clockIn.date,
      clockIn.time,
      clockOut.date,
      clockOut.time,
      ...breakCells,
    ];
  });

  return `${serializeCsv(headers, rows)}\r\n`;
}
