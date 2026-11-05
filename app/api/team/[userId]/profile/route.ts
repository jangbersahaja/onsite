import { user } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth-instance";
import { getDb } from "@/lib/db";
import {
  isValidDisplayName,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
} from "@/lib/profile-rules";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

const teamProfileSchema = z
  .object({
    name: z.string().max(200),
    email: z.string().max(254),
  })
  .strict();

const noStore = { "Cache-Control": "no-store" };

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const session = await getSession(request.headers);
  if (!session) {
    return Response.json(
      { error: "Sign in to continue.", code: "unauthorized" },
      { status: 401, headers: noStore },
    );
  }

  const access = await getTeamAccess(session.user.id);
  if (!access?.isSuperAdmin) {
    return Response.json(
      { error: "You cannot edit this profile.", code: "profile_forbidden" },
      { status: 403, headers: noStore },
    );
  }

  const { userId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON.", code: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = teamProfileSchema.safeParse(body);
  if (
    !parsed.success ||
    !isValidDisplayName(parsed.data.name) ||
    !isValidEmail(parsed.data.email)
  ) {
    return Response.json(
      {
        error: "Enter a display name and a valid email address.",
        code: "invalid_profile",
      },
      { status: 400 },
    );
  }

  const name = normalizeDisplayName(parsed.data.name);
  const email = normalizeEmail(parsed.data.email);
  const db = getDb();

  const [target] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!target) {
    return Response.json(
      { error: "This account could not be found.", code: "account_not_found" },
      { status: 404, headers: noStore },
    );
  }

  const [taken] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(sql`lower(${user.email}) = ${email}`, ne(user.id, userId)))
    .limit(1);
  if (taken) {
    return Response.json(
      { error: "That email is already in use.", code: "email_taken" },
      { status: 409, headers: noStore },
    );
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(user)
        .set({ name, email, updatedAt: new Date() })
        .where(eq(user.id, userId));
      await recordAudit(tx, {
        actorId: session.user.id,
        action: "team_member_profile_updated",
        entityType: "user",
        entityId: userId,
        previousValues: { name: target.name, email: target.email },
        newValues: { name, email },
      });
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "23505") {
      return Response.json(
        { error: "That email is already in use.", code: "email_taken" },
        { status: 409, headers: noStore },
      );
    }
    return Response.json(
      { error: "Could not update profile.", code: "profile_update_failed" },
      { status: 500, headers: noStore },
    );
  }

  return Response.json({ name, email }, { headers: noStore });
}
