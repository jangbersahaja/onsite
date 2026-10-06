import {
  authLoginAttempts,
  outletMemberships,
  outlets,
  staffDeviceEnrollments,
  user,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { createSession, sessionCookie } from "@/lib/auth-instance";
import { getDb } from "@/lib/db";
import { getPinPepper, verifyPin } from "@/lib/pin";
import {
  getStaffDeviceCookieName,
  matchesStaffDeviceToken,
} from "@/lib/staff-device";
import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { z } from "zod";

const pinSignInSchema = z
  .object({
    userId: z.string().trim().min(1).max(254),
    pin: z
      .string()
      .length(6)
      .regex(/^[0-9]{6}$/),
  })
  .strict();

function attemptKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function isBlocked(keys: string[], now: Date) {
  const records = await getDb()
    .select({ blockedUntil: authLoginAttempts.blockedUntil })
    .from(authLoginAttempts)
    .where(inArray(authLoginAttempts.key, keys));
  return records.some(
    (record) => record.blockedUntil && record.blockedUntil > now,
  );
}

async function recordFailure(keys: string[], now: Date) {
  const db = getDb();
  const records = await db
    .select()
    .from(authLoginAttempts)
    .where(inArray(authLoginAttempts.key, keys));

  for (const key of keys) {
    const attempt = records.find((record) => record.key === key);
    const windowExpired =
      !attempt ||
      now.getTime() - attempt.windowStartedAt.getTime() > 15 * 60_000;
    const failedAttempts = windowExpired ? 1 : attempt.failedAttempts + 1;
    const blockedUntil =
      failedAttempts >= 5 ? new Date(now.getTime() + 15 * 60_000) : null;
    await db
      .insert(authLoginAttempts)
      .values({
        key,
        failedAttempts,
        windowStartedAt: windowExpired ? now : attempt.windowStartedAt,
        blockedUntil,
      })
      .onConflictDoUpdate({
        target: authLoginAttempts.key,
        set: {
          failedAttempts,
          windowStartedAt: windowExpired ? now : attempt.windowStartedAt,
          blockedUntil,
        },
      });
  }
}

export async function POST(request: Request) {
  if (!hasServerConfiguration()) {
    return Response.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  }
  const pepper = getPinPepper();
  if (!pepper) {
    return Response.json(
      { error: "PIN sign-in is not configured on this server." },
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
  const parsed = pinSignInSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "A valid account and six-digit PIN are required." },
      { status: 400 },
    );
  }

  try {
    const { userId, pin } = parsed.data;
    const clientAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const addressKey = attemptKey(`pin:${userId}:${clientAddress}`);
    const db = getDb();
    const now = new Date();
    if (await isBlocked([addressKey], now)) {
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
        canAccessClock: user.canAccessClock,
        canAccessBackoffice: user.canAccessBackoffice,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    const [enrollment] = account?.canAccessClock
      ? await db
          .select({
            id: staffDeviceEnrollments.id,
            tokenHash: staffDeviceEnrollments.tokenHash,
            pinHash: staffDeviceEnrollments.pinHash,
          })
          .from(staffDeviceEnrollments)
          .innerJoin(
            outletMemberships,
            eq(staffDeviceEnrollments.userId, outletMemberships.userId),
          )
          .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
          .where(
            and(
              eq(staffDeviceEnrollments.userId, userId),
              eq(staffDeviceEnrollments.status, "active"),
              eq(outletMemberships.role, "staff"),
              eq(outletMemberships.isActive, true),
              eq(outlets.isActive, true),
            ),
          )
          .limit(1)
      : [];

    const deviceToken = (await cookies()).get(
      getStaffDeviceCookieName(userId),
    )?.value;
    const deviceApproved = Boolean(
      enrollment && matchesStaffDeviceToken(deviceToken, enrollment.tokenHash),
    );
    if (!account || !enrollment || !deviceApproved) {
      await recordFailure([addressKey], now);
      return Response.json(
        { error: "PIN sign-in was not recognized for this browser." },
        { status: 401 },
      );
    }

    const keys = [addressKey, attemptKey(`pin-device:${enrollment.id}`)];
    if (await isBlocked(keys, now)) {
      return Response.json(
        { error: "Too many sign-in attempts. Try again later." },
        { status: 429 },
      );
    }
    if (!enrollment.pinHash || !verifyPin(pin, enrollment.pinHash, pepper)) {
      await recordFailure(keys, now);
      return Response.json(
        { error: "PIN sign-in was not recognized for this browser." },
        { status: 401 },
      );
    }

    await db
      .delete(authLoginAttempts)
      .where(inArray(authLoginAttempts.key, keys));
    const newSession = await createSession(account.id);
    return Response.json(
      {
        user: {
          id: account.id,
          name: account.name,
          username: account.username,
          email: account.email,
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
  } catch {
    return Response.json(
      { error: "Could not sign in with PIN." },
      { status: 500 },
    );
  }
}
