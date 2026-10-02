import { auditEvents, outletMemberships, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { takeResetPasswordLink } from "@/lib/reset-password-delivery";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const resetSchema = z.object({ userId: z.string().min(1).max(200) }).strict();

export async function POST(request: Request) {
  if (!hasServerConfiguration()) {
    return Response.json(
      { error: "Authentication is not configured." },
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

    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "A valid team member is required." },
        { status: 400 },
      );
    }

    const access = await getTeamAccess(session.user.id);
    if (!access)
      return Response.json({ error: "Team access denied." }, { status: 403 });

    const db = getDb();
    const [target] = access.isAdmin
      ? await db
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(eq(user.id, parsed.data.userId))
          .limit(1)
      : access.outletIds.length > 0
        ? await db
            .select({ id: user.id, email: user.email })
            .from(outletMemberships)
            .innerJoin(user, eq(outletMemberships.userId, user.id))
            .where(
              and(
                eq(user.id, parsed.data.userId),
                eq(outletMemberships.isActive, true),
                inArray(outletMemberships.outletId, access.outletIds),
                inArray(outletMemberships.role, ["staff", "supervisor"]),
              ),
            )
            .limit(1)
        : [];

    if (!target)
      return Response.json(
        { error: "You cannot reset this account." },
        { status: 403 },
      );

    const requestId = randomUUID();
    const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
    await getAuth().api.requestPasswordReset({
      body: {
        email: target.email,
        redirectTo: new URL("/reset-password", baseURL).toString(),
      },
      headers: { "x-shiftline-reset-delivery": requestId },
    });
    const resetUrl = takeResetPasswordLink(requestId);
    if (!resetUrl) throw new Error("Password reset link was not generated.");

    await db.insert(auditEvents).values({
      actorId: session.user.id,
      action: "password_reset_link_issued",
      entityType: "user",
      entityId: target.id,
      newValues: { email: target.email },
    });

    return Response.json(
      { resetUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not create a password reset link." },
      { status: 500 },
    );
  }
}
