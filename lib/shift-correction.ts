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
