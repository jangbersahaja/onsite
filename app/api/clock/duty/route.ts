import {
  scheduledShifts,
  shiftTemplates,
  user,
  workBreaks,
  workSessions,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { outletCalendarDate } from "@/lib/dashboard-data";
import { getDb } from "@/lib/db";
import { outletDateTimeToISOString } from "@/lib/outlet-time";
import { getOutletStaff, toScheduledShift } from "@/lib/schedule-data";
import { toStaffScheduledShift } from "@/lib/staff-schedule";
import { getStaffActor } from "@/lib/timesheet-actor";
import { addDaysToDateKey } from "@/lib/timesheet-off-days";
import { and, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";

function unavailable() {
  return Response.json(
    {
      error: "Set DATABASE_URL before using the duty board.",
      code: "duty_unconfigured",
    },
    { status: 503 },
  );
}

function photoUrl(userId: string, profilePhotoPath: string | null) {
  return profilePhotoPath
    ? `/api/profile-photos/${encodeURIComponent(userId)}`
    : null;
}

/** Who is on duty at an outlet today: published shifts plus open and recent work sessions. */
export async function GET(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  try {
    const actor = await getStaffActor(request);
    if ("error" in actor) {
      return Response.json({ error: actor.error }, { status: actor.status });
    }

    const db = getDb();
    const [access] = await db
      .select({
        canAccessClock: user.canAccessClock,
        approvalStatus: user.approvalStatus,
      })
      .from(user)
      .where(eq(user.id, actor.userId))
      .limit(1);
    if (!access?.canAccessClock || access.approvalStatus !== "approved") {
      return Response.json(
        {
          error: "Clock access is not enabled.",
          code: "clock_access_disabled",
        },
        { status: 403 },
      );
    }

    const outletId =
      new URL(request.url).searchParams.get("outletId") ||
      actor.outlets[0]?.id;
    const outlet = actor.outlets.find((item) => item.id === outletId);
    if (!outlet) {
      return Response.json(
        {
          error: "You cannot access this outlet.",
          code: "outlet_not_available",
        },
        { status: 403 },
      );
    }

    const now = new Date();
    const today = outletCalendarDate(now, outlet.timezone);
    const yesterday = addDaysToDateKey(today, -1);
    const tomorrow = addDaysToDateKey(today, 1);
    const windowStart = new Date(
      outletDateTimeToISOString(`${yesterday}T00:00`, outlet.timezone),
    );
    const windowEnd = new Date(
      outletDateTimeToISOString(`${tomorrow}T00:00`, outlet.timezone),
    );

    const [members, shiftRows, sessionRows] = await Promise.all([
      getOutletStaff(db, outlet.id),
      db
        .select({
          shift: scheduledShifts,
          templateName: shiftTemplates.name,
          templateCode: shiftTemplates.code,
          templateColor: shiftTemplates.color,
        })
        .from(scheduledShifts)
        .leftJoin(
          shiftTemplates,
          eq(scheduledShifts.templateId, shiftTemplates.id),
        )
        .where(
          and(
            eq(scheduledShifts.outletId, outlet.id),
            eq(scheduledShifts.status, "published"),
            gte(scheduledShifts.shiftDate, yesterday),
            lt(scheduledShifts.shiftDate, tomorrow),
          ),
        )
        .orderBy(scheduledShifts.startAt),
      db
        .select({
          id: workSessions.id,
          userId: workSessions.userId,
          clockInAt: workSessions.clockInAt,
          clockOutAt: workSessions.clockOutAt,
        })
        .from(workSessions)
        .where(
          and(
            eq(workSessions.outletId, outlet.id),
            or(
              isNull(workSessions.clockOutAt),
              and(
                gte(workSessions.clockInAt, windowStart),
                lt(workSessions.clockInAt, windowEnd),
              ),
            ),
          ),
        ),
    ]);

    const breakRows = sessionRows.length
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
              sessionRows.map((session) => session.id),
            ),
          )
      : [];

    const memberIds = new Set(members.map((member) => member.userId));
    const extraIds = [
      ...new Set([
        ...shiftRows.map((row) => row.shift.userId),
        ...sessionRows.map((session) => session.userId),
      ]),
    ].filter((id) => !memberIds.has(id));
    const extraRows = extraIds.length
      ? await db
          .select({
            userId: user.id,
            name: user.name,
            profilePhotoPath: user.profilePhotoPath,
          })
          .from(user)
          .where(inArray(user.id, extraIds))
      : [];

    const staff = [
      ...members.map((member) => ({
        userId: member.userId,
        name: member.name,
        photoUrl: photoUrl(member.userId, member.profilePhotoPath),
      })),
      ...extraRows.map((member) => ({
        userId: member.userId,
        name: member.name,
        photoUrl: photoUrl(member.userId, member.profilePhotoPath),
      })),
    ];

    return Response.json({
      outlet: { id: outlet.id, name: outlet.name, timezone: outlet.timezone },
      today,
      now: now.toISOString(),
      currentUserId: actor.userId,
      staff,
      shifts: shiftRows.map(
        ({ shift, templateName, templateCode, templateColor }) => ({
          ...toStaffScheduledShift(
            toScheduledShift(shift, outlet.timezone),
            shift.templateId && templateName
              ? {
                  name: templateName,
                  code: templateCode ?? "",
                  color: templateColor ?? "slate",
                }
              : null,
          ),
          userId: shift.userId,
        }),
      ),
      sessions: sessionRows.map((session) => ({
        id: session.id,
        userId: session.userId,
        clockInAt: session.clockInAt.toISOString(),
        clockOutAt: session.clockOutAt?.toISOString() ?? null,
        breaks: breakRows
          .filter((item) => item.workSessionId === session.id)
          .map((item) => ({
            startedAt: item.startedAt.toISOString(),
            endedAt: item.endedAt?.toISOString() ?? null,
          })),
      })),
    });
  } catch (error) {
    console.error("Could not load the duty board", error);
    return Response.json(
      { error: "Could not load who is on duty.", code: "duty_load_failed" },
      { status: 500 },
    );
  }
}
