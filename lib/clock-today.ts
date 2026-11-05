import {
  getCompletedBreakMinutes,
  getWorkedMinutes,
  type WorkBreakInterval,
} from "./work-breaks";

export type TodaySession = {
  clockInAt: Date | string;
  clockOutAt: Date | string | null;
  breaks: WorkBreakInterval[];
};

export type TodaySummary = {
  shiftCount: number;
  workedMinutes: number;
  breakMinutes: number;
};

/** Returns the calendar date (YYYY-MM-DD) of a moment in the given time zone. */
export function getDayKey(value: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

/**
 * Sums worked and break minutes for shifts that started on the same calendar
 * day as `now`, in the outlet time zone. Open shifts and open breaks count up to `now`.
 */
export function getTodaySummary(
  sessions: TodaySession[],
  now: Date,
  timeZone: string,
): TodaySummary {
  const today = getDayKey(now, timeZone);
  const nowIso = now.toISOString();
  const summary: TodaySummary = {
    shiftCount: 0,
    workedMinutes: 0,
    breakMinutes: 0,
  };

  for (const session of sessions) {
    if (getDayKey(session.clockInAt, timeZone) !== today) continue;

    const endAt = session.clockOutAt ?? nowIso;
    const breaks = session.breaks.map((breakInterval) => ({
      startedAt: breakInterval.startedAt,
      endedAt: breakInterval.endedAt ?? endAt,
    }));

    summary.shiftCount += 1;
    summary.workedMinutes +=
      getWorkedMinutes(session.clockInAt, endAt, breaks) ?? 0;
    summary.breakMinutes += getCompletedBreakMinutes(breaks);
  }

  return summary;
}
