import {
  isEligibleOutletManagerRecipient,
  isExpiredPushSubscriptionError,
  isSupportedPushEndpoint,
  notificationBody,
  type OutletNotificationEvent,
} from "@/lib/push-notification-content";
import assert from "node:assert/strict";
import test from "node:test";

test("outlet notification copy covers local operational events only", () => {
  const events: OutletNotificationEvent[] = [
    "clock_in",
    "clock_out",
    "break_started",
    "break_ended",
    "correction_requested",
    "correction_reviewed",
    "timesheet_edited",
  ];

  assert.deepEqual(
    events.map((event) => notificationBody(event, "Sam")),
    [
      "Sam clocked in.",
      "Sam clocked out.",
      "Sam started a break.",
      "Sam ended a break.",
      "Sam requested a time correction.",
      "Sam reviewed a time correction.",
      "Sam updated a timesheet.",
    ],
  );
  assert.equal(
    notificationBody("correction_requested", ""),
    "A team member requested a time correction.",
  );
});

test("expired push subscriptions are identified for removal", () => {
  assert.equal(isExpiredPushSubscriptionError({ statusCode: 404 }), true);
  assert.equal(isExpiredPushSubscriptionError({ statusCode: 410 }), true);
  assert.equal(isExpiredPushSubscriptionError({ statusCode: 500 }), false);
  assert.equal(
    isExpiredPushSubscriptionError(new Error("network error")),
    false,
  );
  assert.equal(isExpiredPushSubscriptionError(null), false);
});

test("only opted-in active outlet managers other than the actor receive alerts", () => {
  const manager = {
    userId: "manager-1",
    role: "manager",
    isActive: true,
    notificationsEnabled: true,
  };

  assert.equal(isEligibleOutletManagerRecipient(manager, "staff-1"), true);
  assert.equal(isEligibleOutletManagerRecipient(manager, "manager-1"), false);
  assert.equal(
    isEligibleOutletManagerRecipient(
      { ...manager, notificationsEnabled: false },
      "staff-1",
    ),
    false,
  );
  assert.equal(
    isEligibleOutletManagerRecipient(
      { ...manager, isActive: false },
      "staff-1",
    ),
    false,
  );
  assert.equal(
    isEligibleOutletManagerRecipient({ ...manager, role: "staff" }, "staff-1"),
    false,
  );
});

test("push subscriptions must use a known browser push service", () => {
  assert.equal(
    isSupportedPushEndpoint("https://fcm.googleapis.com/fcm/send/token"),
    true,
  );
  assert.equal(
    isSupportedPushEndpoint(
      "https://updates.push.services.mozilla.com/wpush/v2/token",
    ),
    true,
  );
  assert.equal(
    isSupportedPushEndpoint("http://fcm.googleapis.com/send/token"),
    false,
  );
  assert.equal(isSupportedPushEndpoint("https://example.com/push"), false);
  assert.equal(isSupportedPushEndpoint("not a url"), false);
});
