import { outlets, user, workSessions } from "@/db/schema";
import { getDb } from "@/lib/db";
import { isDateOnly } from "@/lib/outlet-time";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

export type TimesheetFilters = {
  outletId?: string;
  employeeId?: string;
  from?: string;
  to?: string;
};

const filtersSchema = z.object({
  outletId: z.string().uuid().optional(),
  employeeId: z.string().min(1).max(200).optional(),
  from: z.string().refine(isDateOnly).optional(),
  to: z.string().refine(isDateOnly).optional(),
});

export function parseTimesheetFilters(params: URLSearchParams) {
  const parsed = filtersSchema.safeParse({
    outletId: params.get("outletId") || undefined,
    employeeId: params.get("employeeId") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
  });
  if (!parsed.success) return { success: false as const };
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    return { success: false as const };
  }
  return { success: true as const, data: parsed.data };
}

export async function getTimesheetRows(
  outletIds: string[],
  filters: TimesheetFilters,
) {
  if (!outletIds.length) return [];
  const conditions = [inArray(workSessions.outletId, outletIds)];
  if (filters.outletId) {
    conditions.push(eq(workSessions.outletId, filters.outletId));
  }
  if (filters.employeeId) {
    conditions.push(eq(workSessions.userId, filters.employeeId));
  }
  if (filters.from) {
    conditions.push(
      sql`(${workSessions.clockInAt} AT TIME ZONE ${workSessions.timezone})::date >= ${filters.from}::date`,
    );
  }
  if (filters.to) {
    conditions.push(
      sql`(${workSessions.clockInAt} AT TIME ZONE ${workSessions.timezone})::date <= ${filters.to}::date`,
    );
  }

  return getDb()
    .select({
      id: workSessions.id,
      userId: user.id,
      employeeName: user.name,
      employeeEmail: user.email,
      outletId: outlets.id,
      outletName: outlets.name,
      timezone: workSessions.timezone,
      clockInAt: workSessions.clockInAt,
      clockOutAt: workSessions.clockOutAt,
      clockInLatitude: workSessions.clockInLatitude,
      clockInLongitude: workSessions.clockInLongitude,
      clockInAccuracy: workSessions.clockInAccuracy,
      clockInSource: workSessions.clockInSource,
      clockOutLatitude: workSessions.clockOutLatitude,
      clockOutLongitude: workSessions.clockOutLongitude,
      clockOutAccuracy: workSessions.clockOutAccuracy,
      clockOutSource: workSessions.clockOutSource,
    })
    .from(workSessions)
    .innerJoin(user, eq(workSessions.userId, user.id))
    .innerJoin(outlets, eq(workSessions.outletId, outlets.id))
    .where(and(...conditions))
    .orderBy(desc(workSessions.clockInAt))
    .limit(500);
}
