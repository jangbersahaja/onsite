export type OutletNotificationEvent =
  | "clock_in"
  | "clock_out"
  | "break_started"
  | "break_ended"
  | "correction_requested"
  | "correction_reviewed"
  | "timesheet_edited";

const eventDescriptions: Record<OutletNotificationEvent, string> = {
  clock_in: "clocked in",
  clock_out: "clocked out",
  break_started: "started a break",
  break_ended: "ended a break",
  correction_requested: "requested a time correction",
  correction_reviewed: "reviewed a time correction",
  timesheet_edited: "updated a timesheet",
};

export function notificationBody(
  event: OutletNotificationEvent,
  actorName: string,
) {
  return `${actorName || "A team member"} ${eventDescriptions[event]}.`;
}

export function isEligibleOutletManagerRecipient(
  membership: {
    userId: string;
    role: string;
    isActive: boolean;
    notificationsEnabled: boolean;
  },
  actorId: string,
) {
  return (
    membership.role === "manager" &&
    membership.isActive &&
    membership.notificationsEnabled &&
    membership.userId !== actorId
  );
}

export function isSupportedPushEndpoint(value: string) {
  let hostname: string;
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== "https:") return false;
    hostname = endpoint.hostname.toLowerCase();
  } catch {
    return false;
  }

  return [
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "push.apple.com",
    "notify.windows.com",
  ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export function isExpiredPushSubscriptionError(error: unknown) {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return false;
  }
  return error.statusCode === 404 || error.statusCode === 410;
}
