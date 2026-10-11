import { outlets, registrationLinks } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  buildRegistrationUrl,
  createRegistrationToken,
} from "@/lib/registration";
import { canManageOutletRegistration } from "@/lib/registration-rules";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

const createLinkSchema = z
  .object({
    outletId: z.string().uuid(),
    rotate: z.boolean().optional().default(false),
  })
  .strict();

function unavailable() {
  return Response.json(
    { error: "Authentication is not configured." },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

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

    const activeLinks = access.outletIds.length
      ? await getDb()
          .select({
            id: registrationLinks.id,
            outletId: registrationLinks.outletId,
            token: registrationLinks.token,
            createdAt: registrationLinks.createdAt,
          })
          .from(registrationLinks)
          .where(
            and(
              inArray(registrationLinks.outletId, access.outletIds),
              isNull(registrationLinks.revokedAt),
            ),
          )
      : [];
    const linkByOutlet = new Map(
      activeLinks.map((link) => [link.outletId, link]),
    );

    return Response.json(
      {
        outlets: access.outlets.map((outlet) => {
          const link = linkByOutlet.get(outlet.id);
          return {
            outletId: outlet.id,
            outletName: outlet.name,
            link: link
              ? {
                  id: link.id,
                  url: buildRegistrationUrl(request.url, link.token),
                  createdAt: link.createdAt,
                }
              : null,
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not load registration links." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasServerConfiguration()) return unavailable();

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

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    const parsed = createLinkSchema.safeParse(rawBody);
    if (!parsed.success) {
      return Response.json(
        { error: "A valid outlet is required." },
        { status: 400 },
      );
    }
    const { outletId, rotate } = parsed.data;

    if (
      !canManageOutletRegistration(
        {
          id: session.user.id,
          isSuperAdmin: access.isSuperAdmin,
          outletIds: access.outletIds,
        },
        outletId,
      )
    ) {
      return Response.json(
        { error: "You cannot manage registration for this outlet." },
        { status: 403 },
      );
    }

    const db = getDb();
    const [outlet] = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(and(eq(outlets.id, outletId), eq(outlets.isActive, true)))
      .limit(1);
    if (!outlet) {
      return Response.json({ error: "Outlet not found." }, { status: 404 });
    }

    const [existing] = await db
      .select({
        id: registrationLinks.id,
        token: registrationLinks.token,
        createdAt: registrationLinks.createdAt,
      })
      .from(registrationLinks)
      .where(
        and(
          eq(registrationLinks.outletId, outletId),
          isNull(registrationLinks.revokedAt),
        ),
      )
      .limit(1);

    if (existing && !rotate) {
      return Response.json({
        link: {
          id: existing.id,
          outletId,
          url: buildRegistrationUrl(request.url, existing.token),
          createdAt: existing.createdAt,
        },
      });
    }

    const token = createRegistrationToken();
    const now = new Date();
    const created = await db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(registrationLinks)
          .set({ revokedAt: now })
          .where(eq(registrationLinks.id, existing.id));
      }
      const [link] = await tx
        .insert(registrationLinks)
        .values({ outletId, token, createdBy: session.user.id })
        .returning({
          id: registrationLinks.id,
          createdAt: registrationLinks.createdAt,
        });
      await recordAudit(tx, {
        actorId: session.user.id,
        action: existing
          ? "registration_link_rotated"
          : "registration_link_created",
        entityType: "registration_link",
        entityId: link.id,
        outletId,
        newValues: { outletId, replacedLinkId: existing?.id ?? null },
      });
      return link;
    });

    return Response.json(
      {
        link: {
          id: created.id,
          outletId,
          url: buildRegistrationUrl(request.url, token),
          createdAt: created.createdAt,
        },
      },
      { status: existing ? 200 : 201 },
    );
  } catch {
    return Response.json(
      { error: "Could not create the registration link." },
      { status: 500 },
    );
  }
}
