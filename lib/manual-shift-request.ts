import { isCorrectionReasonCode } from "@/lib/correction-reasons";
import type { ManualBreak } from "@/lib/timesheet-create-rules";
import { z } from "zod";

export const manualShiftRequestSchema = z
  .object({
    outletId: z.string().uuid(),
    // Local outlet time, "YYYY-MM-DDTHH:mm", same as timesheet manual entry.
    clockInAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    clockOutAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    breaks: z
      .array(
        z
          .object({
            startedAt: z.string().datetime({ offset: true }),
            endedAt: z.string().datetime({ offset: true }),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    reasonCode: z.string().refine((value) => isCorrectionReasonCode(value), {
      message: "Choose a valid reason.",
    }),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const manualShiftReviewSchema = z
  .object({
    requestId: z.string().uuid(),
    outletId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().max(500),
  })
  .strict()
  .refine((value) => value.decision !== "reject" || value.reason.length > 0, {
    path: ["reason"],
    message: "A note is required to reject a request.",
  });

export type StoredBreak = { startedAt: string; endedAt: string };

/** Converts the request payload breaks into `Date` intervals. */
export function toManualBreaks(
  breaks: { startedAt: string; endedAt: string }[] | undefined,
): ManualBreak[] {
  return (breaks ?? []).map((item) => ({
    startedAt: new Date(item.startedAt),
    endedAt: new Date(item.endedAt),
  }));
}

/** Serialises breaks for the jsonb column. */
export function serializeBreaks(breaks: ManualBreak[]): StoredBreak[] {
  return breaks.map((item) => ({
    startedAt: item.startedAt.toISOString(),
    endedAt: (item.endedAt ?? item.startedAt).toISOString(),
  }));
}

/** Reads the jsonb column back into `Date` intervals, skipping malformed rows. */
export function parseStoredBreaks(value: unknown): ManualBreak[] {
  if (!Array.isArray(value)) return [];
  const result: ManualBreak[] = [];
  for (const item of value) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as StoredBreak).startedAt !== "string" ||
      typeof (item as StoredBreak).endedAt !== "string"
    ) {
      continue;
    }
    const startedAt = new Date((item as StoredBreak).startedAt);
    const endedAt = new Date((item as StoredBreak).endedAt);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
      continue;
    }
    result.push({ startedAt, endedAt });
  }
  return result;
}
