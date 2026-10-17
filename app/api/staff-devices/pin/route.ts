import {
  outletMemberships,
  outlets,
  staffDeviceEnrollments,
  user,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { getPinPepper, hashPin, isValidPin } from "@/lib/pin";
import {
  getStaffDeviceCookieName,
  matchesStaffDeviceToken,
} from "@/lib/staff-device";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

const setPinSchema = z
  .object({
    pin: z
      .string()
      .length(6)
      .regex(/^[0-9]{6}$/),
  })
  .strict();

const removePinSchema = z
  .object({ currentPassword: z.string().min(1).max(128) })
  .strict();

async function getActiveEnrollment(userId: string) {
  const [enrollment] = await getDb()
    .select({
      id: staffDeviceEnrollments.id,
      tokenHash: staffDeviceEnrollments.tokenHash,
    })
    .from(staffDeviceEnrollments)
    .innerJoin(user, eq(staffDeviceEnrollments.userId, user.id))
    .innerJoin(
      outletMemberships,
      eq(staffDeviceEnrollments.userId, outletMemberships.userId),
    )
    .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
    .where(
      and(
        eq(staffDeviceEnrollments.userId, userId),
        eq(staffDeviceEnrollments.status, "active"),
        eq(user.canAccessClock, true),
        eq(outletMemberships.isActive, true),
        eq(outlets.isActive, true),
      ),
    )
    .limit(1);
  if (!enrollment) return null;

  const token = (await cookies()).get(getStaffDeviceCookieName(userId))?.value;
  return matchesStaffDeviceToken(token, enrollment.tokenHash)
    ? enrollment
    : null;
}

async function verifyCurrentPassword(userId: string, password: string) {
  const [account] = await getDb()
    .select({ passwordHash: user.passwordHash })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return account ? verifyPassword(password, account.passwordHash) : false;
}

export async function POST(request: Request) {
  if (!hasServerConfiguration()) {
    return Response.json(
      {
        error: "Authentication is not configured.",
        code: "auth_unconfigured",
      },
      { status: 503 },
    );
  }

  const pepper = getPinPepper();
  if (!pepper) {
    return Response.json(
      {
        error: "PIN sign-in is not configured on this server.",
        code: "pin_sign_in_unconfigured",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        error: "Request body must be valid JSON.",
        code: "invalid_json",
      },
      { status: 400 },
    );
  }
  const parsed = setPinSchema.safeParse(body);
  if (!parsed.success || !isValidPin(parsed.data.pin)) {
    return Response.json(
      {
        error: "A six-digit PIN is required.",
        code: "invalid_pin",
      },
      { status: 400 },
    );
  }

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session) {
      return Response.json(
        { error: "Sign in required.", code: "unauthorized" },
        { status: 401 },
      );
    }
    if (!session.user.canAccessClock) {
      return Response.json(
        {
          error: "Clock access is not enabled.",
          code: "clock_access_disabled",
        },
        { status: 403 },
      );
    }

    const enrollment = await getActiveEnrollment(session.user.id);
    if (!enrollment) {
      return Response.json(
        {
          error: "Use this PIN only from your approved browser.",
          code: "pin_requires_approved_browser",
        },
        { status: 403 },
      );
    }
    const now = new Date();
    const saved = await getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(staffDeviceEnrollments)
        .set({ pinHash: hashPin(parsed.data.pin, pepper), updatedAt: now })
        .where(
          and(
            eq(staffDeviceEnrollments.id, enrollment.id),
            eq(staffDeviceEnrollments.status, "active"),
          ),
        )
        .returning({ id: staffDeviceEnrollments.id });
      if (!updated) return false;

      await recordAudit(tx, {
        actorId: session.user.id,
        action: "staff_device_pin_set",
        entityType: "staff_device_enrollment",
        entityId: enrollment.id,
        newValues: { userId: session.user.id },
      });
      return true;
    });
    if (!saved) {
      return Response.json(
        {
          error: "Device status changed. Refresh and try again.",
          code: "device_status_changed",
        },
        { status: 409 },
      );
    }
    return Response.json({ pinEnabled: true });
  } catch {
    return Response.json(
      {
        error: "Could not update this browser's PIN.",
        code: "pin_update_failed",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!hasServerConfiguration()) {
    return Response.json(
      {
        error: "Authentication is not configured.",
        code: "auth_unconfigured",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        error: "Request body must be valid JSON.",
        code: "invalid_json",
      },
      { status: 400 },
    );
  }
  const parsed = removePinSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "A current password is required.",
        code: "current_password_required",
      },
      { status: 400 },
    );
  }

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session) {
      return Response.json(
        { error: "Sign in required.", code: "unauthorized" },
        { status: 401 },
      );
    }
    if (!session.user.canAccessClock) {
      return Response.json(
        {
          error: "Clock access is not enabled.",
          code: "clock_access_disabled",
        },
        { status: 403 },
      );
    }

    const enrollment = await getActiveEnrollment(session.user.id);
    if (!enrollment) {
      return Response.json(
        {
          error: "Use this setting only from your approved browser.",
          code: "setting_requires_approved_browser",
        },
        { status: 403 },
      );
    }
    if (
      !(await verifyCurrentPassword(
        session.user.id,
        parsed.data.currentPassword,
      ))
    ) {
      return Response.json(
        {
          error: "Current password was not recognized.",
          code: "current_password_invalid",
        },
        { status: 401 },
      );
    }

    const now = new Date();
    const removed = await getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(staffDeviceEnrollments)
        .set({ pinHash: null, updatedAt: now })
        .where(
          and(
            eq(staffDeviceEnrollments.id, enrollment.id),
            eq(staffDeviceEnrollments.status, "active"),
          ),
        )
        .returning({ id: staffDeviceEnrollments.id });
      if (!updated) return false;

      await recordAudit(tx, {
        actorId: session.user.id,
        action: "staff_device_pin_removed",
        entityType: "staff_device_enrollment",
        entityId: enrollment.id,
        newValues: { userId: session.user.id },
      });
      return true;
    });
    if (!removed) {
      return Response.json(
        {
          error: "Device status changed. Refresh and try again.",
          code: "device_status_changed",
        },
        { status: 409 },
      );
    }
    return Response.json({ pinEnabled: false });
  } catch {
    return Response.json(
      {
        error: "Could not remove this browser's PIN.",
        code: "pin_remove_failed",
      },
      { status: 500 },
    );
  }
}
