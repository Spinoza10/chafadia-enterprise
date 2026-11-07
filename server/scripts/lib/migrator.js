import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

/** Apply every migrations/*.sql file not yet recorded in schema_migrations, each in its own transaction. */
export async function runMigrations(client, log = console.log) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const { rows } = await client.query("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      log(`  applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
}

// Tables the runtime role may DELETE from. Financial records (orders, payments, receipts,
// refunds, stock_movements) and audit_logs are deliberately excluded.
const DELETABLE = [
  "refresh_tokens", "password_resets", "user_permissions", "wishlists", "addresses",
  "product_images", "notifications", "announcements", "coupons", "delivery_zones",
];

/** Least-privilege grants for the runtime application role. */
export async function applyGrants(client, appRole) {
  const role = `"${appRole.replace(/"/g, "")}"`;
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${role}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM ${role}`);
  await client.query(`REVOKE INSERT, UPDATE, DELETE ON schema_migrations, permissions FROM ${role}`);
  await client.query(`GRANT DELETE ON ${DELETABLE.join(", ")} TO ${role}`);
}
