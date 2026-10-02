import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../db/schema";

loadEnvConfig(process.cwd());

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("Set DATABASE_URL in .env.local before migrating.");

  const client = postgres(connectionString, { max: 1, prepare: false });

  try {
    await migrate(drizzle({ client, schema }), {
      migrationsFolder: "./db/migrations",
    });
    console.info("Database migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Database migration failed.");
  process.exitCode = 1;
});
