import { auditEvents, outlets, workSessions } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getTeamAccess } from "@/lib/team-access";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const outletSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().min(4).max(300),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    radiusMeters: z.number().int().min(25).max(1000),
    timezone: z.string().trim().min(1).max(100).refine(isValidTimezone),
  })
  .strict();

const outletUpdateSchema = outletSchema.extend({ id: z.string().uuid() });

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
    if (!session)
      return Response.json({ error: "Sign in required." }, { status: 401 });

    const access = await getTeamAccess(session.user.id);
    if (!access?.isAdmin) {
      return Response.json(
        { error: "Only admins can add outlets." },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const parsed = outletSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error: "Outlet details are invalid. Check the location and timezone.",
        },
        { status: 400 },
      );
    }

    const db = getDb();
    const [created] = await db.transaction(async (tx) => {
      const [outlet] = await tx.insert(outlets).values(parsed.data).returning({
        id: outlets.id,
        name: outlets.name,
        address: outlets.address,
      });
      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action: "outlet_created",
        entityType: "outlet",
        entityId: outlet.id,
        newValues: parsed.data,
      });
      return [outlet];
    });

    return Response.json({ outlet: created }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Could not create outlet." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
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
    if (!session)
      return Response.json({ error: "Sign in required." }, { status: 401 });
    const access = await getTeamAccess(session.user.id);
    if (!access?.isAdmin) {
      return Response.json(
        { error: "Only admins can edit outlets." },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    const parsed = outletUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Outlet details are invalid." },
        { status: 400 },
      );
    }

    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const [previous] = await tx
        .select()
        .from(outlets)
        .where(and(eq(outlets.id, parsed.data.id), eq(outlets.isActive, true)))
        .limit(1);
      if (!previous) return null;
      const { id, ...values } = parsed.data;
      const [updated] = await tx
        .update(outlets)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(outlets.id, id), eq(outlets.isActive, true)))
        .returning();
      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action: "outlet_updated",
        entityType: "outlet",
        entityId: id,
        previousValues: {
          name: previous.name,
          address: previous.address,
          latitude: previous.latitude,
          longitude: previous.longitude,
          radiusMeters: previous.radiusMeters,
          timezone: previous.timezone,
        },
        newValues: values,
      });
      return updated;
    });
    if (!result)
      return Response.json(
        { error: "Active outlet not found." },
        { status: 404 },
      );
    return Response.json({ outlet: result });
  } catch {
    return Response.json(
      { error: "Could not update outlet." },
      { status: 500 },
    );
  }
}

const deactivateSchema = z
  .object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) })
  .strict();

export async function DELETE(request: Request) {
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
    if (!session)
      return Response.json({ error: "Sign in required." }, { status: 401 });
    const access = await getTeamAccess(session.user.id);
    if (!access?.isAdmin) {
      return Response.json(
        { error: "Only admins can deactivate outlets." },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }
    const parsed = deactivateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "A valid outlet and reason are required." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [openSession] = await db
      .select({ id: workSessions.id })
      .from(workSessions)
      .where(
        and(
          eq(workSessions.outletId, parsed.data.id),
          isNull(workSessions.clockOutAt),
        ),
      )
      .limit(1);
    if (openSession) {
      return Response.json(
        {
          error: "This outlet has an open shift. Close it before deactivation.",
        },
        { status: 409 },
      );
    }

    const result = await db.transaction(async (tx) => {
      const [previous] = await tx
        .select({
          id: outlets.id,
          name: outlets.name,
          isActive: outlets.isActive,
        })
        .from(outlets)
        .where(and(eq(outlets.id, parsed.data.id), eq(outlets.isActive, true)))
        .limit(1);
      if (!previous) return false;
      await tx
        .update(outlets)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(outlets.id, parsed.data.id), eq(outlets.isActive, true)));
      await tx.insert(auditEvents).values({
        actorId: session.user.id,
        action: "outlet_deactivated",
        entityType: "outlet",
        entityId: previous.id,
        previousValues: { name: previous.name, isActive: true },
        newValues: { isActive: false },
        reason: parsed.data.reason,
      });
      return true;
    });
    if (!result)
      return Response.json(
        { error: "Active outlet not found." },
        { status: 404 },
      );
    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Could not deactivate outlet." },
      { status: 500 },
    );
  }
}
