// One-time setup: creates the chafadia_enterprise database, an owner role (migrations) and a
// least-privilege runtime role, applies migrations and writes the connection strings to server/.env.
// Existing databases on the server are never touched.
//
// Usage: npm run db:setup            (prompts for the postgres superuser password)
// Env:   PGHOST (localhost) PGPORT (5432) PGSUPERUSER (postgres) PGPASSWORD (optional, skips prompt)
//        DB_NAME (chafadia_enterprise)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runMigrations, applyGrants } from "./lib/migrator.js";
import { prompt } from "./lib/prompt.js";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.env.ENV_FILE || path.join(serverDir, ".env");
const examplePath = path.join(serverDir, ".env.example");

const host = process.env.PGHOST || "localhost";
const port = Number(process.env.PGPORT || 5432);
const superuser = process.env.PGSUPERUSER || "postgres";
const dbName = process.env.DB_NAME || "chafadia_enterprise";
const ownerRole = `${dbName}_owner`;
const appRole = `${dbName}_app`;

if (!/^[a-z_][a-z0-9_]{0,40}$/.test(dbName)) throw new Error("DB_NAME must be lowercase letters, digits and _");

const randomSecret = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");
const url = (user, pass, db) =>
  `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`;

function upsertEnv(values) {
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : fs.readFileSync(examplePath, "utf8");
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(envPath, text, { mode: 0o600 });
}

async function main() {
  const password =
    process.env.PGPASSWORD ?? (await prompt(`Password for PostgreSQL user "${superuser}" on ${host}:${port}: `, { hidden: true }));

  const admin = new pg.Client({ host, port, user: superuser, password, database: "postgres" });
  await admin.connect();

  const ownerPass = randomSecret();
  const appPass = randomSecret();

  for (const [role, pass] of [[ownerRole, ownerPass], [appRole, appPass]]) {
    const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
    const verb = exists.rowCount ? "ALTER" : "CREATE";
    // identifiers are validated above; the password is passed as a literal via format()
    const { rows } = await admin.query("SELECT format('%s ROLE %I LOGIN PASSWORD %L', $1::text, $2::text, $3::text) AS sql", [verb, role, pass]);
    await admin.query(rows[0].sql);
    console.log(`${verb === "CREATE" ? "Created" : "Updated password for"} role ${role}`);
  }

  const dbExists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!dbExists.rowCount) {
    await admin.query(`CREATE DATABASE "${dbName}" OWNER "${ownerRole}" ENCODING 'UTF8' TEMPLATE template0`);
    console.log(`Created database ${dbName}`);
  } else {
    console.log(`Database ${dbName} already exists - applying pending migrations only`);
  }
  await admin.query(`REVOKE ALL ON DATABASE "${dbName}" FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE "${dbName}" TO "${ownerRole}", "${appRole}"`);
  await admin.end();

  const owner = new pg.Client({ connectionString: url(ownerRole, ownerPass, dbName) });
  await owner.connect();
  await owner.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await owner.query(`ALTER SCHEMA public OWNER TO "${ownerRole}"`).catch(() => {
    // PG15+ public schema is owned by pg_database_owner, which is already the owner role
  });
  console.log("Running migrations...");
  await runMigrations(owner);
  await applyGrants(owner, appRole);
  await owner.end();

  const envValues = {
    DATABASE_URL: url(appRole, appPass, dbName),
    MIGRATION_DATABASE_URL: url(ownerRole, ownerPass, dbName),
    APP_DB_ROLE: appRole,
  };
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (!/^JWT_ACCESS_SECRET=.{32,}$/m.test(current)) envValues.JWT_ACCESS_SECRET = randomSecret(48);
  upsertEnv(envValues);

  console.log(`\nDone. Connection strings written to ${envPath}`);
  console.log("Next steps:");
  console.log("  npm run db:seed           # import the existing product catalogue");
  console.log("  npm run seed:superadmin   # create the owner (Super Admin) account");
}

main().catch((err) => {
  console.error(`\nSetup failed: ${err.message}`);
  process.exit(1);
});
