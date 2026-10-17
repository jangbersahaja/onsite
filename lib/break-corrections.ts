import { validateBreakIntervals } from "@/lib/work-breaks";

export const CORRECTION_EVENTS = [
  "clock_in",
  "clock_out",
  "break_update",
  "break_add",
  "break_delete",
] as const;

export type CorrectionEvent = (typeof CORRECTION_EVENTS)[number];

export type BreakCorrectionEvent = Extract<CorrectionEvent, `break_${string}`>;

export function isBreakCorrectionEvent(
  event: CorrectionEvent,
): event is BreakCorrectionEvent {
  return event.startsWith("break_");
}

export type ShiftBreak = {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
};

export type ShiftTimes = {
  clockInAt: Date;
  clockOutAt: Date | null;
};

export type BreakChange =
  | {
      kind: "update";
      workBreakId: string;
      startedAt: Date;
      endedAt: Date | null;
    }
  | { kind: "add"; startedAt: Date; endedAt: Date }
  | { kind: "delete"; workBreakId: string };

export type BreakChangeError =
  | "break_not_found"
  | "break_end_locked"
  | "break_in_future"
  | "break_invalid";

export type BreakChangePlan =
  | { ok: true; target: ShiftBreak | null }
  | { ok: false; error: BreakChangeError };

/** Allows for small clock skew between the device and the server. */
export const BREAK_FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * Validates a break change against the shift and its existing breaks.
 * Pure: performs no I/O, so the caller applies the change after a successful plan.
 */
export function planBreakChange(
  shift: ShiftTimes,
  breaks: ShiftBreak[],
  change: BreakChange,
  now: Date,
): BreakChangePlan {
  const target =
    change.kind === "add"
      ? null
      : (breaks.find((item) => item.id === change.workBreakId) ?? null);

  if (change.kind !== "add" && !target) {
    return { ok: false, error: "break_not_found" };
  }

  // Removing a break cannot make the remaining intervals invalid.
  if (change.kind === "delete") {
    return { ok: true, target };
  }

  const limit = now.getTime() + BREAK_FUTURE_TOLERANCE_MS;
  if (
    change.startedAt.getTime() > limit ||
    (change.endedAt !== null && change.endedAt.getTime() > limit)
  ) {
    return { ok: false, error: "break_in_future" };
  }

  // An open break can only have its start corrected; its end is set by the
  // live clock flow, not by a correction.
  if (target && target.endedAt === null && change.endedAt !== null) {
    return { ok: false, error: "break_end_locked" };
  }

  // Reopening a closed break is not supported.
  if (target && target.endedAt !== null && change.endedAt === null) {
    return { ok: false, error: "break_invalid" };
  }

  const nextBreaks =
    change.kind === "add"
      ? [...breaks, { startedAt: change.startedAt, endedAt: change.endedAt }]
      : breaks.map((item) =>
          item.id === change.workBreakId
            ? { startedAt: change.startedAt, endedAt: change.endedAt }
            : item,
        );

  if (!validateBreakIntervals(nextBreaks, shift.clockInAt, shift.clockOutAt)) {
    return { ok: false, error: "break_invalid" };
  }

  return { ok: true, target };
}
