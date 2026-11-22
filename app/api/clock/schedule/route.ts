import { scheduledShifts, shiftTemplates, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { outletCalendarDate } from "@/lib/dashboard-data";
import { getDb } from "@/lib/db";
import { isDateOnly } from "@/lib/outlet-time";
import { toScheduledShift } from "@/lib/schedule-data";
import {
  dayDifference,
  MAX_SCHEDULE_RANGE_DAYS,
  startOfWeek,
} from "@/lib/schedule-rules";
import { toStaffScheduledShift } from "@/lib/staff-schedule";
import { getStaffActor } from "@/lib/timesheet-actor";
import { addDaysToDateKey } from "@/lib/timesheet-off-days";
import { and, eq, gte, lte } from "drizzle-orm";

function unavailable() {
  return Response.json(
    {
      error: "Set DATABASE_URL before using schedules.",
      code: "schedule_unconfigured",
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  try {
    const actor = await getStaffActor(request);
    if ("error" in actor) {
      return Response.json({ error: actor.error }, { status: actor.status });
    }

    const [staff] = await getDb()
      .select({
        canAccessClock: user.canAccessClock,
        approvalStatus: user.approvalStatus,
      })
      .from(user)
      .where(eq(user.id, actor.userId))
      .limit(1);
    if (!staff?.canAccessClock || staff.approvalStatus !== "approved") {
      return Response.json(
        {
          error: "Clock access is not enabled.",
          code: "clock_access_disabled",
        },
        { status: 403 },
      );
    }

    const params = new URL(request.url).searchParams;
    const requestedOutletId = params.get("outletId");
    const outletId = requestedOutletId || actor.outlets[0]?.id;
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

    const today = outletCalendarDate(new Date(), outlet.timezone);
    const from = params.get("from") || startOfWeek(today);
    const to = params.get("to") || addDaysToDateKey(from, 6);
    if (!isDateOnly(from) || !isDateOnly(to) || from > to) {
      return Response.json(
        { error: "Choose a valid date range.", code: "invalid_schedule_range" },
        { status: 400 },
      );
    }
    if (dayDifference(from, to) >= MAX_SCHEDULE_RANGE_DAYS) {
      return Response.json(
        {
          error: `Choose a range of ${MAX_SCHEDULE_RANGE_DAYS} days or fewer.`,
          code: "schedule_range_too_long",
        },
        { status: 400 },
      );
    }

    const rows = await getDb()
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
          eq(scheduledShifts.userId, actor.userId),
          eq(scheduledShifts.outletId, outlet.id),
          eq(scheduledShifts.status, "published"),
          gte(scheduledShifts.shiftDate, from),
          lte(scheduledShifts.shiftDate, to),
        ),
      )
      .orderBy(scheduledShifts.startAt);

    return Response.json({
      outlets: actor.outlets.map((item) => ({
        id: item.id,
        name: item.name,
        timezone: item.timezone,
        imageUrl: item.imageUrl,
      })),
      outlet: {
        id: outlet.id,
        name: outlet.name,
        timezone: outlet.timezone,
        imageUrl: outlet.imageUrl,
      },
      from,
      to,
      today,
      now: new Date().toISOString(),
      shifts: rows.map(({ shift, templateName, templateCode, templateColor }) =>
        toStaffScheduledShift(
          toScheduledShift(shift, outlet.timezone),
          shift.templateId && templateName
            ? {
                name: templateName,
                code: templateCode ?? "",
                color: templateColor ?? "slate",
              }
            : null,
        ),
      ),
    });
  } catch (error) {
    console.error("Could not load staff schedule", error);
    return Response.json(
      { error: "Could not load your schedule.", code: "schedule_load_failed" },
      { status: 500 },
    );
  }
}
