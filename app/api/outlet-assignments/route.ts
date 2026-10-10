import { auditEvents, outletMemberships, outlets, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

const assignmentSchema = z
  .object({
    managerId: z.string().min(1).max(200),
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
    if (!access?.isSuperAdmin)
      return Response.json(
        { error: "Only admins can assign outlet managers." },
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
        { error: "Manager assignment details are invalid." },
        { status: 400 },
      );

    const db = getDb();
    const [outlet] = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(
        and(eq(outlets.id, parsed.data.outletId), eq(outlets.isActive, true)),
      )
      .limit(1);
    const [manager] = await db
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          eq(user.id, parsed.data.managerId),
          inArray(user.accountType, ["admin", "super_admin"]),
        ),
      )
      .limit(1);
    if (!outlet || !manager)
      return Response.json(
        { error: "Active outlet or manager not found." },
        { status: 404 },
      );

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(outletMemberships)
        .where(
          and(
            eq(outletMemberships.userId, parsed.data.managerId),
            eq(outletMemberships.outletId, parsed.data.outletId),
            eq(outletMemberships.role, "manager"),
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
            userId: parsed.data.managerId,
            outletId: parsed.data.outletId,
            role: "manager",
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
          ? "manager_assigned_to_outlet"
          : "manager_unassigned_from_outlet",
        entityType: "outlet_membership",
        entityId:
          existing?.id ?? `${parsed.data.managerId}:${parsed.data.outletId}`,
        previousValues: { isActive: existing?.isActive ?? false },
        newValues: {
          userId: parsed.data.managerId,
          outletId: parsed.data.outletId,
          role: "manager",
          isActive: parsed.data.assigned,
        },
      });
      return { changed: true, wasActive: parsed.data.assigned };
    });

    return Response.json({ success: true, ...result });
  } catch {
    return Response.json(
      { error: "Could not update the manager assignment." },
      { status: 500 },
    );
  }
}
