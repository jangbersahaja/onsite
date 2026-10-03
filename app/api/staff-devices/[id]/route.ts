import {
  auditEvents,
  outletMemberships,
  outlets,
  staffDeviceEnrollments,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

const deviceActionSchema = z
  .object({ action: z.enum(["approve", "reject", "revoke"]) })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
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
    if (!session) {
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }

    const access = await getTeamAccess(session.user.id);
    if (!access) {
      return Response.json({ error: "Team access denied." }, { status: 403 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    const parsed = deviceActionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return Response.json(
        { error: "A valid device action is required." },
        { status: 400 },
      );
    }

    const { id } = await context.params;
    const db = getDb();
    const authorizedConditions = [
      eq(staffDeviceEnrollments.id, id),
      eq(outletMemberships.role, "staff"),
      eq(outletMemberships.isActive, true),
      eq(outlets.isActive, true),
    ];
    if (!access.isAdmin) {
      if (!access.outletIds.length) {
        return Response.json(
          { error: "You cannot manage this device." },
          { status: 403 },
        );
      }
      authorizedConditions.push(
        inArray(outletMemberships.outletId, access.outletIds),
      );
    }

    const [target] = await db
      .select({
        id: staffDeviceEnrollments.id,
        userId: staffDeviceEnrollments.userId,
        status: staffDeviceEnrollments.status,
      })
      .from(staffDeviceEnrollments)
      .innerJoin(
        outletMemberships,
        eq(staffDeviceEnrollments.userId, outletMemberships.userId),
      )
      .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
      .where(and(...authorizedConditions))
      .limit(1);

    if (!target) {
      return Response.json(
        { error: "You cannot manage this device." },
        { status: 403 },
      );
    }
    if (target.userId === session.user.id) {
      return Response.json(
        { error: "You cannot manage your own trusted device." },
        { status: 403 },
      );
    }

    const { action } = parsed.data;
    if (action === "approve" && target.status !== "pending") {
      return Response.json(
        { error: "Only pending devices can be approved." },
        { status: 409 },
      );
    }
    if (action === "reject" && target.status !== "pending") {
      return Response.json(
        { error: "Only pending devices can be rejected." },
        { status: 409 },
      );
    }
    if (action === "revoke" && target.status !== "active") {
      return Response.json(
        { error: "Only active devices can be revoked." },
        { status: 409 },
      );
    }

    const now = new Date();
    const result = await db.transaction(async (tx) => {
      if (action === "approve") {
        const revoked = await tx
          .update(staffDeviceEnrollments)
          .set({ status: "revoked", revokedAt: now, updatedAt: now })
          .where(
            and(
              eq(staffDeviceEnrollments.userId, target.userId),
              eq(staffDeviceEnrollments.status, "active"),
            ),
          )
          .returning({ id: staffDeviceEnrollments.id });

        const [approved] = await tx
          .update(staffDeviceEnrollments)
          .set({
            status: "active",
            approvedBy: session.user.id,
            approvedAt: now,
            revokedAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(staffDeviceEnrollments.id, target.id),
              eq(staffDeviceEnrollments.status, "pending"),
            ),
          )
          .returning({ id: staffDeviceEnrollments.id });

        if (!approved) throw new Error("STAFF_DEVICE_STATE_CONFLICT");

        for (const previousDevice of revoked) {
          await tx.insert(auditEvents).values({
            actorId: session.user.id,
            action: "staff_device_revoked",
            entityType: "staff_device_enrollment",
            entityId: previousDevice.id,
            newValues: { userId: target.userId, replacementId: target.id },
          });
        }
        await tx.insert(auditEvents).values({
          actorId: session.user.id,
          action: "staff_device_enrollment_approved",
          entityType: "staff_device_enrollment",
          entityId: target.id,
          newValues: { userId: target.userId },
        });
        return { status: "active" as const };
      }

      const [revoked] = await tx
        .update(staffDeviceEnrollments)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(staffDeviceEnrollments.id, target.id),
            eq(staffDeviceEnrollments.status, target.status),
          ),
        )
        .returning({ id: staffDeviceEnrollments.id });
      if (!revoked) throw new Error("STAFF_DEVICE_STATE_CONFLICT");

      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action:
          action === "reject"
            ? "staff_device_enrollment_rejected"
            : "staff_device_revoked",
        entityType: "staff_device_enrollment",
        entityId: target.id,
        newValues: { userId: target.userId },
      });
      return { status: "revoked" as const };
    });

    return Response.json(result);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "STAFF_DEVICE_STATE_CONFLICT"
    ) {
      return Response.json(
        { error: "Device status changed. Refresh and try again." },
        { status: 409 },
      );
    }
    return Response.json(
      { error: "Could not update the trusted device." },
      { status: 500 },
    );
  }
}
