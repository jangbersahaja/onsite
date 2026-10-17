import { outletMemberships, outlets } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { outletPhotoPathPrefix } from "@/lib/outlet-photo";
import { PROFILE_PHOTO_CONTENT_TYPES } from "@/lib/profile-photo";
import { getTeamAccess } from "@/lib/team-access";
import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const outletIdSchema = z.uuid();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ outletId: string }> },
) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return new Response("Sign in required.", { status: 401 });

  try {
    const { outletId } = await params;
    if (!outletIdSchema.safeParse(outletId).success)
      return new Response("Not found.", { status: 404 });

    const db = getDb();
    const [outlet] = await db
      .select({ imagePath: outlets.imagePath })
      .from(outlets)
      .where(eq(outlets.id, outletId))
      .limit(1);
    if (
      !outlet?.imagePath ||
      !outlet.imagePath.startsWith(outletPhotoPathPrefix(outletId))
    ) {
      return new Response("Not found.", { status: 404 });
    }

    const access = await getTeamAccess(session.user.id);
    if (!access?.outletIds.includes(outletId)) {
      const [membership] = await db
        .select({ id: outletMemberships.id })
        .from(outletMemberships)
        .innerJoin(outlets, eq(outletMemberships.outletId, outlets.id))
        .where(
          and(
            eq(outletMemberships.userId, session.user.id),
            eq(outletMemberships.outletId, outletId),
            eq(outletMemberships.isActive, true),
            eq(outlets.isActive, true),
          ),
        )
        .limit(1);
      if (!membership) return new Response("Forbidden.", { status: 403 });
    }

    const result = await get(outlet.imagePath, { access: "private" });
    const contentType = result?.blob.contentType;
    if (
      !result ||
      result.statusCode !== 200 ||
      !result.stream ||
      !contentType ||
      !PROFILE_PHOTO_CONTENT_TYPES.includes(
        contentType as (typeof PROFILE_PHOTO_CONTENT_TYPES)[number],
      )
    ) {
      return new Response("Not found.", { status: 404 });
    }

    return new Response(result.stream, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Could not load outlet photo.", { status: 500 });
  }
}
