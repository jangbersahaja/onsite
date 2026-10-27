import { outletMemberships, user, workBreaks, workSessions } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { staffCodeKey } from "@/lib/staff-code";
import {
  hasOverlap,
  type ManualBreak,
  type TimeRange,
} from "@/lib/timesheet-create-rules";
import {
  buildImportedShift,
  parseTimesheetImportCsv,
  TIMESHEET_IMPORT_MAX_BYTES,
} from "@/lib/timesheet-import";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const importRequestSchema = z
  .object({
    outletId: z.string().uuid(),
    csvText: z.string().min(1).max(TIMESHEET_IMPORT_MAX_BYTES),
  })
  .strict();

export const commitRequestSchema = importRequestSchema
  .extend({
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export function isImportTooLarge(csvText: string) {
  return Buffer.byteLength(csvText, "utf8") > TIMESHEET_IMPORT_MAX_BYTES;
}

/** Finds an outlet the actor can import into. Inactive outlets are refused. */
export function findImportOutlet(
  outlets: ReadonlyArray<{ id: string; timezone: string; isActive?: boolean }>,
  outletId: string,
) {
  const outlet = outlets.find((item) => item.id === outletId);
  if (!outlet) {
    return {
      error: "You cannot access this outlet.",
      status: 403 as const,
    };
  }
  if (outlet.isActive === false) {
    return { error: "This outlet is inactive.", status: 403 as const };
  }
  return { outlet: { id: outlet.id, timezone: outlet.timezone } };
}

type ImportExecutor = Pick<ReturnType<typeof getDb>, "select">;

type ImportActor = {
  userId: string;
  access: { isSuperAdmin: boolean };
};

type ImportOutlet = {
  id: string;
  timezone: string;
};

type ImportInput = {
  actor: ImportActor;
  outlet: ImportOutlet;
  csvText: string;
  now: Date;
};

export type ImportRowStatus = {
  rowNumber: number;
  staffCode: string | null;
  username: string | null;
  status: "ok" | "error";
  message: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  breakCount: number;
};

export type AcceptedImportShift = {
  rowNumber: number;
  userId: string;
  username: string;
  clockInAt: Date;
  clockOutAt: Date;
  breaks: ManualBreak[];
};

export type ImportEvaluation =
  | { ok: false; error: string; status: 400 }
  | {
      ok: true;
      rows: ImportRowStatus[];
      accepted: AcceptedImportShift[];
      importableCount: number;
      errorCount: number;
    };

/**
 * Checks every row without writing. Rows are judged in file order, so the
 * first row for a time range wins and later clashing rows are rejected.
 */
export async function evaluateTimesheetImport(
  executor: ImportExecutor,
  input: ImportInput,
): Promise<ImportEvaluation> {
  const parsedCsv = parseTimesheetImportCsv(input.csvText);
  if (!parsedCsv.ok) return { ok: false, error: parsedCsv.error, status: 400 };

  const parsedRows = parsedCsv.records.map((record) =>
    buildImportedShift(record, input.outlet.timezone, input.now),
  );

  const members = await executor
    .select({
      userId: user.id,
      username: user.username,
      staffCode: user.staffCode,
      isActive: outletMemberships.isActive,
      canAccessClock: user.canAccessClock,
      approvalStatus: user.approvalStatus,
    })
    .from(outletMemberships)
    .innerJoin(user, eq(outletMemberships.userId, user.id))
    .where(
      and(
        eq(outletMemberships.outletId, input.outlet.id),
        isNotNull(user.staffCode),
      ),
    );

  const memberByCode = new Map<string, (typeof members)[number]>();
  for (const member of members) {
    if (member.staffCode)
      memberByCode.set(staffCodeKey(member.staffCode), member);
  }

  const matchedUserIds = [
    ...new Set(
      parsedRows.flatMap((row) => {
        if (!row.ok) return [];
        const member = memberByCode.get(staffCodeKey(row.staffCode));
        return member ? [member.userId] : [];
      }),
    ),
  ];

  const existingRows = matchedUserIds.length
    ? await executor
        .select({
          userId: workSessions.userId,
          start: workSessions.clockInAt,
          end: workSessions.clockOutAt,
        })
        .from(workSessions)
        .where(inArray(workSessions.userId, matchedUserIds))
    : [];

  const existingByUser = new Map<string, TimeRange[]>();
  for (const session of existingRows) {
    const ranges = existingByUser.get(session.userId) ?? [];
    ranges.push({ start: session.start, end: session.end });
    existingByUser.set(session.userId, ranges);
  }

  const fileByUser = new Map<string, TimeRange[]>();
  const rows: ImportRowStatus[] = [];
  const accepted: AcceptedImportShift[] = [];

  for (const parsed of parsedRows) {
    if (!parsed.ok) {
      rows.push({
        rowNumber: parsed.rowNumber,
        staffCode: parsed.staffCode,
        username: null,
        status: "error",
        message: parsed.error,
        clockInAt: null,
        clockOutAt: null,
        breakCount: 0,
      });
      continue;
    }

    const base = {
      rowNumber: parsed.rowNumber,
      staffCode: parsed.staffCode,
      clockInAt: parsed.clockInAt.toISOString(),
      clockOutAt: parsed.clockOutAt.toISOString(),
      breakCount: parsed.breaks.length,
    };
    const reject = (message: string, username: string | null = null) => {
      rows.push({ ...base, username, status: "error", message });
    };

    const member = memberByCode.get(staffCodeKey(parsed.staffCode));
    if (!member) {
      reject("No staff member has this staff code at this outlet.");
      continue;
    }
    if (
      !input.actor.access.isSuperAdmin &&
      member.userId === input.actor.userId
    ) {
      reject("You cannot change your own shifts.", member.username);
      continue;
    }
    if (
      !member.isActive ||
      !member.canAccessClock ||
      member.approvalStatus !== "approved"
    ) {
      reject(
        "This staff member cannot have shifts added at this outlet.",
        member.username,
      );
      continue;
    }

    const shift = { start: parsed.clockInAt, end: parsed.clockOutAt };
    if (hasOverlap(shift, existingByUser.get(member.userId) ?? [])) {
      reject(
        "This shift overlaps an existing shift for this staff member.",
        member.username,
      );
      continue;
    }
    const inFile = fileByUser.get(member.userId) ?? [];
    if (hasOverlap(shift, inFile)) {
      reject("This shift overlaps another row in this file.", member.username);
      continue;
    }

    inFile.push(shift);
    fileByUser.set(member.userId, inFile);
    accepted.push({
      rowNumber: parsed.rowNumber,
      userId: member.userId,
      username: member.username,
      clockInAt: parsed.clockInAt,
      clockOutAt: parsed.clockOutAt,
      breaks: parsed.breaks,
    });
    rows.push({
      ...base,
      username: member.username,
      status: "ok",
      message: null,
    });
  }

  rows.sort((first, second) => first.rowNumber - second.rowNumber);
  return {
    ok: true,
    rows,
    accepted,
    importableCount: accepted.length,
    errorCount: rows.length - accepted.length,
  };
}

export type CommitImportResult =
  | { ok: false; error: string; status: 400 }
  | {
      ok: true;
      batchId: string;
      importedCount: number;
      skippedCount: number;
      rows: ImportRowStatus[];
    };

/**
 * Re-checks the file under row locks, then inserts only the rows that pass.
 * Rows that clash or fail validation are skipped and reported.
 */
export async function commitTimesheetImport(
  input: ImportInput & { reason: string },
): Promise<CommitImportResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const preview = await evaluateTimesheetImport(tx, input);
    if (!preview.ok) return preview;

    const lockIds = [
      ...new Set(preview.accepted.map((shift) => shift.userId)),
    ].sort();
    for (const userId of lockIds) {
      // Lock staff rows in sorted order so concurrent imports cannot deadlock.
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
        .for("update");
    }

    // Re-evaluate after locking so the commit reflects the latest shifts.
    const evaluation = await evaluateTimesheetImport(tx, input);
    if (!evaluation.ok) return evaluation;

    if (!evaluation.accepted.length) {
      return {
        ok: true as const,
        batchId: "",
        importedCount: 0,
        skippedCount: evaluation.errorCount,
        rows: evaluation.rows,
      };
    }

    const batchId = randomUUID();
    const now = input.now;
    const importedShifts: Array<{
      workSessionId: string;
      username: string;
      clockInAt: string;
      clockOutAt: string;
      breakCount: number;
    }> = [];

    for (const shift of evaluation.accepted) {
      const [created] = await tx
        .insert(workSessions)
        .values({
          userId: shift.userId,
          outletId: input.outlet.id,
          timezone: input.outlet.timezone,
          clockInAt: shift.clockInAt,
          clockOutAt: shift.clockOutAt,
          clockInSource: "manual",
          clockOutSource: "manual",
          updatedAt: now,
        })
        .returning({ id: workSessions.id });

      if (shift.breaks.length) {
        await tx.insert(workBreaks).values(
          shift.breaks.map((breakInterval) => ({
            workSessionId: created.id,
            startedAt: breakInterval.startedAt,
            endedAt: breakInterval.endedAt,
            updatedAt: now,
          })),
        );
      }

      importedShifts.push({
        workSessionId: created.id,
        username: shift.username,
        clockInAt: shift.clockInAt.toISOString(),
        clockOutAt: shift.clockOutAt.toISOString(),
        breakCount: shift.breaks.length,
      });
    }

    await recordAudit(tx, {
      actorId: input.actor.userId,
      action: "timesheet_import",
      entityType: "timesheet_import",
      entityId: batchId,
      outletId: input.outlet.id,
      newValues: {
        importedCount: evaluation.importableCount,
        skippedCount: evaluation.errorCount,
        shifts: importedShifts,
      },
      reason: input.reason,
    });

    return {
      ok: true as const,
      batchId,
      importedCount: evaluation.importableCount,
      skippedCount: evaluation.errorCount,
      rows: evaluation.rows,
    };
  });
}
