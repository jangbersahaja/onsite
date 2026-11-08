import {
  manualShiftRequests,
  outletMemberships,
  outlets,
  user,
  workBreaks,
  workSessions,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import {
  manualShiftRequestSchema,
  manualShiftReviewSchema,
  parseStoredBreaks,
  serializeBreaks,
  toManualBreaks,
} from "@/lib/manual-shift-request";
import { outletDateTimeToISOString } from "@/lib/outlet-time";
import { notifyOutletManagers } from "@/lib/push-notifications";
import { getActor } from "@/lib/timesheet-actor";
import { hasOverlap, validateManualShift } from "@/lib/timesheet-create-rules";
import { and, desc, eq, inArray } from "drizzle-orm";

function unavailable() {
  return Response.json(
    { error: "Set DATABASE_URL before using manual shifts." },
    { status: 503 },
  );
}

/** Staff list their own requests, or managers list pending requests (view=review). */
export async function GET(request: Request) {
  if (!hasServerConfiguration()) return unavailable();
  try {
    const actor = await getActor(request);
    if ("error" in actor) {
      return Response.json({ error: actor.error }, { status: actor.status });
    }
    const db = getDb();
    const view = new URL(request.url).searchParams.get("view");

    if (view === "review") {
      const reviewOutletIds = actor.access.outletIds ?? [];
      if (!reviewOutletIds.length) {
        return Response.json(
          {
            error: "Manual shift review is not available.",
            code: "review_unavailable",
          },
          { status: 403 },
        );
      }
      const requestedOutletId = new URL(request.url).searchParams.get(
        "outletId",
      );
      if (requestedOutletId && !reviewOutletIds.includes(requestedOutletId)) {
        return Response.json(
          { error: "Outlet is not available.", code: "outlet_not_available" },
          { status: 403 },
        );
      }
      const visibleOutletIds = requestedOutletId
        ? [requestedOutletId]
        : reviewOutletIds;
      const rows = await db
        .select({
          id: manualShiftRequests.id,
          outletId: manualShiftRequests.outletId,
          outletName: outlets.name,
          requestedBy: manualShiftRequests.requestedBy,
          requesterName: user.name,
          requesterUsername: user.username,
          timezone: manualShiftRequests.timezone,
          clockInAt: manualShiftRequests.clockInAt,
          clockOutAt: manualShiftRequests.clockOutAt,
          breaks: manualShiftRequests.breaks,
          reasonCode: manualShiftRequests.reasonCode,
          reason: manualShiftRequests.reason,
          status: manualShiftRequests.status,
          createdAt: manualShiftRequests.createdAt,
        })
        .from(manualShiftRequests)
        .innerJoin(user, eq(manualShiftRequests.requestedBy, user.id))
        .innerJoin(outlets, eq(manualShiftRequests.outletId, outlets.id))
        .where(
          and(
            eq(manualShiftRequests.status, "pending"),
            inArray(manualShiftRequests.outletId, visibleOutletIds),
          ),
        )
        .orderBy(desc(manualShiftRequests.createdAt))
        .limit(100);
      return Response.json({ requests: rows });
    }

    const rows = await db
      .select({
        id: manualShiftRequests.id,
        outletId: manualShiftRequests.outletId,
        outletName: outlets.name,
        timezone: manualShiftRequests.timezone,
        clockInAt: manualShiftRequests.clockInAt,
        clockOutAt: manualShiftRequests.clockOutAt,
        breaks: manualShiftRequests.breaks,
        reasonCode: manualShiftRequests.reasonCode,
        reason: manualShiftRequests.reason,
        status: manualShiftRequests.status,
        reviewReason: manualShiftRequests.reviewReason,
        reviewedAt: manualShiftRequests.reviewedAt,
        createdAt: manualShiftRequests.createdAt,
      })
      .from(manualShiftRequests)
      .innerJoin(outlets, eq(manualShiftRequests.outletId, outlets.id))
      .where(eq(manualShiftRequests.requestedBy, actor.userId))
      .orderBy(desc(manualShiftRequests.createdAt))
      .limit(100);
    return Response.json({ requests: rows });
  } catch (error) {
    console.error("Could not load manual shift requests", error);
    return Response.json(
      { error: "Could not load manual shift requests." },
      { status: 500 },
    );
  }
}

/** Staff submit a past shift that was never clocked. Stays pending until reviewed. */
export async function POST(request: Request) {
  if (!hasServerConfiguration()) return unavailable();
  try {
    const actor = await getActor(request);
    if ("error" in actor) {
      return Response.json({ error: actor.error }, { status: actor.status });
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
    const parsed = manualShiftRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Shift request details are invalid." },
        { status: 400 },
      );
    }

    const outlet = actor.outlets.find(
      (item) => item.id === parsed.data.outletId,
    );
    if (!outlet) {
      return Response.json(
        { error: "You cannot access this outlet." },
        { status: 403 },
      );
    }
    if (outlet.isActive === false) {
      return Response.json(
        { error: "This outlet is inactive." },
        { status: 403 },
      );
    }

    const clockInAt = new Date(
      outletDateTimeToISOString(parsed.data.clockInAt, outlet.timezone),
    );
    const clockOutAt = new Date(
      outletDateTimeToISOString(parsed.data.clockOutAt, outlet.timezone),
    );
    const breaks = toManualBreaks(parsed.data.breaks);
    const validationError = validateManualShift({
      clockInAt,
      clockOutAt,
      breaks,
      now: new Date(),
    });
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const db = getDb();
    const [self] = await db
      .select({
        canAccessClock: user.canAccessClock,
        approvalStatus: user.approvalStatus,
      })
      .from(outletMemberships)
      .innerJoin(user, eq(outletMemberships.userId, user.id))
      .where(
        and(
          eq(outletMemberships.outletId, outlet.id),
          eq(outletMemberships.userId, actor.userId),
          eq(outletMemberships.isActive, true),
        ),
      )
      .limit(1);
    if (
      !self ||
      self.canAccessClock === false ||
      self.approvalStatus !== "approved"
    ) {
      return Response.json(
        { error: "Your account cannot submit shift requests here." },
        { status: 403 },
      );
    }

    // Reject if the requested time already exists as a real shift.
    const existing = await db
      .select({
        clockInAt: workSessions.clockInAt,
        clockOutAt: workSessions.clockOutAt,
      })
      .from(workSessions)
      .where(eq(workSessions.userId, actor.userId));
    if (
      hasOverlap(
        { start: clockInAt, end: clockOutAt },
        existing.map((row) => ({
          start: row.clockInAt,
          end: row.clockOutAt ?? new Date(8.64e15),
        })),
      )
    ) {
      return Response.json(
        { error: "This time overlaps an existing shift." },
        { status: 409 },
      );
    }

    const [created] = await db
      .insert(manualShiftRequests)
      .values({
        requestedBy: actor.userId,
        outletId: outlet.id,
        timezone: outlet.timezone,
        clockInAt,
        clockOutAt,
        breaks: serializeBreaks(breaks),
        reasonCode: parsed.data.reasonCode,
        reason: parsed.data.reason,
        status: "pending",
      })
      .returning({ id: manualShiftRequests.id });

    await notifyOutletManagers({
      outletId: outlet.id,
      actorId: actor.userId,
      event: "manual_shift_requested",
    });

    return Response.json({ success: true, id: created.id }, { status: 201 });
  } catch (error) {
    console.error("Could not submit manual shift request", error);
    return Response.json(
      { error: "Could not submit shift request." },
      { status: 500 },
    );
  }
}

/** Managers approve (creates a real shift) or reject a pending request. */
export async function PATCH(request: Request) {
  if (!hasServerConfiguration()) return unavailable();
  try {
    const actor = await getActor(request);
    if ("error" in actor) {
      return Response.json({ error: actor.error }, { status: actor.status });
    }
    const reviewOutletIds = actor.access.outletIds ?? [];
    if (!reviewOutletIds.length) {
      return Response.json(
        {
          error: "Manual shift review is not available.",
          code: "review_unavailable",
        },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON.", code: "invalid_body" },
        { status: 400 },
      );
    }
    const parsed = manualShiftReviewSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Review details are invalid.", code: "invalid_review" },
        { status: 400 },
      );
    }
    if (!reviewOutletIds.includes(parsed.data.outletId)) {
      return Response.json(
        {
          error: "You cannot review requests for this outlet.",
          code: "outlet_forbidden",
        },
        { status: 403 },
      );
    }

    const db = getDb();
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(manualShiftRequests)
        .where(
          and(
            eq(manualShiftRequests.id, parsed.data.requestId),
            eq(manualShiftRequests.outletId, parsed.data.outletId),
            inArray(manualShiftRequests.outletId, reviewOutletIds),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) return { status: 404 as const, code: "not_found" };
      if (row.status !== "pending") {
        return { status: 409 as const, code: "already_reviewed" };
      }
      if (row.requestedBy === actor.userId) {
        return { status: 403 as const, code: "self_review" };
      }

      if (parsed.data.decision === "reject") {
        await tx
          .update(manualShiftRequests)
          .set({
            status: "rejected",
            reviewedBy: actor.userId,
            reviewedAt: now,
            reviewReason: parsed.data.reason,
          })
          .where(eq(manualShiftRequests.id, row.id));
        await recordAudit(tx, {
          actorId: actor.userId,
          action: "manual_shift_rejected",
          entityType: "manual_shift_request",
          entityId: row.id,
          outletId: row.outletId,
          reason: parsed.data.reason,
        });
        return { status: 200 as const, decision: "rejected" as const };
      }

      // Approve: lock the staff row, then create the real shift.
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, row.requestedBy))
        .for("update");

      const existing = await tx
        .select({
          clockInAt: workSessions.clockInAt,
          clockOutAt: workSessions.clockOutAt,
        })
        .from(workSessions)
        .where(eq(workSessions.userId, row.requestedBy));
      if (
        hasOverlap(
          { start: row.clockInAt, end: row.clockOutAt },
          existing.map((item) => ({
            start: item.clockInAt,
            end: item.clockOutAt ?? new Date(8.64e15),
          })),
        )
      ) {
        return { status: 409 as const, code: "overlaps_existing_shift" };
      }

      const [session] = await tx
        .insert(workSessions)
        .values({
          userId: row.requestedBy,
          outletId: row.outletId,
          clockInAt: row.clockInAt,
          clockOutAt: row.clockOutAt,
          clockInSource: "manual",
          clockOutSource: "manual",
          updatedAt: now,
        })
        .returning({ id: workSessions.id });

      const breaks = parseStoredBreaks(row.breaks);
      if (breaks.length) {
        await tx.insert(workBreaks).values(
          breaks.map((item) => ({
            workSessionId: session.id,
            startedAt: item.startedAt,
            endedAt: item.endedAt,
          })),
        );
      }

      await tx
        .update(manualShiftRequests)
        .set({
          status: "approved",
          workSessionId: session.id,
          reviewedBy: actor.userId,
          reviewedAt: now,
          reviewReason: parsed.data.reason || null,
        })
        .where(eq(manualShiftRequests.id, row.id));

      await recordAudit(tx, {
        actorId: actor.userId,
        action: "manual_shift_approved",
        entityType: "work_session",
        entityId: session.id,
        outletId: row.outletId,
        newValues: {
          requestId: row.id,
          requestedBy: row.requestedBy,
          clockInAt: row.clockInAt.toISOString(),
          clockOutAt: row.clockOutAt.toISOString(),
        },
        reason: parsed.data.reason || null,
      });
      return { status: 200 as const, decision: "approved" as const };
    });

    if (!("decision" in result)) {
      const messages: Record<string, string> = {
        not_found: "Request not found.",
        already_reviewed: "This request was already reviewed.",
        self_review: "You cannot review your own request.",
        overlaps_existing_shift: "This time overlaps an existing shift.",
      };
      return Response.json(
        {
          error: messages[result.code] ?? "Could not review request.",
          code: result.code,
        },
        { status: result.status },
      );
    }

    await notifyOutletManagers({
      outletId: parsed.data.outletId,
      actorId: actor.userId,
      event: "manual_shift_reviewed",
    });

    return Response.json({ success: true, decision: result.decision });
  } catch (error) {
    console.error("Could not review manual shift request", error);
    return Response.json(
      { error: "Could not review shift request.", code: "server_error" },
      { status: 500 },
    );
  }
}
