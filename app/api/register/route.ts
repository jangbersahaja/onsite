import { auditEvents, staffDeviceEnrollments, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getDb } from "@/lib/db";
import { describeDeviceFromUserAgent } from "@/lib/device-name";
import { createOneTimeToken } from "@/lib/one-time-token";
import { hashPassword } from "@/lib/password";
import { MAX_PROFILE_PHOTO_BYTES } from "@/lib/profile-photo";
import {
  deleteProfilePhoto,
  ProfilePhotoValidationError,
  uploadProfilePhoto,
  validateProfilePhotoFile,
} from "@/lib/profile-photo-storage";
import {
  allowRegistrationAttempt,
  findActiveRegistrationLink,
  isRegistrationTokenFormat,
} from "@/lib/registration";
import { getStaffDeviceCookieName } from "@/lib/staff-device";
import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const registerSchema = z
  .object({
    token: z.string().min(32).max(128),
    name: z.string().trim().min(2).max(120),
    username: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[a-zA-Z0-9._-]+$/),
    email: z.string().trim().max(254).email(),
    password: z.string().min(12).max(128),
  })
  .strict();

function unavailable() {
  return Response.json(
    { error: "Authentication is not configured." },
    { status: 503 },
  );
}

function linkInactive() {
  return Response.json(
    {
      error:
        "This registration link is no longer active. Ask your manager for a new one.",
    },
    { status: 410 },
  );
}

export async function GET(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!isRegistrationTokenFormat(token)) return linkInactive();

  try {
    const link = await findActiveRegistrationLink(token);
    if (!link) return linkInactive();
    return Response.json(
      { outletName: link.outletName },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not verify this registration link." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return Response.json(
      { error: "Registration requires a profile photo upload." },
      { status: 400 },
    );
  }
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

  const now = new Date();
  const clientAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await allowRegistrationAttempt(clientAddress, now))) {
    return Response.json(
      { error: "Too many registration attempts. Try again later." },
      { status: 429 },
    );
  }

  let profilePhotoFile: File;
  let rawBody: unknown;
  try {
    const form = await request.formData();
    rawBody = {
      token: form.get("token"),
      name: form.get("name"),
      username: form.get("username"),
      email: form.get("email"),
      password: form.get("password"),
    };
    const photo = form.get("profilePhoto");
    if (photo === null || typeof photo === "string" || photo.size === 0) {
      return Response.json(
        { error: "A profile photo is required." },
        { status: 400 },
      );
    }
    profilePhotoFile = photo;
  } catch {
    return Response.json(
      { error: "Request body must be a valid form submission." },
      { status: 400 },
    );
  }

  const parsed = registerSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      {
        error:
          "Name, username, email, a password of at least 12 characters, and a valid link are required.",
      },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const email = input.email.toLowerCase();
  const username = input.username.toLowerCase();

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

  const db = getDb();
  let createdUserId: string | undefined;
  let uploadedProfilePhotoPath: string | undefined;

  try {
    const link = await findActiveRegistrationLink(input.token);
    if (!link) return linkInactive();

    const [existingEmail] = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${email}`)
      .limit(1);
    if (existingEmail) {
      return Response.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }

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

    createdUserId = randomUUID();
    const passwordHash = await hashPassword(input.password);
    const device = createOneTimeToken();
    uploadedProfilePhotoPath = await uploadProfilePhoto(
      createdUserId,
      profilePhotoFile,
    );

    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: createdUserId!,
        name: input.name,
        username,
        email,
        passwordHash,
        profilePhotoPath: uploadedProfilePhotoPath ?? null,
        accountType: "user",
        canAccessClock: true,
        canAccessBackoffice: false,
        approvalStatus: "pending",
        registrationOutletId: link.outletId,
      });

      // Pending until a manager approves the registration. The device is
      // activated in the same step as approval, never before.
      await tx.insert(staffDeviceEnrollments).values({
        userId: createdUserId!,
        tokenHash: device.tokenHash,
        deviceName: describeDeviceFromUserAgent(
          request.headers.get("user-agent"),
        ),
        status: "pending",
      });

      await tx.insert(auditEvents).values({
        actorId: createdUserId!,
        action: "registration_submitted",
        entityType: "user",
        entityId: createdUserId!,
        newValues: { outletId: link.outletId, username, email },
      });
    });

    const cookieStore = await cookies();
    cookieStore.set(getStaffDeviceCookieName(createdUserId), device.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return Response.json({ submitted: true }, { status: 201 });
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
    return Response.json(
      { error: "Could not submit this registration." },
      { status: 400 },
    );
  }
}
