import { invitations, outletMemberships, outlets, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getTeamAccess } from "@/lib/team-access";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";

function unavailable() {
  return Response.json(
    {
      error: "Set DATABASE_URL and BETTER_AUTH_SECRET before managing a team.",
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session)
      return Response.json({ error: "Sign in required." }, { status: 401 });

    const access = await getTeamAccess(session.user.id);
    if (!access)
      return Response.json({ error: "Team access denied." }, { status: 403 });

    if (access.outletIds.length === 0) {
      return Response.json({
        isAdmin: access.isAdmin,
        outlets: [],
        members: [],
        invitations: [],
        managers: [],
        managerAssignments: [],
      });
    }

    const db = getDb();
    const [members, pendingInvitations, managers, managerAssignments] =
      await Promise.all([
        db
          .select({
            userId: user.id,
            name: user.name,
            email: user.email,
            outletId: outlets.id,
            outletName: outlets.name,
            role: outletMemberships.role,
          })
          .from(outletMemberships)
          .innerJoin(user, eq(outletMemberships.userId, user.id))
          .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
          .where(
            and(
              eq(outletMemberships.isActive, true),
              eq(outlets.isActive, true),
              inArray(outletMemberships.outletId, access.outletIds),
            ),
          )
          .orderBy(user.name)
          .limit(200),
        db
          .select({
            id: invitations.id,
            email: invitations.email,
            role: invitations.role,
            outletId: outlets.id,
            outletName: outlets.name,
            expiresAt: invitations.expiresAt,
          })
          .from(invitations)
          .innerJoin(outlets, eq(invitations.outletId, outlets.id))
          .where(
            and(
              inArray(invitations.outletId, access.outletIds),
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
              gt(invitations.expiresAt, new Date()),
            ),
          )
          .orderBy(desc(invitations.createdAt))
          .limit(50),
        access.isAdmin
          ? db
              .selectDistinct({
                id: user.id,
                name: user.name,
                email: user.email,
              })
              .from(outletMemberships)
              .innerJoin(user, eq(outletMemberships.userId, user.id))
              .where(
                and(
                  eq(outletMemberships.role, "manager"),
                  eq(user.globalRole, "member"),
                ),
              )
              .orderBy(user.name)
          : Promise.resolve([]),
        access.isAdmin
          ? db
              .select({
                userId: user.id,
                outletId: outlets.id,
                isActive: outletMemberships.isActive,
              })
              .from(outletMemberships)
              .innerJoin(user, eq(outletMemberships.userId, user.id))
              .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
              .where(
                and(
                  eq(outletMemberships.role, "manager"),
                  eq(user.globalRole, "member"),
                  inArray(outlets.id, access.outletIds),
                ),
              )
          : Promise.resolve([]),
      ]);

    return Response.json({
      isAdmin: access.isAdmin,
      outlets: access.outlets,
      members: members.map((member) => ({
        ...member,
        canReset:
          access.isAdmin ||
          (member.userId !== session.user.id && member.role !== "manager"),
      })),
      invitations: pendingInvitations,
      managers,
      managerAssignments,
    });
  } catch {
    return Response.json(
      { error: "Could not load team data." },
      { status: 500 },
    );
  }
}
