export type RegistrationActor = {
  id: string;
  isSuperAdmin: boolean;
  outletIds: string[];
};

export type RegistrationTarget = {
  id: string;
  approvalStatus: "pending" | "approved";
  registrationOutletId: string | null;
};

/** Backoffice users may create or rotate registration links for outlets they manage. */
export function canManageOutletRegistration(
  actor: RegistrationActor,
  outletId: string,
) {
  return actor.isSuperAdmin || actor.outletIds.includes(outletId);
}

/**
 * Only the manager of the outlet a user registered for (or a super admin) may
 * approve or reject that registration. Nobody can review their own account.
 */
export function canReviewRegistration(
  actor: RegistrationActor,
  target: RegistrationTarget,
) {
  if (actor.id === target.id) return false;
  if (target.approvalStatus !== "pending") return false;
  if (!target.registrationOutletId) return actor.isSuperAdmin;
  return canManageOutletRegistration(actor, target.registrationOutletId);
}
