import { hasServerConfiguration } from "@/lib/app-config";
import { getDb } from "@/lib/db";
import { getActor } from "@/lib/timesheet-actor";
import {
  evaluateTimesheetImport,
  findImportOutlet,
  importRequestSchema,
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
    const parsed = importRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Import details are invalid." },
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

    const evaluation = await evaluateTimesheetImport(getDb(), {
      actor,
      outlet: found.outlet,
      csvText: parsed.data.csvText,
      now: new Date(),
    });
    if (!evaluation.ok) {
      return Response.json({ error: evaluation.error }, { status: 400 });
    }

    return Response.json({
      rows: evaluation.rows,
      importableCount: evaluation.importableCount,
      errorCount: evaluation.errorCount,
    });
  } catch {
    return Response.json(
      { error: "Could not check the import file." },
      { status: 500 },
    );
  }
}
