import { Router } from "express";
import argon2 from "argon2";
import { z } from "zod";
import { query, tx } from "../db.js";
import { audit, diff } from "../lib/audit.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { loadPermissions } from "../lib/rbac.js";
import { email, id, pagination, parse, password, phone } from "../lib/validate.js";
import { normalizePhone } from "../lib/phone.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requirePermission("users.manage"));

// Staff roles the owner can assign. super_admin is only created by the seed script.
const ASSIGNABLE_ROLES = ["admin", "cashier", "delivery"];

const listUser = (u) => ({
  id: u.id,
  email: u.email,
  fullName: u.full_name,
  phone: u.phone,
  role: u.role,
  status: u.status,
  lastLoginAt: u.last_login_at,
  lockedUntil: u.locked_until,
  createdAt: u.created_at,
});

/** Phones are stored as +237...; one account per phone number. Returns the normalised number. */
async function checkPhone(run, input, exceptId = 0) {
  if (input === null || input === undefined || input === "") return input === undefined ? undefined : null;
  const p = normalizePhone(input);
  if (!p) throw badRequest("Enter a valid phone number");
  const dup = await run("SELECT 1 FROM users WHERE phone = $1 AND status <> 'deleted' AND id <> $2", [p, exceptId]);
  if (dup.rowCount) throw badRequest("Another account (staff or customer) already uses this phone number");
  return p;
}

async function getTarget(client, userId) {
  const { rows } = await client.query("SELECT * FROM users WHERE id = $1 AND status <> 'deleted' FOR UPDATE", [userId]);
  if (!rows[0]) throw notFound("User not found");
  if (rows[0].role === "super_admin") throw forbidden("The Super Admin account cannot be modified here");
  return rows[0];
}

router.get("/", async (req, res) => {
  const q = parse(
    pagination.extend({
      role: z.enum(["admin", "cashier", "delivery", "customer", "staff"]).optional(),
      search: z.string().trim().max(100).optional(),
    }),
    req.query
  );
  const params = [];
  const where = ["status <> 'deleted'"];
  if (q.role === "staff") where.push("role IN ('super_admin','admin','cashier','delivery')");
  else if (q.role) where.push(`role = $${params.push(q.role)}`);
  if (q.search) where.push(`(email ILIKE $${params.push(`%${q.search}%`)} OR full_name ILIKE $${params.length})`);

  const { rows } = await query(
    `SELECT *, count(*) OVER() AS total FROM users WHERE ${where.join(" AND ")}
      ORDER BY role, created_at DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    params
  );
  res.json({ data: rows.map(listUser), total: rows[0]?.total ?? 0, page: q.page, limit: q.limit });
});

router.post("/", async (req, res) => {
  const body = parse(
    z.object({
      fullName: z.string().trim().min(2).max(120),
      email,
      phone: phone.optional(),
      role: z.enum(ASSIGNABLE_ROLES),
      password,
    }),
    req.body
  );
  const exists = await query("SELECT 1 FROM users WHERE email = $1 AND status <> 'deleted'", [body.email]);
  if (exists.rowCount) throw badRequest("An account with this email already exists");
  body.phone = await checkPhone(query, body.phone);

  const hash = await argon2.hash(body.password, { type: argon2.argon2id });
  const user = await tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (email, full_name, phone, password_hash, role, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [body.email, body.fullName, body.phone ?? null, hash, body.role, req.user.id]
    );
    await audit({
      req, client, action: "user.create", entityType: "user", entityId: rows[0].id,
      newValue: { email: body.email, fullName: body.fullName, role: body.role },
    });
    return rows[0];
  });
  res.status(201).json({ data: listUser(user) });
});

router.patch("/:id", async (req, res) => {
  const userId = parse(id, req.params.id);
  const body = parse(
    z.object({
      fullName: z.string().trim().min(2).max(120).optional(),
      phone: phone.nullable().optional(),
      role: z.enum(ASSIGNABLE_ROLES).optional(),
      status: z.enum(["active", "suspended"]).optional(),
      password: password.optional(),
      unlock: z.boolean().optional(),
    }),
    req.body
  );

  const updated = await tx(async (client) => {
    const target = await getTarget(client, userId);
    if (target.role === "customer" && body.role) throw badRequest("Customers cannot be promoted; create a staff account instead");
    body.phone = await checkPhone(client.query.bind(client), body.phone, userId);
    if (body.phone === null && !target.email) throw badRequest("This account logs in with its phone number; it cannot be removed");

    const changes = { full_name: body.fullName, phone: body.phone, role: body.role, status: body.status };
    const { oldValue, newValue } = diff(target, changes);
    const revoke = Boolean(body.password || newValue.role || newValue.status === "suspended");
    const hash = body.password ? await argon2.hash(body.password, { type: argon2.argon2id }) : null;

    const { rows } = await client.query(
      `UPDATE users SET full_name = COALESCE($2, full_name),
              phone = CASE WHEN $3::boolean THEN $4 ELSE phone END,
              role = COALESCE($5, role), status = COALESCE($6, status),
              password_hash = COALESCE($7, password_hash),
              token_version = token_version + CASE WHEN $8 THEN 1 ELSE 0 END,
              failed_login_count = CASE WHEN $9 THEN 0 ELSE failed_login_count END,
              locked_until = CASE WHEN $9 THEN NULL ELSE locked_until END
        WHERE id = $1 RETURNING *`,
      [userId, body.fullName ?? null, body.phone !== undefined, body.phone ?? null, body.role ?? null,
        body.status ?? null, hash, revoke, Boolean(body.unlock)]
    );
    if (revoke) await client.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    if (newValue.role) await client.query("DELETE FROM user_permissions WHERE user_id = $1", [userId]);

    const action = newValue.status === "suspended" ? "user.suspend" : newValue.status === "active" ? "user.reactivate" : newValue.role ? "user.role_change" : "user.update";
    if (body.password) newValue.password = "[changed]";
    if (body.unlock) newValue.unlocked = true;
    await audit({ req, client, action, entityType: "user", entityId: userId, oldValue, newValue });
    return rows[0];
  });
  res.json({ data: listUser(updated) });
});

router.delete("/:id", async (req, res) => {
  const userId = parse(id, req.params.id);
  await tx(async (client) => {
    const target = await getTarget(client, userId);
    // Soft delete: orders, receipts and audit entries keep referring to this person.
    await client.query(
      "UPDATE users SET status = 'deleted', token_version = token_version + 1, email = email || '.deleted.' || id WHERE id = $1",
      [userId]
    );
    await client.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    await audit({ req, client, action: "user.delete", entityType: "user", entityId: userId, oldValue: listUser(target) });
  });
  res.status(204).end();
});

// ---------------------------------------------------------------- permission matrix
router.get("/permissions/matrix", async (_req, res) => {
  const perms = await query("SELECT * FROM permissions ORDER BY category, code");
  const roles = await query("SELECT * FROM role_permissions");
  const defaults = {};
  for (const r of roles.rows) (defaults[r.role] ??= []).push(r.permission_code);
  res.json({ permissions: perms.rows, roleDefaults: defaults });
});

router.get("/:id/permissions", async (req, res) => {
  const userId = parse(id, req.params.id);
  const { rows } = await query("SELECT * FROM users WHERE id = $1 AND status <> 'deleted'", [userId]);
  if (!rows[0]) throw notFound("User not found");
  const overrides = await query("SELECT permission_code, granted FROM user_permissions WHERE user_id = $1", [userId]);
  res.json({
    effective: await loadPermissions(rows[0]),
    overrides: Object.fromEntries(overrides.rows.map((o) => [o.permission_code, o.granted])),
  });
});

/** Replace a user's overrides. Body: { overrides: { "pos.discount": true, "stock.adjust": false } } */
router.put("/:id/permissions", async (req, res) => {
  const userId = parse(id, req.params.id);
  const body = parse(z.object({ overrides: z.record(z.string(), z.boolean()) }), req.body);

  const result = await tx(async (client) => {
    const target = await getTarget(client, userId);
    if (target.role === "customer") throw badRequest("Customers have no staff permissions");

    const codes = Object.keys(body.overrides);
    const { rows: perms } = await client.query("SELECT code, grantable FROM permissions WHERE code = ANY($1)", [codes]);
    const known = new Map(perms.map((p) => [p.code, p.grantable]));
    for (const code of codes) {
      if (!known.has(code)) throw badRequest(`Unknown permission ${code}`);
      if (!known.get(code) && body.overrides[code]) throw badRequest(`${code} is reserved for the Super Admin`);
    }

    const before = await client.query("SELECT permission_code, granted FROM user_permissions WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM user_permissions WHERE user_id = $1", [userId]);
    for (const [code, granted] of Object.entries(body.overrides)) {
      await client.query("INSERT INTO user_permissions (user_id, permission_code, granted) VALUES ($1, $2, $3)", [userId, code, granted]);
    }
    await audit({
      req, client, action: "user.permissions_change", entityType: "user", entityId: userId,
      oldValue: Object.fromEntries(before.rows.map((o) => [o.permission_code, o.granted])),
      newValue: body.overrides,
    });
    return loadPermissions(target, client.query.bind(client));
  });
  res.json({ effective: result });
});

export default router;
