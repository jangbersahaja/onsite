import { outlets } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { MAX_OUTLET_PHOTO_BYTES, outletPhotoUrl } from "@/lib/outlet-photo";
import {
  deleteOutletPhoto,
  OutletPhotoValidationError,
  uploadOutletPhoto,
} from "@/lib/outlet-photo-storage";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const maximumRequestBytes = MAX_OUTLET_PHOTO_BYTES + 64 * 1024;
const outletIdSchema = z.uuid();

type RouteContext = { params: Promise<{ id: string }> };

function tooLarge(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  return Number.isFinite(contentLength) && contentLength > maximumRequestBytes;
}

function photoValidationCode(message: string) {
  if (message === "Choose an image to upload.") return "image_required";
  if (message === "Choose a JPEG, PNG, or WebP image.")
    return "photo_type_invalid";
  if (message === "Outlet photos must be 4 MB or smaller.")
    return "photo_too_large";
  return "photo_invalid";
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!hasServerConfiguration()) {
    return Response.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  }
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Sign in required.", code: "unauthorized" },
      { status: 401 },
    );
  const access = await getTeamAccess(session.user.id);
  if (!access?.isSuperAdmin) {
    return Response.json(
      { error: "Only the super admin can change outlet photos." },
      { status: 403 },
    );
  }
  const { id } = await params;
  if (!outletIdSchema.safeParse(id).success) {
    return Response.json(
      { error: "Outlet not found.", code: "outlet_not_found" },
      { status: 404 },
    );
  }
  if (tooLarge(request)) {
    return Response.json(
      {
        error: "Outlet photos must be 4 MB or smaller.",
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

    const newPath = await uploadOutletPhoto(id, value);
    uploadedPath = newPath;
    const db = getDb();
    const previousOutlet = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ imagePath: outlets.imagePath })
        .from(outlets)
        .where(and(eq(outlets.id, id), eq(outlets.isActive, true)))
        .limit(1);
      if (!current) return undefined;
      await tx
        .update(outlets)
        .set({ imagePath: newPath, updatedAt: new Date() })
        .where(eq(outlets.id, id));
      await recordAudit(tx, {
        actorId: session.user.id,
        action: "outlet_photo_updated",
        entityType: "outlet",
        entityId: id,
        outletId: id,
      });
      return { imagePath: current.imagePath };
    });
    if (previousOutlet === undefined) {
      await deleteOutletPhoto(newPath).catch(() => undefined);
      return Response.json(
        { error: "Outlet not found.", code: "outlet_not_found" },
        { status: 404 },
      );
    }
    if (previousOutlet.imagePath) {
      await deleteOutletPhoto(previousOutlet.imagePath).catch(() => undefined);
    }

    return Response.json(
      { imageUrl: outletPhotoUrl(id, newPath) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (uploadedPath) {
      await deleteOutletPhoto(uploadedPath).catch(() => undefined);
    }
    if (error instanceof OutletPhotoValidationError) {
      return Response.json(
        { error: error.message, code: photoValidationCode(error.message) },
        { status: 400 },
      );
    }
    return Response.json(
      {
        error: "Could not update outlet photo.",
        code: "outlet_photo_update_failed",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  if (!hasServerConfiguration()) {
    return Response.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  }
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "Sign in required.", code: "unauthorized" },
      { status: 401 },
    );
  const access = await getTeamAccess(session.user.id);
  if (!access?.isSuperAdmin) {
    return Response.json(
      { error: "Only the super admin can change outlet photos." },
      { status: 403 },
    );
  }
  const { id } = await params;
  if (!outletIdSchema.safeParse(id).success) {
    return Response.json(
      { error: "Outlet not found.", code: "outlet_not_found" },
      { status: 404 },
    );
  }

  try {
    const db = getDb();
    const previous = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ imagePath: outlets.imagePath })
        .from(outlets)
        .where(and(eq(outlets.id, id), eq(outlets.isActive, true)))
        .limit(1);
      if (!current) return undefined;
      if (!current.imagePath) return { imagePath: null };
      await tx
        .update(outlets)
        .set({ imagePath: null, updatedAt: new Date() })
        .where(eq(outlets.id, id));
      await recordAudit(tx, {
        actorId: session.user.id,
        action: "outlet_photo_removed",
        entityType: "outlet",
        entityId: id,
        outletId: id,
      });
      return { imagePath: current.imagePath };
    });
    if (previous === undefined) {
      return Response.json(
        { error: "Outlet not found.", code: "outlet_not_found" },
        { status: 404 },
      );
    }
    if (previous.imagePath) {
      await deleteOutletPhoto(previous.imagePath).catch(() => undefined);
    }
    return Response.json(
      { imageUrl: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error: "Could not remove outlet photo.",
        code: "outlet_photo_update_failed",
      },
      { status: 500 },
    );
  }
}
