import {
  correctionRequests,
  outletMemberships,
  outlets,
  punchSourceEnum,
  staffDeviceEnrollments,
  user,
  workBreaks,
  workSessions,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import {
  CORRECTION_EVENTS,
  isBreakCorrectionEvent,
  planBreakChange,
  type BreakChange,
  type BreakChangeError,
  type BreakCorrectionEvent,
  type ShiftBreak,
} from "@/lib/break-corrections";
import { getCorrectionTimeError } from "@/lib/correction-time";
import { getDb } from "@/lib/db";
import { notifyOutletManagers } from "@/lib/push-notifications";
import {
  getStaffDeviceCookieName,
  isApprovedStaffDevice,
  isStaffDeviceRequired,
  staffDeviceCookieOptions,
} from "@/lib/staff-device";
import { getTeamAccess } from "@/lib/team-access";
import { and, desc, eq, gt, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

const timestampSchema = z.string().datetime({ offset: true });

const correctionSchema = z
  .object({
    outletId: z.string().uuid(),
    workSessionId: z.string().uuid().nullable(),
    event: z.enum(CORRECTION_EVENTS),
    requestedAt: timestampSchema,
    workBreakId: z.string().uuid().nullable(),
    breakStartedAt: timestampSchema.nullable(),
    breakEndedAt: timestampSchema.nullable(),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict()
  .superRefine((value, context) => {
    if (!isBreakCorrectionEvent(value.event)) {
      if (value.workBreakId || value.breakStartedAt || value.breakEndedAt) {
        context.addIssue({
          code: "custom",
          path: ["workBreakId"],
          message: "Break times only apply to break corrections.",
        });
      }
      return;
    }
    if (!value.workSessionId) {
      context.addIssue({
        code: "custom",
        path: ["workSessionId"],
        message: "A break correction needs its shift.",
      });
    }
    if (value.event !== "break_add" && !value.workBreakId) {
      context.addIssue({
        code: "custom",
        path: ["workBreakId"],
        message: "Choose the break to correct.",
      });
    }
    if (value.event !== "break_delete" && !value.breakStartedAt) {
      context.addIssue({
        code: "custom",
        path: ["breakStartedAt"],
        message: "A break start time is required.",
      });
    }
    if (value.event === "break_add" && !value.breakEndedAt) {
      context.addIssue({
        code: "custom",
        path: ["breakEndedAt"],
        message: "A break end time is required.",
      });
    }
  });

function unavailable() {
  return Response.json(
    {
      error: "Set DATABASE_URL before using corrections.",
      code: "corrections_unconfigured",
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session)
      return Response.json(
        { error: "Sign in required.", code: "unauthorized" },
        { status: 401 },
      );

    const params = new URL(request.url).searchParams;
    const review = params.get("view") === "review";
    const requestedOutletId = params.get("outletId");
    if (!review && !session.user.canAccessClock) {
      return Response.json(
        {
          error: "Clock access is not enabled.",
          code: "clock_access_disabled",
        },
        { status: 403 },
      );
    }
    const access = review ? await getTeamAccess(session.user.id) : null;
    const reviewOutletIds = access?.outletIds ?? [];
    if (review && !reviewOutletIds.length) {
      return Response.json(
        {
          error: "Correction review access is not available.",
          code: "correction_review_unavailable",
        },
        { status: 403 },
      );
    }
    if (
      review &&
      requestedOutletId &&
      !reviewOutletIds.includes(requestedOutletId)
    ) {
      return Response.json(
        {
          error: "You cannot access this outlet.",
          code: "outlet_access_denied",
        },
        { status: 403 },
      );
    }
    const visibleOutletIds = requestedOutletId
      ? [requestedOutletId]
      : reviewOutletIds;

    const requests = await getDb()
      .select({
        id: correctionRequests.id,
        requestedBy: correctionRequests.requestedBy,
        requesterName: user.name,
        requesterEmail: user.email,
        outletId: correctionRequests.outletId,
        outletName: outlets.name,
        timezone: correctionRequests.timezone,
        workSessionId: correctionRequests.workSessionId,
        event: correctionRequests.event,
        requestedAt: correctionRequests.requestedAt,
        workBreakId: correctionRequests.workBreakId,
        breakStartedAt: correctionRequests.breakStartedAt,
        breakEndedAt: correctionRequests.breakEndedAt,
        reason: correctionRequests.reason,
        status: correctionRequests.status,
        appliedAt: correctionRequests.appliedAt,
        reconciledAt: correctionRequests.reconciledAt,
        reviewReason: correctionRequests.reviewReason,
        createdAt: correctionRequests.createdAt,
      })
      .from(correctionRequests)
      .innerJoin(outlets, eq(correctionRequests.outletId, outlets.id))
      .innerJoin(user, eq(correctionRequests.requestedBy, user.id))
      .where(
        review && access
          ? and(
              inArray(correctionRequests.outletId, visibleOutletIds),
              eq(correctionRequests.status, "reconciliation"),
            )
          : eq(correctionRequests.requestedBy, session.user.id),
      )
      .orderBy(desc(correctionRequests.createdAt))
      .limit(review ? 100 : 20);

    return Response.json({ requests, review });
  } catch {
    return Response.json(
      {
        error: "Could not load correction requests.",
        code: "corrections_load_failed",
      },
      { status: 500 },
    );
  }
}

type DbTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];
type CorrectionInput = z.infer<typeof correctionSchema>;
type CorrectionRow = typeof correctionRequests.$inferSelect;
type WorkSessionRow = typeof workSessions.$inferSelect;
type PunchSource = (typeof punchSourceEnum.enumValues)[number];
// Punch values captured before a clock correction, used to restore them on reject.
type PunchSnapshot = {
  at: string | null;
  source: PunchSource | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
};
type ReviewFailure = {
  ok: false;
  status: number;
  error: string;
  code: string;
};

const BREAK_ERROR_DETAILS: Record<
  BreakChangeError,
  { status: number; error: string }
> = {
  break_not_found: {
    status: 404,
    error: "That break no longer exists on this shift.",
  },
  break_end_locked: {
    status: 400,
    error: "An open break can only have its start time corrected.",
  },
  break_in_future: {
    status: 400,
    error: "Break times cannot be in the future.",
  },
  break_invalid: {
    status: 400,
    error:
      "The break times must fall inside the shift and must not overlap other breaks.",
  },
};

function breakErrorDetails(error: BreakChangeError) {
  return { ...BREAK_ERROR_DETAILS[error], code: error };
}

async function loadShiftBreaks(
  tx: DbTransaction,
  workSessionId: string,
): Promise<ShiftBreak[]> {
  return tx
    .select({
      id: workBreaks.id,
      startedAt: workBreaks.startedAt,
      endedAt: workBreaks.endedAt,
    })
    .from(workBreaks)
    .where(eq(workBreaks.workSessionId, workSessionId))
    .orderBy(workBreaks.startedAt);
}

type BreakCorrectionOutcome =
  | { kind: "error"; status: number; error: string; code: string }
  | { kind: "applied"; correction: CorrectionRow; session: WorkSessionRow };

async function submitBreakCorrection(
  tx: DbTransaction,
  {
    event,
    input,
    userId,
    timezone,
    now,
  }: {
    event: BreakCorrectionEvent;
    input: CorrectionInput;
    userId: string;
    timezone: string;
    now: Date;
  },
): Promise<BreakCorrectionOutcome> {
  if (!input.workSessionId) {
    return {
      kind: "error",
      status: 400,
      error: "Choose the shift that contains the break.",
      code: "break_shift_required",
    };
  }

  const [shift] = await tx
    .select()
    .from(workSessions)
    .where(
      and(
        eq(workSessions.id, input.workSessionId),
        eq(workSessions.userId, userId),
        eq(workSessions.outletId, input.outletId),
      ),
    )
    .limit(1)
    .for("update");
  if (!shift) {
    return {
      kind: "error",
      status: 403,
      error: "That shift does not belong to your account.",
      code: "shift_not_owned",
    };
  }

  // Schema refinements guarantee the fields each event needs are present.
  const change: BreakChange =
    event === "break_add"
      ? {
          kind: "add",
          startedAt: new Date(input.breakStartedAt!),
          endedAt: new Date(input.breakEndedAt!),
        }
      : event === "break_update"
        ? {
            kind: "update",
            workBreakId: input.workBreakId!,
            startedAt: new Date(input.breakStartedAt!),
            endedAt: input.breakEndedAt ? new Date(input.breakEndedAt) : null,
          }
        : { kind: "delete", workBreakId: input.workBreakId! };

  const plan = planBreakChange(
    shift,
    await loadShiftBreaks(tx, shift.id),
    change,
    now,
  );
  if (!plan.ok) {
    return { kind: "error", ...breakErrorDetails(plan.error) };
  }

  const previousBreak = plan.target
    ? {
        startedAt: plan.target.startedAt.toISOString(),
        endedAt: plan.target.endedAt?.toISOString() ?? null,
      }
    : null;

  let breakId: string;
  if (change.kind === "add") {
    const [created] = await tx
      .insert(workBreaks)
      .values({
        workSessionId: shift.id,
        startedAt: change.startedAt,
        endedAt: change.endedAt,
        updatedAt: now,
      })
      .returning({ id: workBreaks.id });
    breakId = created.id;
  } else if (change.kind === "update") {
    await tx
      .update(workBreaks)
      .set({
        startedAt: change.startedAt,
        endedAt: change.endedAt,
        updatedAt: now,
      })
      .where(eq(workBreaks.id, change.workBreakId));
    breakId = change.workBreakId;
  } else {
    await tx.delete(workBreaks).where(eq(workBreaks.id, change.workBreakId));
    breakId = change.workBreakId;
  }

  // A deleted break keeps its last known times on the request record.
  const recordedStart =
    change.kind === "delete"
      ? (plan.target?.startedAt ?? now)
      : change.startedAt;
  const recordedEnd =
    change.kind === "delete" ? (plan.target?.endedAt ?? null) : change.endedAt;

  const [correction] = await tx
    .insert(correctionRequests)
    .values({
      requestedBy: userId,
      outletId: input.outletId,
      timezone,
      workSessionId: shift.id,
      event,
      requestedAt: recordedStart,
      workBreakId: change.kind === "delete" ? null : breakId,
      breakStartedAt: recordedStart,
      breakEndedAt: recordedEnd,
      reason: input.reason,
      status: "reconciliation",
      appliedAt: now,
      previousValues: previousBreak,
    })
    .returning();

  await recordAudit(tx, [
    {
      actorId: userId,
      action: "correction_break_applied",
      entityType: "correction_request",
      entityId: correction.id,
      outletId: input.outletId,
      newValues: {
        workSessionId: shift.id,
        event,
        workBreakId: change.kind === "delete" ? null : breakId,
        breakStartedAt: recordedStart.toISOString(),
        breakEndedAt: recordedEnd?.toISOString() ?? null,
        status: "reconciliation",
        appliedAt: now.toISOString(),
      },
      reason: input.reason,
    },
    {
      actorId: userId,
      action: "correction_break_changed",
      entityType: "work_break",
      entityId: breakId,
      outletId: input.outletId,
      previousValues: previousBreak,
      newValues:
        change.kind === "delete"
          ? null
          : {
              startedAt: change.startedAt.toISOString(),
              endedAt: change.endedAt?.toISOString() ?? null,
            },
      reason: input.reason,
    },
  ]);

  return { kind: "applied", correction, session: shift };
}

type BreakReviewInput = {
  correction: CorrectionRow;
  decision: "confirm" | "adjust";
  reason: string;
  reviewerId: string;
  reviewedAt: Date;
  breakStartedAt?: string;
  breakEndedAt?: string | null;
};

async function reconcileBreakCorrection(
  tx: DbTransaction,
  input: BreakReviewInput,
): Promise<{ ok: true } | ReviewFailure> {
  const { correction, reviewerId, reviewedAt } = input;
  const relatedShiftMissing = {
    ok: false as const,
    status: 409,
    error: "The related shift no longer exists.",
    code: "related_shift_missing",
  };
  if (!correction.workSessionId) return relatedShiftMissing;

  const [shift] = await tx
    .select()
    .from(workSessions)
    .where(
      and(
        eq(workSessions.id, correction.workSessionId),
        eq(workSessions.userId, correction.requestedBy),
        eq(workSessions.outletId, correction.outletId),
      ),
    )
    .limit(1)
    .for("update");
  if (!shift) return relatedShiftMissing;

  let recordedStart: Date = correction.breakStartedAt ?? correction.requestedAt;
  let recordedEnd: Date | null = correction.breakEndedAt;
  let adjustedBreak: {
    id: string;
    previousValues: unknown;
    newValues: unknown;
  } | null = null;

  if (input.decision === "adjust") {
    if (correction.event === "break_delete") {
      return {
        ok: false,
        status: 400,
        error: "Deleted breaks can only be confirmed.",
        code: "break_not_adjustable",
      };
    }
    if (!correction.workBreakId) {
      return { ok: false, ...breakErrorDetails("break_not_found") };
    }
    if (!input.breakStartedAt) {
      return {
        ok: false,
        status: 400,
        error: "Decision details are invalid.",
        code: "invalid_decision",
      };
    }

    const startedAt = new Date(input.breakStartedAt);
    const endedAt = input.breakEndedAt ? new Date(input.breakEndedAt) : null;
    const plan = planBreakChange(
      shift,
      await loadShiftBreaks(tx, shift.id),
      {
        kind: "update",
        workBreakId: correction.workBreakId,
        startedAt,
        endedAt,
      },
      reviewedAt,
    );
    if (!plan.ok) return { ok: false, ...breakErrorDetails(plan.error) };
    if (!plan.target) {
      return { ok: false, ...breakErrorDetails("break_not_found") };
    }

    await tx
      .update(workBreaks)
      .set({ startedAt, endedAt, updatedAt: reviewedAt })
      .where(eq(workBreaks.id, plan.target.id));
    adjustedBreak = {
      id: plan.target.id,
      previousValues: {
        startedAt: plan.target.startedAt.toISOString(),
        endedAt: plan.target.endedAt?.toISOString() ?? null,
      },
      newValues: {
        startedAt: startedAt.toISOString(),
        endedAt: endedAt?.toISOString() ?? null,
      },
    };
    recordedStart = startedAt;
    recordedEnd = endedAt;
  }

  await tx
    .update(correctionRequests)
    .set({
      status: "approved",
      requestedAt: recordedStart,
      breakStartedAt: recordedStart,
      breakEndedAt: recordedEnd,
      reviewedBy: reviewerId,
      reviewedAt,
      reviewReason: input.reason || null,
      reconciledBy: reviewerId,
      reconciledAt: reviewedAt,
    })
    .where(eq(correctionRequests.id, correction.id));
  await recordAudit(tx, {
    actorId: reviewerId,
    action:
      input.decision === "adjust"
        ? "correction_adjusted"
        : "correction_reconciled",
    entityType: "correction_request",
    entityId: correction.id,
    outletId: correction.outletId,
    previousValues: {
      status: "reconciliation",
      requestedAt: correction.requestedAt.toISOString(),
      breakStartedAt: correction.breakStartedAt?.toISOString() ?? null,
      breakEndedAt: correction.breakEndedAt?.toISOString() ?? null,
    },
    newValues: {
      status: "approved",
      requestedAt: recordedStart.toISOString(),
      breakStartedAt: recordedStart.toISOString(),
      breakEndedAt: recordedEnd?.toISOString() ?? null,
      reconciledAt: reviewedAt.toISOString(),
    },
    reason: input.reason,
  });
  if (adjustedBreak) {
    await recordAudit(tx, {
      actorId: reviewerId,
      action: "correction_break_adjusted",
      entityType: "work_break",
      entityId: adjustedBreak.id,
      outletId: correction.outletId,
      previousValues: adjustedBreak.previousValues,
      newValues: adjustedBreak.newValues,
      reason: input.reason,
    });
  }

  return { ok: true };
}

const punchSnapshotSchema = z.object({
  at: z.string().nullable(),
  source: z.enum(punchSourceEnum.enumValues).nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  accuracy: z.number().nullable(),
});

const breakSnapshotSchema = z.object({
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});

const notRestorableFailure = {
  ok: false as const,
  status: 409,
  error:
    "This correction has no saved values to restore. Adjust or confirm it instead.",
  code: "reject_not_restorable",
};

const changedSinceCorrectionFailure = {
  ok: false as const,
  status: 409,
  error:
    "This has changed since the correction was applied. Adjust or confirm it instead.",
  code: "changed_since_correction",
};

function sameInstant(a: Date | null, b: Date | null) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

async function saveCorrectionNote(
  tx: DbTransaction,
  input: { correction: CorrectionRow; reason: string; reviewerId: string },
): Promise<{ ok: true }> {
  const { correction, reason, reviewerId } = input;
  await tx
    .update(correctionRequests)
    .set({ reviewReason: reason })
    .where(eq(correctionRequests.id, correction.id));
  await recordAudit(tx, {
    actorId: reviewerId,
    action: "correction_noted",
    entityType: "correction_request",
    entityId: correction.id,
    outletId: correction.outletId,
    previousValues: { reviewReason: correction.reviewReason },
    newValues: { reviewReason: reason },
    reason,
  });
  return { ok: true };
}

async function markCorrectionRejected(
  tx: DbTransaction,
  input: {
    correction: CorrectionRow;
    reason: string;
    reviewerId: string;
    reviewedAt: Date;
  },
) {
  const { correction, reason, reviewerId, reviewedAt } = input;
  await tx
    .update(correctionRequests)
    .set({
      status: "rejected",
      reviewedBy: reviewerId,
      reviewedAt,
      reviewReason: reason,
    })
    .where(eq(correctionRequests.id, correction.id));
  await recordAudit(tx, {
    actorId: reviewerId,
    action: "correction_rejected",
    entityType: "correction_request",
    entityId: correction.id,
    outletId: correction.outletId,
    previousValues: { status: "reconciliation" },
    newValues: { status: "rejected", reviewedAt: reviewedAt.toISOString() },
    reason,
  });
}

async function rejectClockCorrection(
  tx: DbTransaction,
  correction: CorrectionRow,
  workSession: WorkSessionRow,
  input: { reason: string; reviewerId: string; reviewedAt: Date },
): Promise<{ ok: true } | ReviewFailure> {
  const { reviewedAt } = input;
  const snapshot = punchSnapshotSchema.safeParse(correction.previousValues);
  if (!snapshot.success) return notRestorableFailure;
  const { at, source, latitude, longitude, accuracy } = snapshot.data;
  const restoredAt = at ? new Date(at) : null;
  const event: "clock_in" | "clock_out" =
    correction.event === "clock_in" ? "clock_in" : "clock_out";

  const currentAt =
    event === "clock_in" ? workSession.clockInAt : workSession.clockOutAt;
  if (!sameInstant(currentAt, correction.requestedAt)) {
    return changedSinceCorrectionFailure;
  }

  if (event === "clock_in") {
    if (!restoredAt || !source) return notRestorableFailure;
    if (
      getCorrectionTimeError("clock_in", restoredAt, workSession, reviewedAt)
    ) {
      return {
        ok: false,
        status: 409,
        error: "The restored clock-in is no longer valid for this shift.",
        code: "reject_out_of_order",
      };
    }
    const [overlappingSession] = await tx
      .select({ id: workSessions.id })
      .from(workSessions)
      .where(
        and(
          eq(workSessions.userId, correction.requestedBy),
          ne(workSessions.id, workSession.id),
          lte(workSessions.clockInAt, restoredAt),
          or(
            isNull(workSessions.clockOutAt),
            gt(workSessions.clockOutAt, restoredAt),
          ),
        ),
      )
      .limit(1);
    if (overlappingSession) {
      return {
        ok: false,
        status: 409,
        error: "The restored clock-in overlaps another shift.",
        code: "reject_clock_in_overlaps",
      };
    }
    await tx
      .update(workSessions)
      .set({
        clockInAt: restoredAt,
        clockInLatitude: latitude,
        clockInLongitude: longitude,
        clockInAccuracy: accuracy,
        clockInSource: source,
        updatedAt: reviewedAt,
      })
      .where(eq(workSessions.id, workSession.id));
    await recordAudit(tx, {
      actorId: input.reviewerId,
      action: "correction_punch_reverted",
      entityType: "work_session",
      entityId: workSession.id,
      outletId: correction.outletId,
      previousValues: {
        clockInAt: workSession.clockInAt.toISOString(),
        clockInSource: workSession.clockInSource,
      },
      newValues: { clockInAt: restoredAt.toISOString(), clockInSource: source },
      reason: input.reason,
    });
  } else {
    if (restoredAt) {
      if (
        getCorrectionTimeError("clock_out", restoredAt, workSession, reviewedAt)
      ) {
        return {
          ok: false,
          status: 409,
          error: "The restored clock-out is no longer valid for this shift.",
          code: "reject_out_of_order",
        };
      }
    } else {
      // Restoring an open shift is only possible if the user has no other open shift.
      const [otherOpenSession] = await tx
        .select({ id: workSessions.id })
        .from(workSessions)
        .where(
          and(
            eq(workSessions.userId, correction.requestedBy),
            ne(workSessions.id, workSession.id),
            isNull(workSessions.clockOutAt),
          ),
        )
        .limit(1);
      if (otherOpenSession) {
        return {
          ok: false,
          status: 409,
          error: "The user already has another open shift.",
          code: "reject_open_shift_exists",
        };
      }
    }
    await tx
      .update(workSessions)
      .set({
        clockOutAt: restoredAt,
        clockOutLatitude: latitude,
        clockOutLongitude: longitude,
        clockOutAccuracy: accuracy,
        clockOutSource: source,
        updatedAt: reviewedAt,
      })
      .where(eq(workSessions.id, workSession.id));
    await recordAudit(tx, {
      actorId: input.reviewerId,
      action: "correction_punch_reverted",
      entityType: "work_session",
      entityId: workSession.id,
      outletId: correction.outletId,
      previousValues: {
        clockOutAt: workSession.clockOutAt?.toISOString() ?? null,
        clockOutSource: workSession.clockOutSource,
      },
      newValues: {
        clockOutAt: restoredAt?.toISOString() ?? null,
        clockOutSource: source,
      },
      reason: input.reason,
    });
  }

  await markCorrectionRejected(tx, { correction, ...input, reviewedAt });
  return { ok: true };
}

async function rejectBreakCorrection(
  tx: DbTransaction,
  input: {
    correction: CorrectionRow;
    reason: string;
    reviewerId: string;
    reviewedAt: Date;
  },
): Promise<{ ok: true } | ReviewFailure> {
  const { correction, reviewedAt, reviewerId } = input;
  if (!correction.workSessionId) {
    return {
      ok: false,
      status: 409,
      error: "The related shift no longer exists.",
      code: "related_shift_missing",
    };
  }
  const [shift] = await tx
    .select()
    .from(workSessions)
    .where(
      and(
        eq(workSessions.id, correction.workSessionId),
        eq(workSessions.userId, correction.requestedBy),
        eq(workSessions.outletId, correction.outletId),
      ),
    )
    .limit(1)
    .for("update");
  if (!shift) {
    return {
      ok: false,
      status: 409,
      error: "The related shift no longer exists.",
      code: "related_shift_missing",
    };
  }

  const breaks = await loadShiftBreaks(tx, shift.id);
  const current = correction.workBreakId
    ? breaks.find((item) => item.id === correction.workBreakId)
    : undefined;
  const appliedStart = correction.breakStartedAt;
  const appliedEnd = correction.breakEndedAt;

  if (correction.event === "break_add") {
    if (
      !current ||
      !sameInstant(current.startedAt, appliedStart) ||
      !sameInstant(current.endedAt, appliedEnd)
    ) {
      return changedSinceCorrectionFailure;
    }
    await tx.delete(workBreaks).where(eq(workBreaks.id, current.id));
    await recordAudit(tx, {
      actorId: reviewerId,
      action: "correction_break_reverted",
      entityType: "work_break",
      entityId: current.id,
      outletId: correction.outletId,
      previousValues: {
        startedAt: current.startedAt.toISOString(),
        endedAt: current.endedAt?.toISOString() ?? null,
      },
      newValues: null,
      reason: input.reason,
    });
  } else if (correction.event === "break_update") {
    const snapshot = breakSnapshotSchema.safeParse(correction.previousValues);
    if (!snapshot.success || !current) {
      return snapshot.success
        ? changedSinceCorrectionFailure
        : notRestorableFailure;
    }
    if (
      !sameInstant(current.startedAt, appliedStart) ||
      !sameInstant(current.endedAt, appliedEnd)
    ) {
      return changedSinceCorrectionFailure;
    }
    const restoredStart = new Date(snapshot.data.startedAt);
    const restoredEnd = snapshot.data.endedAt
      ? new Date(snapshot.data.endedAt)
      : null;
    const plan = planBreakChange(
      shift,
      breaks,
      {
        kind: "update",
        workBreakId: current.id,
        startedAt: restoredStart,
        endedAt: restoredEnd,
      },
      reviewedAt,
    );
    if (!plan.ok) return { ok: false, ...breakErrorDetails(plan.error) };
    await tx
      .update(workBreaks)
      .set({
        startedAt: restoredStart,
        endedAt: restoredEnd,
        updatedAt: reviewedAt,
      })
      .where(eq(workBreaks.id, current.id));
    await recordAudit(tx, {
      actorId: reviewerId,
      action: "correction_break_reverted",
      entityType: "work_break",
      entityId: current.id,
      outletId: correction.outletId,
      previousValues: {
        startedAt: current.startedAt.toISOString(),
        endedAt: current.endedAt?.toISOString() ?? null,
      },
      newValues: {
        startedAt: restoredStart.toISOString(),
        endedAt: restoredEnd?.toISOString() ?? null,
      },
      reason: input.reason,
    });
  } else {
    // The deleted break's last known times are kept on the correction itself.
    if (!appliedStart) return notRestorableFailure;
    const plan = planBreakChange(
      shift,
      breaks,
      { kind: "add", startedAt: appliedStart, endedAt: appliedEnd },
      reviewedAt,
    );
    if (!plan.ok) return { ok: false, ...breakErrorDetails(plan.error) };
    const [restored] = await tx
      .insert(workBreaks)
      .values({
        workSessionId: shift.id,
        startedAt: appliedStart,
        endedAt: appliedEnd,
        updatedAt: reviewedAt,
      })
      .returning({ id: workBreaks.id });
    await recordAudit(tx, {
      actorId: reviewerId,
      action: "correction_break_reverted",
      entityType: "work_break",
      entityId: restored.id,
      outletId: correction.outletId,
      previousValues: null,
      newValues: {
        startedAt: appliedStart.toISOString(),
        endedAt: appliedEnd?.toISOString() ?? null,
      },
      reason: input.reason,
    });
  }

  await markCorrectionRejected(tx, input);
  return { ok: true };
}

const reviewSchema = z
  .object({
    requestId: z.string().uuid(),
    outletId: z.string().uuid(),
    decision: z.enum(["confirm", "adjust", "reject", "save_note"]),
    reason: z.string().trim().max(500),
    requestedAt: timestampSchema.optional(),
    breakStartedAt: timestampSchema.optional(),
    breakEndedAt: timestampSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.decision !== "reject" && value.decision !== "save_note") ||
      value.reason.length > 0,
    { path: ["reason"], message: "A note is required." },
  );

export async function PATCH(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session)
      return Response.json(
        { error: "Sign in required.", code: "unauthorized" },
        { status: 401 },
      );
    const access = await getTeamAccess(session.user.id);
    if (!access) {
      return Response.json(
        {
          error: "Correction review access is not available.",
          code: "correction_review_unavailable",
        },
        { status: 403 },
      );
    }
    const reviewOutletIds = access.outletIds;
    if (!reviewOutletIds.length) {
      return Response.json(
        {
          error: "Correction review access is not available.",
          code: "correction_review_unavailable",
        },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON.", code: "invalid_json" },
        { status: 400 },
      );
    }
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Decision details are invalid.", code: "invalid_decision" },
        { status: 400 },
      );
    }

    const db = getDb();
    const outcome = await db.transaction(async (tx) => {
      const [correction] = await tx
        .select()
        .from(correctionRequests)
        .where(
          and(
            eq(correctionRequests.id, parsed.data.requestId),
            eq(correctionRequests.outletId, parsed.data.outletId),
            inArray(correctionRequests.outletId, reviewOutletIds),
            eq(correctionRequests.status, "reconciliation"),
          ),
        )
        .limit(1)
        .for("update");

      if (!correction) {
        return {
          ok: false as const,
          status: 404,
          error: "Applied correction not found.",
          code: "correction_not_found",
        };
      }

      const reviewedAt = new Date();
      let updatedPunch: {
        id: string;
        previousValues: Record<string, unknown>;
        newValues: Record<string, unknown>;
      } | null = null;

      if (correction.status === "reconciliation") {
        const { decision } = parsed.data;
        if (decision === "save_note") {
          return saveCorrectionNote(tx, {
            correction,
            reason: parsed.data.reason,
            reviewerId: session.user.id,
          });
        }
        if (isBreakCorrectionEvent(correction.event)) {
          if (decision === "reject") {
            return rejectBreakCorrection(tx, {
              correction,
              reason: parsed.data.reason,
              reviewerId: session.user.id,
              reviewedAt,
            });
          }
          return reconcileBreakCorrection(tx, {
            correction,
            decision,
            reason: parsed.data.reason,
            reviewerId: session.user.id,
            reviewedAt,
            breakStartedAt: parsed.data.breakStartedAt,
            breakEndedAt: parsed.data.breakEndedAt,
          });
        }
        if (!correction.workSessionId) {
          return {
            ok: false as const,
            status: 409,
            error: "The related shift no longer exists.",
            code: "related_shift_missing",
          };
        }

        const [workSession] = await tx
          .select()
          .from(workSessions)
          .where(
            and(
              eq(workSessions.id, correction.workSessionId),
              eq(workSessions.userId, correction.requestedBy),
              eq(workSessions.outletId, correction.outletId),
            ),
          )
          .limit(1)
          .for("update");
        if (!workSession) {
          return {
            ok: false as const,
            status: 409,
            error: "The related shift no longer exists.",
            code: "related_shift_missing",
          };
        }

        if (decision === "reject") {
          return rejectClockCorrection(tx, correction, workSession, {
            reason: parsed.data.reason,
            reviewerId: session.user.id,
            reviewedAt,
          });
        }

        let reconciledTime = correction.requestedAt;
        if (parsed.data.decision === "adjust") {
          if (!parsed.data.requestedAt) {
            return {
              ok: false as const,
              status: 400,
              error: "Decision details are invalid.",
              code: "invalid_decision",
            };
          }
          reconciledTime = new Date(parsed.data.requestedAt);
          const timeError = getCorrectionTimeError(
            correction.event,
            reconciledTime,
            workSession,
            reviewedAt,
          );
          if (timeError === "future") {
            return {
              ok: false as const,
              status: 400,
              error: "A future time cannot be reconciled.",
              code: "future_time_reconcile",
            };
          }
          if (timeError === "out_of_order") {
            return {
              ok: false as const,
              status: 400,
              error: "The adjusted punch would put the shift out of order.",
              code: "adjusted_punch_out_of_order",
            };
          }
          if (correction.event === "clock_in") {
            const [overlappingSession] = await tx
              .select({ id: workSessions.id })
              .from(workSessions)
              .where(
                and(
                  eq(workSessions.userId, correction.requestedBy),
                  ne(workSessions.id, workSession.id),
                  lte(workSessions.clockInAt, reconciledTime),
                  or(
                    isNull(workSessions.clockOutAt),
                    gt(workSessions.clockOutAt, reconciledTime),
                  ),
                ),
              )
              .limit(1);
            if (overlappingSession) {
              return {
                ok: false as const,
                status: 409,
                error: "The adjusted clock-in overlaps another shift.",
                code: "adjusted_clock_in_overlaps",
              };
            }
          }

          const previousValues =
            correction.event === "clock_in"
              ? {
                  clockInAt: workSession.clockInAt.toISOString(),
                  clockInSource: workSession.clockInSource,
                }
              : {
                  clockOutAt: workSession.clockOutAt?.toISOString() ?? null,
                  clockOutSource: workSession.clockOutSource,
                };
          const newValues =
            correction.event === "clock_in"
              ? {
                  clockInAt: reconciledTime.toISOString(),
                  clockInSource: "manual",
                }
              : {
                  clockOutAt: reconciledTime.toISOString(),
                  clockOutSource: "manual",
                };
          await tx
            .update(workSessions)
            .set(
              correction.event === "clock_in"
                ? {
                    clockInAt: reconciledTime,
                    clockInLatitude: null,
                    clockInLongitude: null,
                    clockInAccuracy: null,
                    clockInSource: "manual",
                    updatedAt: reviewedAt,
                  }
                : {
                    clockOutAt: reconciledTime,
                    clockOutLatitude: null,
                    clockOutLongitude: null,
                    clockOutAccuracy: null,
                    clockOutSource: "manual",
                    updatedAt: reviewedAt,
                  },
            )
            .where(eq(workSessions.id, workSession.id));
          updatedPunch = { id: workSession.id, previousValues, newValues };
        }

        await tx
          .update(correctionRequests)
          .set({
            status: "approved",
            requestedAt: reconciledTime,
            reviewedBy: session.user.id,
            reviewedAt,
            reviewReason: parsed.data.reason || null,
            reconciledBy: session.user.id,
            reconciledAt: reviewedAt,
          })
          .where(eq(correctionRequests.id, correction.id));
        await recordAudit(tx, {
          actorId: session.user.id,
          action:
            parsed.data.decision === "adjust"
              ? "correction_adjusted"
              : "correction_reconciled",
          entityType: "correction_request",
          entityId: correction.id,
          outletId: correction.outletId,
          previousValues: {
            status: "reconciliation",
            requestedAt: correction.requestedAt.toISOString(),
          },
          newValues: {
            status: "approved",
            requestedAt: reconciledTime.toISOString(),
            reconciledAt: reviewedAt.toISOString(),
          },
          reason: parsed.data.reason,
        });
        if (updatedPunch) {
          await recordAudit(tx, {
            actorId: session.user.id,
            action: "correction_punch_adjusted",
            entityType: "work_session",
            entityId: updatedPunch.id,
            outletId: correction.outletId,
            previousValues: updatedPunch.previousValues,
            newValues: updatedPunch.newValues,
            reason: parsed.data.reason,
          });
        }
        return { ok: true as const };
      }
      return {
        ok: false as const,
        status: 409,
        error: "This correction is no longer awaiting reconciliation.",
        code: "correction_not_awaiting",
      };
    });

    if (!outcome.ok) {
      return Response.json(
        { error: outcome.error, code: outcome.code },
        { status: outcome.status },
      );
    }
    if (parsed.data.decision !== "save_note") {
      await notifyOutletManagers({
        outletId: parsed.data.outletId,
        actorId: session.user.id,
        event: "correction_reviewed",
      });
    }
    return Response.json({ success: true });
  } catch {
    return Response.json(
      {
        error: "Could not review the correction request.",
        code: "correction_review_failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session)
      return Response.json(
        { error: "Sign in required.", code: "unauthorized" },
        { status: 401 },
      );
    if (!session.user.canAccessClock)
      return Response.json(
        {
          error: "Clock access is not enabled.",
          code: "clock_access_disabled",
        },
        { status: 403 },
      );

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON.", code: "invalid_json" },
        { status: 400 },
      );
    }

    const parsed = correctionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return Response.json(
        {
          error: "Correction request details are invalid.",
          code: "invalid_correction",
        },
        { status: 400 },
      );
    }

    const input = parsed.data;
    if (input.event === "clock_out" && !input.workSessionId) {
      return Response.json(
        {
          error: "Choose the shift that needs a clock-out correction.",
          code: "clock_out_shift_required",
        },
        { status: 400 },
      );
    }
    const requestedAt = new Date(input.requestedAt);
    if (
      !isBreakCorrectionEvent(input.event) &&
      getCorrectionTimeError(
        input.event,
        requestedAt,
        null,
        new Date(),
        5 * 60_000,
      ) === "future"
    ) {
      return Response.json(
        {
          error: "Requested time cannot be in the future.",
          code: "requested_time_future",
        },
        { status: 400 },
      );
    }

    const db = getDb();
    const [assignment] = await db
      .select({
        timezone: outlets.timezone,
      })
      .from(outletMemberships)
      .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
      .where(
        and(
          eq(outletMemberships.userId, session.user.id),
          eq(outletMemberships.outletId, input.outletId),
          eq(outletMemberships.isActive, true),
          eq(outlets.isActive, true),
        ),
      )
      .limit(1);

    if (!assignment) {
      return Response.json(
        {
          error: "You are not assigned to this outlet.",
          code: "outlet_not_assigned",
        },
        { status: 403 },
      );
    }

    if (isStaffDeviceRequired(session.user.canAccessClock)) {
      const cookieStore = await cookies();
      const deviceToken = cookieStore.get(
        getStaffDeviceCookieName(session.user.id),
      )?.value;
      const [activeDevice] = await db
        .select({
          status: staffDeviceEnrollments.status,
          tokenHash: staffDeviceEnrollments.tokenHash,
        })
        .from(staffDeviceEnrollments)
        .where(
          and(
            eq(staffDeviceEnrollments.userId, session.user.id),
            eq(staffDeviceEnrollments.status, "active"),
          ),
        )
        .limit(1);

      if (
        !isApprovedStaffDevice(
          deviceToken,
          activeDevice?.status,
          activeDevice?.tokenHash,
        )
      ) {
        return Response.json(
          {
            error: "This browser is not approved for staff clock actions.",
            code: "staff_device_not_approved",
          },
          { status: 403 },
        );
      }
      if (deviceToken)
        cookieStore.set(
          getStaffDeviceCookieName(session.user.id),
          deviceToken,
          staffDeviceCookieOptions(),
        );
    }

    const now = new Date();
    const outcome = await db.transaction(async (tx) => {
      if (isBreakCorrectionEvent(input.event)) {
        return submitBreakCorrection(tx, {
          event: input.event,
          input,
          userId: session.user.id,
          timezone: assignment.timezone,
          now,
        });
      }
      let workSession = null;
      if (input.workSessionId) {
        [workSession] = await tx
          .select()
          .from(workSessions)
          .where(
            and(
              eq(workSessions.id, input.workSessionId),
              eq(workSessions.userId, session.user.id),
              eq(workSessions.outletId, input.outletId),
            ),
          )
          .limit(1)
          .for("update");
        if (!workSession) {
          return {
            kind: "error" as const,
            status: 403,
            error: "That shift does not belong to your account.",
            code: "shift_not_owned",
          };
        }
      } else if (input.event === "clock_out") {
        return {
          kind: "error" as const,
          status: 400,
          error: "Choose the shift that needs a clock-out correction.",
          code: "clock_out_shift_required",
        };
      } else {
        const [openSession] = await tx
          .select({ id: workSessions.id })
          .from(workSessions)
          .where(
            and(
              eq(workSessions.userId, session.user.id),
              isNull(workSessions.clockOutAt),
            ),
          )
          .limit(1)
          .for("update");
        if (openSession) {
          return {
            kind: "error" as const,
            status: 409,
            error: "You already have an open shift.",
            code: "already_clocked_in",
          };
        }
      }

      if (
        workSession &&
        getCorrectionTimeError(input.event, requestedAt, workSession, now) ===
          "out_of_order"
      ) {
        return {
          kind: "error" as const,
          status: 400,
          error: "The requested punch would put the shift out of order.",
          code: "requested_punch_out_of_order",
        };
      }

      if (input.event === "clock_in") {
        const overlapConditions = [
          eq(workSessions.userId, session.user.id),
          lte(workSessions.clockInAt, requestedAt),
          or(
            isNull(workSessions.clockOutAt),
            gt(workSessions.clockOutAt, requestedAt),
          ),
        ];
        if (workSession)
          overlapConditions.push(ne(workSessions.id, workSession.id));
        const [overlappingSession] = await tx
          .select({ id: workSessions.id })
          .from(workSessions)
          .where(and(...overlapConditions))
          .limit(1);
        if (overlappingSession) {
          return {
            kind: "error" as const,
            status: 409,
            error: "The requested clock-in overlaps another shift.",
            code: "requested_clock_in_overlaps",
          };
        }
      }

      if (input.event === "clock_out" && workSession) {
        const [openBreak] = await tx
          .select({ id: workBreaks.id })
          .from(workBreaks)
          .where(
            and(
              eq(workBreaks.workSessionId, workSession.id),
              isNull(workBreaks.endedAt),
            ),
          )
          .limit(1);
        if (openBreak) {
          return {
            kind: "error" as const,
            status: 409,
            error: "End your break before clocking out.",
            code: "end_break_first",
          };
        }
      }

      const previousValues = workSession
        ? input.event === "clock_in"
          ? {
              clockInAt: workSession.clockInAt.toISOString(),
              clockInSource: workSession.clockInSource,
            }
          : {
              clockOutAt: workSession.clockOutAt?.toISOString() ?? null,
              clockOutSource: workSession.clockOutSource,
            }
        : {};
      // Full punch snapshot (including coordinates) so a reject can restore it exactly.
      const punchSnapshot: PunchSnapshot | null = workSession
        ? input.event === "clock_in"
          ? {
              at: workSession.clockInAt.toISOString(),
              source: workSession.clockInSource,
              latitude: workSession.clockInLatitude,
              longitude: workSession.clockInLongitude,
              accuracy: workSession.clockInAccuracy,
            }
          : {
              at: workSession.clockOutAt?.toISOString() ?? null,
              source: workSession.clockOutSource,
              latitude: workSession.clockOutLatitude,
              longitude: workSession.clockOutLongitude,
              accuracy: workSession.clockOutAccuracy,
            }
        : null;
      let updatedSession;
      if (workSession) {
        [updatedSession] = await tx
          .update(workSessions)
          .set(
            input.event === "clock_in"
              ? {
                  clockInAt: requestedAt,
                  clockInLatitude: null,
                  clockInLongitude: null,
                  clockInAccuracy: null,
                  clockInSource: "manual",
                  updatedAt: now,
                }
              : {
                  clockOutAt: requestedAt,
                  clockOutLatitude: null,
                  clockOutLongitude: null,
                  clockOutAccuracy: null,
                  clockOutSource: "manual",
                  updatedAt: now,
                },
          )
          .where(eq(workSessions.id, workSession.id))
          .returning();
      } else {
        [updatedSession] = await tx
          .insert(workSessions)
          .values({
            userId: session.user.id,
            outletId: input.outletId,
            timezone: assignment.timezone,
            clockInAt: requestedAt,
            clockInSource: "manual",
            updatedAt: now,
          })
          .returning();
      }
      if (!updatedSession) {
        return {
          kind: "error" as const,
          status: 409,
          error: "The shift could not be updated.",
          code: "shift_update_failed",
        };
      }

      const [correction] = await tx
        .insert(correctionRequests)
        .values({
          requestedBy: session.user.id,
          outletId: input.outletId,
          timezone: assignment.timezone,
          workSessionId: updatedSession.id,
          event: input.event,
          requestedAt,
          reason: input.reason,
          status: "reconciliation",
          appliedAt: now,
          previousValues: punchSnapshot,
        })
        .returning();

      const newValues =
        input.event === "clock_in"
          ? {
              clockInAt: requestedAt.toISOString(),
              clockInSource: "manual",
            }
          : {
              clockOutAt: requestedAt.toISOString(),
              clockOutSource: "manual",
            };
      await recordAudit(tx, [
        {
          actorId: session.user.id,
          action: "correction_applied",
          entityType: "correction_request",
          entityId: correction.id,
          outletId: input.outletId,
          newValues: {
            workSessionId: updatedSession.id,
            event: input.event,
            requestedAt: requestedAt.toISOString(),
            status: "reconciliation",
            appliedAt: now.toISOString(),
          },
          reason: input.reason,
        },
        {
          actorId: session.user.id,
          action: "correction_punch_applied",
          entityType: "work_session",
          entityId: updatedSession.id,
          outletId: input.outletId,
          previousValues,
          newValues,
          reason: input.reason,
        },
      ]);

      return { kind: "applied" as const, correction, session: updatedSession };
    });

    if (outcome.kind === "error") {
      return Response.json(
        { error: outcome.error, code: outcome.code },
        { status: outcome.status },
      );
    }
    await notifyOutletManagers({
      outletId: input.outletId,
      actorId: session.user.id,
      event: "correction_requested",
    });
    return Response.json(
      { request: outcome.correction, session: outcome.session },
      { status: 201 },
    );
  } catch {
    return Response.json(
      {
        error: "Could not submit the correction request.",
        code: "correction_submit_failed",
      },
      { status: 500 },
    );
  }
}
