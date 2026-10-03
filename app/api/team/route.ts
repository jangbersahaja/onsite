import {
  invitationOutlets,
  invitations,
  outletMemberships,
  outlets,
  staffDeviceEnrollments,
  user,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getTeamAccess } from "@/lib/team-access";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";

function unavailable() {
  return Response.json(
    {
      error: "Set DATABASE_URL before managing a team.",
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

    const db = getDb();
    const [members, invitationRows, managers, managerAssignments] =
      await Promise.all([
        db
          .select({
            userId: user.id,
            name: user.name,
            email: user.email,
            username: user.username,
            accountType: user.accountType,
            canAccessClock: user.canAccessClock,
            canAccessBackoffice: user.canAccessBackoffice,
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
            accountType: invitations.accountType,
            canAccessClock: invitations.canAccessClock,
            canAccessBackoffice: invitations.canAccessBackoffice,
            role: invitations.role,
            outletId: invitationOutlets.outletId,
            outletName: outlets.name,
            expiresAt: invitations.expiresAt,
          })
          .from(invitations)
          .leftJoin(
            invitationOutlets,
            eq(invitationOutlets.invitationId, invitations.id),
          )
          .leftJoin(outlets, eq(invitationOutlets.outletId, outlets.id))
          .where(
            and(
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
              gt(invitations.expiresAt, new Date()),
            ),
          )
          .orderBy(desc(invitations.createdAt))
          .limit(300),
        access.isSuperAdmin
          ? db
              .selectDistinct({
                id: user.id,
                name: user.name,
                email: user.email,
              })
              .from(user)
              .where(eq(user.accountType, "admin"))
              .orderBy(user.name)
          : Promise.resolve([]),
        access.isSuperAdmin
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
                  eq(user.accountType, "admin"),
                  inArray(outlets.id, access.outletIds),
                ),
              )
          : Promise.resolve([]),
      ]);

    const invitationMap = new Map<
      string,
      {
        id: string;
        email: string;
        accountType: "super_admin" | "admin" | "staff";
        canAccessClock: boolean;
        canAccessBackoffice: boolean;
        role: "manager" | "supervisor" | "staff";
        outletIds: string[];
        outletNames: string[];
        expiresAt: Date;
      }
    >();
    for (const row of invitationRows) {
      const invitation = invitationMap.get(row.id) ?? {
        id: row.id,
        email: row.email,
        accountType: row.accountType,
        canAccessClock: row.canAccessClock,
        canAccessBackoffice: row.canAccessBackoffice,
        role: row.role,
        outletIds: [],
        outletNames: [],
        expiresAt: row.expiresAt,
      };
      if (row.outletId && !invitation.outletIds.includes(row.outletId)) {
        invitation.outletIds.push(row.outletId);
        if (row.outletName) invitation.outletNames.push(row.outletName);
      }
      invitationMap.set(row.id, invitation);
    }
    const pendingInvitations = Array.from(invitationMap.values()).filter(
      (invitation) =>
        access.isSuperAdmin ||
        (invitation.outletIds.length > 0 &&
          invitation.outletIds.every((outletId) => access.outletIds.includes(outletId))),
    );

    const staffUserIds = Array.from(
      new Set(
        members
          .filter((member) => member.role === "staff")
          .map((member) => member.userId),
      ),
    );
    const staffDevices = staffUserIds.length
      ? await db
          .select({
            id: staffDeviceEnrollments.id,
            userId: staffDeviceEnrollments.userId,
            status: staffDeviceEnrollments.status,
            createdAt: staffDeviceEnrollments.createdAt,
            approvedAt: staffDeviceEnrollments.approvedAt,
          })
          .from(staffDeviceEnrollments)
          .where(
            and(
              inArray(staffDeviceEnrollments.userId, staffUserIds),
              inArray(staffDeviceEnrollments.status, ["pending", "active"]),
            ),
          )
      : [];

    return Response.json({
      isAdmin: access.isAdmin,
      isSuperAdmin: access.isSuperAdmin,
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
      staffDevices,
    });
  } catch {
    return Response.json(
      { error: "Could not load team data." },
      { status: 500 },
    );
  }
}
