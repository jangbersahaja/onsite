import {
  auditEvents,
  correctionRequests,
  outletMemberships,
  outlets,
  staffDeviceEnrollments,
  user,
  workBreaks,
  workSessions,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getCorrectionTimeError } from "@/lib/correction-time";
import { getDb } from "@/lib/db";
import {
  getStaffDeviceCookieName,
  isApprovedStaffDevice,
  isStaffDeviceRequired,
} from "@/lib/staff-device";
import { getTeamAccess } from "@/lib/team-access";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

const correctionSchema = z
  .object({
    outletId: z.string().uuid(),
    workSessionId: z.string().uuid().nullable(),
    event: z.enum(["clock_in", "clock_out"]),
    requestedAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

function unavailable() {
  return Response.json(
    {
      error: "Set DATABASE_URL before using corrections.",
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
      return Response.json({ error: "Sign in required." }, { status: 401 });

    const review = new URL(request.url).searchParams.get("view") === "review";
    if (!review && !session.user.canAccessClock) {
      return Response.json(
        { error: "Clock access is not enabled." },
        { status: 403 },
      );
    }
    const access = review ? await getTeamAccess(session.user.id) : null;
    const reviewOutletIds = access?.outletIds ?? [];
    if (review && !reviewOutletIds.length) {
      return Response.json(
        { error: "Correction review access is not available." },
        { status: 403 },
      );
    }

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
              inArray(correctionRequests.outletId, reviewOutletIds),
              inArray(correctionRequests.status, ["pending", "reconciliation"]),
            )
          : eq(correctionRequests.requestedBy, session.user.id),
      )
      .orderBy(desc(correctionRequests.createdAt))
      .limit(review ? 100 : 20);

    return Response.json({ requests, review });
  } catch {
    return Response.json(
      { error: "Could not load correction requests." },
      { status: 500 },
    );
  }
}

const reviewSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: z.enum(["approve", "reject", "confirm", "adjust"]),
    reason: z.string().trim().min(3).max(500),
    requestedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((value) => value.decision !== "adjust" || value.requestedAt, {
    path: ["requestedAt"],
    message: "An adjusted punch time is required.",
  });

export async function PATCH(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session)
      return Response.json({ error: "Sign in required." }, { status: 401 });
    const access = await getTeamAccess(session.user.id);
    if (!access) {
      return Response.json(
        { error: "Correction review access is not available." },
        { status: 403 },
      );
    }
    const reviewOutletIds = access.outletIds;
    if (!reviewOutletIds.length) {
      return Response.json(
        { error: "Correction review access is not available." },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Decision details are invalid." },
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
            inArray(correctionRequests.outletId, reviewOutletIds),
            inArray(correctionRequests.status, ["pending", "reconciliation"]),
          ),
        )
        .limit(1)
        .for("update");

      if (!correction) {
        return {
          ok: false as const,
          status: 404,
          error: "Pending request not found.",
        };
      }

      const reviewedAt = new Date();
      let updatedPunch: {
        id: string;
        previousValues: Record<string, unknown>;
        newValues: Record<string, unknown>;
      } | null = null;

      if (correction.status === "reconciliation") {
        if (
          parsed.data.decision !== "confirm" &&
          parsed.data.decision !== "adjust"
        ) {
          return {
            ok: false as const,
            status: 400,
            error: "Applied corrections can only be confirmed or adjusted.",
          };
        }
        if (!correction.workSessionId) {
          return {
            ok: false as const,
            status: 409,
            error: "The related shift no longer exists.",
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
          };
        }

        let reconciledTime = correction.requestedAt;
        if (parsed.data.decision === "adjust") {
          reconciledTime = new Date(parsed.data.requestedAt!);
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
            };
          }
          if (timeError === "out_of_order") {
            return {
              ok: false as const,
              status: 400,
              error: "The adjusted punch would put the shift out of order.",
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
            reviewReason: parsed.data.reason,
            reconciledBy: session.user.id,
            reconciledAt: reviewedAt,
          })
          .where(eq(correctionRequests.id, correction.id));
        await tx.insert(auditEvents).values({
          actorId: session.user.id,
          action:
            parsed.data.decision === "adjust"
              ? "correction_adjusted"
              : "correction_reconciled",
          entityType: "correction_request",
          entityId: correction.id,
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
          await tx.insert(auditEvents).values({
            actorId: session.user.id,
            action: "correction_punch_adjusted",
            entityType: "work_session",
            entityId: updatedPunch.id,
            previousValues: updatedPunch.previousValues,
            newValues: updatedPunch.newValues,
            reason: parsed.data.reason,
          });
        }
        return { ok: true as const };
      }

      if (
        parsed.data.decision !== "approve" &&
        parsed.data.decision !== "reject"
      ) {
        return {
          ok: false as const,
          status: 400,
          error: "Pending legacy requests must be approved or rejected.",
        };
      }

      if (parsed.data.decision === "approve") {
        if (
          getCorrectionTimeError(
            correction.event,
            correction.requestedAt,
            null,
            reviewedAt,
          ) === "future"
        ) {
          return {
            ok: false as const,
            status: 400,
            error: "A future time cannot be approved.",
          };
        }

        if (correction.workSessionId) {
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
            };
          }

          if (
            (correction.event === "clock_in" &&
              workSession.clockOutAt &&
              correction.requestedAt >= workSession.clockOutAt) ||
            (correction.event === "clock_out" &&
              correction.requestedAt <= workSession.clockInAt)
          ) {
            return {
              ok: false as const,
              status: 400,
              error: "The requested punch would put the shift out of order.",
            };
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
                  clockInAt: correction.requestedAt.toISOString(),
                  clockInSource: "manual",
                }
              : {
                  clockOutAt: correction.requestedAt.toISOString(),
                  clockOutSource: "manual",
                };

          await tx
            .update(workSessions)
            .set(
              correction.event === "clock_in"
                ? {
                    clockInAt: correction.requestedAt,
                    clockInLatitude: null,
                    clockInLongitude: null,
                    clockInAccuracy: null,
                    clockInSource: "manual",
                    updatedAt: reviewedAt,
                  }
                : {
                    clockOutAt: correction.requestedAt,
                    clockOutLatitude: null,
                    clockOutLongitude: null,
                    clockOutAccuracy: null,
                    clockOutSource: "manual",
                    updatedAt: reviewedAt,
                  },
            )
            .where(eq(workSessions.id, workSession.id));
          updatedPunch = { id: workSession.id, previousValues, newValues };
        } else if (correction.event === "clock_in") {
          const [overlappingSession] = await tx
            .select({ id: workSessions.id })
            .from(workSessions)
            .where(
              and(
                eq(workSessions.userId, correction.requestedBy),
                lte(workSessions.clockInAt, correction.requestedAt),
                or(
                  isNull(workSessions.clockOutAt),
                  gt(workSessions.clockOutAt, correction.requestedAt),
                ),
              ),
            )
            .limit(1);
          if (overlappingSession) {
            return {
              ok: false as const,
              status: 409,
              error: "The requested missed clock-in overlaps another shift.",
            };
          }

          const [created] = await tx
            .insert(workSessions)
            .values({
              userId: correction.requestedBy,
              outletId: correction.outletId,
              timezone: correction.timezone,
              clockInAt: correction.requestedAt,
              clockInLatitude: null,
              clockInLongitude: null,
              clockInAccuracy: null,
              clockInSource: "manual",
              updatedAt: reviewedAt,
            })
            .returning({ id: workSessions.id });
          updatedPunch = {
            id: created.id,
            previousValues: {},
            newValues: {
              clockInAt: correction.requestedAt.toISOString(),
              clockInSource: "manual",
              outletId: correction.outletId,
              userId: correction.requestedBy,
            },
          };
        } else {
          return {
            ok: false as const,
            status: 400,
            error: "A missed clock-out must be linked to its shift.",
          };
        }
      }

      const status =
        parsed.data.decision === "approve" ? "approved" : "rejected";
      await tx
        .update(correctionRequests)
        .set({
          status,
          reviewedBy: session.user.id,
          reviewedAt,
          reviewReason: parsed.data.reason,
        })
        .where(eq(correctionRequests.id, correction.id));

      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action:
          parsed.data.decision === "approve"
            ? "correction_approved"
            : "correction_rejected",
        entityType: "correction_request",
        entityId: correction.id,
        previousValues: { status: "pending" },
        newValues: { status, reviewedAt: reviewedAt.toISOString() },
        reason: parsed.data.reason,
      });

      if (updatedPunch) {
        await tx.insert(auditEvents).values({
          actorId: session.user.id,
          action: "correction_applied",
          entityType: "work_session",
          entityId: updatedPunch.id,
          previousValues: updatedPunch.previousValues,
          newValues: updatedPunch.newValues,
          reason: parsed.data.reason,
        });
      }
      return { ok: true as const };
    });

    if (!outcome.ok) {
      return Response.json(
        { error: outcome.error },
        { status: outcome.status },
      );
    }
    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Could not review the correction request." },
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
      return Response.json({ error: "Sign in required." }, { status: 401 });
    if (!session.user.canAccessClock)
      return Response.json(
        { error: "Clock access is not enabled." },
        { status: 403 },
      );

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const parsed = correctionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return Response.json(
        { error: "Correction request details are invalid." },
        { status: 400 },
      );
    }

    const input = parsed.data;
    if (input.event === "clock_out" && !input.workSessionId) {
      return Response.json(
        { error: "Choose the shift that needs a clock-out correction." },
        { status: 400 },
      );
    }
    const requestedAt = new Date(input.requestedAt);
    if (
      getCorrectionTimeError(
        input.event,
        requestedAt,
        null,
        new Date(),
        5 * 60_000,
      ) === "future"
    ) {
      return Response.json(
        { error: "Requested time cannot be in the future." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [assignment] =
      session.user.accountType === "super_admin"
        ? await db
            .select({
              role: sql<string>`'manager'`.as("role"),
              timezone: outlets.timezone,
            })
            .from(outlets)
            .where(
              and(eq(outlets.id, input.outletId), eq(outlets.isActive, true)),
            )
            .limit(1)
        : await db
            .select({
              role: outletMemberships.role,
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
        { error: "You are not assigned to this outlet." },
        { status: 403 },
      );
    }

    if (isStaffDeviceRequired(assignment.role)) {
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
    }

    const now = new Date();
    const outcome = await db.transaction(async (tx) => {
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
          };
        }
      } else if (input.event === "clock_out") {
        return {
          kind: "error" as const,
          status: 400,
          error: "Choose the shift that needs a clock-out correction.",
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
      await tx.insert(auditEvents).values([
        {
          actorId: session.user.id,
          action: "correction_applied",
          entityType: "correction_request",
          entityId: correction.id,
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
          previousValues,
          newValues,
          reason: input.reason,
        },
      ]);

      return { kind: "applied" as const, correction, session: updatedSession };
    });

    if (outcome.kind === "error") {
      return Response.json(
        { error: outcome.error },
        { status: outcome.status },
      );
    }
    return Response.json(
      { request: outcome.correction, session: outcome.session },
      { status: 201 },
    );
  } catch {
    return Response.json(
      { error: "Could not submit the correction request." },
      { status: 500 },
    );
  }
}
