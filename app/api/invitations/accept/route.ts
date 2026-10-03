import {
  auditEvents,
  invitationOutlets,
  invitations,
  outletMemberships,
  outlets,
  staffDeviceEnrollments,
  user,
} from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getDb } from "@/lib/db";
import { createOneTimeToken, hashOneTimeToken } from "@/lib/one-time-token";
import { hashPassword } from "@/lib/password";
import {
  deleteProfilePhoto,
  ProfilePhotoValidationError,
  uploadProfilePhoto,
  validateProfilePhotoFile,
} from "@/lib/profile-photo-storage";
import { MAX_PROFILE_PHOTO_BYTES } from "@/lib/profile-photo";
import { getStaffDeviceCookieName } from "@/lib/staff-device";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const acceptSchema = z
  .object({
    token: z.string().min(32).max(128),
    name: z.string().trim().min(2).max(120),
    username: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[a-zA-Z0-9._-]+$/),
    password: z.string().min(12).max(128),
  })
  .strict();

function unavailable() {
  return Response.json(
    { error: "Authentication is not configured." },
    { status: 503 },
  );
}

function eligibleInvitation(now: Date) {
  return and(
    isNull(invitations.acceptedAt),
    isNull(invitations.revokedAt),
    gt(invitations.expiresAt, now),
    or(
      isNull(invitations.claimedAt),
      lt(invitations.claimedAt, new Date(now.getTime() - 5 * 60_000)),
    ),
  );
}

export async function GET(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length < 32 || token.length > 128) {
    return Response.json(
      { error: "This invitation link is invalid." },
      { status: 400 },
    );
  }

  try {
    const now = new Date();
    const [invitation] = await getDb()
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        accountType: invitations.accountType,
        canAccessClock: invitations.canAccessClock,
        canAccessBackoffice: invitations.canAccessBackoffice,
        outletId: invitations.outletId,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.tokenHash, hashOneTimeToken(token)),
          eligibleInvitation(now),
        ),
      )
      .limit(1);

    if (!invitation) {
      return Response.json(
        { error: "This invitation is expired or already used." },
        { status: 410 },
      );
    }

    const linkedOutlets = await getDb()
      .select({ name: outlets.name })
      .from(invitationOutlets)
      .innerJoin(outlets, eq(invitationOutlets.outletId, outlets.id))
      .where(eq(invitationOutlets.invitationId, invitation.id));
    const outletNames = linkedOutlets.length
      ? linkedOutlets.map((outlet) => outlet.name)
      : invitation.outletId
        ? await getDb()
            .select({ name: outlets.name })
            .from(outlets)
            .where(eq(outlets.id, invitation.outletId))
            .then((rows) => rows.map((outlet) => outlet.name))
        : [];

    return Response.json(
      { ...invitation, outletNames },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      { error: "Could not verify this invitation." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  let rawBody: unknown;
  let profilePhotoFile: File | null = null;
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const contentLength = Number(request.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_PROFILE_PHOTO_BYTES + 64 * 1024
      ) {
        return Response.json(
          { error: "Profile photos must be 2 MB or smaller." },
          { status: 413 },
        );
      }
      const form = await request.formData();
      rawBody = {
        token: form.get("token"),
        name: form.get("name"),
        username: form.get("username"),
        password: form.get("password"),
      };
      const photo = form.get("profilePhoto");
      if (photo !== null && typeof photo !== "string" && photo.size > 0) {
        profilePhotoFile = photo;
      }
    } else {
      rawBody = await request.json();
    }
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = acceptSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Name, username, password, and invitation token are required." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  if (profilePhotoFile) {
    try {
      await validateProfilePhotoFile(profilePhotoFile);
    } catch (error) {
      if (error instanceof ProfilePhotoValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      return Response.json(
        { error: "Could not validate profile photo." },
        { status: 400 },
      );
    }
  }
  const db = getDb();
  const now = new Date();
  let claimedInvitation:
    | {
        id: string;
        email: string;
        role: "manager" | "supervisor" | "staff";
        outletId: string | null;
        invitedBy: string;
        accountType: "super_admin" | "admin" | "staff";
        canAccessClock: boolean;
        canAccessBackoffice: boolean;
      }
    | undefined;
  let createdUserId: string | undefined;
  let uploadedProfilePhotoPath: string | undefined;

  try {
    const tokenHash = hashOneTimeToken(input.token);
    const [available] = await db
      .select({ id: invitations.id, email: invitations.email })
      .from(invitations)
      .where(and(eq(invitations.tokenHash, tokenHash), eligibleInvitation(now)))
      .limit(1);

    if (!available) {
      return Response.json(
        { error: "This invitation is expired or already used." },
        { status: 410 },
      );
    }

    const [existingUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${available.email}`)
      .limit(1);
    if (existingUser) {
      return Response.json(
        {
          error:
            "This email already has an account. Ask your manager for help.",
        },
        { status: 409 },
      );
    }

    const username = input.username.toLowerCase();
    const [existingUsername] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.username}) = ${username}`)
      .limit(1);
    if (existingUsername) {
      return Response.json(
        { error: "This username is already taken." },
        { status: 409 },
      );
    }

    const [claimed] = await db
      .update(invitations)
      .set({ claimedAt: now })
      .where(
        and(
          eq(invitations.id, available.id),
          eq(invitations.tokenHash, tokenHash),
          eligibleInvitation(now),
        ),
      )
      .returning({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        outletId: invitations.outletId,
        invitedBy: invitations.invitedBy,
        accountType: invitations.accountType,
        canAccessClock: invitations.canAccessClock,
        canAccessBackoffice: invitations.canAccessBackoffice,
      });

    if (!claimed) {
      return Response.json(
        { error: "This invitation is being used or has expired." },
        { status: 409 },
      );
    }
    claimedInvitation = claimed;

    createdUserId = randomUUID();
    const passwordHash = await hashPassword(input.password);
    const firstDevice = claimed.role === "staff" ? createOneTimeToken() : null;
    if (profilePhotoFile) {
      uploadedProfilePhotoPath = await uploadProfilePhoto(
        createdUserId,
        profilePhotoFile,
      );
    }

    await db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(invitations)
        .set({ acceptedAt: now, claimedAt: null })
        .where(
          and(
            eq(invitations.id, claimed.id),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            eq(invitations.claimedAt, now),
          ),
        )
        .returning({ id: invitations.id });
      if (!consumed)
        throw new Error("Invitation was revoked before acceptance completed.");

      await tx.insert(user).values({
        id: createdUserId!,
        name: input.name,
        username,
        email: claimed.email,
        passwordHash,
        profilePhotoPath: uploadedProfilePhotoPath ?? null,
        accountType: claimed.accountType,
        canAccessClock: claimed.canAccessClock,
        canAccessBackoffice: claimed.canAccessBackoffice,
      });

      const linkedOutlets = await tx
        .select({ outletId: invitationOutlets.outletId })
        .from(invitationOutlets)
        .where(eq(invitationOutlets.invitationId, claimed.id));
      const assignedOutletIds = Array.from(
        new Set([
          ...linkedOutlets.map((outlet) => outlet.outletId),
          ...(claimed.outletId ? [claimed.outletId] : []),
        ]),
      );
      if (assignedOutletIds.length) {
        await tx.insert(outletMemberships).values(
          assignedOutletIds.map((outletId) => ({
            userId: createdUserId!,
            outletId,
            role:
              claimed.accountType === "admin"
                ? ("manager" as const)
                : claimed.role,
            assignedBy: claimed.invitedBy,
          })),
        );
      }

      if (firstDevice) {
        const [enrollment] = await tx
          .insert(staffDeviceEnrollments)
          .values({
            userId: createdUserId!,
            tokenHash: firstDevice.tokenHash,
            status: "active",
            approvedAt: now,
          })
          .returning({ id: staffDeviceEnrollments.id });

        await tx.insert(auditEvents).values({
          actorId: createdUserId!,
          action: "staff_device_first_registration_enrolled",
          entityType: "staff_device_enrollment",
          entityId: enrollment.id,
          newValues: { userId: createdUserId, automatic: true },
        });
      }

      await tx.insert(auditEvents).values({
        actorId: createdUserId!,
        action: "invitation_accepted",
        entityType: "invitation",
        entityId: claimed.id,
        newValues: {
          email: claimed.email,
          username,
          role: claimed.role,
          accountType: claimed.accountType,
          outletIds: assignedOutletIds,
        },
      });
    });

    if (firstDevice) {
      const cookieStore = await cookies();
      cookieStore.set(
        getStaffDeviceCookieName(createdUserId),
        firstDevice.token,
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        },
      );
    }

    return Response.json({ accepted: true }, { status: 201 });
  } catch {
    if (uploadedProfilePhotoPath) {
      await deleteProfilePhoto(uploadedProfilePhotoPath).catch(() => undefined);
    }
    if (createdUserId) {
      await db
        .delete(user)
        .where(eq(user.id, createdUserId))
        .catch(() => undefined);
    }
    if (claimedInvitation) {
      await db
        .update(invitations)
        .set({ claimedAt: null })
        .where(
          and(
            eq(invitations.id, claimedInvitation.id),
            isNull(invitations.acceptedAt),
          ),
        )
        .catch(() => undefined);
    }
    return Response.json(
      { error: "Could not accept this invitation." },
      { status: 400 },
    );
  }
}
