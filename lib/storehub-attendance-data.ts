import { outletScheduleDate } from "@/lib/dashboard-data";
import type { Employee, Timesheet } from "@pyyupsk/storehub";

export type StoreHubShift = {
  id: string;
  source: "storehub";
  storeHubEmployeeId: string;
  employeeName: string;
  employeeEmail: null;
  outletId: string;
  outletName: string;
  timezone: string;
  clockInAt: string;
  clockOutAt: string | null;
  breaks: { id: string; startedAt: string; endedAt: string }[];
  breakMinutes: number | null;
  workedMinutes: number | null;
  sessionCount: number;
};

type OutletIdentity = {
  id: string;
  name: string;
  timezone: string;
};

export type StoreHubTimesheetFilters = {
  employeeId?: string;
  from?: string;
  to?: string;
};

function normalizeTimestamp(value: unknown): string;
function normalizeTimestamp(value: unknown, allowEmpty: true): string | null;
function normalizeTimestamp(value: unknown, allowEmpty = false) {
  if (allowEmpty && (value === null || value === undefined || value === "")) {
    return null;
  }
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("StoreHub returned an invalid attendance timestamp.");
  }
  return new Date(value).toISOString();
}

export function normalizeStoreHubTimesheets(
  timesheets: readonly Timesheet[],
  employees: readonly Employee[],
  outlet: OutletIdentity,
): StoreHubShift[] {
  const employeeNames = new Map(
    employees.map((employee) => [
      employee.id,
      [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim(),
    ]),
  );
  const uniqueSessions = new Map<
    string,
    {
      storeId: string;
      storeHubEmployeeId: string;
      employeeName: string;
      clockInAt: string;
      clockOutAt: string | null;
    }
  >();
  for (const timesheet of timesheets) {
    const clockInAt = normalizeTimestamp(timesheet.clockInTime);
    const clockOutAt = normalizeTimestamp(timesheet.clockOutTime, true);
    const session = {
      storeId: timesheet.storeId,
      storeHubEmployeeId: timesheet.employeeId,
      employeeName:
        employeeNames.get(timesheet.employeeId) ||
        `StoreHub employee ${timesheet.employeeId}`,
      clockInAt,
      clockOutAt,
    };
    uniqueSessions.set(
      JSON.stringify([
        session.storeId,
        session.storeHubEmployeeId,
        session.clockInAt,
        session.clockOutAt,
      ]),
      session,
    );
  }
  const sessions = Array.from(uniqueSessions.values());

  const groups = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const workDate = outletScheduleDate(session.clockInAt, outlet.timezone);
    const groupId = `${session.storeId}:${session.storeHubEmployeeId}:${workDate}`;
    const group = groups.get(groupId) ?? [];
    group.push(session);
    groups.set(groupId, group);
  }

  return Array.from(groups, ([groupId, group]) => {
    group.sort(
      (first, second) =>
        Date.parse(first.clockInAt) - Date.parse(second.clockInAt),
    );
    const first = group[0];
    const last = group[group.length - 1];
    const breaks: StoreHubShift["breaks"] = [];
    let breakMilliseconds = 0;
    let metricsAreReliable = group.every(
      (session) =>
        session.clockOutAt === null ||
        Date.parse(session.clockOutAt) >= Date.parse(session.clockInAt),
    );

    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const current = group[index];
      if (previous.clockOutAt === null) {
        metricsAreReliable = false;
        continue;
      }
      const gapMilliseconds =
        Date.parse(current.clockInAt) - Date.parse(previous.clockOutAt);
      if (gapMilliseconds < 0) {
        metricsAreReliable = false;
      } else if (gapMilliseconds > 0) {
        breakMilliseconds += gapMilliseconds;
        breaks.push({
          id: `storehub:${encodeURIComponent(groupId)}:break:${index}`,
          startedAt: previous.clockOutAt,
          endedAt: current.clockInAt,
        });
      }
    }

    const grossMilliseconds = last.clockOutAt
      ? Date.parse(last.clockOutAt) - Date.parse(first.clockInAt)
      : null;
    const clockOutAt = last.clockOutAt;
    return {
      id: `storehub:${encodeURIComponent(groupId)}`,
      source: "storehub" as const,
      storeHubEmployeeId: first.storeHubEmployeeId,
      employeeName: first.employeeName,
      employeeEmail: null,
      outletId: outlet.id,
      outletName: outlet.name,
      timezone: outlet.timezone,
      clockInAt: first.clockInAt,
      clockOutAt,
      breaks,
      breakMinutes: metricsAreReliable
        ? Math.floor(breakMilliseconds / 60_000)
        : null,
      workedMinutes:
        metricsAreReliable && grossMilliseconds !== null
          ? Math.max(
              0,
              Math.floor((grossMilliseconds - breakMilliseconds) / 60_000),
            )
          : null,
      sessionCount: group.length,
    };
  });
}

export function filterStoreHubTimesheets(
  rows: readonly StoreHubShift[],
  filters: StoreHubTimesheetFilters,
) {
  return rows.filter((row) => {
    const localDate = outletScheduleDate(row.clockInAt, row.timezone);
    return (
      (!filters.employeeId ||
        filters.employeeId === `storehub:${row.storeHubEmployeeId}`) &&
      (!filters.from || localDate >= filters.from) &&
      (!filters.to || localDate <= filters.to)
    );
  });
}

export function storeHubShiftOverlapsWindow(
  row: StoreHubShift,
  windowStartAt: Date,
  evaluatedAt: Date,
) {
  return (
    new Date(row.clockInAt) < evaluatedAt &&
    (row.clockOutAt === null || new Date(row.clockOutAt) > windowStartAt)
  );
}
