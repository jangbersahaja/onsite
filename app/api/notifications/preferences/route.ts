import { outletMemberships, outlets, pushSubscriptions } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const preferenceSchema = z
  .object({ outletId: z.string().uuid(), enabled: z.boolean() })
  .strict();

function unavailable() {
  return Response.json(
    { error: "Set DATABASE_URL before managing notifications." },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session)
      return Response.json({ error: "Sign in required." }, { status: 401 });

    const outletId = new URL(request.url).searchParams.get("outletId");
    if (!outletId || !z.uuid().safeParse(outletId).success) {
      return Response.json({ error: "Outlet ID is invalid." }, { status: 400 });
    }

    const [membership] = await getDb()
      .select({ enabled: outletMemberships.notificationsEnabled })
      .from(outletMemberships)
      .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
      .where(
        and(
          eq(outletMemberships.userId, session.user.id),
          eq(outletMemberships.outletId, outletId),
          eq(outletMemberships.role, "manager"),
          eq(outletMemberships.isActive, true),
          eq(outlets.isActive, true),
        ),
      )
      .limit(1);

    if (!membership) {
      return Response.json(
        { error: "Active outlet manager assignment not found." },
        { status: 404 },
      );
    }

    return Response.json({
      enabled: membership.enabled,
      publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    });
  } catch {
    return Response.json(
      { error: "Could not load notification settings." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
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
    const parsed = preferenceSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Notification settings are invalid." },
        { status: 400 },
      );
    }

    const db = getDb();
    if (parsed.data.enabled) {
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
      const [subscription] = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, session.user.id))
        .limit(1);
      if (!subscription) {
        return Response.json(
          { error: "Register this browser before enabling notifications." },
          { status: 409 },
        );
      }
    }

    const [membership] = await db
      .update(outletMemberships)
      .set({ notificationsEnabled: parsed.data.enabled })
      .where(
        and(
          eq(outletMemberships.userId, session.user.id),
          eq(outletMemberships.outletId, parsed.data.outletId),
          eq(outletMemberships.role, "manager"),
          eq(outletMemberships.isActive, true),
        ),
      )
      .returning({ enabled: outletMemberships.notificationsEnabled });

    if (!membership) {
      return Response.json(
        { error: "Active outlet manager assignment not found." },
        { status: 404 },
      );
    }
    return Response.json({ enabled: membership.enabled });
  } catch {
    return Response.json(
      { error: "Could not update notification settings." },
      { status: 500 },
    );
  }
}
