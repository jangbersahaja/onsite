import { passwordResetTokens, session, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getDb } from "@/lib/db";
import { hashOneTimeToken } from "@/lib/one-time-token";
import { hashPassword } from "@/lib/password";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

const resetSchema = z
  .object({
    token: z.string().min(32).max(128),
    password: z.string().min(12).max(128),
  })
  .strict();

export async function POST(request: Request) {
  if (!hasServerConfiguration()) {
    return Response.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  }

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
      { error: "A valid reset token and password are required." },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const now = new Date();
  const changed = await getDb().transaction(async (tx) => {
    const [reset] = await tx
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
      })
      .from(passwordResetTokens)
      .where(
        and(
          eq(
            passwordResetTokens.tokenHash,
            hashOneTimeToken(parsed.data.token),
          ),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .for("update")
      .limit(1);
    if (!reset) return false;

    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(eq(passwordResetTokens.id, reset.id));
    await tx
      .update(user)
      .set({ passwordHash, updatedAt: now })
      .where(eq(user.id, reset.userId));
    await tx
      .update(session)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(session.userId, reset.userId), isNull(session.revokedAt)));
    return true;
  });

  if (!changed) {
    return Response.json(
      { error: "This reset link is invalid, expired, or already used." },
      { status: 410 },
    );
  }
  return Response.json({ reset: true });
}
