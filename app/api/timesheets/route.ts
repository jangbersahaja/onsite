import {
  outletMemberships,
  outlets,
  user,
  workBreaks,
  workSessions,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { recordAudit } from "@/lib/audit";
import { addCalendarDays } from "@/lib/dashboard-data";
import { getDb } from "@/lib/db";
import {
  csvCell,
  formatOutletTimestamp,
  outletDateTimeToISOString,
} from "@/lib/outlet-time";
import { notifyOutletManagers } from "@/lib/push-notifications";
import {
  getStoreHubAttendance,
  mergeStoreHubAttendance,
} from "@/lib/storehub-attendance";
import { filterStoreHubTimesheets } from "@/lib/storehub-attendance-data";
import { getActor } from "@/lib/timesheet-actor";
import {
  canChangeShiftFor,
  canDeleteShift,
  hasOverlap,
  validateManualShift,
  type ManualBreak,
} from "@/lib/timesheet-create-rules";
import { getTimesheetRows, parseTimesheetFilters } from "@/lib/timesheet-data";
import { buildTimesheetImportExport } from "@/lib/timesheet-import";
import { getOffDayDateKeys } from "@/lib/timesheet-off-days";
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

function dateRangeLabel(filters: { from?: string; to?: string }) {
  if (filters.from && filters.to) return `${filters.from}_to_${filters.to}`;
  if (filters.from) return `From_${filters.from}`;
  if (filters.to) return `Through_${filters.to}`;
  return "All_Dates";
}

function csvDownloadHeaders(filename: string) {
  const fallbackFilename = filename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encodedFilename = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
    "Cache-Control": "no-store",
  };
}

function formatCsvOutletTimestamp(value: Date | string, timezone: string) {
  const [date, time] = formatOutletTimestamp(value, timezone).split(" ");
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year} ${time}`;
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
    const storeHubOutlets = actor.outlets.filter(
      (outlet) =>
        outlet.isActive !== false &&
        (!parsed.data.outletId || parsed.data.outletId === outlet.id),
    );
    const storeHubAttendance = mergeStoreHubAttendance(
      await Promise.all(
        storeHubOutlets.map((storeHubOutlet) =>
          getStoreHubAttendance(storeHubOutlet, {
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
          }),
        ),
      ),
    );
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
    if (params.get("format") === "import-csv") {
      if (!parsed.data.outletId) {
        return Response.json(
          { error: "Choose one outlet to export an import file." },
          { status: 400 },
        );
      }
      const outletName =
        actor.outlets.find((outlet) => outlet.id === parsed.data.outletId)
          ?.name ?? "Outlet";
      const filename =
        [
          "Timesheets-import",
          filenamePart(outletName),
          filenamePart(dateRangeLabel(parsed.data)),
        ].join("_") + ".csv";
      return new Response(
        buildTimesheetImportExport(
          onsiteRows.map((row) => ({
            staffCode: row.staffCode,
            timezone: row.timezone,
            clockInAt: row.clockInAt,
            clockOutAt: row.clockOutAt,
            breaks: row.breaks,
          })),
        ),
        { headers: csvDownloadHeaders(filename) },
      );
    }

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
        const dayLines: { date: string; cells: string[] }[] = [];
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

          const cells = [
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
          ];
          dayLines.push({
            date: formatOutletTimestamp(row.clockInAt, row.timezone).slice(
              0,
              10,
            ),
            cells,
          });
        }
        if (group.rows.every((row) => row.source === "onsite")) {
          const today = formatOutletTimestamp(
            new Date(),
            group.rows[0].timezone,
          ).slice(0, 10);
          for (const date of getOffDayDateKeys({
            from: parsed.data.from,
            to: parsed.data.to,
            today,
            workedDateKeys: dayLines.map((line) => line.date),
          })) {
            const [year, month, day] = date.split("-");
            dayLines.push({
              date,
              cells: [`${day}/${month}/${year}`, "", "", "", "", "Off day"],
            });
          }
        }
        dayLines.sort((left, right) => left.date.localeCompare(right.date));
        csvRows.push(...dayLines.map((line) => line.cells));
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
      const dateRange = dateRangeLabel(parsed.data);
      const filename =
        [
          "Timesheets",
          ...(employeeName ? [filenamePart(employeeName)] : []),
          ...(outletName ? [filenamePart(outletName)] : []),
          filenamePart(dateRange),
        ].join("_") + ".csv";
      return new Response(
        csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
        { headers: csvDownloadHeaders(filename) },
      );
    }

    const staffRows = isStoreHubEmployee
      ? []
      : await getDb()
          .select({
            userId: user.id,
            name: user.name,
            username: user.username,
            email: user.email,
            outletId: outlets.id,
            outletName: outlets.name,
            timezone: outlets.timezone,
          })
          .from(outletMemberships)
          .innerJoin(user, eq(outletMemberships.userId, user.id))
          .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
          .where(
            and(
              inArray(outletMemberships.outletId, actor.outletIds),
              eq(outletMemberships.isActive, true),
              eq(outlets.isActive, true),
              eq(user.canAccessClock, true),
              eq(user.approvalStatus, "approved"),
              parsed.data.outletId
                ? eq(outletMemberships.outletId, parsed.data.outletId)
                : undefined,
              parsed.data.employeeId
                ? eq(user.id, parsed.data.employeeId)
                : undefined,
            ),
          )
          .orderBy(user.name);
    const actorChangeScope = {
      userId: actor.userId,
      isSuperAdmin: actor.access.isSuperAdmin,
    };
    const staff = staffRows.filter((member) =>
      canChangeShiftFor(actorChangeScope, member.userId),
    );

    const employeeMap = new Map<
      string,
      { id: string; name: string; email: string }
    >();
    for (const row of rows) {
      employeeMap.set(row.employeeFilterId, {
        id: row.employeeFilterId,
        name: row.employeeName,
        email: row.employeeEmail ?? "",
      });
    }
    for (const member of staffRows) {
      if (!employeeMap.has(member.userId)) {
        employeeMap.set(member.userId, {
          id: member.userId,
          name: member.name,
          email: member.email,
        });
      }
    }
    return Response.json({
      outlets: actor.outlets,
      employees: Array.from(employeeMap.values()),
      staff,
      currentUserId: actor.userId,
      isSuperAdmin: actor.access.isSuperAdmin,
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
    reason: z.string().trim().max(500),
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

      await recordAudit(tx, {
        actorId: actor.userId,
        action: "timesheet_edit",
        entityType: "work_session",
        entityId: current.id,
        outletId: current.outletId,
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
        reason: parsed.data.reason || null,
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

const createSchema = z
  .object({
    outletId: z.string().uuid(),
    userId: z.string().min(1).max(200),
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
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

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
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Shift details are invalid." },
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
    if (
      !canChangeShiftFor(
        { userId: actor.userId, isSuperAdmin: actor.access.isSuperAdmin },
        parsed.data.userId,
      )
    ) {
      return Response.json(
        { error: "You cannot change your own shifts." },
        { status: 403 },
      );
    }

    const db = getDb();
    const [target] = await db
      .select({
        userId: user.id,
        username: user.username,
        isActive: outletMemberships.isActive,
        canAccessClock: user.canAccessClock,
        approvalStatus: user.approvalStatus,
      })
      .from(outletMemberships)
      .innerJoin(user, eq(outletMemberships.userId, user.id))
      .where(
        and(
          eq(outletMemberships.outletId, outlet.id),
          eq(outletMemberships.userId, parsed.data.userId),
        ),
      )
      .limit(1);
    if (
      !target ||
      !target.isActive ||
      !target.canAccessClock ||
      target.approvalStatus !== "approved"
    ) {
      return Response.json(
        { error: "This staff member cannot have shifts added at this outlet." },
        { status: 400 },
      );
    }

    let clockInAt: Date;
    let clockOutAt: Date;
    try {
      clockInAt = new Date(
        outletDateTimeToISOString(parsed.data.clockInAt, outlet.timezone),
      );
      clockOutAt = new Date(
        outletDateTimeToISOString(parsed.data.clockOutAt, outlet.timezone),
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Invalid outlet time.",
        },
        { status: 400 },
      );
    }

    const shiftBreaks: ManualBreak[] = (parsed.data.breaks ?? []).map(
      (breakInterval) => ({
        startedAt: new Date(breakInterval.startedAt),
        endedAt: new Date(breakInterval.endedAt),
      }),
    );
    const validationError = validateManualShift({
      clockInAt,
      clockOutAt,
      breaks: shiftBreaks,
      now: new Date(),
    });
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const outcome = await db.transaction(async (tx) => {
      // Lock the staff member's row so concurrent shift writes for them serialise.
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, target.userId))
        .limit(1)
        .for("update");

      const existing = await tx
        .select({
          start: workSessions.clockInAt,
          end: workSessions.clockOutAt,
        })
        .from(workSessions)
        .where(eq(workSessions.userId, target.userId));
      if (hasOverlap({ start: clockInAt, end: clockOutAt }, existing)) {
        return {
          status: 409 as const,
          error: "This shift overlaps another shift for this staff member.",
        };
      }

      const now = new Date();
      const [created] = await tx
        .insert(workSessions)
        .values({
          userId: target.userId,
          outletId: outlet.id,
          timezone: outlet.timezone,
          clockInAt,
          clockOutAt,
          clockInSource: "manual",
          clockOutSource: "manual",
          updatedAt: now,
        })
        .returning({ id: workSessions.id });

      if (shiftBreaks.length) {
        await tx.insert(workBreaks).values(
          shiftBreaks.map((breakInterval) => ({
            workSessionId: created.id,
            startedAt: breakInterval.startedAt,
            endedAt: breakInterval.endedAt,
            updatedAt: now,
          })),
        );
      }

      await recordAudit(tx, {
        actorId: actor.userId,
        action: "timesheet_create",
        entityType: "work_session",
        entityId: created.id,
        outletId: outlet.id,
        newValues: {
          username: target.username,
          clockInAt: clockInAt.toISOString(),
          clockOutAt: clockOutAt.toISOString(),
          breaks: shiftBreaks.map((breakInterval) => ({
            startedAt: breakInterval.startedAt.toISOString(),
            endedAt: breakInterval.endedAt?.toISOString() ?? null,
          })),
        },
        reason: parsed.data.reason,
      });
      return { id: created.id };
    });

    if ("error" in outcome) {
      return Response.json(
        { error: outcome.error },
        { status: outcome.status },
      );
    }

    await notifyOutletManagers({
      outletId: outlet.id,
      actorId: actor.userId,
      event: "timesheet_created",
    });
    return Response.json({ success: true, id: outcome.id }, { status: 201 });
  } catch {
    return Response.json({ error: "Could not add shift." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!hasServerConfiguration()) return unavailable();
  try {
    const actor = await getActor(request);
    if ("error" in actor) {
      return Response.json({ error: actor.error }, { status: actor.status });
    }

    const idParam = z
      .string()
      .uuid()
      .safeParse(new URL(request.url).searchParams.get("id"));
    if (!idParam.success) {
      return Response.json(
        { error: "Timesheet entry id is invalid." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [session] = await db
      .select({
        id: workSessions.id,
        userId: workSessions.userId,
        outletId: workSessions.outletId,
      })
      .from(workSessions)
      .where(eq(workSessions.id, idParam.data))
      .limit(1);
    if (!session || !actor.outletIds.includes(session.outletId)) {
      return Response.json(
        { error: "Timesheet entry not found." },
        { status: 404 },
      );
    }
    if (
      !canChangeShiftFor(
        { userId: actor.userId, isSuperAdmin: actor.access.isSuperAdmin },
        session.userId,
      )
    ) {
      return Response.json(
        { error: "You cannot change your own shifts." },
        { status: 403 },
      );
    }

    const outcome = await db.transaction(async (tx) => {
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, session.userId))
        .limit(1)
        .for("update");

      const [current] = await tx
        .select({
          id: workSessions.id,
          userId: workSessions.userId,
          outletId: workSessions.outletId,
          timezone: workSessions.timezone,
          clockInAt: workSessions.clockInAt,
          clockOutAt: workSessions.clockOutAt,
          clockInSource: workSessions.clockInSource,
          clockOutSource: workSessions.clockOutSource,
        })
        .from(workSessions)
        .where(eq(workSessions.id, session.id))
        .limit(1)
        .for("update");
      if (!current) {
        return { status: 404 as const, error: "Timesheet entry not found." };
      }
      if (!canDeleteShift(current)) {
        return {
          status: 409 as const,
          error: "Open shifts cannot be deleted. Clock out first.",
        };
      }

      const breaks = await tx
        .select({
          startedAt: workBreaks.startedAt,
          endedAt: workBreaks.endedAt,
        })
        .from(workBreaks)
        .where(eq(workBreaks.workSessionId, current.id))
        .orderBy(workBreaks.startedAt);

      await recordAudit(tx, {
        actorId: actor.userId,
        action: "timesheet_delete",
        entityType: "work_session",
        entityId: current.id,
        outletId: current.outletId,
        previousValues: {
          userId: current.userId,
          timezone: current.timezone,
          clockInAt: current.clockInAt.toISOString(),
          clockOutAt: current.clockOutAt?.toISOString() ?? null,
          clockInSource: current.clockInSource,
          clockOutSource: current.clockOutSource,
          breaks: breaks.map((breakInterval) => ({
            startedAt: breakInterval.startedAt.toISOString(),
            endedAt: breakInterval.endedAt?.toISOString() ?? null,
          })),
        },
      });

      // Break rows are removed by the workSessions cascade.
      await tx.delete(workSessions).where(eq(workSessions.id, current.id));
      return { deleted: true as const, outletId: current.outletId };
    });

    if ("error" in outcome) {
      return Response.json(
        { error: outcome.error },
        { status: outcome.status },
      );
    }

    await notifyOutletManagers({
      outletId: outcome.outletId,
      actorId: actor.userId,
      event: "timesheet_deleted",
    });
    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "Could not delete shift." }, { status: 500 });
  }
}
