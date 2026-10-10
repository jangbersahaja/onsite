import { auditEvents, outlets, workBreaks, workSessions } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { addCalendarDays } from "@/lib/dashboard-data";
import { getDb } from "@/lib/db";
import {
  csvCell,
  formatOutletTimestamp,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import { notifyOutletManagers } from "@/lib/push-notifications";
import {
  getConfiguredStoreHubOutletId,
  getStoreHubAttendance,
} from "@/lib/storehub-attendance";
import { filterStoreHubTimesheets } from "@/lib/storehub-attendance-data";
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

function filenamePart(value: string) {
  return (
    value
      .normalize("NFKC")
      .trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")
      .replace(/^[_ .-]+|[_ .-]+$/g, "") || "All"
  );
}

function formatCsvOutletTimestamp(value: Date | string, timezone: string) {
  const [date, time] = formatOutletTimestamp(value, timezone).split(" ");
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year} ${time}`;
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
          timezone: outlets.timezone,
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
    if (
      parsed.data.outletId &&
      actor.outlets.find((outlet) => outlet.id === parsed.data.outletId)
        ?.isActive === false
    ) {
      return Response.json(
        { error: "This outlet is inactive." },
        { status: 403 },
      );
    }

    const isStoreHubEmployee = parsed.data.employeeId?.startsWith("storehub:");
    const onsiteRows = isStoreHubEmployee
      ? []
      : await getTimesheetRows(actor.outletIds, parsed.data);
    const configuredStoreHubOutletId = getConfiguredStoreHubOutletId();
    const storeHubOutlet = actor.outlets.find(
      (outlet) =>
        outlet.id === configuredStoreHubOutletId &&
        (!parsed.data.outletId || parsed.data.outletId === outlet.id),
    );
    const storeHubAttendance = storeHubOutlet
      ? await getStoreHubAttendance(storeHubOutlet, {
          from: parsed.data.from
            ? new Date(
                outletDateTimeToISOString(
                  `${parsed.data.from}T06:00`,
                  storeHubOutlet.timezone,
                ),
              )
            : undefined,
          to: parsed.data.to
            ? new Date(
                new Date(
                  outletDateTimeToISOString(
                    `${addCalendarDays(parsed.data.to, 1)}T06:00`,
                    storeHubOutlet.timezone,
                  ),
                ).getTime() - 1,
              )
            : undefined,
        })
      : { status: "not_configured" as const, rows: [], fetchedAt: null };
    const storeHubRows =
      storeHubAttendance.status === "available"
        ? filterStoreHubTimesheets(storeHubAttendance.rows, parsed.data).map(
            (row) => ({
              ...row,
              employeeFilterId: `storehub:${row.storeHubEmployeeId}`,
              clockInLocal: formatOutletTimestamp(row.clockInAt, row.timezone),
              clockOutLocal: row.clockOutAt
                ? formatOutletTimestamp(row.clockOutAt, row.timezone)
                : null,
              grossDurationMinutes: row.clockOutAt
                ? Math.max(
                    0,
                    Math.floor(
                      (new Date(row.clockOutAt).getTime() -
                        new Date(row.clockInAt).getTime()) /
                        60_000,
                    ),
                  )
                : null,
              durationMinutes: null,
              clockInSource: "storehub" as const,
              clockOutSource: row.clockOutAt ? ("storehub" as const) : null,
            }),
          )
        : [];
    const rows = [
      ...onsiteRows.map((row) => ({
        ...row,
        source: "onsite" as const,
        employeeFilterId: row.userId,
      })),
      ...storeHubRows,
    ]
      .sort(
        (first, second) =>
          new Date(second.clockInAt).getTime() -
          new Date(first.clockInAt).getTime(),
      )
      .slice(0, 500);
    if (params.get("format") === "csv") {
      const employeeIdentity = (row: (typeof rows)[number]) =>
        "userId" in row && row.userId
          ? `user:${row.userId}`
          : row.employeeEmail
            ? `email:${row.employeeEmail.toLowerCase()}`
            : `name:${row.employeeName.trim().toLowerCase()}`;
      const orderedRows = [...rows].sort((left, right) => {
        const outletOrder = left.outletName.localeCompare(
          right.outletName,
          "en",
          { numeric: true, sensitivity: "base" },
        );
        if (outletOrder !== 0) return outletOrder;
        const outletIdOrder = left.outletId.localeCompare(right.outletId);
        if (outletIdOrder !== 0) return outletIdOrder;

        const employeeOrder = left.employeeName.localeCompare(
          right.employeeName,
          "en",
          { numeric: true, sensitivity: "base" },
        );
        if (employeeOrder !== 0) return employeeOrder;
        const staffOrder = employeeIdentity(left).localeCompare(
          employeeIdentity(right),
          "en",
          { numeric: true, sensitivity: "base" },
        );
        if (staffOrder !== 0) return staffOrder;

        const leftDate = formatOutletTimestamp(
          left.clockInAt,
          left.timezone,
        ).slice(0, 10);
        const rightDate = formatOutletTimestamp(
          right.clockInAt,
          right.timezone,
        ).slice(0, 10);
        return (
          leftDate.localeCompare(rightDate) || left.id.localeCompare(right.id)
        );
      });
      const groups: { key: string; rows: typeof orderedRows }[] = [];
      for (const row of orderedRows) {
        const key = `${row.outletId}:${employeeIdentity(row)}`;
        const lastGroup = groups[groups.length - 1];
        if (lastGroup?.key === key) lastGroup.rows.push(row);
        else groups.push({ key, rows: [row] });
      }

      const csvRows: unknown[][] = [];
      const employeeNames = new Map<string, string>();
      const outletNames = new Map<string, string>();
      for (const [groupIndex, group] of groups.entries()) {
        const firstRow = group.rows[0];
        employeeNames.set(employeeIdentity(firstRow), firstRow.employeeName);
        outletNames.set(firstRow.outletId, firstRow.outletName);
        if (groupIndex > 0) csvRows.push([]);
        csvRows.push(
          ["Name", firstRow.employeeName],
          ["Email", firstRow.employeeEmail ?? ""],
          ["Outlet", firstRow.outletName],
          [],
          [
            "Clock in (outlet time)",
            "Clock out (outlet time)",
            "Gross hours",
            "Break hours",
            "Worked hours",
            "Source / adjustment",
          ],
        );

        let totalWorkedMinutes = 0;
        for (const row of group.rows) {
          const clockInLocal = formatCsvOutletTimestamp(
            row.clockInAt,
            row.timezone,
          );
          const clockOutLocal = row.clockOutAt
            ? formatCsvOutletTimestamp(row.clockOutAt, row.timezone)
            : null;
          const grossMinutes = row.clockOutAt
            ? Math.max(
                0,
                Math.floor(
                  (new Date(row.clockOutAt!).getTime() -
                    new Date(row.clockInAt).getTime()) /
                    60_000,
                ),
              )
            : null;
          const breakMinutes =
            row.source === "storehub"
              ? row.breakMinutes
              : getCompletedBreakMinutes(row.breaks);
          const workedMinutes =
            row.source === "storehub"
              ? row.workedMinutes
              : getWorkedMinutes(row.clockInAt, row.clockOutAt, row.breaks);
          if (workedMinutes !== null) totalWorkedMinutes += workedMinutes;

          csvRows.push([
            clockInLocal,
            clockOutLocal ?? "Open",
            grossMinutes === null ? "" : (grossMinutes / 60).toFixed(2),
            breakMinutes === null ? "" : (breakMinutes / 60).toFixed(2),
            workedMinutes === null ? "" : (workedMinutes / 60).toFixed(2),
            row.source === "storehub"
              ? "StoreHub import"
              : row.clockInSource === "manual" ||
                  row.clockOutSource === "manual"
                ? "Manually adjusted"
                : "GPS verified",
          ]);
        }
        csvRows.push(
          ["Total shift records", group.rows.length],
          ["Total work hours", (totalWorkedMinutes / 60).toFixed(2)],
        );
      }

      const employeeName =
        employeeNames.size === 1 ? [...employeeNames.values()][0] : null;
      const outletName =
        outletNames.size === 1
          ? [...outletNames.values()][0]
          : parsed.data.outletId
            ? (actor.outlets.find(
                (outlet) => outlet.id === parsed.data.outletId,
              )?.name ?? null)
            : null;
      const dateRange =
        parsed.data.from && parsed.data.to
          ? `${parsed.data.from}_to_${parsed.data.to}`
          : parsed.data.from
            ? `From_${parsed.data.from}`
            : parsed.data.to
              ? `Through_${parsed.data.to}`
              : "All_Dates";
      const filename =
        [
          "Timesheets",
          ...(employeeName ? [filenamePart(employeeName)] : []),
          ...(outletName ? [filenamePart(outletName)] : []),
          filenamePart(dateRange),
        ].join("_") + ".csv";
      const fallbackFilename = filename
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\x20-\x7e]/g, "_")
        .replace(/["\\]/g, "_");
      const encodedFilename = encodeURIComponent(filename).replace(
        /['()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      return new Response(
        csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const employees = Array.from(
      new Map(
        rows.map((row) => [
          row.employeeFilterId,
          {
            id: row.employeeFilterId,
            name: row.employeeName,
            email: row.employeeEmail ?? "",
          },
        ]),
      ).values(),
    );
    return Response.json({
      outlets: actor.outlets,
      employees,
      storeHubStatus: storeHubAttendance.status,
      storeHubFetchedAt: storeHubAttendance.fetchedAt,
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
                (new Date(row.clockOutAt).getTime() -
                  new Date(row.clockInAt).getTime()) /
                  60_000,
              ),
            )
          : null,
        breakMinutes:
          row.source === "storehub"
            ? row.breakMinutes
            : getCompletedBreakMinutes(row.breaks),
        durationMinutes:
          row.source === "storehub"
            ? row.workedMinutes
            : getWorkedMinutes(row.clockInAt, row.clockOutAt, row.breaks),
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
    outletId: z.string().uuid(),
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

    if (
      !current ||
      current.outletId !== parsed.data.outletId ||
      !actor.outletIds.includes(current.outletId)
    ) {
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

    await notifyOutletManagers({
      outletId: parsed.data.outletId,
      actorId: actor.userId,
      event: "timesheet_edited",
    });
    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Could not update timesheet entry." },
      { status: 500 },
    );
  }
}
