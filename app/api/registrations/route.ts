import { outlets, user } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getTeamAccess } from "@/lib/team-access";
import { and, desc, eq, inArray } from "drizzle-orm";

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
    const access = await getTeamAccess(session.user.id);
    if (!access) {
      return Response.json({ error: "Team access denied." }, { status: 403 });
    }

    const conditions = [eq(user.approvalStatus, "pending")];
    if (!access.isSuperAdmin) {
      if (!access.outletIds.length) {
        return Response.json(
          { requests: [] },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      conditions.push(inArray(user.registrationOutletId, access.outletIds));
    }

    const rows = await getDb()
      .select({
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        requestedAt: user.createdAt,
        outletId: user.registrationOutletId,
        outletName: outlets.name,
      })
      .from(user)
      .leftJoin(outlets, eq(user.registrationOutletId, outlets.id))
      .where(and(...conditions))
      .orderBy(desc(user.createdAt))
      .limit(200);

    return Response.json(
      {
        requests: rows.map((row) => ({
          ...row,
          photoUrl: `/api/profile-photos/${row.id}`,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not load registrations." },
      { status: 500 },
    );
  }
}
