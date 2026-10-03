import { auditEvents, invitationOutlets, invitations } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq, isNull } from "drizzle-orm";

export async function DELETE(
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
    if (!session)
      return Response.json({ error: "Sign in required." }, { status: 401 });

    const { id } = await context.params;
    const access = await getTeamAccess(session.user.id);
    if (!access)
      return Response.json({ error: "Team access denied." }, { status: 403 });

    const db = getDb();
    const [invitation] = await db
      .select({ id: invitations.id, outletId: invitations.outletId })
      .from(invitations)
      .where(eq(invitations.id, id))
      .limit(1);
    const linkedOutlets = invitation
      ? await db
          .select({ outletId: invitationOutlets.outletId })
          .from(invitationOutlets)
          .where(eq(invitationOutlets.invitationId, invitation.id))
      : [];
    const outletIds = Array.from(
      new Set([
        ...linkedOutlets.map((outlet) => outlet.outletId),
        ...(invitation?.outletId ? [invitation.outletId] : []),
      ]),
    );
    if (
      !invitation ||
      (!access.isSuperAdmin &&
        (!outletIds.length || !outletIds.every((outletId) => access.outletIds.includes(outletId))))
    ) {
      return Response.json({ error: "Invitation not found." }, { status: 404 });
    }

    const revokedAt = new Date();
    const [revoked] = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(invitations)
        .set({ revokedAt, claimedAt: null })
        .where(
          and(
            eq(invitations.id, invitation.id),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        )
        .returning({ id: invitations.id });

      if (updated) {
        await tx.insert(auditEvents).values({
          actorId: session.user.id,
          action: "invitation_revoked",
          entityType: "invitation",
          entityId: updated.id,
          newValues: { revokedAt: revokedAt.toISOString() },
        });
      }
      return [updated];
    });

    if (!revoked) {
      return Response.json(
        { error: "Invitation was already accepted or revoked." },
        { status: 409 },
      );
    }

    return Response.json({ revoked: true });
  } catch {
    return Response.json(
      { error: "Could not revoke this invitation." },
      { status: 500 },
    );
  }
}
