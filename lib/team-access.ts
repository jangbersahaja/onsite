import { outletMemberships, outlets, user } from "@/db/schema";
import { getDb } from "@/lib/db";
import { and, eq } from "drizzle-orm";

export async function getTeamAccess(userId: string) {
  const db = getDb();
  const [actor] = await db
    .select({
      accountType: user.accountType,
      canAccessBackoffice: user.canAccessBackoffice,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!actor || !actor.canAccessBackoffice) return null;

  const isSuperAdmin = actor.accountType === "super_admin";
  const isAdmin = actor.accountType === "admin" || isSuperAdmin;
  const manageableOutlets = isSuperAdmin
    ? await db
        .select({
          id: outlets.id,
          name: outlets.name,
          address: outlets.address,
          latitude: outlets.latitude,
          longitude: outlets.longitude,
          radiusMeters: outlets.radiusMeters,
          timezone: outlets.timezone,
        })
        .from(outlets)
        .where(eq(outlets.isActive, true))
    : await db
        .select({
          id: outlets.id,
          name: outlets.name,
          address: outlets.address,
          latitude: outlets.latitude,
          longitude: outlets.longitude,
          radiusMeters: outlets.radiusMeters,
          timezone: outlets.timezone,
        })
        .from(outletMemberships)
        .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
        .where(
          and(
            eq(outletMemberships.userId, userId),
            eq(outletMemberships.isActive, true),
            eq(outlets.isActive, true),
          ),
        );

  return {
    isAdmin,
    isSuperAdmin,
    outlets: manageableOutlets,
    outletIds: manageableOutlets.map((outlet) => outlet.id),
  };
}
