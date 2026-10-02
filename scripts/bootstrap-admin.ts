import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { auditEvents, outlets, user } from "../db/schema";
import { getAuth } from "../lib/auth-instance";
import { getDb } from "../lib/db-client";

loadEnvConfig(process.cwd());

async function main() {
  function required(name: string) {
    const value = process.env[name]?.trim();
    if (!value)
      throw new Error(`Set ${name} in .env.local before bootstrapping.`);
    return value;
  }

  const name = required("BOOTSTRAP_ADMIN_NAME");
  const email = required("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const password = required("BOOTSTRAP_ADMIN_PASSWORD");
  const outletName = required("BOOTSTRAP_OUTLET_NAME");
  const address = required("BOOTSTRAP_OUTLET_ADDRESS");
  const latitude = Number(required("BOOTSTRAP_OUTLET_LATITUDE"));
  const longitude = Number(required("BOOTSTRAP_OUTLET_LONGITUDE"));
  const timezone = required("BOOTSTRAP_OUTLET_TIMEZONE");

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("BOOTSTRAP_OUTLET_LATITUDE must be between -90 and 90.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("BOOTSTRAP_OUTLET_LONGITUDE must be between -180 and 180.");
  }
  if (password.length < 12) {
    throw new Error(
      "BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters.",
    );
  }
  new Intl.DateTimeFormat("en", { timeZone: timezone });

  const db = getDb();
  const [existingUser] = await db
    .select({ id: user.id, globalRole: user.globalRole })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (existingUser) {
    throw new Error(
      existingUser.globalRole === "admin"
        ? "This admin account already exists; bootstrap is a one-time setup command."
        : "This email already belongs to an account; choose a different bootstrap email.",
    );
  }

  const registration = await getAuth({ allowSignUp: true }).api.signUpEmail({
    body: { name, email, password },
  });
  const adminId = registration.user.id;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ globalRole: "admin", updatedAt: now })
      .where(eq(user.id, adminId));
    const [outlet] = await tx
      .insert(outlets)
      .values({ name: outletName, address, latitude, longitude, timezone })
      .returning({ id: outlets.id });
    await tx.insert(auditEvents).values({
      actorId: adminId,
      action: "bootstrap_admin",
      entityType: "outlet",
      entityId: outlet.id,
      newValues: { name, email },
    });
  });

  console.info(`Created super admin ${email} and outlet ${outletName}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Bootstrap failed.");
  process.exitCode = 1;
});
