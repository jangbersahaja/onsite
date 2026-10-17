import { pushSubscriptions } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  getOutletNotificationEnabled,
  setOutletNotificationEnabled,
} from "@/lib/outlet-notification-preferences";
import { getTeamAccess } from "@/lib/team-access";
import { eq } from "drizzle-orm";
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

    const access = await getTeamAccess(session.user.id);
    if (!access || !access.outletIds.includes(outletId)) {
      return Response.json(
        { error: "Active backoffice outlet assignment not found." },
        { status: 404 },
      );
    }

    const enabled = await getOutletNotificationEnabled({
      userId: session.user.id,
      outletId,
      isSuperAdmin: access.isSuperAdmin,
    });

    return Response.json({
      enabled,
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

    const access = await getTeamAccess(session.user.id);
    if (!access || !access.outletIds.includes(parsed.data.outletId)) {
      return Response.json(
        { error: "Active backoffice outlet assignment not found." },
        { status: 404 },
      );
    }
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
      const [subscription] = await getDb()
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

    const enabled = await setOutletNotificationEnabled({
      userId: session.user.id,
      outletId: parsed.data.outletId,
      isSuperAdmin: access.isSuperAdmin,
      enabled: parsed.data.enabled,
    });
    return Response.json({ enabled });
  } catch {
    return Response.json(
      { error: "Could not update notification settings." },
      { status: 500 },
    );
  }
}
