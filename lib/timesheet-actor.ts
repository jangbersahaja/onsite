import { outlets } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { outletPhotoUrl } from "@/lib/outlet-photo";
import { getTeamAccess } from "@/lib/team-access";

/** Resolves the signed-in user's timesheet access and visible outlets. */
export async function getActor(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return { error: "Sign in required.", status: 401 as const };
  const access = await getTeamAccess(session.user.id);
  if (!access) {
    return {
      error: "Timesheet access is not available.",
      status: 403 as const,
    };
  }
  const outletsForAccess = access.isSuperAdmin
    ? (
        await getDb()
          .select({
            id: outlets.id,
            name: outlets.name,
            address: outlets.address,
            timezone: outlets.timezone,
            isActive: outlets.isActive,
            imagePath: outlets.imagePath,
          })
          .from(outlets)
      ).map(({ imagePath, ...outlet }) => ({
        ...outlet,
        imageUrl: outletPhotoUrl(outlet.id, imagePath),
      }))
    : access.outlets.map((outlet) => ({ ...outlet, isActive: true }));
  if (!outletsForAccess.length) {
    return {
      error: "Timesheet access is not available.",
      status: 403 as const,
    };
  }
  return {
    userId: session.user.id,
    access,
    outlets: outletsForAccess,
    outletIds: outletsForAccess.map((outlet) => outlet.id),
  };
}
