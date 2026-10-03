import { auditEvents, outlets, workBreaks, workSessions } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  formatOutletTimestamp,
  outletDateTimeToISOString,
  serializeCsv,
} from "@/lib/outlet-time";
import { getTeamAccess } from "@/lib/team-access";
import { getTimesheetRows, parseTimesheetFilters } from "@/lib/timesheet-data";
import {
  getCompletedBreakMinutes,
  getWorkedMinutes,
  validateBreakIntervals,
} from "@/lib/work-breaks";
import { and, eq, inArray } from "drizzle-orm";
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
        const grossMinutes = row.clockOutAt
          ? Math.max(
              0,
              Math.floor(
                (row.clockOutAt.getTime() - row.clockInAt.getTime()) / 60_000,
              ),
            )
          : null;
        const breakMinutes = getCompletedBreakMinutes(row.breaks);
        const workedMinutes = getWorkedMinutes(
          row.clockInAt,
          row.clockOutAt,
          row.breaks,
        );
        return [
          row.employeeName,
          row.employeeEmail,
          row.outletName,
          formatOutletTimestamp(row.clockInAt, row.timezone),
          row.clockOutAt
            ? formatOutletTimestamp(row.clockOutAt, row.timezone)
            : "Open",
          grossMinutes === null ? "" : (grossMinutes / 60).toFixed(2),
          breakMinutes,
          workedMinutes === null ? "" : (workedMinutes / 60).toFixed(2),
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
            "Gross hours",
            "Break minutes",
            "Worked hours",
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
        grossDurationMinutes: row.clockOutAt
          ? Math.max(
              0,
              Math.floor(
                (row.clockOutAt.getTime() - row.clockInAt.getTime()) / 60_000,
              ),
            )
          : null,
        breakMinutes: getCompletedBreakMinutes(row.breaks),
        durationMinutes: getWorkedMinutes(
          row.clockInAt,
          row.clockOutAt,
          row.breaks,
        ),
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
    breaks: z
      .array(
        z
          .object({
            id: z.string().uuid().nullable(),
            startedAt: z.string().datetime({ offset: true }),
            endedAt: z.string().datetime({ offset: true }).nullable(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
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

    const outcome = await db.transaction(async (tx) => {
      const [lockedSession] = await tx
        .select({ id: workSessions.id })
        .from(workSessions)
        .where(eq(workSessions.id, current.id))
        .limit(1)
        .for("update");
      if (!lockedSession) return { error: "Timesheet entry not found." };

      const previousBreaks = await tx
        .select({
          id: workBreaks.id,
          startedAt: workBreaks.startedAt,
          endedAt: workBreaks.endedAt,
        })
        .from(workBreaks)
        .where(eq(workBreaks.workSessionId, current.id))
        .orderBy(workBreaks.startedAt)
        .for("update");
      const nextBreaks = parsed.data.breaks
        ? parsed.data.breaks.map((breakInterval) => ({
            id: breakInterval.id,
            startedAt: new Date(breakInterval.startedAt),
            endedAt: breakInterval.endedAt
              ? new Date(breakInterval.endedAt)
              : null,
          }))
        : previousBreaks;
      const now = new Date();
      if (
        !validateBreakIntervals(nextBreaks, clockInAt, clockOutAt) ||
        nextBreaks.some(
          (breakInterval) =>
            breakInterval.startedAt > now ||
            (breakInterval.endedAt !== null && breakInterval.endedAt > now),
        )
      ) {
        return {
          error:
            "Breaks must be ordered, non-overlapping, within the shift, and not in the future.",
        };
      }

      const existingIds = new Set(
        previousBreaks.map((breakInterval) => breakInterval.id),
      );
      const submittedIds = nextBreaks
        .map((breakInterval) => breakInterval.id)
        .filter((id): id is string => id !== null);
      if (
        new Set(submittedIds).size !== submittedIds.length ||
        submittedIds.some((id) => !existingIds.has(id))
      ) {
        return { error: "Break details do not match this shift." };
      }

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

      const savedBreaks: {
        id: string;
        startedAt: Date;
        endedAt: Date | null;
      }[] = [];
      if (parsed.data.breaks) {
        for (const breakInterval of nextBreaks) {
          if (breakInterval.id) {
            await tx
              .update(workBreaks)
              .set({
                startedAt: breakInterval.startedAt,
                endedAt: breakInterval.endedAt,
                updatedAt: now,
              })
              .where(
                and(
                  eq(workBreaks.id, breakInterval.id),
                  eq(workBreaks.workSessionId, current.id),
                ),
              );
            savedBreaks.push({
              id: breakInterval.id,
              startedAt: breakInterval.startedAt,
              endedAt: breakInterval.endedAt,
            });
          } else {
            const [created] = await tx
              .insert(workBreaks)
              .values({
                workSessionId: current.id,
                startedAt: breakInterval.startedAt,
                endedAt: breakInterval.endedAt,
                updatedAt: now,
              })
              .returning({ id: workBreaks.id });
            savedBreaks.push({ ...breakInterval, id: created.id });
          }
        }
        const removedIds = previousBreaks
          .map((breakInterval) => breakInterval.id)
          .filter((id) => !submittedIds.includes(id));
        if (removedIds.length) {
          await tx
            .delete(workBreaks)
            .where(
              and(
                eq(workBreaks.workSessionId, current.id),
                inArray(workBreaks.id, removedIds),
              ),
            );
        }
      }
      const auditedBreaks = parsed.data.breaks ? savedBreaks : nextBreaks;

      await tx.insert(auditEvents).values({
        actorId: actor.userId,
        action: "timesheet_edit",
        entityType: "work_session",
        entityId: current.id,
        previousValues: {
          clockInAt: current.clockInAt.toISOString(),
          clockOutAt: current.clockOutAt?.toISOString() ?? null,
          breaks: previousBreaks.map((breakInterval) => ({
            id: breakInterval.id,
            startedAt: breakInterval.startedAt.toISOString(),
            endedAt: breakInterval.endedAt?.toISOString() ?? null,
          })),
        },
        newValues: {
          clockInAt: clockInAt.toISOString(),
          clockOutAt: clockOutAt?.toISOString() ?? null,
          breaks: auditedBreaks.map((breakInterval) => ({
            id: breakInterval.id,
            startedAt: breakInterval.startedAt.toISOString(),
            endedAt: breakInterval.endedAt?.toISOString() ?? null,
          })),
        },
        reason: parsed.data.reason,
      });
      return { success: true };
    });

    if ("error" in outcome) {
      return Response.json({ error: outcome.error }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Could not update timesheet entry." },
      { status: 500 },
    );
  }
}
