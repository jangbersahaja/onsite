import type { CorrectionEvent } from "@/lib/break-corrections";

// Times are outlet-local "YYYY-MM-DDTHH:mm" strings. "" means not set.
export type ShiftCorrectionBreak = {
  id: string | null;
  startedAt: string;
  endedAt: string;
};

export type ShiftCorrectionSnapshot = {
  clockInAt: string;
  clockOutAt: string;
  breaks: ShiftCorrectionBreak[];
};

export type CorrectionSchedule = {
  id: string;
  startAt: string;
  endAt: string;
  breakMinutes: number;
  templateName: string | null;
  note: string | null;
};

export type CorrectionScheduleSnapshot = {
  scheduleId: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  breakMinutes: number;
  templateName: string | null;
  matchedAt: string;
};

export type CorrectionScheduleVariance = {
  startMinutes: number | null;
  endMinutes: number | null;
  paidMinutes: number | null;
  scheduledPaidMinutes: number;
  breakMinutes: number;
};

export function snapshotCorrectionSchedule(
  schedule: CorrectionSchedule,
  matchedAt = new Date(),
): CorrectionScheduleSnapshot {
  return {
    scheduleId: schedule.id,
    scheduledStartAt: schedule.startAt,
    scheduledEndAt: schedule.endAt,
    breakMinutes: schedule.breakMinutes,
    templateName: schedule.templateName,
    matchedAt: matchedAt.toISOString(),
  };
}

export function correctionScheduleVariance(
  schedule: CorrectionSchedule,
  corrected: {
    clockInAt: string;
    clockOutAt: string | null;
    breakMinutes: number;
  },
): CorrectionScheduleVariance {
  const scheduledStart = Date.parse(schedule.startAt);
  const scheduledEnd = Date.parse(schedule.endAt);
  const clockIn = Date.parse(corrected.clockInAt);
  const clockOut = corrected.clockOutAt
    ? Date.parse(corrected.clockOutAt)
    : NaN;
  const scheduledPaidMinutes = Math.max(
    0,
    Math.round((scheduledEnd - scheduledStart) / 60_000) -
      schedule.breakMinutes,
  );
  return {
    startMinutes: Number.isFinite(clockIn)
      ? Math.round((clockIn - scheduledStart) / 60_000)
      : null,
    endMinutes: Number.isFinite(clockOut)
      ? Math.round((clockOut - scheduledEnd) / 60_000)
      : null,
    paidMinutes:
      Number.isFinite(clockOut) && Number.isFinite(clockIn)
        ? Math.max(
            0,
            Math.round((clockOut - clockIn) / 60_000) - corrected.breakMinutes,
          )
        : null,
    scheduledPaidMinutes,
    breakMinutes: corrected.breakMinutes - schedule.breakMinutes,
  };
}

export type CorrectionSessionDefault = {
  id: string | null;
  clockInAt: string;
  clockOutAt: string | null;
  breaks: ShiftCorrectionBreak[];
  schedule: CorrectionSchedule | null;
};

export function correctionSessionDefault(input: {
  session: {
    id: string;
    clockInAt: string;
    clockOutAt: string | null;
    breaks: { id: string; startedAt: string; endedAt: string | null }[];
  } | null;
  schedule: CorrectionSchedule | null;
}): CorrectionSessionDefault {
  return {
    id: input.session?.id ?? null,
    clockInAt: input.session?.clockInAt ?? input.schedule?.startAt ?? "",
    clockOutAt: input.session?.clockOutAt ?? input.schedule?.endAt ?? null,
    breaks:
      input.session?.breaks.map((item) => ({
        id: item.id,
        startedAt: item.startedAt,
        endedAt: item.endedAt ?? "",
      })) ?? [],
    schedule: input.schedule,
  };
}

export function bestCorrectionSchedule(
  schedules: CorrectionSchedule[],
  session: { clockInAt: string; clockOutAt: string | null },
) {
  if (!schedules.length) return null;
  const clockIn = Date.parse(session.clockInAt);
  const clockOut = session.clockOutAt
    ? Date.parse(session.clockOutAt)
    : clockIn;
  const candidate = [...schedules]
    .map((schedule) => {
      const start = Date.parse(schedule.startAt);
      const end = Date.parse(schedule.endAt);
      const overlap = Math.max(
        0,
        Math.min(end, clockOut) - Math.max(start, clockIn),
      );
      const distance = Math.min(
        Math.abs(clockIn - start),
        Math.abs(clockIn - end),
        Math.abs(clockOut - start),
        Math.abs(clockOut - end),
      );
      return { schedule, score: overlap, distance };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.distance - right.distance,
    )[0];
  if (
    !candidate ||
    (candidate.score === 0 && candidate.distance > 180 * 60_000)
  ) {
    return null;
  }
  return candidate.schedule;
}

export type ShiftCorrectionRequest = {
  event: CorrectionEvent;
  requestedAt: string;
  workBreakId: string | null;
  breakStartedAt: string | null;
  breakEndedAt: string | null;
};

function clockRequest(
  event: "clock_in" | "clock_out",
  localTime: string,
  toISO: (local: string) => string,
): ShiftCorrectionRequest {
  return {
    event,
    requestedAt: toISO(localTime),
    workBreakId: null,
    breakStartedAt: null,
    breakEndedAt: null,
  };
}

// Turns an edited shift into one correction request per changed item, in the
// order the server can apply them. Deletes run first so freed time is available.
export function buildShiftCorrectionRequests(
  original: ShiftCorrectionSnapshot,
  edited: ShiftCorrectionSnapshot,
  toISO: (local: string) => string,
): ShiftCorrectionRequest[] {
  const clockIn =
    edited.clockInAt !== original.clockInAt
      ? clockRequest("clock_in", edited.clockInAt, toISO)
      : null;
  const clockOut =
    edited.clockOutAt && edited.clockOutAt !== original.clockOutAt
      ? clockRequest("clock_out", edited.clockOutAt, toISO)
      : null;

  // A clock-in moved past the old clock-out is only valid once the clock-out has moved.
  const clockInPastOldOut =
    original.clockOutAt !== "" && edited.clockInAt >= original.clockOutAt;
  const clockRequests = clockInPastOldOut
    ? [clockOut, clockIn]
    : [clockIn, clockOut];

  const editedIds = new Set(
    edited.breaks.map((item) => item.id).filter((id) => id !== null),
  );
  const deletes = original.breaks
    .filter(
      (item): item is ShiftCorrectionBreak & { id: string } =>
        item.id !== null && !editedIds.has(item.id),
    )
    .map(
      (item): ShiftCorrectionRequest => ({
        event: "break_delete",
        requestedAt: toISO(item.startedAt),
        workBreakId: item.id,
        breakStartedAt: null,
        breakEndedAt: null,
      }),
    );

  const updates: ShiftCorrectionRequest[] = [];
  const adds: ShiftCorrectionRequest[] = [];
  for (const item of edited.breaks) {
    if (item.id === null) {
      if (!item.startedAt || !item.endedAt) continue;
      adds.push({
        event: "break_add",
        requestedAt: toISO(item.startedAt),
        workBreakId: null,
        breakStartedAt: toISO(item.startedAt),
        breakEndedAt: toISO(item.endedAt),
      });
      continue;
    }
    const originalItem = original.breaks.find(
      (candidate) => candidate.id === item.id,
    );
    if (
      !originalItem ||
      (originalItem.startedAt === item.startedAt &&
        originalItem.endedAt === item.endedAt)
    ) {
      continue;
    }
    updates.push({
      event: "break_update",
      requestedAt: toISO(item.startedAt),
      workBreakId: item.id,
      breakStartedAt: toISO(item.startedAt),
      breakEndedAt: item.endedAt ? toISO(item.endedAt) : null,
    });
  }

  return [
    ...clockRequests.filter(
      (request): request is ShiftCorrectionRequest => request !== null,
    ),
    ...deletes,
    ...updates,
    ...adds,
  ];
}
