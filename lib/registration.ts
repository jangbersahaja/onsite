import { authLoginAttempts, outlets, registrationLinks } from "@/db/schema";
import { getDb } from "@/lib/db";
import { and, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

const REGISTRATION_ATTEMPT_LIMIT = 10;
const REGISTRATION_WINDOW_MS = 60 * 60_000;

export function createRegistrationToken() {
  return randomBytes(32).toString("base64url");
}

export function isRegistrationTokenFormat(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function buildRegistrationUrl(requestUrl: string, token: string) {
  const url = new URL("/register", requestUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function findActiveRegistrationLink(token: string) {
  if (!isRegistrationTokenFormat(token)) return null;
  const [link] = await getDb()
    .select({
      id: registrationLinks.id,
      outletId: registrationLinks.outletId,
      outletName: outlets.name,
    })
    .from(registrationLinks)
    .innerJoin(outlets, eq(registrationLinks.outletId, outlets.id))
    .where(
      and(
        eq(registrationLinks.token, token),
        isNull(registrationLinks.revokedAt),
        eq(outlets.isActive, true),
      ),
    )
    .limit(1);
  return link ?? null;
}

/**
 * Limits public registration submissions per client address.
 * Returns false when the address has exceeded the hourly limit.
 */
export async function allowRegistrationAttempt(
  clientAddress: string,
  now: Date,
) {
  const db = getDb();
  const key = createHash("sha256")
    .update(`register:${clientAddress}`)
    .digest("hex");
  const [attempt] = await db
    .select()
    .from(authLoginAttempts)
    .where(eq(authLoginAttempts.key, key))
    .limit(1);

  if (attempt?.blockedUntil && attempt.blockedUntil > now) return false;

  const windowExpired =
    !attempt ||
    now.getTime() - attempt.windowStartedAt.getTime() > REGISTRATION_WINDOW_MS;
  const attempts = windowExpired ? 1 : attempt.failedAttempts + 1;
  const blockedUntil =
    attempts > REGISTRATION_ATTEMPT_LIMIT
      ? new Date(now.getTime() + REGISTRATION_WINDOW_MS)
      : null;
  const windowStartedAt = windowExpired ? now : attempt.windowStartedAt;

  await db
    .insert(authLoginAttempts)
    .values({
      key,
      failedAttempts: attempts,
      windowStartedAt,
      blockedUntil,
    })
    .onConflictDoUpdate({
      target: authLoginAttempts.key,
      set: {
        failedAttempts: attempts,
        windowStartedAt,
        blockedUntil,
      },
    });

  return blockedUntil === null;
}
