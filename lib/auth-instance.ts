import { session, user } from "@/db/schema";
import { getDb } from "@/lib/db-client";
import { hashOneTimeToken } from "@/lib/one-time-token";
import { and, eq, gt, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export const sessionCookieName = "shiftline_session";
const sessionLifetimeSeconds = 60 * 60 * 24 * 30;

function readCookie(headers: Headers, name: string) {
  const cookies = headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
  return null;
}

export async function getSession(headers: Headers) {
  const token = readCookie(headers, sessionCookieName);
  if (!token) return null;

  const [record] = await getDb()
    .select({
      id: session.id,
      expiresAt: session.expiresAt,
      userId: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      accountType: user.accountType,
      canAccessClock: user.canAccessClock,
      canAccessBackoffice: user.canAccessBackoffice,
    })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(
      and(
        eq(session.tokenHash, hashOneTimeToken(token)),
        gt(session.expiresAt, new Date()),
        isNull(session.revokedAt),
      ),
    )
    .limit(1);

  if (!record) return null;
  return {
    session: { id: record.id, expiresAt: record.expiresAt },
    user: {
      id: record.userId,
      name: record.name,
      username: record.username,
      email: record.email,
      accountType: record.accountType,
      canAccessClock: record.canAccessClock,
      canAccessBackoffice: record.canAccessBackoffice,
    },
  };
}

export function getAuth() {
  return {
    api: {
      getSession: ({ headers }: { headers: Headers }) => getSession(headers),
    },
  };
}

export async function createSession(userId: string) {
  const token = randomUUID() + randomUUID();
  const tokenHash = hashOneTimeToken(token);
  const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000);
  const id = randomUUID();

  await getDb().insert(session).values({
    id,
    token: tokenHash,
    tokenHash,
    userId,
    expiresAt,
  });

  return { token, expiresAt };
}

export function sessionCookie(token: string, maxAge = sessionLifetimeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function revokeSession(headers: Headers) {
  const token = readCookie(headers, sessionCookieName);
  if (!token) return;
  await getDb()
    .update(session)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(session.tokenHash, hashOneTimeToken(token)),
        isNull(session.revokedAt),
      ),
    );
}
