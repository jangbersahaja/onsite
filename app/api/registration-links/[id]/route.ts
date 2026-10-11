import { registrationLinks } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canManageOutletRegistration } from "@/lib/registration-rules";
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
    if (!session) {
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }
    const access = await getTeamAccess(session.user.id);
    if (!access) {
      return Response.json({ error: "Team access denied." }, { status: 403 });
    }

    const { id } = await context.params;
    const db = getDb();
    const [link] = await db
      .select({
        id: registrationLinks.id,
        outletId: registrationLinks.outletId,
      })
      .from(registrationLinks)
      .where(
        and(eq(registrationLinks.id, id), isNull(registrationLinks.revokedAt)),
      )
      .limit(1);
    if (!link) {
      return Response.json(
        { error: "Registration link not found." },
        { status: 404 },
      );
    }
    if (
      !canManageOutletRegistration(
        {
          id: session.user.id,
          isSuperAdmin: access.isSuperAdmin,
          outletIds: access.outletIds,
        },
        link.outletId,
      )
    ) {
      return Response.json(
        { error: "You cannot manage registration for this outlet." },
        { status: 403 },
      );
    }

    const now = new Date();
    const revoked = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(registrationLinks)
        .set({ revokedAt: now })
        .where(
          and(
            eq(registrationLinks.id, link.id),
            isNull(registrationLinks.revokedAt),
          ),
        )
        .returning({ id: registrationLinks.id });
      if (!updated) return false;
      await recordAudit(tx, {
        actorId: session.user.id,
        action: "registration_link_revoked",
        entityType: "registration_link",
        entityId: link.id,
        outletId: link.outletId,
        newValues: { outletId: link.outletId },
      });
      return true;
    });

    if (!revoked) {
      return Response.json(
        { error: "Registration link was already revoked." },
        { status: 409 },
      );
    }
    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Could not revoke the registration link." },
      { status: 500 },
    );
  }
}
