import { auditEvents, outlets } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { describeAuditEvent, isAuditAction } from "@/lib/audit-events";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getTeamAccess } from "@/lib/team-access";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  or,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const outletIdSchema = z.uuid();
const actorIdSchema = z.string().min(1).max(200);

function parseInstant(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  if (!hasServerConfiguration()) {
    return Response.json(
      { error: "Set DATABASE_URL before loading activity." },
      { status: 503 },
    );
  }

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session)
      return Response.json({ error: "Sign in required." }, { status: 401 });

    const access = await getTeamAccess(session.user.id);
    if (!access)
      return Response.json(
        { error: "Activity access denied." },
        { status: 403 },
      );

    const params = new URL(request.url).searchParams;
    const conditions: SQL[] = [];

    // Super admins see every event. Backoffice users see events at their
    // outlets plus their own actions wherever they happened.
    if (!access.isSuperAdmin) {
      const ownEvents = eq(auditEvents.actorId, session.user.id);
      const visibility =
        access.outletIds.length > 0
          ? or(ownEvents, inArray(auditEvents.outletId, access.outletIds))
          : ownEvents;
      if (visibility) conditions.push(visibility);
    }

    const outletParam = params.get("outletId");
    if (outletParam) {
      const outletId = outletIdSchema.safeParse(outletParam);
      if (!outletId.success)
        return Response.json(
          { error: "Choose a valid outlet." },
          { status: 400 },
        );
      if (!access.isSuperAdmin && !access.outletIds.includes(outletId.data))
        return Response.json(
          { error: "You cannot view activity for this outlet." },
          { status: 403 },
        );
      conditions.push(eq(auditEvents.outletId, outletId.data));
    }

    const actorParam = params.get("actorId");
    if (actorParam) {
      const actorId = actorIdSchema.safeParse(actorParam);
      if (!actorId.success)
        return Response.json(
          { error: "Choose a valid team member." },
          { status: 400 },
        );
      conditions.push(eq(auditEvents.actorId, actorId.data));
    }

    const actionParam = params.get("action");
    if (actionParam) {
      if (!isAuditAction(actionParam))
        return Response.json(
          { error: "Choose a valid activity type." },
          { status: 400 },
        );
      conditions.push(eq(auditEvents.action, actionParam));
    }

    const fromParam = params.get("from");
    const toParam = params.get("to");
    const beforeParam = params.get("before");
    const from = parseInstant(fromParam);
    const to = parseInstant(toParam);
    const before = parseInstant(beforeParam);
    if ((fromParam && !from) || (toParam && !to) || (beforeParam && !before)) {
      return Response.json(
        { error: "Choose a valid date range." },
        { status: 400 },
      );
    }
    if (from) conditions.push(gte(auditEvents.createdAt, from));
    if (to) conditions.push(lte(auditEvents.createdAt, to));
    if (before) conditions.push(lt(auditEvents.createdAt, before));

    const requestedLimit = Number(params.get("limit") ?? DEFAULT_LIMIT);
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const rows = await getDb()
      .select({
        id: auditEvents.id,
        createdAt: auditEvents.createdAt,
        action: auditEvents.action,
        actorId: auditEvents.actorId,
        actorName: auditEvents.actorName,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        outletId: auditEvents.outletId,
        outletName: outlets.name,
        newValues: auditEvents.newValues,
        reason: auditEvents.reason,
      })
      .from(auditEvents)
      .leftJoin(outlets, eq(auditEvents.outletId, outlets.id))
      .where(and(...conditions))
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const events = page.map(({ newValues, ...row }) => ({
      ...row,
      description: describeAuditEvent({
        action: row.action,
        actorName: row.actorName,
        outletName: row.outletName,
        newValues,
      }),
    }));
    const last = page.at(-1);

    return Response.json(
      {
        events,
        nextBefore: hasMore && last ? last.createdAt.toISOString() : null,
        outlets: access.outlets.map((outlet) => ({
          id: outlet.id,
          name: outlet.name,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not load activity." },
      { status: 500 },
    );
  }
}
