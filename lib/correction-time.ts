export type CorrectionEvent = "clock_in" | "clock_out";

type ShiftTimes = {
  clockInAt: Date;
  clockOutAt: Date | null;
};

export function getCorrectionTimeError(
  event: CorrectionEvent,
  requestedAt: Date,
  shift: ShiftTimes | null,
  now: Date,
  futureToleranceMilliseconds = 0,
) {
  if (requestedAt.getTime() > now.getTime() + futureToleranceMilliseconds) {
    return "future" as const;
  }

  if (
    shift &&
    ((event === "clock_in" &&
      shift.clockOutAt &&
      requestedAt >= shift.clockOutAt) ||
      (event === "clock_out" && requestedAt <= shift.clockInAt))
  ) {
    return "out_of_order" as const;
  }

  return null;
}
