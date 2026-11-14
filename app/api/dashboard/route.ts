import { scheduledShifts, user, workBreaks, workSessions } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import {
  addCalendarDays,
  getDashboardShiftMetrics,
  getDashboardShiftStatus,
  getScheduleWindow,
  groupDashboardSessions,
  orderDashboardShifts,
  outletScheduleDate,
  scheduledRowStatus,
} from "@/lib/dashboard-data";
import { getDb } from "@/lib/db";
import { formatOutletTimestamp, isDateOnly } from "@/lib/outlet-time";
import type { AttendanceFlag } from "@/lib/schedule-rules";
import { evaluateAttendance } from "@/lib/schedule-rules";
import { getStoreHubAttendance } from "@/lib/storehub-attendance";
import { storeHubShiftOverlapsWindow } from "@/lib/storehub-attendance-data";
import { getTeamAccess } from "@/lib/team-access";
import { getCompletedBreakMinutes } from "@/lib/work-breaks";
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
        const [shifts, storeHubAttendance, scheduleRows] = await Promise.all([
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
          db
            .select({
              id: scheduledShifts.id,
              userId: user.id,
              employeeName: user.name,
              profilePhotoPath: user.profilePhotoPath,
              startAt: scheduledShifts.startAt,
              endAt: scheduledShifts.endAt,
              breakMinutes: scheduledShifts.breakMinutes,
            })
            .from(scheduledShifts)
            .innerJoin(user, eq(scheduledShifts.userId, user.id))
            .where(
              and(
                eq(scheduledShifts.outletId, outlet.id),
                eq(scheduledShifts.shiftDate, date),
                eq(scheduledShifts.status, "published"),
              ),
            )
            .orderBy(asc(scheduledShifts.startAt)),
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
        const attendance = evaluateAttendance(
          scheduleRows.map((row) => ({
            id: row.id,
            userId: row.userId,
            startAt: row.startAt,
            endAt: row.endAt,
            breakMinutes: row.breakMinutes,
          })),
          shifts.map((shift) => ({
            id: shift.id,
            userId: shift.userId,
            clockInAt: shift.clockInAt,
            clockOutAt: shift.clockOutAt,
            workedMinutes: null,
            completedBreakMinutes: getCompletedBreakMinutes(
              breaks.filter((item) => item.workSessionId === shift.id),
            ),
          })),
          evaluatedAt,
        );
        const hasSchedule = scheduleRows.length > 0;
        const unscheduledIds = new Set(
          attendance.unscheduled.map((session) => session.id),
        );
        const scheduleSessionLinks = new Map<
          string,
          { startAt: Date; endAt: Date; flags: AttendanceFlag[] }
        >();
        for (const row of scheduleRows) {
          const result = attendance.results.get(row.id);
          const firstSessionId = result?.sessionIds[0];
          if (result && firstSessionId) {
            scheduleSessionLinks.set(firstSessionId, {
              startAt: row.startAt,
              endAt: row.endAt,
              flags: result.flags,
            });
          }
        }
        const scheduledOnlyRows = scheduleRows
          .filter(
            (row) => attendance.results.get(row.id)?.sessionIds.length === 0,
          )
          .map((row) => {
            const result = attendance.results.get(row.id)!;
            return {
              id: `scheduled-${row.id}`,
              source: "scheduled" as const,
              userId: row.userId,
              employeeName: row.employeeName,
              profilePhotoUrl: row.profilePhotoPath
                ? `/api/profile-photos/${encodeURIComponent(row.userId)}`
                : null,
              clockInAt: null,
              clockOutAt: null,
              clockInLocal: null,
              clockOutLocal: null,
              status: scheduledRowStatus(result.status),
              workedMinutes: 0,
              breakMinutes: 0,
              breaks: [],
              schedules: [
                {
                  startAt: row.startAt,
                  endAt: row.endAt,
                  flags: result.flags,
                },
              ],
              sessions: [],
              unscheduled: false,
            };
          });
        const sessionRows = shifts.map((shift) => {
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
            schedule: scheduleSessionLinks.get(shift.id) ?? null,
            unscheduled: hasSchedule && unscheduledIds.has(shift.id),
          };
        });
        const onsiteShiftRows = groupDashboardSessions(sessionRows).map(
          (row) => ({ ...row, source: "onsite" as const }),
        );
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
                    schedules: [],
                    sessions: [
                      {
                        id: shift.id,
                        clockInAt: shift.clockInAt,
                        clockOutAt: shift.clockOutAt,
                        clockInLocal: formatOutletTimestamp(
                          shift.clockInAt,
                          outlet.timezone,
                        ),
                        clockOutLocal: shift.clockOutAt
                          ? formatOutletTimestamp(
                              shift.clockOutAt,
                              outlet.timezone,
                            )
                          : null,
                        status: getDashboardShiftStatus(
                          shift.clockInAt,
                          shift.clockOutAt,
                          shift.breaks,
                          evaluatedAt,
                        ),
                        unscheduled: false,
                      },
                    ],
                    unscheduled: false,
                  };
                })
            : [];
        const shiftRows = [
          ...onsiteShiftRows,
          ...storeHubShiftRows,
          ...scheduledOnlyRows,
        ];
        const hasUnknownMetrics = storeHubShiftRows.some(
          (shift) => shift.breakMinutes === null,
        );

        return {
          id: outlet.id,
          name: outlet.name,
          address: outlet.address,
          timezone: outlet.timezone,
          imageUrl: outlet.imageUrl ?? null,
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
