import {
  auditEvents,
  invitations,
  outletMemberships,
  outlets,
  user,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hashOneTimeToken } from "@/lib/one-time-token";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

const acceptSchema = z
  .object({
    token: z.string().min(32).max(128),
    name: z.string().trim().min(2).max(120),
    password: z.string().min(12).max(128),
  })
  .strict();

function unavailable() {
  return Response.json(
    { error: "Authentication is not configured." },
    { status: 503 },
  );
}

function eligibleInvitation(now: Date) {
  return and(
    isNull(invitations.acceptedAt),
    isNull(invitations.revokedAt),
    gt(invitations.expiresAt, now),
    or(
      isNull(invitations.claimedAt),
      lt(invitations.claimedAt, new Date(now.getTime() - 5 * 60_000)),
    ),
  );
}

export async function GET(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length < 32 || token.length > 128) {
    return Response.json(
      { error: "This invitation link is invalid." },
      { status: 400 },
    );
  }

  try {
    const now = new Date();
    const [invitation] = await getDb()
      .select({
        email: invitations.email,
        role: invitations.role,
        outletName: outlets.name,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(outlets, eq(invitations.outletId, outlets.id))
      .where(
        and(
          eq(invitations.tokenHash, hashOneTimeToken(token)),
          eligibleInvitation(now),
        ),
      )
      .limit(1);

    if (!invitation) {
      return Response.json(
        { error: "This invitation is expired or already used." },
        { status: 410 },
      );
    }

    return Response.json(invitation, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Could not verify this invitation." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = acceptSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Name, password, and invitation token are required." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const db = getDb();
  const now = new Date();
  let claimedInvitation:
    | {
        id: string;
        email: string;
        role: "manager" | "supervisor" | "staff";
        outletId: string;
        invitedBy: string;
      }
    | undefined;
  let createdUserId: string | undefined;

  try {
    const tokenHash = hashOneTimeToken(input.token);
    const [available] = await db
      .select({ id: invitations.id, email: invitations.email })
      .from(invitations)
      .where(and(eq(invitations.tokenHash, tokenHash), eligibleInvitation(now)))
      .limit(1);

    if (!available) {
      return Response.json(
        { error: "This invitation is expired or already used." },
        { status: 410 },
      );
    }

    const [existingUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${available.email}`)
      .limit(1);
    if (existingUser) {
      return Response.json(
        {
          error:
            "This email already has an account. Ask your manager for help.",
        },
        { status: 409 },
      );
    }

    const [claimed] = await db
      .update(invitations)
      .set({ claimedAt: now })
      .where(
        and(
          eq(invitations.id, available.id),
          eq(invitations.tokenHash, tokenHash),
          eligibleInvitation(now),
        ),
      )
      .returning({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        outletId: invitations.outletId,
        invitedBy: invitations.invitedBy,
      });

    if (!claimed) {
      return Response.json(
        { error: "This invitation is being used or has expired." },
        { status: 409 },
      );
    }
    claimedInvitation = claimed;

    const registration = await getAuth({ allowSignUp: true }).api.signUpEmail({
      body: {
        name: input.name,
        email: claimed.email,
        password: input.password,
      },
    });
    createdUserId = registration.user.id;

    await db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(invitations)
        .set({ acceptedAt: now, claimedAt: null })
        .where(
          and(
            eq(invitations.id, claimed.id),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            eq(invitations.claimedAt, now),
          ),
        )
        .returning({ id: invitations.id });
      if (!consumed)
        throw new Error("Invitation was revoked before acceptance completed.");

      await tx.insert(outletMemberships).values({
        userId: registration.user.id,
        outletId: claimed.outletId,
        role: claimed.role,
        assignedBy: claimed.invitedBy,
      });

      await tx.insert(auditEvents).values({
        actorId: registration.user.id,
        action: "invitation_accepted",
        entityType: "invitation",
        entityId: claimed.id,
        newValues: {
          email: claimed.email,
          role: claimed.role,
          outletId: claimed.outletId,
        },
      });
    });

    return Response.json({ accepted: true }, { status: 201 });
  } catch {
    if (createdUserId) {
      await db
        .delete(user)
        .where(eq(user.id, createdUserId))
        .catch(() => undefined);
    }
    if (claimedInvitation) {
      await db
        .update(invitations)
        .set({ claimedAt: null })
        .where(
          and(
            eq(invitations.id, claimedInvitation.id),
            isNull(invitations.acceptedAt),
          ),
        )
        .catch(() => undefined);
    }
    return Response.json(
      { error: "Could not accept this invitation." },
      { status: 400 },
    );
  }
}
