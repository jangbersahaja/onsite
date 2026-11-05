import { session, user } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth-instance";
import { getDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { isValidNewPassword } from "@/lib/profile-rules";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

const passwordSchema = z
  .object({
    currentPassword: z.string().max(128),
    newPassword: z.string().max(128),
  })
  .strict();

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const authSession = await getSession(request.headers);
  if (!authSession) {
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

  const parsed = passwordSchema.safeParse(body);
  if (
    !parsed.success ||
    !parsed.data.currentPassword ||
    !isValidNewPassword(parsed.data.newPassword)
  ) {
    return Response.json(
      {
        error:
          "Enter your current password and a new password of 12 to 128 characters.",
        code: "invalid_password",
      },
      { status: 400 },
    );
  }

  const userId = authSession.user.id;
  const currentSessionId = authSession.session.id;
  const db = getDb();

  const [current] = await db
    .select({ passwordHash: user.passwordHash })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!current) {
    return Response.json(
      { error: "Sign in to continue.", code: "unauthorized" },
      { status: 401, headers: noStore },
    );
  }

  const matches = await verifyPassword(
    parsed.data.currentPassword,
    current.passwordHash,
  );
  if (!matches) {
    return Response.json(
      {
        error: "The current password is incorrect.",
        code: "current_password_incorrect",
      },
      { status: 403, headers: noStore },
    );
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);

  try {
    await db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(user)
        .set({ passwordHash, updatedAt: now })
        .where(eq(user.id, userId));
      await tx
        .update(session)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(session.userId, userId),
            ne(session.id, currentSessionId),
            isNull(session.revokedAt),
          ),
        );
      await recordAudit(tx, {
        actorId: userId,
        action: "password_changed",
        entityType: "user",
        entityId: userId,
      });
    });
  } catch {
    return Response.json(
      {
        error: "Could not update password.",
        code: "password_update_failed",
      },
      { status: 500, headers: noStore },
    );
  }

  return Response.json({ changed: true }, { headers: noStore });
}
