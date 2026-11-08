import { addDaysToDateKey } from "@/lib/timesheet-off-days";

export const SHIFT_COLORS = [
  "violet",
  "sky",
  "emerald",
  "amber",
  "rose",
  "slate",
] as const;
export type ShiftColor = (typeof SHIFT_COLORS)[number];

/** Minutes after the scheduled start before a clock-in counts as late. */
export const LATE_GRACE_MINUTES = 5;
/** Minutes before the scheduled end that a clock-out may happen without counting as leaving early. */
export const EARLY_LEAVE_GRACE_MINUTES = 5;
/** Minutes past the scheduled end before the extra time counts as overtime. */
export const OVERTIME_THRESHOLD_MINUTES = 15;
/** Tolerance around the planned break length before it counts as short or long. */
export const BREAK_GRACE_MINUTES = 5;
/** How far a clock-in may drift from a shift and still be attributed to it. */
export const MATCH_WINDOW_MINUTES = 180;
export const MAX_SHIFT_MINUTES = 16 * 60;
export const MIN_SHIFT_MINUTES = 15;
export const MAX_SCHEDULE_RANGE_DAYS = 62;

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeOfDay(value: string) {
  return timePattern.test(value);
}

export function timeToMinutes(value: string) {
  const match = timePattern.exec(value);
  if (!match) throw new Error("Enter a valid time.");
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Wall-clock length of a shift; an end at or before the start ends next day. */
export function shiftSpanMinutes(startTime: string, endTime: string) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return end > start ? end - start : end + 24 * 60 - start;
}

export function endsNextDay(startTime: string, endTime: string) {
  return timeToMinutes(endTime) <= timeToMinutes(startTime);
}

export function validateShiftTimes(input: {
  startTime: string;
  endTime: string;
  breakMinutes: number;
}): string | null {
  if (!isTimeOfDay(input.startTime) || !isTimeOfDay(input.endTime)) {
    return "Enter valid start and end times.";
  }
  const span = shiftSpanMinutes(input.startTime, input.endTime);
  if (span < MIN_SHIFT_MINUTES) {
    return `Shifts must be at least ${MIN_SHIFT_MINUTES} minutes.`;
  }
  if (span > MAX_SHIFT_MINUTES) {
    return `Shifts cannot be longer than ${MAX_SHIFT_MINUTES / 60} hours.`;
  }
  if (
    !Number.isInteger(input.breakMinutes) ||
    input.breakMinutes < 0 ||
    input.breakMinutes >= span
  ) {
    return "Break must be shorter than the shift.";
  }
  return null;
}

/** Local start/end datetimes (YYYY-MM-DDTHH:MM) for a shift on `date`. */
export function shiftLocalDateTimes(
  date: string,
  startTime: string,
  endTime: string,
) {
  const endDate = endsNextDay(startTime, endTime)
    ? addDaysToDateKey(date, 1)
    : date;
  return { start: `${date}T${startTime}`, end: `${endDate}T${endTime}` };
}

export function dayDifference(from: string, to: string) {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) -
      Date.UTC(fromYear, fromMonth - 1, fromDay)) /
      86_400_000,
  );
}

export function dateRangeKeys(from: string, to: string) {
  const keys: string[] = [];
  for (let date = from; date <= to; date = addDaysToDateKey(date, 1)) {
    keys.push(date);
  }
  return keys;
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDaysToDateKey(date, -((weekday + 6) % 7));
}

export function startOfMonth(date: string) {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string) {
  const [year, month] = date.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export function addMonths(date: string, months: number) {
  const [year, month] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function scheduledMinutes(shift: {
  startAt: Date | string;
  endAt: Date | string;
  breakMinutes: number;
}) {
  const span = Math.round(
    (new Date(shift.endAt).getTime() - new Date(shift.startAt).getTime()) /
      60_000,
  );
  return Math.max(0, span - shift.breakMinutes);
}

type Interval = { start: number; end: number };

export function rangesOverlap(left: Interval, right: Interval) {
  return left.start < right.end && right.start < left.end;
}

/** Returns the index pairs of shifts for the same user whose times overlap. */
export function findScheduleConflicts(
  shifts: { userId: string; startAt: Date | string; endAt: Date | string }[],
) {
  const conflicts: [number, number][] = [];
  const byUser = new Map<string, number[]>();
  shifts.forEach((shift, index) => {
    byUser.set(shift.userId, [...(byUser.get(shift.userId) ?? []), index]);
  });
  for (const indexes of byUser.values()) {
    for (let left = 0; left < indexes.length; left += 1) {
      for (let right = left + 1; right < indexes.length; right += 1) {
        const first = shifts[indexes[left]];
        const second = shifts[indexes[right]];
        if (
          rangesOverlap(
            {
              start: new Date(first.startAt).getTime(),
              end: new Date(first.endAt).getTime(),
            },
            {
              start: new Date(second.startAt).getTime(),
              end: new Date(second.endAt).getTime(),
            },
          )
        ) {
          conflicts.push([indexes[left], indexes[right]]);
        }
      }
    }
  }
  return conflicts;
}

export type AttendanceStatus =
  | "upcoming"
  | "not_clocked_in"
  | "in_progress"
  | "completed"
  | "absent";

export type AttendanceFlag =
  | "late"
  | "left_early"
  | "overtime"
  | "absent"
  | "short_break"
  | "long_break"
  | "missed_break";

export type ShiftAttendance = {
  status: AttendanceStatus;
  flags: AttendanceFlag[];
  sessionIds: string[];
  clockInAt: string | null;
  clockOutAt: string | null;
  lateMinutes: number;
  earlyMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
  plannedBreakMinutes: number;
  actualBreakMinutes: number;
};

export type AttendanceShift = {
  id: string;
  userId: string;
  startAt: Date | string;
  endAt: Date | string;
  /** Planned break length; omitted means no break is planned. */
  breakMinutes?: number;
};

export type AttendanceSession = {
  id: string;
  userId: string;
  clockInAt: Date | string;
  clockOutAt: Date | string | null;
  workedMinutes: number | null;
  completedBreakMinutes?: number;
};

function toMs(value: Date | string) {
  return new Date(value).getTime();
}

function minutesBetween(from: number, to: number) {
  return Math.max(0, Math.floor((to - from) / 60_000));
}

/**
 * Attributes each work session to at most one scheduled shift (largest overlap,
 * otherwise the nearest shift start within MATCH_WINDOW_MINUTES) and scores the
 * shift. Sessions that match nothing are returned as unscheduled.
 */
export function evaluateAttendance(
  shifts: AttendanceShift[],
  sessions: AttendanceSession[],
  now: Date,
) {
  const nowMs = now.getTime();
  const matched = new Map<string, AttendanceSession[]>();
  const unscheduled: AttendanceSession[] = [];
  const windowMs = MATCH_WINDOW_MINUTES * 60_000;

  for (const session of sessions) {
    const sessionStart = toMs(session.clockInAt);
    const sessionEnd = session.clockOutAt
      ? toMs(session.clockOutAt)
      : Math.max(nowMs, sessionStart);
    let best: { shift: AttendanceShift; score: number } | null = null;
    for (const shift of shifts) {
      if (shift.userId !== session.userId) continue;
      const shiftStart = toMs(shift.startAt);
      const shiftEnd = toMs(shift.endAt);
      const overlap =
        Math.min(shiftEnd, sessionEnd) - Math.max(shiftStart, sessionStart);
      const distance = Math.abs(sessionStart - shiftStart);
      // Overlap wins outright; otherwise prefer the closest start in the window.
      const score =
        overlap > 0
          ? overlap + windowMs
          : distance <= windowMs
            ? -distance
            : null;
      if (score === null) continue;
      if (!best || score > best.score) best = { shift, score };
    }
    if (best) {
      matched.set(best.shift.id, [
        ...(matched.get(best.shift.id) ?? []),
        session,
      ]);
    } else {
      unscheduled.push(session);
    }
  }

  const results = new Map<string, ShiftAttendance>();
  for (const shift of shifts) {
    const shiftStart = toMs(shift.startAt);
    const shiftEnd = toMs(shift.endAt);
    const shiftSessions = [...(matched.get(shift.id) ?? [])].sort(
      (left, right) => toMs(left.clockInAt) - toMs(right.clockInAt),
    );
    const flags: AttendanceFlag[] = [];

    if (!shiftSessions.length) {
      const status: AttendanceStatus =
        nowMs < shiftStart + LATE_GRACE_MINUTES * 60_000
          ? "upcoming"
          : nowMs < shiftEnd
            ? "not_clocked_in"
            : "absent";
      if (status === "absent") flags.push("absent");
      if (status === "not_clocked_in") flags.push("late");
      results.set(shift.id, {
        status,
        flags,
        sessionIds: [],
        clockInAt: null,
        clockOutAt: null,
        lateMinutes:
          status === "not_clocked_in" ? minutesBetween(shiftStart, nowMs) : 0,
        earlyMinutes: 0,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        workedMinutes: 0,
        plannedBreakMinutes: shift.breakMinutes ?? 0,
        actualBreakMinutes: 0,
      });
      continue;
    }

    const firstIn = toMs(shiftSessions[0].clockInAt);
    const last = shiftSessions.at(-1)!;
    const isOpen = last.clockOutAt === null;
    const lastOut = isOpen ? nowMs : toMs(last.clockOutAt!);
    const lateMinutes = minutesBetween(shiftStart, firstIn);
    const earlyMinutes = minutesBetween(firstIn, shiftStart);
    const earlyLeaveMinutes = isOpen ? 0 : minutesBetween(lastOut, shiftEnd);
    const overtimeMinutes = minutesBetween(shiftEnd, lastOut);

    if (lateMinutes > LATE_GRACE_MINUTES) flags.push("late");
    if (earlyLeaveMinutes > EARLY_LEAVE_GRACE_MINUTES) flags.push("left_early");
    if (overtimeMinutes > OVERTIME_THRESHOLD_MINUTES) flags.push("overtime");

    const plannedBreakMinutes = shift.breakMinutes ?? 0;
    const actualBreakMinutes = shiftSessions.reduce(
      (total, session) => total + (session.completedBreakMinutes ?? 0),
      0,
    );
    if (!isOpen && plannedBreakMinutes > 0 && actualBreakMinutes === 0) {
      flags.push("missed_break");
    } else if (
      !isOpen &&
      actualBreakMinutes < plannedBreakMinutes - BREAK_GRACE_MINUTES
    ) {
      flags.push("short_break");
    }
    if (actualBreakMinutes > plannedBreakMinutes + BREAK_GRACE_MINUTES) {
      flags.push("long_break");
    }

    results.set(shift.id, {
      status: isOpen ? "in_progress" : "completed",
      flags,
      sessionIds: shiftSessions.map((session) => session.id),
      clockInAt: new Date(firstIn).toISOString(),
      clockOutAt: isOpen ? null : new Date(lastOut).toISOString(),
      lateMinutes,
      earlyMinutes,
      earlyLeaveMinutes,
      overtimeMinutes:
        overtimeMinutes > OVERTIME_THRESHOLD_MINUTES ? overtimeMinutes : 0,
      workedMinutes: shiftSessions.reduce(
        (total, session) => total + (session.workedMinutes ?? 0),
        0,
      ),
      plannedBreakMinutes,
      actualBreakMinutes,
    });
  }

  return { results, unscheduled };
}

export type AttendanceSummaryRow = {
  userId: string;
  scheduledShifts: number;
  scoredShifts: number;
  scheduledMinutes: number;
  workedMinutes: number;
  onTime: number;
  late: number;
  lateMinutes: number;
  earlyMinutes: number;
  absent: number;
  leftEarly: number;
  overtime: number;
  overtimeMinutes: number;
  unscheduled: number;
  unscheduledMinutes: number;
  workedShifts: number;
  breakPlannedMinutes: number;
  breakActualMinutes: number;
  breakIssues: number;
};

/** Aggregates scored shifts into per-staff totals. Upcoming shifts only add scheduled time. */
export function summarizeAttendance(
  shifts: (AttendanceShift & {
    breakMinutes: number;
    attendance: ShiftAttendance | null;
  })[],
  unscheduled: AttendanceSession[],
) {
  const rows = new Map<string, AttendanceSummaryRow>();
  const rowFor = (userId: string) => {
    let row = rows.get(userId);
    if (!row) {
      row = {
        userId,
        scheduledShifts: 0,
        scoredShifts: 0,
        scheduledMinutes: 0,
        workedMinutes: 0,
        onTime: 0,
        late: 0,
        lateMinutes: 0,
        earlyMinutes: 0,
        absent: 0,
        leftEarly: 0,
        overtime: 0,
        overtimeMinutes: 0,
        unscheduled: 0,
        unscheduledMinutes: 0,
        workedShifts: 0,
        breakPlannedMinutes: 0,
        breakActualMinutes: 0,
        breakIssues: 0,
      };
      rows.set(userId, row);
    }
    return row;
  };

  for (const shift of shifts) {
    const row = rowFor(shift.userId);
    row.scheduledShifts += 1;
    row.scheduledMinutes += scheduledMinutes(shift);
    const attendance = shift.attendance;
    if (!attendance || attendance.status === "upcoming") continue;
    row.scoredShifts += 1;
    if (attendance.sessionIds.length) {
      row.workedShifts += 1;
      row.breakPlannedMinutes += attendance.plannedBreakMinutes;
      row.breakActualMinutes += attendance.actualBreakMinutes;
      if (
        attendance.flags.some(
          (flag) =>
            flag === "missed_break" ||
            flag === "short_break" ||
            flag === "long_break",
        )
      ) {
        row.breakIssues += 1;
      }
    }
    row.workedMinutes += attendance.workedMinutes;
    row.earlyMinutes += attendance.earlyMinutes;
    if (attendance.flags.includes("absent")) row.absent += 1;
    if (attendance.flags.includes("late")) {
      row.late += 1;
      row.lateMinutes += attendance.lateMinutes;
    } else if (attendance.status !== "absent") {
      row.onTime += 1;
    }
    if (attendance.flags.includes("left_early")) row.leftEarly += 1;
    if (attendance.flags.includes("overtime")) {
      row.overtime += 1;
      row.overtimeMinutes += attendance.overtimeMinutes;
    }
  }
  for (const session of unscheduled) {
    const row = rowFor(session.userId);
    row.unscheduled += 1;
    row.unscheduledMinutes += session.workedMinutes ?? 0;
    row.workedMinutes += session.workedMinutes ?? 0;
  }
  return [...rows.values()];
}

/** Share of scored shifts started on time, or null when nothing has been scored yet. */
export function punctualityRate(
  row: Pick<AttendanceSummaryRow, "onTime" | "scoredShifts">,
) {
  return row.scoredShifts ? row.onTime / row.scoredShifts : null;
}
