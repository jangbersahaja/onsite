import { user } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth-instance";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import {
  isValidDisplayName,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
} from "@/lib/profile-rules";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

const profileSchema = z
  .object({
    name: z.string().max(200),
    email: z.string().max(254),
    currentPassword: z.string().max(128).optional(),
  })
  .strict();

const noStore = { "Cache-Control": "no-store" };

export async function PATCH(request: Request) {
  const session = await getSession(request.headers);
  if (!session) {
    return Response.json(
      { error: "Sign in to continue.", code: "unauthorized" },
      { status: 401, headers: noStore },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON.", code: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = profileSchema.safeParse(body);
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

  const userId = session.user.id;
  const name = normalizeDisplayName(parsed.data.name);
  const email = normalizeEmail(parsed.data.email);
  const db = getDb();

  const [current] = await db
    .select({
      name: user.name,
      email: user.email,
      passwordHash: user.passwordHash,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!current) {
    return Response.json(
      { error: "Sign in to continue.", code: "unauthorized" },
      { status: 401, headers: noStore },
    );
  }

  const emailChanged = email !== current.email.toLowerCase();
  if (emailChanged) {
    const currentPassword = parsed.data.currentPassword ?? "";
    if (!currentPassword) {
      return Response.json(
        {
          error:
            "Enter your current password and a new password of 12 to 128 characters.",
          code: "invalid_password",
        },
        { status: 400 },
      );
    }
    const matches = await verifyPassword(currentPassword, current.passwordHash);
    if (!matches) {
      return Response.json(
        {
          error: "The current password is incorrect.",
          code: "current_password_incorrect",
        },
        { status: 403 },
      );
    }

    const [taken] = await db
      .select({ id: user.id })
      .from(user)
      .where(and(sql`lower(${user.email}) = ${email}`, ne(user.id, userId)))
      .limit(1);
    if (taken) {
      return Response.json(
        {
          error: "That email is already in use.",
          code: "email_taken",
        },
        { status: 409 },
      );
    }
  }

  try {
    await db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(user)
        .set({ name, email, updatedAt: now })
        .where(eq(user.id, userId));
      await recordAudit(tx, {
        actorId: userId,
        action: "profile_updated",
        entityType: "user",
        entityId: userId,
        previousValues: { name: current.name, email: current.email },
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
