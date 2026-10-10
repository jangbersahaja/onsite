import { outletMemberships, outlets, pushSubscriptions } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isSupportedPushEndpoint } from "@/lib/push-notification-content";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const subscriptionSchema = z
  .object({
    endpoint: z.string().url().max(4096).refine(isSupportedPushEndpoint),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(1).max(256),
        auth: z.string().min(1).max(256),
      })
      .strict(),
  })
  .strict();

const deleteSchema = z.object({ endpoint: z.string().url() }).strict();

function unavailable() {
  return Response.json(
    { error: "Set DATABASE_URL before managing notifications." },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  if (!hasServerConfiguration()) return unavailable();
  if (
    !process.env.VAPID_PUBLIC_KEY ||
    !process.env.VAPID_PRIVATE_KEY ||
    !process.env.VAPID_SUBJECT
  ) {
    return Response.json(
      { error: "Browser push notifications are not configured." },
      { status: 503 },
    );
  }

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session)
      return Response.json({ error: "Sign in required." }, { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    const parsed = subscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Push subscription is invalid." },
        { status: 400 },
      );
    }

    const [membership] = await getDb()
      .select({ id: outletMemberships.id })
      .from(outletMemberships)
      .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
      .where(
        and(
          eq(outletMemberships.userId, session.user.id),
          eq(outletMemberships.role, "manager"),
          eq(outletMemberships.isActive, true),
          eq(outlets.isActive, true),
        ),
      )
      .limit(1);
    if (!membership) {
      return Response.json(
        { error: "An active outlet manager assignment is required." },
        { status: 403 },
      );
    }

    const db = getDb();
    await db
      .insert(pushSubscriptions)
      .values({
        userId: session.user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: session.user.id,
          p256dh: parsed.data.keys.p256dh,
          auth: parsed.data.keys.auth,
          updatedAt: new Date(),
        },
      });

    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Could not save push subscription." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session)
      return Response.json({ error: "Sign in required." }, { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Push subscription endpoint is invalid." },
        { status: 400 },
      );
    }

    await getDb()
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, session.user.id),
          eq(pushSubscriptions.endpoint, parsed.data.endpoint),
        ),
      );
    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Could not remove push subscription." },
      { status: 500 },
    );
  }
}
