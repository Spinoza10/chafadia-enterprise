// Create the first (and only) Super Admin. There is no public way to create this account.
// Usage: npm run seed:superadmin
//   prompts for name, email and password, or reads SUPERADMIN_NAME / SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD.
import argon2 from "argon2";
import "../src/config.js";
import { pool, query } from "../src/db.js";
import { audit } from "../src/lib/audit.js";
import { email as emailSchema, password as passwordSchema } from "../src/lib/validate.js";
import { prompt } from "./lib/prompt.js";

async function main() {
  const existing = await query("SELECT email FROM users WHERE role = 'super_admin' AND status <> 'deleted'");
  if (existing.rowCount) {
    console.log(`A Super Admin already exists (${existing.rows[0].email}). Nothing to do.`);
    return;
  }

  const name = process.env.SUPERADMIN_NAME || (await prompt("Owner full name: "));
  const emailInput = process.env.SUPERADMIN_EMAIL || (await prompt("Owner email: "));
  const email = emailSchema.parse(emailInput);

  let password = process.env.SUPERADMIN_PASSWORD;
  if (!password) {
    password = await prompt("Password (min 10 chars, letters and numbers): ", { hidden: true });
    const confirm = await prompt("Repeat password: ", { hidden: true });
    if (password !== confirm) throw new Error("Passwords do not match");
  }
  const check = passwordSchema.safeParse(password);
  if (!check.success) throw new Error(check.error.issues[0].message);
  if (!name || name.trim().length < 2) throw new Error("Enter the owner's name");

  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const { rows } = await query(
    "INSERT INTO users (email, full_name, password_hash, role) VALUES ($1, $2, $3, 'super_admin') RETURNING id, role",
    [email, name.trim(), hash]
  );
  await audit({ actor: rows[0], action: "user.seed_super_admin", entityType: "user", entityId: rows[0].id, newValue: { email } });
  console.log(`Super Admin ${email} created. Log in at the shop's /login page.`);
}

main()
  .catch((err) => {
    console.error(`Failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
