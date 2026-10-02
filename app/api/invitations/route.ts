import { auditEvents, invitations, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createOneTimeToken } from "@/lib/one-time-token";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

const invitationSchema = z
  .object({
    email: z.email().transform((email) => email.trim().toLowerCase()),
    role: z.enum(["manager", "supervisor", "staff"]),
    outletId: z.string().uuid(),
  })
  .strict();

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

    const parsed = invitationSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Invitation details are invalid." },
        { status: 400 },
      );
    }

    const input = parsed.data;
    const access = await getTeamAccess(session.user.id);
    if (!access)
      return Response.json({ error: "Team access denied." }, { status: 403 });
    if (!access.outletIds.includes(input.outletId)) {
      return Response.json(
        { error: "You cannot manage this outlet." },
        { status: 403 },
      );
    }
    if (access.isAdmin ? input.role !== "manager" : input.role === "manager") {
      return Response.json(
        {
          error: access.isAdmin
            ? "Admins invite managers."
            : "Managers invite staff or supervisors.",
        },
        { status: 403 },
      );
    }

    const db = getDb();
    const [existingUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${input.email}`)
      .limit(1);
    if (existingUser) {
      return Response.json(
        { error: "This email already has an account." },
        { status: 409 },
      );
    }

    const { token, tokenHash } = createOneTimeToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const invitation = await db.transaction(async (tx) => {
      await tx
        .update(invitations)
        .set({ revokedAt: now, claimedAt: null })
        .where(
          and(
            eq(invitations.email, input.email),
            eq(invitations.outletId, input.outletId),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        );

      const [created] = await tx
        .insert(invitations)
        .values({
          email: input.email,
          role: input.role,
          outletId: input.outletId,
          tokenHash,
          invitedBy: session.user.id,
          expiresAt,
        })
        .returning({ id: invitations.id });

      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action: "invitation_created",
        entityType: "invitation",
        entityId: created.id,
        newValues: {
          email: input.email,
          role: input.role,
          outletId: input.outletId,
          expiresAt: expiresAt.toISOString(),
        },
      });

      return created;
    });

    const inviteUrl = new URL(
      "/invite",
      process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    );
    inviteUrl.searchParams.set("token", token);

    return Response.json(
      {
        invitationId: invitation.id,
        inviteUrl: inviteUrl.toString(),
        expiresAt,
      },
      { status: 201 },
    );
  } catch {
    return Response.json(
      { error: "Could not create the invitation." },
      { status: 500 },
    );
  }
}
