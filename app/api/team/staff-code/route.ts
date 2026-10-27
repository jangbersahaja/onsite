import { outletMemberships, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeStaffCode, staffCodeKey } from "@/lib/staff-code";
import { canManageTargetAccess, getTeamAccess } from "@/lib/team-access";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

const staffCodeSchema = z
  .object({
    userId: z.string().min(1).max(200),
    staffCode: z.string().max(100).nullable(),
  })
  .strict();

export async function PATCH(request: Request) {
  if (!hasServerConfiguration()) {
    return Response.json(
      { error: "Authentication is not configured." },
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
      return Response.json({ error: "Team access denied." }, { status: 403 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    const parsed = staffCodeSchema.safeParse(body);
    if (!parsed.success)
      return Response.json(
        { error: "Staff code details are invalid." },
        { status: 400 },
      );

    const normalized = normalizeStaffCode(parsed.data.staffCode);
    if ("error" in normalized)
      return Response.json({ error: normalized.error }, { status: 400 });
    const nextCode = normalized.value;

    const db = getDb();
    const [target] = await db
      .select({
        id: user.id,
        username: user.username,
        accountType: user.accountType,
        canAccessBackoffice: user.canAccessBackoffice,
        staffCode: user.staffCode,
      })
      .from(user)
      .where(eq(user.id, parsed.data.userId))
      .limit(1);

    let sharesOutlet = access.isSuperAdmin;
    if (target && !access.isSuperAdmin) {
      const sharedOutlets = await db
        .select({ outletId: outletMemberships.outletId })
        .from(outletMemberships)
        .where(
          and(
            eq(outletMemberships.userId, target.id),
            eq(outletMemberships.isActive, true),
            inArray(outletMemberships.outletId, access.outletIds),
          ),
        )
        .limit(1);
      sharesOutlet = sharedOutlets.length > 0;
    }

    if (
      !target ||
      !canManageTargetAccess(
        { id: session.user.id, isSuperAdmin: access.isSuperAdmin },
        target,
        sharesOutlet,
      )
    )
      return Response.json(
        { error: "You cannot change the staff code for this team member." },
        { status: 403 },
      );

    if ((target.staffCode ?? null) === nextCode)
      return Response.json({ success: true, staffCode: nextCode });

    if (nextCode) {
      const [clash] = await db
        .select({ id: user.id })
        .from(user)
        .where(
          and(
            sql`lower(${user.staffCode}) = ${staffCodeKey(nextCode)}`,
            sql`${user.id} <> ${target.id}`,
          ),
        )
        .limit(1);
      if (clash)
        return Response.json(
          { error: "Another team member already uses this staff code." },
          { status: 409 },
        );
    }

    try {
      await db.transaction(async (tx) => {
        await tx
          .update(user)
          .set({ staffCode: nextCode, updatedAt: new Date() })
          .where(eq(user.id, target.id));
        await recordAudit(tx, {
          actorId: session.user.id,
          action: "staff_code_updated",
          entityType: "user",
          entityId: target.id,
          previousValues: { staffCode: target.staffCode ?? null },
          newValues: { staffCode: nextCode },
        });
      });
    } catch (error) {
      // The partial unique index is the final guard against a race.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        return Response.json(
          { error: "Another team member already uses this staff code." },
          { status: 409 },
        );
      }
      throw error;
    }

    return Response.json({ success: true, staffCode: nextCode });
  } catch {
    return Response.json(
      { error: "Could not update the staff code." },
      { status: 500 },
    );
  }
}
