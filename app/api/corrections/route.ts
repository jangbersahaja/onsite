import {
  auditEvents,
  correctionRequests,
  outletMemberships,
  outlets,
  user,
  workSessions,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getTeamAccess } from "@/lib/team-access";
import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
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
      error:
        "Set DATABASE_URL and BETTER_AUTH_SECRET before using corrections.",
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
    const access = review ? await getTeamAccess(session.user.id) : null;
    const reviewOutletIds = access?.isAdmin
      ? (await getDb().select({ id: outlets.id }).from(outlets)).map(
          (outlet) => outlet.id,
        )
      : (access?.outletIds ?? []);
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
        event: correctionRequests.event,
        requestedAt: correctionRequests.requestedAt,
        reason: correctionRequests.reason,
        status: correctionRequests.status,
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
              eq(correctionRequests.status, "pending"),
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
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

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
    const reviewOutletIds = access.isAdmin
      ? (await getDb().select({ id: outlets.id }).from(outlets)).map(
          (outlet) => outlet.id,
        )
      : access.outletIds;
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
            eq(correctionRequests.status, "pending"),
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

      if (parsed.data.decision === "approve") {
        if (correction.requestedAt > reviewedAt) {
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
    if (requestedAt.getTime() > Date.now() + 5 * 60_000) {
      return Response.json(
        { error: "Requested time cannot be in the future." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [assignment] = await db
      .select({
        outletId: outletMemberships.outletId,
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

    if (input.workSessionId) {
      const [workSession] = await db
        .select({ id: workSessions.id })
        .from(workSessions)
        .where(
          and(
            eq(workSessions.id, input.workSessionId),
            eq(workSessions.userId, session.user.id),
            eq(workSessions.outletId, input.outletId),
          ),
        )
        .limit(1);

      if (!workSession) {
        return Response.json(
          { error: "That shift does not belong to your account." },
          { status: 403 },
        );
      }
    }

    const created = await db.transaction(async (tx) => {
      const [correction] = await tx
        .insert(correctionRequests)
        .values({
          requestedBy: session.user.id,
          outletId: input.outletId,
          timezone: assignment.timezone,
          workSessionId: input.workSessionId,
          event: input.event,
          requestedAt,
          reason: input.reason,
        })
        .returning();

      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action: "correction_requested",
        entityType: "correction_request",
        entityId: correction.id,
        newValues: {
          outletId: input.outletId,
          workSessionId: input.workSessionId,
          event: input.event,
          requestedAt: requestedAt.toISOString(),
          status: "pending",
        },
        reason: input.reason,
      });

      return correction;
    });

    return Response.json({ request: created }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Could not submit the correction request." },
      { status: 500 },
    );
  }
}
