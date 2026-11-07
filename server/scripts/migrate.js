// Apply pending migrations using the owner role, then refresh runtime-role grants.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import pg from "pg";
import { runMigrations, applyGrants } from "./lib/migrator.js";

const envFile = process.env.ENV_FILE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("MIGRATION_DATABASE_URL is not set. Run `npm run db:setup` first.");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await runMigrations(client);
  if (process.env.APP_DB_ROLE) await applyGrants(client, process.env.APP_DB_ROLE);
  console.log("Migrations up to date.");
} finally {
  await client.end();
}
