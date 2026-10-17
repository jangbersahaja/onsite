import { outletMemberships, superAdminOutletNotifications } from "@/db/schema";
import { getDb } from "@/lib/db";
import { and, eq } from "drizzle-orm";

// Regular backoffice users store the preference on their outlet membership.
// Super admins have no membership rows for outlets they can manage, so their
// preference lives in a separate per-outlet table to avoid side effects on
// membership-based features (clock, corrections, staff devices, team lists).

export async function getOutletNotificationEnabled(input: {
  userId: string;
  outletId: string;
  isSuperAdmin: boolean;
}) {
  const db = getDb();

  if (input.isSuperAdmin) {
    const [row] = await db
      .select({ enabled: superAdminOutletNotifications.notificationsEnabled })
      .from(superAdminOutletNotifications)
      .where(
        and(
          eq(superAdminOutletNotifications.userId, input.userId),
          eq(superAdminOutletNotifications.outletId, input.outletId),
        ),
      )
      .limit(1);
    return row?.enabled ?? false;
  }

  const [membership] = await db
    .select({ enabled: outletMemberships.notificationsEnabled })
    .from(outletMemberships)
    .where(
      and(
        eq(outletMemberships.userId, input.userId),
        eq(outletMemberships.outletId, input.outletId),
        eq(outletMemberships.isActive, true),
      ),
    )
    .limit(1);
  return membership?.enabled ?? false;
}

export async function setOutletNotificationEnabled(input: {
  userId: string;
  outletId: string;
  isSuperAdmin: boolean;
  enabled: boolean;
}) {
  const db = getDb();

  if (input.isSuperAdmin) {
    const [row] = await db
      .insert(superAdminOutletNotifications)
      .values({
        userId: input.userId,
        outletId: input.outletId,
        notificationsEnabled: input.enabled,
      })
      .onConflictDoUpdate({
        target: [
          superAdminOutletNotifications.userId,
          superAdminOutletNotifications.outletId,
        ],
        set: { notificationsEnabled: input.enabled },
      })
      .returning({
        enabled: superAdminOutletNotifications.notificationsEnabled,
      });
    return row?.enabled ?? input.enabled;
  }

  const [membership] = await db
    .update(outletMemberships)
    .set({ notificationsEnabled: input.enabled })
    .where(
      and(
        eq(outletMemberships.userId, input.userId),
        eq(outletMemberships.outletId, input.outletId),
        eq(outletMemberships.isActive, true),
      ),
    )
    .returning({ enabled: outletMemberships.notificationsEnabled });
  return membership?.enabled ?? false;
}
