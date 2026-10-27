import { user } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { MAX_PROFILE_PHOTO_BYTES } from "@/lib/profile-photo";
import {
  deleteProfilePhoto,
  ProfilePhotoValidationError,
  uploadProfilePhoto,
} from "@/lib/profile-photo-storage";
import { eq } from "drizzle-orm";

const maximumRequestBytes = MAX_PROFILE_PHOTO_BYTES + 64 * 1024;

function tooLarge(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  return Number.isFinite(contentLength) && contentLength > maximumRequestBytes;
}

function photoValidationCode(message: string) {
  if (message === "Choose an image to upload.") return "image_required";
  if (message === "Choose a JPEG, PNG, or WebP image.")
    return "photo_type_invalid";
  if (message === "Profile photos must be 4 MB or smaller.")
    return "photo_too_large";
  return "photo_invalid";
}

export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Sign in required.", code: "unauthorized" },
      { status: 401 },
    );
  if (tooLarge(request)) {
    return Response.json(
      {
        error: "Profile photos must be 4 MB or smaller.",
        code: "photo_too_large",
      },
      { status: 413 },
    );
  }

  let uploadedPath: string | undefined;
  try {
    const form = await request.formData();
    const value = form.get("photo");
    if (!value || typeof value === "string") {
      return Response.json(
        { error: "Choose an image to upload.", code: "image_required" },
        { status: 400 },
      );
    }

    uploadedPath = await uploadProfilePhoto(session.user.id, value);
    const db = getDb();
    const [current] = await db
      .select({ profilePhotoPath: user.profilePhotoPath })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);
    if (!current) {
      await deleteProfilePhoto(uploadedPath).catch(() => undefined);
      return Response.json(
        { error: "Account not found.", code: "account_not_found" },
        { status: 404 },
      );
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(user)
        .set({ profilePhotoPath: uploadedPath, updatedAt: new Date() })
        .where(eq(user.id, session.user.id))
        .returning({ id: user.id });
      if (!row) return null;
      await recordAudit(tx, {
        actorId: session.user.id,
        action: "profile_photo_updated",
        entityType: "user",
        entityId: session.user.id,
      });
      return row;
    });
    if (!updated) {
      await deleteProfilePhoto(uploadedPath).catch(() => undefined);
      return Response.json(
        { error: "Account not found.", code: "account_not_found" },
        { status: 404 },
      );
    }
    if (current.profilePhotoPath) {
      await deleteProfilePhoto(current.profilePhotoPath).catch(() => undefined);
    }

    return Response.json(
      {
        profilePhotoUrl: `/api/profile-photos/${encodeURIComponent(session.user.id)}`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (uploadedPath) {
      await deleteProfilePhoto(uploadedPath).catch(() => undefined);
    }
    if (error instanceof ProfilePhotoValidationError) {
      return Response.json(
        { error: error.message, code: photoValidationCode(error.message) },
        { status: 400 },
      );
    }
    return Response.json(
      {
        error: "Could not update profile photo.",
        code: "profile_photo_update_failed",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Sign in required.", code: "unauthorized" },
      { status: 401 },
    );

  try {
    const db = getDb();
    const [current] = await db
      .select({ profilePhotoPath: user.profilePhotoPath })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);
    if (!current)
      return Response.json(
        { error: "Account not found.", code: "account_not_found" },
        { status: 404 },
      );

    await db.transaction(async (tx) => {
      await tx
        .update(user)
        .set({ profilePhotoPath: null, updatedAt: new Date() })
        .where(eq(user.id, session.user.id));
      if (current.profilePhotoPath) {
        await recordAudit(tx, {
          actorId: session.user.id,
          action: "profile_photo_removed",
          entityType: "user",
          entityId: session.user.id,
        });
      }
    });
    if (current.profilePhotoPath) {
      await deleteProfilePhoto(current.profilePhotoPath).catch(() => undefined);
    }
    return Response.json(
      { profilePhotoUrl: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error: "Could not remove profile photo.",
        code: "profile_photo_remove_failed",
      },
      { status: 500 },
    );
  }
}
