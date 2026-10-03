import { authLoginAttempts, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { createSession, sessionCookie } from "@/lib/auth-instance";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";

const signInSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(128),
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

  const parsed = signInSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Username/email and password are required." },
      { status: 400 },
    );
  }

  const identifier = parsed.data.identifier.toLowerCase();
  const clientAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const attemptKey = createHash("sha256")
    .update(`${identifier}:${clientAddress}`)
    .digest("hex");
  const db = getDb();
  const now = new Date();
  const [attempt] = await db
    .select()
    .from(authLoginAttempts)
    .where(eq(authLoginAttempts.key, attemptKey))
    .limit(1);

  if (attempt?.blockedUntil && attempt.blockedUntil > now) {
    return Response.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429 },
    );
  }

  const [account] = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      passwordHash: user.passwordHash,
      accountType: user.accountType,
      canAccessClock: user.canAccessClock,
      canAccessBackoffice: user.canAccessBackoffice,
    })
    .from(user)
    .where(
      sql`lower(${user.email}) = ${identifier} OR lower(${user.username}) = ${identifier}`,
    )
    .limit(1);

  const passwordMatches = account?.passwordHash
    ? await verifyPassword(parsed.data.password, account.passwordHash)
    : false;
  if (!account || !passwordMatches) {
    const windowExpired =
      !attempt ||
      now.getTime() - attempt.windowStartedAt.getTime() > 15 * 60_000;
    const failedAttempts = windowExpired ? 1 : attempt.failedAttempts + 1;
    await db
      .insert(authLoginAttempts)
      .values({
        key: attemptKey,
        failedAttempts,
        windowStartedAt: windowExpired ? now : attempt.windowStartedAt,
        blockedUntil:
          failedAttempts >= 5 ? new Date(now.getTime() + 15 * 60_000) : null,
      })
      .onConflictDoUpdate({
        target: authLoginAttempts.key,
        set: {
          failedAttempts,
          windowStartedAt: windowExpired ? now : attempt.windowStartedAt,
          blockedUntil:
            failedAttempts >= 5 ? new Date(now.getTime() + 15 * 60_000) : null,
        },
      });
    return Response.json(
      { error: "Username/email or password was not recognized." },
      { status: 401 },
    );
  }

  await db
    .delete(authLoginAttempts)
    .where(eq(authLoginAttempts.key, attemptKey));
  const newSession = await createSession(account.id);
  return Response.json(
    {
      user: {
        id: account.id,
        name: account.name,
        username: account.username,
        email: account.email,
        accountType: account.accountType,
        canAccessClock: account.canAccessClock,
        canAccessBackoffice: account.canAccessBackoffice,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": sessionCookie(newSession.token),
      },
    },
  );
}
