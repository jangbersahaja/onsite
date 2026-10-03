import {
  auditEvents,
  outletMemberships,
  outlets,
  staffDeviceEnrollments,
  workSessions,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { verifyGeofence } from "@/lib/geofence";
import { parseDateRange } from "@/lib/outlet-time";
import {
  getStaffDeviceCookieName,
  isApprovedStaffDevice,
  isStaffDeviceRequired,
} from "@/lib/staff-device";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

const clockActionSchema = z
  .object({
    action: z.enum(["clock_in", "clock_out"]),
    outletId: z.string().uuid(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100_000),
  })
  .strict();

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

    const params = new URL(request.url).searchParams;
    const historyRange = parseDateRange(params.get("from"), params.get("to"));
    if (!historyRange) {
      return Response.json(
        { error: "History date filters are invalid." },
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

    const recentSessions = await db
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
      .limit(100);

    return Response.json({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
      outlets: assignments,
      activeSession: activeSession ?? null,
      recentSessions,
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
            .select({ role: outletMemberships.role, timezone: outlets.timezone })
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
      return Response.json({ error, reason: location.reason }, { status: 422 });
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
        .limit(1);

      if (!openSession || openSession.outletId !== input.outletId) return null;

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
