import { loadEnvConfig } from "@next/env";
import { and, eq } from "drizzle-orm";
import { auditEvents, outletStorehubConnections, outlets } from "../db/schema";
import { getDb } from "../lib/db-client";
import {
  encryptStoreHubToken,
  getStoreHubCredentialKey,
} from "../lib/storehub-credentials";

loadEnvConfig(process.cwd());

/**
 * One-time import of the StoreHub settings that used to live in environment variables.
 * It encrypts the token and stores the link on the outlet. It does not call StoreHub,
 * so run it only with credentials you already know are valid.
 * After it succeeds, remove the STOREHUB_* variables from the environment.
 */
async function main() {
  function required(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Set ${name} before importing.`);
    return value;
  }

  const storeName = required("STOREHUB_STORE_NAME");
  const apiToken = required("STOREHUB_API_TOKEN");
  const outletId = required("STOREHUB_OUTLET_ID");
  const posStoreId = required("STOREHUB_POS_STORE_ID");
  const key = getStoreHubCredentialKey();

  const db = getDb();
  await db.transaction(async (tx) => {
    const [outlet] = await tx
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(and(eq(outlets.id, outletId), eq(outlets.isActive, true)))
      .limit(1);
    if (!outlet) {
      throw new Error("STOREHUB_OUTLET_ID does not match an active outlet.");
    }

    const [existingLink] = await tx
      .select({ outletId: outletStorehubConnections.outletId })
      .from(outletStorehubConnections)
      .where(eq(outletStorehubConnections.outletId, outletId))
      .limit(1);
    if (existingLink) {
      throw new Error("This outlet already has a StoreHub link.");
    }

    const [conflict] = await tx
      .select({ outletId: outletStorehubConnections.outletId })
      .from(outletStorehubConnections)
      .where(
        and(
          eq(outletStorehubConnections.storeName, storeName),
          eq(outletStorehubConnections.posStoreId, posStoreId),
        ),
      )
      .limit(1);
    if (conflict) {
      throw new Error(
        "This StoreHub store is already linked to another outlet.",
      );
    }

    const encrypted = encryptStoreHubToken(apiToken, outletId, key);
    await tx.insert(outletStorehubConnections).values({
      outletId,
      storeName,
      posStoreId,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenTag: encrypted.tag,
      keyVersion: 1,
      createdBy: null,
      updatedBy: null,
    });

    await tx.insert(auditEvents).values({
      actorId: null,
      action: "outlet_storehub_linked",
      entityType: "outlet",
      entityId: outletId,
      outletId,
      newValues: { storeName, posStoreId, source: "env_import" },
    });

    console.info(
      `Linked outlet ${outlet.name} to StoreHub store ${posStoreId}.`,
    );
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Import failed.");
  process.exitCode = 1;
});
