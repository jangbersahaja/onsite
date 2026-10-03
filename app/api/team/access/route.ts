import { auditEvents, outletMemberships, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

const accessSchema = z
  .object({
    userId: z.string().min(1).max(200),
    canAccessClock: z.boolean(),
    canAccessBackoffice: z.boolean(),
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
    const parsed = accessSchema.safeParse(body);
    if (!parsed.success)
      return Response.json(
        { error: "App access details are invalid." },
        { status: 400 },
      );
    if (!parsed.data.canAccessClock && !parsed.data.canAccessBackoffice)
      return Response.json(
        { error: "At least one app access grant is required." },
        { status: 400 },
      );
    if (parsed.data.userId === session.user.id)
      return Response.json(
        { error: "You cannot change your own app access." },
        { status: 403 },
      );

    const db = getDb();
    let managerOutletIds = access.outletIds;
    if (!access.isSuperAdmin) {
      if (!access.isAdmin)
        return Response.json(
          { error: "Only outlet managers can change staff app access." },
          { status: 403 },
        );
      const managerOutlets = await db
        .select({ outletId: outletMemberships.outletId })
        .from(outletMemberships)
        .where(
          and(
            eq(outletMemberships.userId, session.user.id),
            eq(outletMemberships.role, "manager"),
            eq(outletMemberships.isActive, true),
            inArray(outletMemberships.outletId, access.outletIds),
          ),
        );
      managerOutletIds = managerOutlets.map((outlet) => outlet.outletId);
      if (!managerOutletIds.length)
        return Response.json(
          { error: "Only outlet managers can change staff app access." },
          { status: 403 },
        );
    }

    const targetQuery = db
      .select({
        id: user.id,
        canAccessClock: user.canAccessClock,
        canAccessBackoffice: user.canAccessBackoffice,
      })
      .from(user);
    const [target] = access.isSuperAdmin
      ? await targetQuery
          .where(
            and(eq(user.id, parsed.data.userId), eq(user.accountType, "staff")),
          )
          .limit(1)
      : await db
          .select({
            id: user.id,
            canAccessClock: user.canAccessClock,
            canAccessBackoffice: user.canAccessBackoffice,
          })
          .from(outletMemberships)
          .innerJoin(user, eq(outletMemberships.userId, user.id))
          .where(
            and(
              eq(user.id, parsed.data.userId),
              eq(user.accountType, "staff"),
              eq(outletMemberships.isActive, true),
              inArray(outletMemberships.outletId, managerOutletIds),
            ),
          )
          .limit(1);

    if (!target)
      return Response.json(
        { error: "You cannot change access for this team member." },
        { status: 403 },
      );

    if (
      target.canAccessClock === parsed.data.canAccessClock &&
      target.canAccessBackoffice === parsed.data.canAccessBackoffice
    ) {
      return Response.json({ success: true });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(user)
        .set({
          canAccessClock: parsed.data.canAccessClock,
          canAccessBackoffice: parsed.data.canAccessBackoffice,
          updatedAt: new Date(),
        })
        .where(eq(user.id, target.id));
      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action: "team_member_app_access_updated",
        entityType: "user",
        entityId: target.id,
        previousValues: {
          canAccessClock: target.canAccessClock,
          canAccessBackoffice: target.canAccessBackoffice,
        },
        newValues: {
          canAccessClock: parsed.data.canAccessClock,
          canAccessBackoffice: parsed.data.canAccessBackoffice,
        },
      });
    });

    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Could not update app access." },
      { status: 500 },
    );
  }
}
