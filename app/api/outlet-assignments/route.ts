import { auditEvents, outletMemberships, outlets, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canManageTargetAccess, getTeamAccess } from "@/lib/team-access";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const assignmentSchema = z
  .object({
    userId: z.string().min(1).max(200),
    outletId: z.string().uuid(),
    assigned: z.boolean(),
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
      return Response.json(
        { error: "Only backoffice users can change outlet assignments." },
        { status: 403 },
      );

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    const parsed = assignmentSchema.safeParse(body);
    if (!parsed.success)
      return Response.json(
        { error: "Outlet assignment details are invalid." },
        { status: 400 },
      );
    if (
      !access.isSuperAdmin &&
      !access.outletIds.includes(parsed.data.outletId)
    )
      return Response.json(
        { error: "You cannot manage this outlet." },
        { status: 403 },
      );

    const db = getDb();
    const [outlet] = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(
        and(eq(outlets.id, parsed.data.outletId), eq(outlets.isActive, true)),
      )
      .limit(1);
    const [target] = await db
      .select({
        id: user.id,
        accountType: user.accountType,
        canAccessBackoffice: user.canAccessBackoffice,
      })
      .from(user)
      .where(eq(user.id, parsed.data.userId))
      .limit(1);
    if (!outlet || !target)
      return Response.json(
        { error: "Active outlet or user not found." },
        { status: 404 },
      );
    // The outlet being changed is already inside the actor's scope, so the
    // target is treated as sharing an outlet with the actor.
    if (
      !canManageTargetAccess(
        { id: session.user.id, isSuperAdmin: access.isSuperAdmin },
        target,
        true,
      )
    )
      return Response.json(
        { error: "You cannot change outlet assignments for this user." },
        { status: 403 },
      );

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(outletMemberships)
        .where(
          and(
            eq(outletMemberships.userId, parsed.data.userId),
            eq(outletMemberships.outletId, parsed.data.outletId),
          ),
        )
        .limit(1);

      if (parsed.data.assigned) {
        if (existing?.isActive) return { changed: false, wasActive: true };
        if (existing) {
          await tx
            .update(outletMemberships)
            .set({ isActive: true, assignedBy: session.user.id })
            .where(eq(outletMemberships.id, existing.id));
        } else {
          await tx.insert(outletMemberships).values({
            userId: parsed.data.userId,
            outletId: parsed.data.outletId,
            assignedBy: session.user.id,
          });
        }
      } else {
        if (!existing?.isActive) return { changed: false, wasActive: false };
        await tx
          .update(outletMemberships)
          .set({ isActive: false })
          .where(eq(outletMemberships.id, existing.id));
      }

      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action: parsed.data.assigned
          ? "user_assigned_to_outlet"
          : "user_unassigned_from_outlet",
        entityType: "outlet_membership",
        entityId:
          existing?.id ?? `${parsed.data.userId}:${parsed.data.outletId}`,
        previousValues: { isActive: existing?.isActive ?? false },
        newValues: {
          userId: parsed.data.userId,
          outletId: parsed.data.outletId,
          isActive: parsed.data.assigned,
        },
      });
      return { changed: true, wasActive: parsed.data.assigned };
    });

    return Response.json({ success: true, ...result });
  } catch {
    return Response.json(
      { error: "Could not update the outlet assignment." },
      { status: 500 },
    );
  }
}
