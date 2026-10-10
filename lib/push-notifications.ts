import {
  outletMemberships,
  outlets,
  pushSubscriptions,
  user,
} from "@/db/schema";
import { getDb } from "@/lib/db";
import {
  isEligibleOutletManagerRecipient,
  isExpiredPushSubscriptionError,
  notificationBody,
  type OutletNotificationEvent,
} from "@/lib/push-notification-content";
import { eq } from "drizzle-orm";
import * as webPush from "web-push";

export type { OutletNotificationEvent } from "@/lib/push-notification-content";

export async function notifyOutletManagers(input: {
  outletId: string;
  actorId: string;
  event: OutletNotificationEvent;
}) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return;

  try {
    const db = getDb();
    const [[outlet], [actor], recipients] = await Promise.all([
      db
        .select({ name: outlets.name })
        .from(outlets)
        .where(eq(outlets.id, input.outletId))
        .limit(1),
      db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, input.actorId))
        .limit(1),
      db
        .select({
          id: pushSubscriptions.id,
          userId: outletMemberships.userId,
          role: outletMemberships.role,
          isActive: outletMemberships.isActive,
          notificationsEnabled: outletMemberships.notificationsEnabled,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(outletMemberships)
        .innerJoin(
          pushSubscriptions,
          eq(pushSubscriptions.userId, outletMemberships.userId),
        )
        .where(eq(outletMemberships.outletId, input.outletId)),
    ]);

    const eligibleRecipients = recipients.filter((recipient) =>
      isEligibleOutletManagerRecipient(recipient, input.actorId),
    );
    if (!outlet || eligibleRecipients.length === 0) return;

    const payload = JSON.stringify({
      title: `${outlet.name} activity`,
      body: notificationBody(input.event, actor?.name ?? ""),
      url: "/manage",
    });

    await Promise.all(
      eligibleRecipients.map(async (recipient) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: recipient.endpoint,
              keys: { p256dh: recipient.p256dh, auth: recipient.auth },
            },
            payload,
            {
              TTL: 60,
              timeout: 5000,
              vapidDetails: { subject, publicKey, privateKey },
            },
          );
        } catch (error) {
          if (isExpiredPushSubscriptionError(error)) {
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.id, recipient.id));
            return;
          }
          const statusCode =
            typeof error === "object" && error !== null && "statusCode" in error
              ? error.statusCode
              : "unknown";
          console.error(
            "Could not deliver an outlet manager notification.",
            statusCode,
          );
        }
      }),
    );
  } catch (error) {
    console.error(
      "Could not prepare outlet manager notifications.",
      error instanceof Error ? error.name : "unknown",
    );
  }
}
