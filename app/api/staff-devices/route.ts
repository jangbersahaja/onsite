import {
  auditEvents,
  outletMemberships,
  outlets,
  staffDeviceEnrollments,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createOneTimeToken } from "@/lib/one-time-token";
import {
  getStaffDeviceCookieName,
  isApprovedStaffDevice,
  matchesStaffDeviceToken,
} from "@/lib/staff-device";
import { and, desc, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  if (!hasServerConfiguration()) {
    return Response.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  }

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session) {
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }

    const db = getDb();
    const [staffAssignment] = await db
      .select({ id: outletMemberships.id })
      .from(outletMemberships)
      .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
      .where(
        and(
          eq(outletMemberships.userId, session.user.id),
          eq(outletMemberships.role, "staff"),
          eq(outletMemberships.isActive, true),
          eq(outlets.isActive, true),
        ),
      )
      .limit(1);

    if (!staffAssignment) {
      return Response.json({ required: false, status: "not_required" });
    }

    const enrollments = await db
      .select({
        status: staffDeviceEnrollments.status,
        tokenHash: staffDeviceEnrollments.tokenHash,
        createdAt: staffDeviceEnrollments.createdAt,
      })
      .from(staffDeviceEnrollments)
      .where(
        and(
          eq(staffDeviceEnrollments.userId, session.user.id),
          inArray(staffDeviceEnrollments.status, ["pending", "active"]),
        ),
      )
      .orderBy(desc(staffDeviceEnrollments.createdAt));
    const pending = enrollments.find((device) => device.status === "pending");
    const active = enrollments.find((device) => device.status === "active");
    const currentToken = (await cookies()).get(
      getStaffDeviceCookieName(session.user.id),
    )?.value;

    return Response.json({
      required: true,
      status: pending
        ? active
          ? "replacement_pending"
          : "pending"
        : active
          ? "active"
          : "not_enrolled",
      hasActiveDevice: Boolean(active),
      currentBrowserApproved: active
        ? isApprovedStaffDevice(currentToken, active.status, active.tokenHash)
        : false,
      currentBrowserHasPendingRequest: pending
        ? matchesStaffDeviceToken(currentToken, pending.tokenHash)
        : false,
      pendingRequestedAt: pending?.createdAt ?? null,
    });
  } catch {
    return Response.json(
      { error: "Could not load trusted-device status." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasServerConfiguration()) {
    return Response.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  }

  try {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (!session) {
      return Response.json({ error: "Sign in required." }, { status: 401 });
    }

    const db = getDb();
    const [staffAssignment] = await db
      .select({ id: outletMemberships.id })
      .from(outletMemberships)
      .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
      .where(
        and(
          eq(outletMemberships.userId, session.user.id),
          eq(outletMemberships.role, "staff"),
          eq(outletMemberships.isActive, true),
          eq(outlets.isActive, true),
        ),
      )
      .limit(1);

    if (!staffAssignment) {
      return Response.json(
        { error: "Only staff can enroll a device." },
        { status: 403 },
      );
    }

    const cookieStore = await cookies();
    const cookieName = getStaffDeviceCookieName(session.user.id);
    const currentToken = cookieStore.get(cookieName)?.value;
    const enrollments = await db
      .select({
        id: staffDeviceEnrollments.id,
        tokenHash: staffDeviceEnrollments.tokenHash,
        status: staffDeviceEnrollments.status,
      })
      .from(staffDeviceEnrollments)
      .where(
        and(
          eq(staffDeviceEnrollments.userId, session.user.id),
          inArray(staffDeviceEnrollments.status, ["pending", "active"]),
        ),
      );
    const pending = enrollments.find((device) => device.status === "pending");
    const active = enrollments.find((device) => device.status === "active");

    if (pending) {
      if (matchesStaffDeviceToken(currentToken, pending.tokenHash)) {
        return Response.json({
          status: "pending",
          replacement: Boolean(active),
        });
      }
      return Response.json(
        {
          error: "A device request is already waiting for manager approval.",
          code: "device_request_pending",
        },
        { status: 409 },
      );
    }

    if (
      active &&
      isApprovedStaffDevice(currentToken, active.status, active.tokenHash)
    ) {
      return Response.json({ status: "active", replacement: false });
    }

    const credential = createOneTimeToken();
    const created = await db.transaction(async (tx) => {
      const [enrollment] = await tx
        .insert(staffDeviceEnrollments)
        .values({ userId: session.user.id, tokenHash: credential.tokenHash })
        .returning({ id: staffDeviceEnrollments.id });

      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action: "staff_device_enrollment_requested",
        entityType: "staff_device_enrollment",
        entityId: enrollment.id,
        newValues: { userId: session.user.id, replacement: Boolean(active) },
      });
      return enrollment;
    });

    cookieStore.set(cookieName, credential.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return Response.json({
      status: "pending",
      replacement: Boolean(active),
      requestId: created.id,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return Response.json(
        {
          error: "A device request is already waiting for manager approval.",
          code: "device_request_pending",
        },
        { status: 409 },
      );
    }
    return Response.json(
      { error: "Could not request a trusted device." },
      { status: 500 },
    );
  }
}
