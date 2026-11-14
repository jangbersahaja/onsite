import { outletDateTimeToISOString } from "@/lib/outlet-time";
import type { AttendanceFlag, AttendanceStatus } from "@/lib/schedule-rules";

export type DashboardBreak = {
  startedAt: Date | string;
  endedAt: Date | string | null;
};

export type DashboardShiftStatus =
  | "absent"
  | "not_clocked_in"
  | "on_shift"
  | "on_break"
  | "upcoming"
  | "finished";

export function orderDashboardShifts<
  T extends { status: DashboardShiftStatus; employeeName: string },
>(shifts: T[]) {
  const statusOrder: Record<DashboardShiftStatus, number> = {
    absent: 0,
    not_clocked_in: 1,
    on_shift: 2,
    on_break: 3,
    upcoming: 4,
    finished: 5,
  };
  return [...shifts].sort(
    (first, second) =>
      statusOrder[first.status] - statusOrder[second.status] ||
      first.employeeName.localeCompare(second.employeeName, "en", {
        sensitivity: "base",
      }),
  );
}

export type DashboardSchedule = {
  startAt: Date | string;
  endAt: Date | string;
  flags: AttendanceFlag[];
};

export type DashboardSession = {
  id: string;
  clockInAt: Date | string;
  clockOutAt: Date | string | null;
  clockInLocal: string;
  clockOutLocal: string | null;
  status: DashboardShiftStatus;
  workedMinutes: number;
  breakMinutes: number;
  breaks: DashboardBreak[];
  schedule: DashboardSchedule | null;
  unscheduled: boolean;
};

export type DashboardSessionSummary = Pick<
  DashboardSession,
  | "id"
  | "clockInAt"
  | "clockOutAt"
  | "clockInLocal"
  | "clockOutLocal"
  | "status"
  | "unscheduled"
>;

/** Groups one person's clock sessions for the day into a single roster row. */
export function groupDashboardSessions(
  sessions: (DashboardSession & {
    userId: string;
    employeeName: string;
    profilePhotoUrl: string | null;
  })[],
) {
  const byUser = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const group = byUser.get(session.userId);
    if (group) group.push(session);
    else byUser.set(session.userId, [session]);
  }

  return [...byUser.values()].map((group) => {
    const ordered = [...group].sort(
      (first, second) =>
        timestamp(first.clockInAt) - timestamp(second.clockInAt),
    );
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const isOpen = ordered.some((session) => session.clockOutAt === null);
    const schedules = new Map<string, DashboardSchedule>();
    for (const session of ordered) {
      if (!session.schedule) continue;
      const key = `${timestamp(session.schedule.startAt)}|${timestamp(session.schedule.endAt)}`;
      schedules.set(key, session.schedule);
    }

    return {
      id: first.id,
      userId: first.userId,
      employeeName: first.employeeName,
      profilePhotoUrl: first.profilePhotoUrl,
      clockInAt: first.clockInAt,
      clockOutAt: isOpen ? null : last.clockOutAt,
      clockInLocal: first.clockInLocal,
      clockOutLocal: isOpen ? null : last.clockOutLocal,
      status: combinedSessionStatus(ordered.map((session) => session.status)),
      workedMinutes: ordered.reduce(
        (total, session) => total + session.workedMinutes,
        0,
      ),
      breakMinutes: ordered.reduce(
        (total, session) => total + session.breakMinutes,
        0,
      ),
      breaks: ordered
        .flatMap((session) => session.breaks)
        .sort((first, second) => timestamp(first.startedAt) - timestamp(second.startedAt)),
      schedules: [...schedules.values()],
      unscheduled: ordered.every((session) => session.unscheduled),
      sessions: ordered.map(
        ({
          id,
          clockInAt,
          clockOutAt,
          clockInLocal,
          clockOutLocal,
          status,
          unscheduled,
        }): DashboardSessionSummary => ({
          id,
          clockInAt,
          clockOutAt,
          clockInLocal,
          clockOutLocal,
          status,
          unscheduled,
        }),
      ),
    };
  });
}

/** A person is live while any session is on shift or on break; on break wins. */
function combinedSessionStatus(
  statuses: DashboardShiftStatus[],
): DashboardShiftStatus {
  return (
    (["on_break", "on_shift"] as const).find((status) =>
      statuses.includes(status),
    ) ?? statuses[0]
  );
}

/** Maps a scheduled shift with no clock-in to its row status. */
export function scheduledRowStatus(
  status: AttendanceStatus,
): DashboardShiftStatus {
  if (status === "absent") return "absent";
  if (status === "not_clocked_in") return "not_clocked_in";
  return "upcoming";
}

const flagPriority: AttendanceFlag[] = [
  "absent",
  "late",
  "left_early",
  "missed_break",
  "short_break",
  "long_break",
  "overtime",
];

/** Schedule flags for a row, most important first. The status pill already says absent. */
export function dashboardRowFlags(
  flags: AttendanceFlag[],
  status: DashboardShiftStatus,
) {
  return flagPriority.filter(
    (flag) =>
      flags.includes(flag) && !(flag === "absent" && status === "absent"),
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

export type TimelineSpan = { left: number; width: number };

export function getTimelineSpan(
  startAt: Date | string,
  endAt: Date | string | null,
  windowStartAt: Date | string,
  windowEndAt: Date | string,
  evaluatedAt: Date | string,
): TimelineSpan | null {
  const now = timestamp(evaluatedAt);
  const windowStart = timestamp(windowStartAt);
  const windowEnd = timestamp(windowEndAt);
  const start = Math.max(timestamp(startAt), windowStart);
  const end = Math.min(endAt === null ? now : timestamp(endAt), windowEnd, now);
  if (end <= start) return null;

  const duration = windowEnd - windowStart;
  return {
    left: ((start - windowStart) / duration) * 100,
    width: ((end - start) / duration) * 100,
  };
}
