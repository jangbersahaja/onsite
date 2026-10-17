export const AUDIT_ACTIONS = [
  "sign_in",
  "password_reset_completed",
  "profile_photo_updated",
  "profile_photo_removed",
  "clock_in",
  "clock_out",
  "start_break",
  "end_break",
  "timesheet_edit",
  "timesheet_create",
  "timesheet_delete",
  "correction_applied",
  "correction_punch_applied",
  "correction_adjusted",
  "correction_reconciled",
  "correction_punch_adjusted",
  "correction_break_applied",
  "correction_break_changed",
  "correction_break_adjusted",
  "invitation_created",
  "outlet_created",
  "outlet_updated",
  "outlet_deactivated",
  "outlet_storehub_linked",
  "outlet_storehub_updated",
  "outlet_storehub_unlinked",
  "user_assigned_to_outlet",
  "user_unassigned_from_outlet",
  "registration_submitted",
  "registration_approved",
  "registration_rejected",
  "registration_link_created",
  "registration_link_rotated",
  "registration_link_revoked",
  "staff_device_enrollment_requested",
  "staff_device_enrollment_approved",
  "staff_device_enrollment_rejected",
  "staff_device_revoked",
  "staff_device_pin_set",
  "staff_device_pin_removed",
  "team_member_app_access_updated",
  "password_reset_link_issued",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

export type AuditEventForDescription = {
  action: string;
  actorName: string | null;
  outletName: string | null;
  newValues: unknown;
};

type DescriptionParts = {
  actor: string;
  /** " at Outlet" suffix, or empty when no outlet is recorded. */
  atOutlet: string;
  outletName: string | null;
  /** Username or email of the affected person, when recorded. */
  target: string | null;
};

function readString(values: unknown, key: string): string | null {
  if (!values || typeof values !== "object") return null;
  const value = (values as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

const describers: Record<AuditAction, (parts: DescriptionParts) => string> = {
  sign_in: ({ actor }) => `${actor} signed in`,
  password_reset_completed: ({ actor }) => `${actor} reset their password`,
  profile_photo_updated: ({ actor }) => `${actor} updated their profile photo`,
  profile_photo_removed: ({ actor }) => `${actor} removed their profile photo`,
  clock_in: ({ actor, atOutlet }) => `${actor} clocked in${atOutlet}`,
  clock_out: ({ actor, atOutlet }) => `${actor} clocked out${atOutlet}`,
  start_break: ({ actor, atOutlet }) => `${actor} started a break${atOutlet}`,
  end_break: ({ actor, atOutlet }) => `${actor} ended a break${atOutlet}`,
  timesheet_edit: ({ actor, atOutlet }) =>
    `${actor} edited a timesheet${atOutlet}`,
  timesheet_create: ({ actor, target, atOutlet }) =>
    `${actor} added a shift${target ? ` for ${target}` : ""}${atOutlet}`,
  timesheet_delete: ({ actor, atOutlet }) =>
    `${actor} deleted a shift${atOutlet}`,
  correction_applied: ({ actor, atOutlet }) =>
    `${actor} submitted a time correction${atOutlet}`,
  correction_punch_applied: ({ actor, atOutlet }) =>
    `${actor} applied a time correction${atOutlet}`,
  correction_adjusted: ({ actor, atOutlet }) =>
    `${actor} adjusted a correction request${atOutlet}`,
  correction_reconciled: ({ actor, atOutlet }) =>
    `${actor} reconciled a correction request${atOutlet}`,
  correction_punch_adjusted: ({ actor, atOutlet }) =>
    `${actor} adjusted a punch${atOutlet}`,
  correction_break_applied: ({ actor, atOutlet }) =>
    `${actor} submitted a break correction${atOutlet}`,
  correction_break_changed: ({ actor, atOutlet }) =>
    `${actor} changed a break${atOutlet}`,
  correction_break_adjusted: ({ actor, atOutlet }) =>
    `${actor} adjusted a break${atOutlet}`,
  invitation_created: ({ actor, target }) =>
    `${actor} invited ${target ?? "a new user"}`,
  outlet_created: ({ actor, outletName }) =>
    `${actor} created outlet${outletName ? ` ${outletName}` : ""}`,
  outlet_updated: ({ actor, outletName }) =>
    `${actor} updated outlet${outletName ? ` ${outletName}` : ""}`,
  outlet_deactivated: ({ actor, outletName }) =>
    `${actor} deactivated outlet${outletName ? ` ${outletName}` : ""}`,
  outlet_storehub_linked: ({ actor, outletName }) =>
    `${actor} linked StoreHub to outlet${outletName ? ` ${outletName}` : ""}`,
  outlet_storehub_updated: ({ actor, outletName }) =>
    `${actor} updated StoreHub link for outlet${outletName ? ` ${outletName}` : ""}`,
  outlet_storehub_unlinked: ({ actor, outletName }) =>
    `${actor} unlinked StoreHub from outlet${outletName ? ` ${outletName}` : ""}`,
  user_assigned_to_outlet: ({ actor, outletName }) =>
    `${actor} assigned a user to ${outletName ?? "an outlet"}`,
  user_unassigned_from_outlet: ({ actor, outletName }) =>
    `${actor} removed a user from ${outletName ?? "an outlet"}`,
  registration_submitted: ({ actor, atOutlet }) =>
    `${actor} submitted a registration${atOutlet}`,
  registration_approved: ({ actor, target, atOutlet }) =>
    `${actor} approved registration of ${target ?? "a user"}${atOutlet}`,
  registration_rejected: ({ actor, target, atOutlet }) =>
    `${actor} rejected registration of ${target ?? "a user"}${atOutlet}`,
  registration_link_created: ({ actor, atOutlet }) =>
    `${actor} created a registration link${atOutlet}`,
  registration_link_rotated: ({ actor, atOutlet }) =>
    `${actor} rotated a registration link${atOutlet}`,
  registration_link_revoked: ({ actor, atOutlet }) =>
    `${actor} revoked a registration link${atOutlet}`,
  staff_device_enrollment_requested: ({ actor }) =>
    `${actor} requested device approval`,
  staff_device_enrollment_approved: ({ actor }) => `${actor} approved a device`,
  staff_device_enrollment_rejected: ({ actor }) => `${actor} rejected a device`,
  staff_device_revoked: ({ actor }) => `${actor} revoked a device`,
  staff_device_pin_set: ({ actor }) => `${actor} set a device PIN`,
  staff_device_pin_removed: ({ actor }) => `${actor} removed a device PIN`,
  team_member_app_access_updated: ({ actor }) =>
    `${actor} updated team app access`,
  password_reset_link_issued: ({ actor, target }) =>
    `${actor} issued a password reset link${target ? ` for ${target}` : ""}`,
};

export function describeAuditEvent(event: AuditEventForDescription): string {
  const actor = event.actorName ?? "System";
  if (!isAuditAction(event.action)) {
    return `${actor} performed ${event.action}`;
  }
  return describers[event.action]({
    actor,
    atOutlet: event.outletName ? ` at ${event.outletName}` : "",
    outletName: event.outletName,
    target:
      readString(event.newValues, "username") ??
      readString(event.newValues, "email"),
  });
}
