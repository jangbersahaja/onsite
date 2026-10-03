import { user } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  deleteProfilePhoto,
  ProfilePhotoValidationError,
  uploadProfilePhoto,
} from "@/lib/profile-photo-storage";
import { MAX_PROFILE_PHOTO_BYTES } from "@/lib/profile-photo";
import { eq } from "drizzle-orm";

const maximumRequestBytes = MAX_PROFILE_PHOTO_BYTES + 64 * 1024;

function tooLarge(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  return Number.isFinite(contentLength) && contentLength > maximumRequestBytes;
}

export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "Sign in required." }, { status: 401 });
  if (tooLarge(request)) {
    return Response.json(
      { error: "Profile photos must be 2 MB or smaller." },
      { status: 413 },
    );
  }

  let uploadedPath: string | undefined;
  try {
    const form = await request.formData();
    const value = form.get("photo");
    if (!value || typeof value === "string") {
      return Response.json(
        { error: "Choose an image to upload." },
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
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    const [updated] = await db
      .update(user)
      .set({ profilePhotoPath: uploadedPath, updatedAt: new Date() })
      .where(eq(user.id, session.user.id))
      .returning({ id: user.id });
    if (!updated) {
      await deleteProfilePhoto(uploadedPath).catch(() => undefined);
      return Response.json({ error: "Account not found." }, { status: 404 });
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
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json(
      { error: "Could not update profile photo." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "Sign in required." }, { status: 401 });

  try {
    const db = getDb();
    const [current] = await db
      .select({ profilePhotoPath: user.profilePhotoPath })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);
    if (!current)
      return Response.json({ error: "Account not found." }, { status: 404 });

    await db
      .update(user)
      .set({ profilePhotoPath: null, updatedAt: new Date() })
      .where(eq(user.id, session.user.id));
    if (current.profilePhotoPath) {
      await deleteProfilePhoto(current.profilePhotoPath).catch(() => undefined);
    }
    return Response.json(
      { profilePhotoUrl: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not remove profile photo." },
      { status: 500 },
    );
  }
}
