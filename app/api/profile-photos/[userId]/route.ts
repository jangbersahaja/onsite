import { outletMemberships, user } from "@/db/schema";
import { get } from "@vercel/blob";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { PROFILE_PHOTO_CONTENT_TYPES } from "@/lib/profile-photo";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq, inArray } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return new Response("Sign in required.", { status: 401 });

  try {
    const { userId } = await params;
    if (!userId || userId.length > 128)
      return new Response("Not found.", { status: 404 });
    const db = getDb();
    const [target] = await db
      .select({ profilePhotoPath: user.profilePhotoPath })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (
      !target?.profilePhotoPath ||
      !target.profilePhotoPath.startsWith(`profile-photos/${userId}-`)
    ) {
      return new Response("Not found.", { status: 404 });
    }

    if (session.user.id !== userId) {
      const access = await getTeamAccess(session.user.id);
      if (!access?.outletIds.length)
        return new Response("Forbidden.", { status: 403 });
      const [membership] = await db
        .select({ userId: outletMemberships.userId })
        .from(outletMemberships)
        .where(
          and(
            eq(outletMemberships.userId, userId),
            eq(outletMemberships.isActive, true),
            inArray(outletMemberships.outletId, access.outletIds),
          ),
        )
        .limit(1);
      if (!membership) return new Response("Forbidden.", { status: 403 });
    }

    const result = await get(target.profilePhotoPath, { access: "private" });
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
    return new Response("Could not load profile photo.", { status: 500 });
  }
}
