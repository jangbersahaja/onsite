import { shiftTemplates } from "@/db/schema";
import { hasServerConfiguration } from "@/lib/app-config";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import {
  readJson,
  requireScheduleActor,
  scheduleErrorResponse,
  scheduleUnavailable,
  timeSchema,
} from "@/lib/schedule-api";
import { requireScheduleOutlet, ScheduleError } from "@/lib/schedule-data";
import { SHIFT_COLORS, validateShiftTimes } from "@/lib/schedule-rules";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const templateFields = {
  outletId: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
  code: z.string().trim().min(1).max(4),
  startTime: timeSchema,
  endTime: timeSchema,
  breakMinutes: z.number().int().min(0).max(240),
  color: z.enum(SHIFT_COLORS),
};
const createSchema = z.object(templateFields).strict();
const updateSchema = z
  .object({ ...templateFields, id: z.string().uuid() })
  .strict();
const deleteSchema = z
  .object({ outletId: z.string().uuid(), id: z.string().uuid() })
  .strict();

function validate(input: z.infer<typeof createSchema>) {
  const invalid = validateShiftTimes(input);
  if (invalid) throw new ScheduleError(invalid);
}

export async function POST(request: Request) {
  if (!hasServerConfiguration()) return scheduleUnavailable();
  try {
    const actor = await requireScheduleActor(request);
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ScheduleError("Check the template details.");
    validate(parsed.data);
    const outlet = requireScheduleOutlet(actor, parsed.data.outletId);
    const template = await getDb().transaction(async (tx) => {
      const [row] = await tx
        .insert(shiftTemplates)
        .values({
          ...parsed.data,
          code: parsed.data.code.toUpperCase(),
          createdBy: actor.userId,
        })
        .returning();
      await recordAudit(tx, {
        actorId: actor.userId,
        action: "shift_template_created",
        entityType: "shift_template",
        entityId: row.id,
        outletId: outlet.id,
        newValues: parsed.data,
      });
      return row;
    });
    return Response.json({ template }, { status: 201 });
  } catch (error) {
    return scheduleErrorResponse(error, "Could not save the template.");
  }
}

export async function PATCH(request: Request) {
  if (!hasServerConfiguration()) return scheduleUnavailable();
  try {
    const actor = await requireScheduleActor(request);
    const parsed = updateSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ScheduleError("Check the template details.");
    validate(parsed.data);
    const { id, ...values } = parsed.data;
    const outlet = requireScheduleOutlet(actor, values.outletId);
    const template = await getDb().transaction(async (tx) => {
      const [previous] = await tx
        .select()
        .from(shiftTemplates)
        .where(
          and(eq(shiftTemplates.id, id), eq(shiftTemplates.outletId, outlet.id)),
        )
        .limit(1);
      if (!previous) throw new ScheduleError("This template no longer exists.", 404);
      const [row] = await tx
        .update(shiftTemplates)
        .set({
          ...values,
          code: values.code.toUpperCase(),
          updatedAt: new Date(),
        })
        .where(eq(shiftTemplates.id, id))
        .returning();
      await recordAudit(tx, {
        actorId: actor.userId,
        action: "shift_template_updated",
        entityType: "shift_template",
        entityId: id,
        outletId: outlet.id,
        previousValues: previous,
        newValues: values,
      });
      return row;
    });
    return Response.json({ template });
  } catch (error) {
    return scheduleErrorResponse(error, "Could not update the template.");
  }
}

/** Existing shifts keep their times; they just lose the template link. */
export async function DELETE(request: Request) {
  if (!hasServerConfiguration()) return scheduleUnavailable();
  try {
    const actor = await requireScheduleActor(request);
    const parsed = deleteSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ScheduleError("Choose a template.");
    const outlet = requireScheduleOutlet(actor, parsed.data.outletId);
    await getDb().transaction(async (tx) => {
      const [deleted] = await tx
        .delete(shiftTemplates)
        .where(
          and(
            eq(shiftTemplates.id, parsed.data.id),
            eq(shiftTemplates.outletId, outlet.id),
          ),
        )
        .returning();
      if (!deleted) throw new ScheduleError("This template no longer exists.", 404);
      await recordAudit(tx, {
        actorId: actor.userId,
        action: "shift_template_deleted",
        entityType: "shift_template",
        entityId: deleted.id,
        outletId: outlet.id,
        previousValues: deleted,
      });
    });
    return Response.json({ ok: true });
  } catch (error) {
    return scheduleErrorResponse(error, "Could not delete the template.");
  }
}
