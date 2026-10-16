import { validateBreakIntervals } from "@/lib/work-breaks";

export type ManualBreak = {
  startedAt: Date;
  endedAt: Date | null;
};

export type TimeRange = {
  start: Date;
  end: Date | null;
};

/** Open ranges (end null) are treated as running until they are closed. */
export function hasOverlap(
  next: { start: Date; end: Date },
  existing: TimeRange[],
) {
  return existing.some(
    (range) =>
      range.start.getTime() < next.end.getTime() &&
      (range.end === null || range.end.getTime() > next.start.getTime()),
  );
}

export function validateManualShift(input: {
  clockInAt: Date;
  clockOutAt: Date | null;
  breaks: ManualBreak[];
  now: Date;
}): string | null {
  if (!input.clockOutAt) return "Clock out is required.";
  if (input.clockOutAt <= input.clockInAt) {
    return "Clock out must be after clock in.";
  }
  if (input.clockInAt > input.now || input.clockOutAt > input.now) {
    return "Times cannot be in the future.";
  }
  if (input.breaks.some((breakInterval) => breakInterval.endedAt === null)) {
    return "Breaks must have an end time.";
  }
  if (
    input.breaks.some(
      (breakInterval) =>
        breakInterval.startedAt > input.now ||
        (breakInterval.endedAt !== null && breakInterval.endedAt > input.now),
    )
  ) {
    return "Breaks cannot be in the future.";
  }
  if (
    !validateBreakIntervals(input.breaks, input.clockInAt, input.clockOutAt)
  ) {
    return "Breaks must be ordered, non-overlapping, and within the shift.";
  }
  return null;
}

/** Backoffice users cannot change their own shifts; super admins may. */
export function canChangeShiftFor(
  actor: { userId: string; isSuperAdmin: boolean },
  targetUserId: string,
) {
  return actor.isSuperAdmin || actor.userId !== targetUserId;
}

export function canDeleteShift(session: { clockOutAt: Date | null }) {
  return session.clockOutAt !== null;
}
