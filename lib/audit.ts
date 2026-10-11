import { auditEvents, user } from "@/db/schema";
import type { AuditAction } from "@/lib/audit-events";
import { getDb } from "@/lib/db";
import { inArray } from "drizzle-orm";

type AuditExecutor = Pick<ReturnType<typeof getDb>, "select" | "insert">;

export type AuditInput = {
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  outletId?: string | null;
  previousValues?: unknown;
  newValues?: unknown;
  reason?: string | null;
};

/**
 * Writes audit rows. Pass a transaction so the audit row commits with the change.
 * The actor's name is copied onto each row so the trail survives user deletion.
 */
export async function recordAudit(
  executor: AuditExecutor,
  input: AuditInput | AuditInput[],
) {
  const rows = Array.isArray(input) ? input : [input];
  const actorIds = [
    ...new Set(rows.flatMap((row) => (row.actorId ? [row.actorId] : []))),
  ];
  const actors = actorIds.length
    ? await executor
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, actorIds))
    : [];
  const names = new Map(actors.map((actor) => [actor.id, actor.name]));

  await executor.insert(auditEvents).values(
    rows.map((row) => ({
      ...row,
      outletId: row.outletId ?? null,
      actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
    })),
  );
}
