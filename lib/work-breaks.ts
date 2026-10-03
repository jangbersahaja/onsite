export type WorkBreakInterval = {
  startedAt: Date | string;
  endedAt: Date | string | null;
};

function timestamp(value: Date | string) {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function getCompletedBreakMinutes(breaks: WorkBreakInterval[]) {
  const intervals = breaks
    .filter((breakInterval) => breakInterval.endedAt !== null)
    .map((breakInterval) => ({
      start: timestamp(breakInterval.startedAt),
      end: timestamp(breakInterval.endedAt!),
    }))
    .filter(
      (interval) =>
        Number.isFinite(interval.start) &&
        Number.isFinite(interval.end) &&
        interval.end > interval.start,
    )
    .sort((first, second) => first.start - second.start);

  let totalMilliseconds = 0;
  let current: { start: number; end: number } | null = null;
  for (const interval of intervals) {
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

export function getWorkedMinutes(
  clockInAt: Date | string,
  clockOutAt: Date | string | null,
  breaks: WorkBreakInterval[],
) {
  if (!clockOutAt) return null;
  const grossMilliseconds = timestamp(clockOutAt) - timestamp(clockInAt);
  if (!Number.isFinite(grossMilliseconds)) return null;
  const grossMinutes = Math.max(0, Math.floor(grossMilliseconds / 60_000));
  return Math.max(0, grossMinutes - getCompletedBreakMinutes(breaks));
}

export function validateBreakIntervals(
  breaks: WorkBreakInterval[],
  clockInAt: Date | string,
  clockOutAt: Date | string | null,
) {
  const shiftStart = timestamp(clockInAt);
  const shiftEnd = clockOutAt === null ? null : timestamp(clockOutAt);
  if (
    !Number.isFinite(shiftStart) ||
    (shiftEnd !== null &&
      (!Number.isFinite(shiftEnd) || shiftEnd <= shiftStart))
  ) {
    return false;
  }

  const intervals = breaks
    .map((breakInterval) => ({
      start: timestamp(breakInterval.startedAt),
      end:
        breakInterval.endedAt === null
          ? null
          : timestamp(breakInterval.endedAt),
    }))
    .sort((first, second) => first.start - second.start);

  let previousEnd = shiftStart;
  for (const [index, interval] of intervals.entries()) {
    if (
      !Number.isFinite(interval.start) ||
      interval.start < shiftStart ||
      interval.start < previousEnd
    ) {
      return false;
    }
    if (interval.end === null) {
      if (shiftEnd !== null || index !== intervals.length - 1) return false;
      previousEnd = interval.start;
      continue;
    }
    if (
      !Number.isFinite(interval.end) ||
      interval.end <= interval.start ||
      (shiftEnd !== null && interval.end > shiftEnd)
    ) {
      return false;
    }
    previousEnd = interval.end;
  }

  return true;
}
