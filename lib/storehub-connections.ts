import "server-only";

import { outletStorehubConnections } from "@/db/schema";
import { getDb } from "@/lib/db";
import {
  decryptStoreHubToken,
  encryptStoreHubToken,
  getStoreHubCredentialKey,
} from "@/lib/storehub-credentials";
import { and, eq, inArray, ne } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;
export type StoreHubDbExecutor = Pick<Db, "select" | "insert" | "delete">;

export type StoreHubLinkSummary = {
  storeName: string;
  posStoreId: string;
};

export type StoreHubConnection = StoreHubLinkSummary & {
  apiToken: string;
};

export class StoreHubLinkConflictError extends Error {
  constructor() {
    super("This StoreHub store is already linked to another outlet.");
  }
}

export async function getStoreHubConnection(
  outletId: string,
): Promise<StoreHubConnection | null> {
  const [row] = await getDb()
    .select()
    .from(outletStorehubConnections)
    .where(eq(outletStorehubConnections.outletId, outletId))
    .limit(1);
  if (!row) return null;
  return {
    storeName: row.storeName,
    posStoreId: row.posStoreId,
    apiToken: decryptStoreHubToken(
      {
        ciphertext: row.tokenCiphertext,
        iv: row.tokenIv,
        tag: row.tokenTag,
      },
      outletId,
      getStoreHubCredentialKey(),
    ),
  };
}

/** Returns link metadata only. Tokens are never selected here. */
export async function getStoreHubLinkSummaries(outletIds: string[]) {
  const summaries = new Map<string, StoreHubLinkSummary>();
  if (!outletIds.length) return summaries;
  const rows = await getDb()
    .select({
      outletId: outletStorehubConnections.outletId,
      storeName: outletStorehubConnections.storeName,
      posStoreId: outletStorehubConnections.posStoreId,
    })
    .from(outletStorehubConnections)
    .where(inArray(outletStorehubConnections.outletId, outletIds));
  for (const row of rows) {
    summaries.set(row.outletId, {
      storeName: row.storeName,
      posStoreId: row.posStoreId,
    });
  }
  return summaries;
}

export async function saveStoreHubConnection(
  executor: StoreHubDbExecutor,
  input: StoreHubConnection & { outletId: string; actorId: string },
) {
  const [conflict] = await executor
    .select({ id: outletStorehubConnections.id })
    .from(outletStorehubConnections)
    .where(
      and(
        eq(outletStorehubConnections.storeName, input.storeName),
        eq(outletStorehubConnections.posStoreId, input.posStoreId),
        ne(outletStorehubConnections.outletId, input.outletId),
      ),
    )
    .limit(1);
  if (conflict) throw new StoreHubLinkConflictError();

  const encrypted = encryptStoreHubToken(
    input.apiToken,
    input.outletId,
    getStoreHubCredentialKey(),
  );
  const now = new Date();
  try {
    await executor
      .insert(outletStorehubConnections)
      .values({
        outletId: input.outletId,
        storeName: input.storeName,
        posStoreId: input.posStoreId,
        tokenCiphertext: encrypted.ciphertext,
        tokenIv: encrypted.iv,
        tokenTag: encrypted.tag,
        createdBy: input.actorId,
        updatedBy: input.actorId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: outletStorehubConnections.outletId,
        set: {
          storeName: input.storeName,
          posStoreId: input.posStoreId,
          tokenCiphertext: encrypted.ciphertext,
          tokenIv: encrypted.iv,
          tokenTag: encrypted.tag,
          updatedBy: input.actorId,
          updatedAt: now,
        },
      });
  } catch (error) {
    // Unique violation from a concurrent save of the same store.
    if ((error as { code?: string }).code === "23505") {
      throw new StoreHubLinkConflictError();
    }
    throw error;
  }
}

export async function deleteStoreHubConnection(
  executor: StoreHubDbExecutor,
  outletId: string,
) {
  await executor
    .delete(outletStorehubConnections)
    .where(eq(outletStorehubConnections.outletId, outletId));
}
