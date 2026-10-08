import { user, workBreaks, workSessions } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import {
  addCalendarDays,
  getDashboardShiftMetrics,
  getDashboardShiftStatus,
  getScheduleWindow,
  orderDashboardShifts,
  outletScheduleDate,
} from "@/lib/dashboard-data";
import { getDb } from "@/lib/db";
import { formatOutletTimestamp, isDateOnly } from "@/lib/outlet-time";
import { getStoreHubAttendance } from "@/lib/storehub-attendance";
import { storeHubShiftOverlapsWindow } from "@/lib/storehub-attendance-data";
import { getTeamAccess } from "@/lib/team-access";
import { and, asc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";

type DashboardView = "today" | "yesterday" | "custom";

function unavailable() {
  return Response.json(
    { error: "Set DATABASE_URL before loading the dashboard." },
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

    const access = await getTeamAccess(session.user.id);
    if (!access)
      return Response.json(
        { error: "Dashboard access denied." },
        { status: 403 },
      );
    if (!access.outlets.length) {
      return Response.json(
        { error: "No accessible outlets are available." },
        { status: 403 },
      );
    }

    const params = new URL(request.url).searchParams;
    const requestedView = params.get("view") ?? "today";
    const view: DashboardView | null =
      requestedView === "today" ||
      requestedView === "yesterday" ||
      requestedView === "custom"
        ? requestedView
        : null;
    const customDate = params.get("date");
    if (
      !view ||
      (view === "custom" && (!customDate || !isDateOnly(customDate)))
    ) {
      return Response.json(
        { error: "Choose a valid dashboard date." },
        { status: 400 },
      );
    }

    const now = new Date();
    const db = getDb();
    const dashboardOutlets = await Promise.all(
      access.outlets.map(async (outlet) => {
        const localToday = outletScheduleDate(now, outlet.timezone);
        const date =
          view === "custom"
            ? customDate!
            : view === "yesterday"
              ? addCalendarDays(localToday, -1)
              : localToday;
        const { startAt, endAt } = getScheduleWindow(date, outlet.timezone);
        const evaluatedAt =
          date < localToday
            ? endAt
            : new Date(Math.min(now.getTime(), endAt.getTime()));
        const [shifts, storeHubAttendance] = await Promise.all([
          evaluatedAt.getTime() > startAt.getTime()
            ? await db
                .select({
                  id: workSessions.id,
                  userId: user.id,
                  employeeName: user.name,
                  profilePhotoPath: user.profilePhotoPath,
                  clockInAt: workSessions.clockInAt,
                  clockOutAt: workSessions.clockOutAt,
                })
                .from(workSessions)
                .innerJoin(user, eq(workSessions.userId, user.id))
                .where(
                  and(
                    eq(workSessions.outletId, outlet.id),
                    lt(workSessions.clockInAt, evaluatedAt),
                    or(
                      isNull(workSessions.clockOutAt),
                      gt(workSessions.clockOutAt, startAt),
                    ),
                  ),
                )
                .orderBy(asc(user.name), asc(workSessions.clockInAt))
                .limit(500)
            : Promise.resolve([]),
          getStoreHubAttendance(outlet, {
            from: new Date(startAt.getTime() - 24 * 60 * 60 * 1000),
            to: endAt,
          }),
        ]);
        const breaks = shifts.length
          ? await db
              .select({
                id: workBreaks.id,
                workSessionId: workBreaks.workSessionId,
                startedAt: workBreaks.startedAt,
                endedAt: workBreaks.endedAt,
              })
              .from(workBreaks)
              .where(
                inArray(
                  workBreaks.workSessionId,
                  shifts.map((shift) => shift.id),
                ),
              )
              .orderBy(asc(workBreaks.startedAt))
          : [];
        const onsiteShiftRows = shifts.map((shift) => {
          const shiftBreaks = breaks.filter(
            (breakInterval) => breakInterval.workSessionId === shift.id,
          );
          const metrics = getDashboardShiftMetrics(
            shift.clockInAt,
            shift.clockOutAt,
            shiftBreaks,
            startAt,
            endAt,
            evaluatedAt,
          );
          return {
            id: shift.id,
            source: "onsite" as const,
            userId: shift.userId,
            employeeName: shift.employeeName,
            profilePhotoUrl: shift.profilePhotoPath
              ? `/api/profile-photos/${encodeURIComponent(shift.userId)}`
              : null,
            clockInAt: shift.clockInAt,
            clockOutAt: shift.clockOutAt,
            clockInLocal: formatOutletTimestamp(
              shift.clockInAt,
              outlet.timezone,
            ),
            clockOutLocal: shift.clockOutAt
              ? formatOutletTimestamp(shift.clockOutAt, outlet.timezone)
              : null,
            status: getDashboardShiftStatus(
              shift.clockInAt,
              shift.clockOutAt,
              shiftBreaks,
              evaluatedAt,
            ),
            ...metrics,
            breaks: shiftBreaks.map((breakInterval) => ({
              id: breakInterval.id,
              startedAt: breakInterval.startedAt,
              endedAt: breakInterval.endedAt,
            })),
          };
        });
        const storeHubShiftRows =
          storeHubAttendance.status === "available"
            ? storeHubAttendance.rows
                .filter((shift) =>
                  storeHubShiftOverlapsWindow(shift, startAt, evaluatedAt),
                )
                .map((shift) => {
                  const metrics = getDashboardShiftMetrics(
                    shift.clockInAt,
                    shift.clockOutAt,
                    shift.breaks,
                    startAt,
                    endAt,
                    evaluatedAt,
                  );
                  return {
                    ...metrics,
                    id: shift.id,
                    source: "storehub" as const,
                    storeHubEmployeeId: shift.storeHubEmployeeId,
                    userId: null,
                    employeeName: shift.employeeName,
                    profilePhotoUrl: null,
                    clockInAt: shift.clockInAt,
                    clockOutAt: shift.clockOutAt,
                    clockInLocal: formatOutletTimestamp(
                      shift.clockInAt,
                      outlet.timezone,
                    ),
                    clockOutLocal: shift.clockOutAt
                      ? formatOutletTimestamp(shift.clockOutAt, outlet.timezone)
                      : null,
                    status: getDashboardShiftStatus(
                      shift.clockInAt,
                      shift.clockOutAt,
                      shift.breaks,
                      evaluatedAt,
                    ),
                    workedMinutes:
                      shift.breakMinutes === null
                        ? null
                        : metrics.workedMinutes,
                    breakMinutes:
                      shift.breakMinutes === null ? null : metrics.breakMinutes,
                    breaks: shift.breaks,
                  };
                })
            : [];
        const shiftRows = [...onsiteShiftRows, ...storeHubShiftRows];
        const hasUnknownMetrics = storeHubShiftRows.some(
          (shift) => shift.breakMinutes === null,
        );

        return {
          id: outlet.id,
          name: outlet.name,
          address: outlet.address,
          timezone: outlet.timezone,
          date,
          windowStartAt: startAt,
          windowEndAt: endAt,
          evaluatedAt,
          storeHubStatus: storeHubAttendance.status,
          storeHubFetchedAt: storeHubAttendance.fetchedAt,
          onShiftCount: shiftRows.filter((shift) => shift.status === "on_shift")
            .length,
          onBreakCount: storeHubShiftRows.some(
            (shift) => shift.status !== "finished",
          )
            ? null
            : onsiteShiftRows.filter((shift) => shift.status === "on_break")
                .length,
          workedMinutes: hasUnknownMetrics
            ? null
            : shiftRows.reduce(
                (total, shift) => total + (shift.workedMinutes ?? 0),
                0,
              ),
          breakMinutes: hasUnknownMetrics
            ? null
            : shiftRows.reduce(
                (total, shift) => total + (shift.breakMinutes ?? 0),
                0,
              ),
          shifts: orderDashboardShifts(shiftRows),
        };
      }),
    );

    return Response.json(
      {
        view,
        customDate: view === "custom" ? customDate : null,
        outlets: dashboardOutlets,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not load the schedule dashboard." },
      { status: 500 },
    );
  }
}
