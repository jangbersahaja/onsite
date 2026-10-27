import { hasServerConfiguration } from "@/lib/app-config";
import { getActor } from "@/lib/timesheet-actor";
import { buildTimesheetImportTemplate } from "@/lib/timesheet-import";

export async function GET(request: Request) {
  if (!hasServerConfiguration()) {
    return Response.json(
      { error: "Set DATABASE_URL before using timesheets." },
      { status: 503 },
    );
  }
  const actor = await getActor(request);
  if ("error" in actor) {
    return Response.json({ error: actor.error }, { status: actor.status });
  }

  return new Response(buildTimesheetImportTemplate(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="timesheet-import-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
