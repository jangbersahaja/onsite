import {
  outletMemberships,
  outlets,
  staffDeviceEnrollments,
  user,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStoreHubLinkSummaries } from "@/lib/storehub-connections";
import { canManageTargetAccess, getTeamAccess } from "@/lib/team-access";
import { and, eq, inArray } from "drizzle-orm";

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

    const requestedOutletId = new URL(request.url).searchParams.get("outletId");
    if (requestedOutletId && !access.outletIds.includes(requestedOutletId)) {
      return Response.json(
        { error: "You cannot access this outlet." },
        { status: 403 },
      );
    }
    const visibleOutletIds = requestedOutletId
      ? [requestedOutletId]
      : access.outletIds;

    const db = getDb();
    const [members, backofficeUsers, backofficeAssignments] = await Promise.all(
      [
        db
          .select({
            userId: user.id,
            name: user.name,
            email: user.email,
            username: user.username,
            accountType: user.accountType,
            canAccessClock: user.canAccessClock,
            canAccessBackoffice: user.canAccessBackoffice,
            profilePhotoPath: user.profilePhotoPath,
            outletId: outlets.id,
            outletName: outlets.name,
          })
          .from(outletMemberships)
          .innerJoin(user, eq(outletMemberships.userId, user.id))
          .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
          .where(
            and(
              eq(outletMemberships.isActive, true),
              eq(outlets.isActive, true),
              inArray(outletMemberships.outletId, visibleOutletIds),
            ),
          )
          .orderBy(user.name)
          .limit(200),
        access.isSuperAdmin
          ? db
              .selectDistinct({
                id: user.id,
                name: user.name,
                email: user.email,
              })
              .from(user)
              .where(
                and(
                  eq(user.accountType, "user"),
                  eq(user.canAccessBackoffice, true),
                ),
              )
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
                  eq(user.accountType, "user"),
                  eq(user.canAccessBackoffice, true),
                  inArray(outlets.id, visibleOutletIds),
                ),
              )
          : Promise.resolve([]),
      ],
    );

    const staffUserIds = Array.from(
      new Set(
        members
          .filter((member) => member.canAccessClock)
          .map((member) => member.userId),
      ),
    );
    const staffDevices = staffUserIds.length
      ? await db
          .select({
            id: staffDeviceEnrollments.id,
            userId: staffDeviceEnrollments.userId,
            status: staffDeviceEnrollments.status,
            deviceName: staffDeviceEnrollments.deviceName,
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

    const actor = {
      id: session.user.id,
      isSuperAdmin: access.isSuperAdmin,
    };

    const storeHubLinks = access.isSuperAdmin
      ? await getStoreHubLinkSummaries(access.outletIds)
      : null;

    return Response.json({
      isSuperAdmin: access.isSuperAdmin,
      outlets: access.outlets.map((outlet) =>
        storeHubLinks
          ? { ...outlet, storeHub: storeHubLinks.get(outlet.id) ?? null }
          : outlet,
      ),
      members: members.map((member) => {
        const canManage = canManageTargetAccess(
          actor,
          {
            id: member.userId,
            accountType: member.accountType,
            canAccessBackoffice: member.canAccessBackoffice,
          },
          true,
        );
        const { profilePhotoPath, ...publicMember } = member;
        return {
          ...publicMember,
          profilePhotoUrl: profilePhotoPath
            ? `/api/profile-photos/${encodeURIComponent(member.userId)}`
            : null,
          canManageAccess: canManage,
          canReset: canManage,
        };
      }),
      backofficeUsers,
      backofficeAssignments,
      staffDevices,
    });
  } catch {
    return Response.json(
      { error: "Could not load team data." },
      { status: 500 },
    );
  }
}
