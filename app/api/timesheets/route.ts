import { auditEvents, outlets, workSessions } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  serializeCsv,
  formatOutletTimestamp,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import { getTimesheetRows, parseTimesheetFilters } from "@/lib/timesheet-data";
import { getTeamAccess } from "@/lib/team-access";
import { eq } from "drizzle-orm";
import { z } from "zod";

function unavailable() {
  return Response.json(
    {
      error: "Set DATABASE_URL before using timesheets.",
    },
    { status: 503 },
  );
}

async function getActor(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return { error: "Sign in required.", status: 401 as const };
  const access = await getTeamAccess(session.user.id);
  if (!access) {
    return {
      error: "Timesheet access is not available.",
      status: 403 as const,
    };
  }
  const outletsForAccess = access.isSuperAdmin
    ? await getDb()
        .select({
          id: outlets.id,
          name: outlets.name,
          address: outlets.address,
          isActive: outlets.isActive,
        })
        .from(outlets)
    : access.outlets.map((outlet) => ({ ...outlet, isActive: true }));
  if (!outletsForAccess.length) {
    return {
      error: "Timesheet access is not available.",
      status: 403 as const,
    };
  }
  return {
    userId: session.user.id,
    access,
    outlets: outletsForAccess,
    outletIds: outletsForAccess.map((outlet) => outlet.id),
  };
}

export async function GET(request: Request) {
  if (!hasServerConfiguration()) return unavailable();
  try {
    const actor = await getActor(request);
    if ("error" in actor) {
      return Response.json({ error: actor.error }, { status: actor.status });
    }

    const params = new URL(request.url).searchParams;
    const parsed = parseTimesheetFilters(params);
    if (!parsed.success) {
      return Response.json(
        { error: "Timesheet filters are invalid." },
        { status: 400 },
      );
    }
    if (
      parsed.data.outletId &&
      !actor.outletIds.includes(parsed.data.outletId)
    ) {
      return Response.json(
        { error: "You cannot access this outlet." },
        { status: 403 },
      );
    }

    const rows = await getTimesheetRows(actor.outletIds, parsed.data);
    if (params.get("format") === "csv") {
      const csvRows = rows.map((row) => {
        const minutes = row.clockOutAt
          ? Math.max(
              0,
              Math.floor(
                (row.clockOutAt.getTime() - row.clockInAt.getTime()) / 60_000,
              ),
            )
          : null;
        return [
          row.employeeName,
          row.employeeEmail,
          row.outletName,
          formatOutletTimestamp(row.clockInAt, row.timezone),
          row.clockOutAt
            ? formatOutletTimestamp(row.clockOutAt, row.timezone)
            : "Open",
          minutes === null ? "" : (minutes / 60).toFixed(2),
          row.clockInSource === "manual" || row.clockOutSource === "manual"
            ? "Manually adjusted"
            : "GPS verified",
        ];
      });
      return new Response(
        serializeCsv(
          [
            "Employee",
            "Email",
            "Outlet",
            "Clock in (outlet time)",
            "Clock out (outlet time)",
            "Hours",
            "Punch source / adjustment",
          ],
          csvRows,
        ),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="timesheets.csv"',
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const employees = Array.from(
      new Map(
        rows.map((row) => [
          row.userId,
          { id: row.userId, name: row.employeeName, email: row.employeeEmail },
        ]),
      ).values(),
    );
    return Response.json({
      outlets: actor.outlets,
      employees,
      rows: rows.map((row) => ({
        ...row,
        clockInLocal: formatOutletTimestamp(row.clockInAt, row.timezone),
        clockOutLocal: row.clockOutAt
          ? formatOutletTimestamp(row.clockOutAt, row.timezone)
          : null,
        durationMinutes: row.clockOutAt
          ? Math.max(
              0,
              Math.floor(
                (row.clockOutAt.getTime() - row.clockInAt.getTime()) / 60_000,
              ),
            )
          : null,
      })),
    });
  } catch {
    return Response.json(
      { error: "Could not load timesheets." },
      { status: 500 },
    );
  }
}

const editSchema = z
  .object({
    id: z.string().uuid(),
    clockInAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    clockOutAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .nullable(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export async function PATCH(request: Request) {
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
    const parsed = editSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Edit details are invalid." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [current] = await db
      .select({
        id: workSessions.id,
        outletId: workSessions.outletId,
        clockInAt: workSessions.clockInAt,
        clockOutAt: workSessions.clockOutAt,
        clockInSource: workSessions.clockInSource,
        clockOutSource: workSessions.clockOutSource,
        timezone: workSessions.timezone,
      })
      .from(workSessions)
      .where(eq(workSessions.id, parsed.data.id))
      .limit(1);

    if (!current || !actor.outletIds.includes(current.outletId)) {
      return Response.json(
        { error: "Timesheet entry not found." },
        { status: 404 },
      );
    }

    let clockInAt: Date;
    let clockOutAt: Date | null;
    try {
      clockInAt = new Date(
        outletDateTimeToISOString(parsed.data.clockInAt, current.timezone),
      );
      clockOutAt = parsed.data.clockOutAt
        ? new Date(
            outletDateTimeToISOString(parsed.data.clockOutAt, current.timezone),
          )
        : null;
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Invalid outlet time.",
        },
        { status: 400 },
      );
    }

    if (
      (clockOutAt && clockOutAt <= clockInAt) ||
      clockInAt > new Date() ||
      (clockOutAt && clockOutAt > new Date())
    ) {
      return Response.json(
        { error: "Times must be in order and cannot be in the future." },
        { status: 400 },
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(workSessions)
        .set({
          clockInAt,
          clockOutAt,
          clockInLatitude:
            clockInAt.getTime() === current.clockInAt.getTime()
              ? undefined
              : null,
          clockInLongitude:
            clockInAt.getTime() === current.clockInAt.getTime()
              ? undefined
              : null,
          clockInAccuracy:
            clockInAt.getTime() === current.clockInAt.getTime()
              ? undefined
              : null,
          clockInSource:
            clockInAt.getTime() === current.clockInAt.getTime()
              ? current.clockInSource
              : "manual",
          clockOutLatitude:
            clockOutAt?.getTime() === current.clockOutAt?.getTime()
              ? undefined
              : null,
          clockOutLongitude:
            clockOutAt?.getTime() === current.clockOutAt?.getTime()
              ? undefined
              : null,
          clockOutAccuracy:
            clockOutAt?.getTime() === current.clockOutAt?.getTime()
              ? undefined
              : null,
          clockOutSource:
            clockOutAt?.getTime() === current.clockOutAt?.getTime()
              ? current.clockOutSource
              : clockOutAt
                ? "manual"
                : null,
          updatedAt: new Date(),
        })
        .where(eq(workSessions.id, current.id));
      await tx.insert(auditEvents).values({
        actorId: actor.userId,
        action: "timesheet_edit",
        entityType: "work_session",
        entityId: current.id,
        previousValues: {
          clockInAt: current.clockInAt.toISOString(),
          clockOutAt: current.clockOutAt?.toISOString() ?? null,
        },
        newValues: {
          clockInAt: clockInAt.toISOString(),
          clockOutAt: clockOutAt?.toISOString() ?? null,
        },
        reason: parsed.data.reason,
      });
    });

    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Could not update timesheet entry." },
      { status: 500 },
    );
  }
}
