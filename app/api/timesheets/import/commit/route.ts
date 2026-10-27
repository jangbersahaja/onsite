import { hasServerConfiguration } from "@/lib/app-config";
import { notifyOutletManagers } from "@/lib/push-notifications";
import { getActor } from "@/lib/timesheet-actor";
import {
  commitRequestSchema,
  commitTimesheetImport,
  findImportOutlet,
  isImportTooLarge,
} from "@/lib/timesheet-import-server";

export async function POST(request: Request) {
  if (!hasServerConfiguration()) {
    return Response.json(
      { error: "Set DATABASE_URL before using timesheets." },
      { status: 503 },
    );
  }
  try {
    const actor = await getActor(request);
    if ("error" in actor) {
      return Response.json({ error: actor.error }, { status: actor.status });
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
    const parsed = commitRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error:
            "Import details are invalid. A reason of at least 3 characters is required.",
        },
        { status: 400 },
      );
    }
    if (isImportTooLarge(parsed.data.csvText)) {
      return Response.json(
        { error: "The file is too large." },
        { status: 413 },
      );
    }

    const found = findImportOutlet(actor.outlets, parsed.data.outletId);
    if ("error" in found) {
      return Response.json({ error: found.error }, { status: found.status });
    }

    const result = await commitTimesheetImport({
      actor,
      outlet: found.outlet,
      csvText: parsed.data.csvText,
      reason: parsed.data.reason,
      now: new Date(),
    });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    if (result.importedCount > 0) {
      await notifyOutletManagers({
        outletId: found.outlet.id,
        actorId: actor.userId,
        event: "timesheet_created",
      });
    }

    return Response.json({
      success: true,
      batchId: result.batchId || null,
      importedCount: result.importedCount,
      skippedCount: result.skippedCount,
      rows: result.rows,
    });
  } catch {
    return Response.json(
      { error: "Could not import shifts." },
      { status: 500 },
    );
  }
}
