import {
  auditEvents,
  outletMemberships,
  staffDeviceEnrollments,
  user,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { deleteProfilePhoto } from "@/lib/profile-photo-storage";
import { canReviewRegistration } from "@/lib/registration-rules";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const registrationActionSchema = z
  .object({ action: z.enum(["approve", "reject"]) })
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
    const parsed = registrationActionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return Response.json(
        { error: "A valid registration action is required." },
        { status: 400 },
      );
    }

    const { id } = await context.params;
    const db = getDb();
    const [target] = await db
      .select({
        id: user.id,
        username: user.username,
        email: user.email,
        approvalStatus: user.approvalStatus,
        registrationOutletId: user.registrationOutletId,
        profilePhotoPath: user.profilePhotoPath,
      })
      .from(user)
      .where(eq(user.id, id))
      .limit(1);

    if (!target || target.approvalStatus !== "pending") {
      return Response.json(
        { error: "Registration not found." },
        { status: 404 },
      );
    }

    const allowed = canReviewRegistration(
      {
        id: session.user.id,
        isSuperAdmin: access.isSuperAdmin,
        outletIds: access.outletIds,
      },
      {
        id: target.id,
        approvalStatus: target.approvalStatus,
        registrationOutletId: target.registrationOutletId,
      },
    );
    if (!allowed) {
      return Response.json(
        { error: "You cannot review this registration." },
        { status: 403 },
      );
    }

    const { action } = parsed.data;
    const now = new Date();

    if (action === "approve") {
      const outletId = target.registrationOutletId;
      if (!outletId) {
        return Response.json(
          { error: "This registration has no outlet to assign." },
          { status: 409 },
        );
      }

      await db.transaction(async (tx) => {
        const [approved] = await tx
          .update(user)
          .set({
            approvalStatus: "approved",
            approvedBy: session.user.id,
            approvedAt: now,
            updatedAt: now,
          })
          .where(
            and(eq(user.id, target.id), eq(user.approvalStatus, "pending")),
          )
          .returning({ id: user.id });
        if (!approved) throw new Error("REGISTRATION_STATE_CONFLICT");

        await tx.insert(outletMemberships).values({
          userId: target.id,
          outletId,
          assignedBy: session.user.id,
        });

        // The device the applicant registered on becomes trusted only now.
        const activatedDevices = await tx
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
              eq(staffDeviceEnrollments.userId, target.id),
              eq(staffDeviceEnrollments.status, "pending"),
            ),
          )
          .returning({ id: staffDeviceEnrollments.id });

        await tx.insert(auditEvents).values({
          actorId: session.user.id,
          action: "registration_approved",
          entityType: "user",
          entityId: target.id,
          newValues: {
            outletId,
            username: target.username,
            activatedDeviceIds: activatedDevices.map((device) => device.id),
          },
        });
      });

      return Response.json({ status: "approved" });
    }

    // Reject: remove the pending account. Device enrollments cascade.
    const [rejected] = await db.transaction(async (tx) => {
      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action: "registration_rejected",
        entityType: "user",
        entityId: target.id,
        newValues: {
          outletId: target.registrationOutletId,
          username: target.username,
          email: target.email,
        },
      });
      return tx
        .delete(user)
        .where(and(eq(user.id, target.id), eq(user.approvalStatus, "pending")))
        .returning({ id: user.id });
    });
    if (!rejected) {
      return Response.json(
        { error: "Registration changed. Refresh and try again." },
        { status: 409 },
      );
    }

    if (target.profilePhotoPath) {
      await deleteProfilePhoto(target.profilePhotoPath).catch(() => undefined);
    }
    return Response.json({ status: "rejected" });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "REGISTRATION_STATE_CONFLICT"
    ) {
      return Response.json(
        { error: "Registration changed. Refresh and try again." },
        { status: 409 },
      );
    }
    return Response.json(
      { error: "Could not update the registration." },
      { status: 500 },
    );
  }
}
