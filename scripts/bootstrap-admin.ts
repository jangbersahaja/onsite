import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auditEvents, outlets, user } from "../db/schema";
import { getDb } from "../lib/db-client";
import { hashPassword } from "../lib/password";

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
  const username =
    process.env.BOOTSTRAP_ADMIN_USERNAME?.trim().toLowerCase() ??
    email.split("@")[0];
  const password = required("BOOTSTRAP_ADMIN_PASSWORD");
  const outletValues = [
    process.env.BOOTSTRAP_OUTLET_NAME?.trim(),
    process.env.BOOTSTRAP_OUTLET_ADDRESS?.trim(),
    process.env.BOOTSTRAP_OUTLET_LATITUDE?.trim(),
    process.env.BOOTSTRAP_OUTLET_LONGITUDE?.trim(),
    process.env.BOOTSTRAP_OUTLET_TIMEZONE?.trim(),
  ];
  const hasOutletDetails = outletValues.some(Boolean);
  if (hasOutletDetails && outletValues.some((value) => !value)) {
    throw new Error(
      "Set all BOOTSTRAP_OUTLET_* values or leave them all empty.",
    );
  }

  const [outletName, address, latitudeValue, longitudeValue, timezone] =
    outletValues;
  const latitude = latitudeValue ? Number(latitudeValue) : undefined;
  const longitude = longitudeValue ? Number(longitudeValue) : undefined;

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error(
      "BOOTSTRAP_ADMIN_USERNAME must be 3-32 letters, numbers, dots, dashes, or underscores.",
    );
  }

  if (
    latitude !== undefined &&
    (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
  ) {
    throw new Error("BOOTSTRAP_OUTLET_LATITUDE must be between -90 and 90.");
  }
  if (
    longitude !== undefined &&
    (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
  ) {
    throw new Error("BOOTSTRAP_OUTLET_LONGITUDE must be between -180 and 180.");
  }
  if (password.length < 12) {
    throw new Error(
      "BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters.",
    );
  }
  if (timezone) new Intl.DateTimeFormat("en", { timeZone: timezone });

  const db = getDb();
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email}`)
    .limit(1);

  if (existingUser) {
    throw new Error("This email already belongs to an account.");
  }

  const adminId = randomUUID();
  const now = new Date();
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id: adminId,
      name,
      username,
      email,
      passwordHash,
      accountType: "super_admin",
      canAccessClock: false,
      canAccessBackoffice: true,
      updatedAt: now,
    });

    const [outlet] = hasOutletDetails
      ? await tx
          .insert(outlets)
          .values({
            name: outletName!,
            address: address!,
            latitude: latitude!,
            longitude: longitude!,
            timezone: timezone!,
          })
          .returning({ id: outlets.id, name: outlets.name })
      : [undefined];

    await tx.insert(auditEvents).values({
      actorId: adminId,
      action: "bootstrap_admin",
      entityType: outlet ? "outlet" : "user",
      entityId: outlet?.id ?? adminId,
      newValues: { name, username, email, outletName: outlet?.name },
    });
  });

  console.info(
    `Created super admin ${email}${outletName ? ` and outlet ${outletName}` : ""}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Bootstrap failed.");
  process.exitCode = 1;
});
