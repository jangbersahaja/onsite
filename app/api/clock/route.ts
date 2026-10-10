import {
  auditEvents,
  outletMemberships,
  outlets,
  staffDeviceEnrollments,
  workBreaks,
  workSessions,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { verifyGeofence } from "@/lib/geofence";
import { parseDateRange } from "@/lib/outlet-time";
import { notifyOutletManagers } from "@/lib/push-notifications";
import {
  getStaffDeviceCookieName,
  isApprovedStaffDevice,
  isStaffDeviceRequired,
} from "@/lib/staff-device";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

const clockActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("clock_in"),
      outletId: z.string().uuid(),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(0).max(100_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("clock_out"),
      outletId: z.string().uuid(),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracy: z.number().min(0).max(100_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("start_break"),
      outletId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("end_break"),
      outletId: z.string().uuid(),
    })
    .strict(),
]);

function unavailable() {
  return Response.json(
    { error: "Set DATABASE_URL before using clocking." },
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
    if (!session.user.canAccessClock)
      return Response.json(
        { error: "Clock access is not enabled." },
        { status: 403 },
      );

    const db = getDb();
    const assignedOutlets = await db
      .select({
        id: outlets.id,
        name: outlets.name,
        address: outlets.address,
        latitude: outlets.latitude,
        longitude: outlets.longitude,
        radiusMeters: outlets.radiusMeters,
        timezone: outlets.timezone,
        role: outletMemberships.role,
      })
      .from(outletMemberships)
      .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
      .where(
        and(
          eq(outletMemberships.userId, session.user.id),
          eq(outletMemberships.isActive, true),
          eq(outlets.isActive, true),
        ),
      );
    const assignments =
      session.user.accountType === "super_admin"
        ? await db
            .select({
              id: outlets.id,
              name: outlets.name,
              address: outlets.address,
              latitude: outlets.latitude,
              longitude: outlets.longitude,
              radiusMeters: outlets.radiusMeters,
              timezone: outlets.timezone,
            })
            .from(outlets)
            .where(eq(outlets.isActive, true))
            .then((rows) =>
              rows.map((outlet) => ({ ...outlet, role: "manager" as const })),
            )
        : assignedOutlets;

    const [activeSession] = await db
      .select({
        id: workSessions.id,
        outletId: workSessions.outletId,
        clockInAt: workSessions.clockInAt,
      })
      .from(workSessions)
      .where(
        and(
          eq(workSessions.userId, session.user.id),
          isNull(workSessions.clockOutAt),
        ),
      )
      .limit(1);
    const [activeBreak] = activeSession
      ? await db
          .select({
            id: workBreaks.id,
            startedAt: workBreaks.startedAt,
          })
          .from(workBreaks)
          .where(
            and(
              eq(workBreaks.workSessionId, activeSession.id),
              isNull(workBreaks.endedAt),
            ),
          )
          .limit(1)
      : [];

    const params = new URL(request.url).searchParams;
    const historyRange = parseDateRange(params.get("from"), params.get("to"));
    const pageSize = Number(params.get("limit") ?? 100);
    const pageOffset = Number(params.get("offset") ?? 0);
    if (!historyRange) {
      return Response.json(
        { error: "History date filters are invalid." },
        { status: 400 },
      );
    }
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isInteger(pageOffset) ||
      pageOffset < 0
    ) {
      return Response.json(
        { error: "History pagination is invalid." },
        { status: 400 },
      );
    }
    const historyConditions = [eq(workSessions.userId, session.user.id)];
    if (historyRange.from) {
      historyConditions.push(
        sql`(${workSessions.clockInAt} AT TIME ZONE ${workSessions.timezone})::date >= ${historyRange.from}::date`,
      );
    }
    if (historyRange.to) {
      historyConditions.push(
        sql`(${workSessions.clockInAt} AT TIME ZONE ${workSessions.timezone})::date <= ${historyRange.to}::date`,
      );
    }

    const sessionRows = await db
      .select({
        id: workSessions.id,
        outletId: workSessions.outletId,
        outletName: outlets.name,
        timezone: workSessions.timezone,
        clockInAt: workSessions.clockInAt,
        clockOutAt: workSessions.clockOutAt,
      })
      .from(workSessions)
      .innerJoin(outlets, eq(workSessions.outletId, outlets.id))
      .where(and(...historyConditions))
      .orderBy(desc(workSessions.clockInAt))
      .limit(pageSize + 1)
      .offset(pageOffset);
    const hasMoreSessions = sessionRows.length > pageSize;
    const recentSessions = sessionRows.slice(0, pageSize);
    const breakRows = recentSessions.length
      ? await db
          .select({
            workSessionId: workBreaks.workSessionId,
            startedAt: workBreaks.startedAt,
            endedAt: workBreaks.endedAt,
          })
          .from(workBreaks)
          .where(
            inArray(
              workBreaks.workSessionId,
              recentSessions.map((row) => row.id),
            ),
          )
          .orderBy(workBreaks.startedAt)
      : [];
    const recentSessionsWithBreaks = recentSessions.map((row) => ({
      ...row,
      breaks: breakRows.filter((breakRow) => breakRow.workSessionId === row.id),
    }));

    return Response.json({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
      outlets: assignments,
      activeSession: activeSession ?? null,
      activeBreak: activeBreak ?? null,
      recentSessions: recentSessionsWithBreaks,
      historyPage: {
        hasMore: hasMoreSessions,
        nextOffset: hasMoreSessions ? pageOffset + pageSize : null,
      },
    });
  } catch {
    return Response.json(
      { error: "Could not load timekeeping data." },
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

    const parsed = clockActionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return Response.json(
        { error: "Clock action details are invalid." },
        { status: 400 },
      );
    }

    const input = parsed.data;
    const db = getDb();

    if (input.action === "start_break" || input.action === "end_break") {
      const now = new Date();
      const outcome = await db.transaction(async (tx) => {
        const [openSession] = await tx
          .select()
          .from(workSessions)
          .where(
            and(
              eq(workSessions.userId, session.user.id),
              isNull(workSessions.clockOutAt),
            ),
          )
          .limit(1)
          .for("update");

        if (!openSession || openSession.outletId !== input.outletId) {
          return { kind: "no_open_shift" as const };
        }

        const [openBreak] = await tx
          .select()
          .from(workBreaks)
          .where(
            and(
              eq(workBreaks.workSessionId, openSession.id),
              isNull(workBreaks.endedAt),
            ),
          )
          .limit(1)
          .for("update");

        if (input.action === "start_break") {
          if (openBreak) return { kind: "already_on_break" as const };
          const [created] = await tx
            .insert(workBreaks)
            .values({ workSessionId: openSession.id, startedAt: now })
            .returning();
          await tx.insert(auditEvents).values({
            actorId: session.user.id,
            action: "start_break",
            entityType: "work_break",
            entityId: created.id,
            newValues: {
              workSessionId: openSession.id,
              startedAt: now.toISOString(),
            },
          });
          return { kind: "break_started" as const, breakRecord: created };
        }

        if (!openBreak) return { kind: "not_on_break" as const };
        const [updated] = await tx
          .update(workBreaks)
          .set({ endedAt: now, updatedAt: now })
          .where(eq(workBreaks.id, openBreak.id))
          .returning();
        await tx.insert(auditEvents).values({
          actorId: session.user.id,
          action: "end_break",
          entityType: "work_break",
          entityId: updated.id,
          previousValues: { endedAt: null },
          newValues: { endedAt: now.toISOString() },
        });
        return { kind: "break_ended" as const, breakRecord: updated };
      });

      if (outcome.kind === "no_open_shift") {
        return Response.json(
          { error: "No open shift exists at this outlet." },
          { status: 409 },
        );
      }
      if (outcome.kind === "already_on_break") {
        return Response.json(
          { error: "This shift already has an open break." },
          { status: 409 },
        );
      }
      if (outcome.kind === "not_on_break") {
        return Response.json(
          { error: "This shift has no open break to end." },
          { status: 409 },
        );
      }
      await notifyOutletManagers({
        outletId: input.outletId,
        actorId: session.user.id,
        event: input.action === "start_break" ? "break_started" : "break_ended",
      });
      return Response.json({
        break: {
          id: outcome.breakRecord.id,
          startedAt: outcome.breakRecord.startedAt,
          endedAt: outcome.breakRecord.endedAt,
        },
      });
    }

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

    if (!assignment)
      return Response.json(
        { error: "You are not assigned to this outlet." },
        { status: 403 },
      );

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

    const [outlet] = await db
      .select({
        latitude: outlets.latitude,
        longitude: outlets.longitude,
        radiusMeters: outlets.radiusMeters,
      })
      .from(outlets)
      .where(eq(outlets.id, input.outletId))
      .limit(1);

    if (!outlet)
      return Response.json({ error: "Outlet not found." }, { status: 404 });

    const location = verifyGeofence(
      {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy,
      },
      { latitude: outlet.latitude, longitude: outlet.longitude },
      outlet.radiusMeters,
    );

    if (!location.allowed) {
      const error =
        location.reason === "poor_accuracy"
          ? "Location accuracy is too low. Request a manual time correction from your outlet lead."
          : "You could not be verified within this outlet's clocking radius. Request a manual time correction if needed.";
      return Response.json(
        {
          error,
          reason: location.reason,
          distanceMeters: Math.round(location.distanceMeters),
          accuracyMeters: Math.round(input.accuracy),
          radiusMeters: outlet.radiusMeters,
        },
        { status: 422 },
      );
    }

    const now = new Date();
    const result = await db.transaction(async (tx) => {
      if (input.action === "clock_in") {
        const [created] = await tx
          .insert(workSessions)
          .values({
            userId: session.user.id,
            outletId: input.outletId,
            timezone: assignment.timezone,
            clockInAt: now,
            clockInLatitude: input.latitude,
            clockInLongitude: input.longitude,
            clockInAccuracy: input.accuracy,
            clockInSource: "gps",
            updatedAt: now,
          })
          .returning();

        await tx.insert(auditEvents).values({
          actorId: session.user.id,
          action: "clock_in",
          entityType: "work_session",
          entityId: created.id,
          newValues: {
            outletId: input.outletId,
            clockInAt: now.toISOString(),
            distanceMeters: Math.round(location.distanceMeters),
            locationAccuracy: input.accuracy,
          },
        });
        return created;
      }

      const [openSession] = await tx
        .select()
        .from(workSessions)
        .where(
          and(
            eq(workSessions.userId, session.user.id),
            isNull(workSessions.clockOutAt),
          ),
        )
        .limit(1)
        .for("update");

      if (!openSession || openSession.outletId !== input.outletId) return null;

      const [openBreak] = await tx
        .select({ id: workBreaks.id })
        .from(workBreaks)
        .where(
          and(
            eq(workBreaks.workSessionId, openSession.id),
            isNull(workBreaks.endedAt),
          ),
        )
        .limit(1);
      if (openBreak) return { kind: "open_break" as const };

      const [updated] = await tx
        .update(workSessions)
        .set({
          clockOutAt: now,
          clockOutLatitude: input.latitude,
          clockOutLongitude: input.longitude,
          clockOutAccuracy: input.accuracy,
          clockOutSource: "gps",
          updatedAt: now,
        })
        .where(
          and(
            eq(workSessions.id, openSession.id),
            isNull(workSessions.clockOutAt),
          ),
        )
        .returning();

      if (!updated) return null;

      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action: "clock_out",
        entityType: "work_session",
        entityId: updated.id,
        previousValues: { clockOutAt: null },
        newValues: {
          clockOutAt: now.toISOString(),
          distanceMeters: Math.round(location.distanceMeters),
          locationAccuracy: input.accuracy,
        },
      });
      return updated;
    });

    if (!result) {
      return Response.json(
        {
          error:
            input.action === "clock_in"
              ? "You already have an open shift."
              : "No open shift exists at this outlet.",
        },
        { status: 409 },
      );
    }
    if ("kind" in result) {
      return Response.json(
        { error: "End your break before clocking out." },
        { status: 409 },
      );
    }

    await notifyOutletManagers({
      outletId: result.outletId,
      actorId: session.user.id,
      event: input.action,
    });
    return Response.json({
      session: {
        id: result.id,
        outletId: result.outletId,
        clockInAt: result.clockInAt,
        clockOutAt: result.clockOutAt,
      },
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return Response.json(
        { error: "You already have an open shift." },
        { status: 409 },
      );
    }
    return Response.json(
      { error: "Could not record the clock action." },
      { status: 500 },
    );
  }
}
