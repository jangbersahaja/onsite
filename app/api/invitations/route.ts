import {
  auditEvents,
  invitationOutlets,
  invitations,
  user,
} from "@/db/schema";
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
    accountType: z.enum(["admin", "staff"]),
    canAccessClock: z.boolean(),
    canAccessBackoffice: z.boolean(),
    outletIds: z.array(z.string().uuid()).max(50),
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
    if (!input.canAccessClock && !input.canAccessBackoffice) {
      return Response.json(
        { error: "At least one app access grant is required." },
        { status: 400 },
      );
    }
    if (input.accountType === "admin" && !access.isSuperAdmin) {
      return Response.json(
        { error: "Only the super admin can invite admins." },
        { status: 403 },
      );
    }
    if (input.accountType === "admin" && !input.canAccessBackoffice) {
      return Response.json(
        { error: "Admins must have Backoffice access." },
        { status: 400 },
      );
    }
    if (
      input.accountType === "staff" &&
      (!input.outletIds.length ||
        input.outletIds.some((outletId) => !access.outletIds.includes(outletId)))
    ) {
      return Response.json(
        { error: "Staff invitations require outlets you can manage." },
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
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        );

      const [created] = await tx
        .insert(invitations)
        .values({
          email: input.email,
          accountType: input.accountType,
          canAccessClock: input.canAccessClock,
          canAccessBackoffice: input.canAccessBackoffice,
          role: input.accountType === "admin" ? "manager" : "staff",
          outletId: input.outletIds[0] ?? null,
          tokenHash,
          invitedBy: session.user.id,
          expiresAt,
        })
        .returning({ id: invitations.id });

      if (input.outletIds.length) {
        await tx.insert(invitationOutlets).values(
          input.outletIds.map((outletId) => ({
            invitationId: created.id,
            outletId,
          })),
        );
      }

      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action: "invitation_created",
        entityType: "invitation",
        entityId: created.id,
        newValues: {
          email: input.email,
          accountType: input.accountType,
          canAccessClock: input.canAccessClock,
          canAccessBackoffice: input.canAccessBackoffice,
          outletIds: input.outletIds,
          expiresAt: expiresAt.toISOString(),
        },
      });

      return created;
    });

    const inviteUrl = new URL("/invite", request.url);
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
