import { outletDateTimeToISOString } from "@/lib/outlet-time";

export type DashboardBreak = {
  startedAt: Date | string;
  endedAt: Date | string | null;
};

export type DashboardShiftStatus = "on_shift" | "on_break" | "finished";

export function orderDashboardShifts<
  T extends { status: DashboardShiftStatus; employeeName: string },
>(shifts: T[]) {
  const statusOrder: Record<DashboardShiftStatus, number> = {
    on_shift: 0,
    on_break: 1,
    finished: 2,
  };
  return [...shifts].sort(
    (first, second) =>
      statusOrder[first.status] - statusOrder[second.status] ||
      first.employeeName.localeCompare(second.employeeName, "en", {
        sensitivity: "base",
      }),
  );
}

export function outletCalendarDate(value: Date | string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function outletScheduleDate(value: Date | string, timezone: string) {
  const instant = new Date(value);
  const localDate = outletCalendarDate(instant, timezone);
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  return localTime < "06:00" ? addCalendarDays(localDate, -1) : localDate;
}

export function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function getScheduleWindow(date: string, timezone: string) {
  const startAt = new Date(
    outletDateTimeToISOString(`${date}T06:00`, timezone),
  );
  const endAt = new Date(
    outletDateTimeToISOString(`${addCalendarDays(date, 1)}T06:00`, timezone),
  );
  return { startAt, endAt };
}

function timestamp(value: Date | string) {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function clippedIntervalMinutes(
  intervals: { startedAt: Date | string; endedAt: Date | string | null }[],
  startAt: number,
  endAt: number,
) {
  const sorted = intervals
    .map((interval) => ({
      start: Math.max(startAt, timestamp(interval.startedAt)),
      end: Math.min(
        endAt,
        interval.endedAt === null ? endAt : timestamp(interval.endedAt),
      ),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((first, second) => first.start - second.start);

  let totalMilliseconds = 0;
  let current: { start: number; end: number } | null = null;
  for (const interval of sorted) {
    if (!current) {
      current = interval;
    } else if (interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
    } else {
      totalMilliseconds += current.end - current.start;
      current = interval;
    }
  }
  if (current) totalMilliseconds += current.end - current.start;
  return Math.floor(totalMilliseconds / 60_000);
}

export function getDashboardShiftMetrics(
  clockInAt: Date | string,
  clockOutAt: Date | string | null,
  breaks: DashboardBreak[],
  windowStartAt: Date,
  windowEndAt: Date,
  evaluatedAt: Date,
) {
  const startAt = Math.max(timestamp(clockInAt), windowStartAt.getTime());
  const endAt = Math.min(
    clockOutAt === null ? evaluatedAt.getTime() : timestamp(clockOutAt),
    windowEndAt.getTime(),
    evaluatedAt.getTime(),
  );
  const breakMinutes =
    endAt > startAt ? clippedIntervalMinutes(breaks, startAt, endAt) : 0;
  const grossMinutes =
    endAt > startAt ? Math.floor((endAt - startAt) / 60_000) : 0;

  return {
    workedMinutes: Math.max(0, grossMinutes - breakMinutes),
    breakMinutes,
  };
}

export function getDashboardShiftStatus(
  clockInAt: Date | string,
  clockOutAt: Date | string | null,
  breaks: DashboardBreak[],
  evaluatedAt: Date,
): DashboardShiftStatus {
  const now = evaluatedAt.getTime();
  const isActive =
    timestamp(clockInAt) <= now &&
    (clockOutAt === null || timestamp(clockOutAt) > now);
  if (!isActive) return "finished";

  const isOnBreak = breaks.some(
    (interval) =>
      timestamp(interval.startedAt) <= now &&
      (interval.endedAt === null || timestamp(interval.endedAt) > now),
  );
  return isOnBreak ? "on_break" : "on_shift";
}
