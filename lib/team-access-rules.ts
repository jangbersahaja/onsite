export type TeamActor = {
  id: string;
  isSuperAdmin: boolean;
};

export type TeamTarget = {
  id: string;
  accountType: "super_admin" | "user";
  canAccessBackoffice: boolean;
};

/**
 * Decides whether an actor may change another person's app access
 * (clock / backoffice grants) or reset their password.
 *
 * - Nobody manages their own access here.
 * - Super admins manage anyone.
 * - Backoffice users manage only clock-only users (no backoffice access)
 *   who share at least one of their outlets. This stops a backoffice user
 *   from revoking the access of another backoffice user.
 * - Super admin accounts are only manageable by a super admin.
 */
export function canManageTargetAccess(
  actor: TeamActor,
  target: TeamTarget,
  sharesOutlet: boolean,
) {
  if (actor.id === target.id) return false;
  if (actor.isSuperAdmin) return true;
  if (!sharesOutlet) return false;
  return target.accountType === "user" && !target.canAccessBackoffice;
}
