// Settings, delivery zones, coupons, audit log, notifications, reviews, content and expenses.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query, tx } from "../db.js";
import { audit, diff } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { email, id, money, pagination, parse, phone } from "../lib/validate.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { applyCoupon } from "../services/orders.js";

const router = Router();

// ---------------------------------------------------------------- public endpoints

router.get("/settings/public", async (_req, res) => {
  const { rows } = await query("SELECT key, value FROM settings WHERE is_public");
  res.json({
    data: {
      ...Object.fromEntries(rows.map((r) => [r.key, r.value])),
      paymentProvider: config.PAYMENT_PROVIDER,
      onlinePaymentMode: config.ONLINE_PAYMENT_MODE,
    },
  });
});

router.get("/delivery-zones", async (_req, res) => {
  const { rows } = await query("SELECT id, name, description, fee FROM delivery_zones WHERE is_active ORDER BY sort_order, name");
  res.json({ data: rows });
});

router.get("/announcements", async (_req, res) => {
  const { rows } = await query(
    `SELECT id, title, body, starts_at AS "startsAt", ends_at AS "endsAt" FROM announcements
      WHERE is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
      ORDER BY created_at DESC LIMIT 10`
  );
  res.json({ data: rows });
});

const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: config.isTest ? 1000 : 10, standardHeaders: "draft-7", legacyHeaders: false });
router.post("/contact", contactLimiter, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(120),
      email: email.optional(),
      phone: phone.optional(),
      subject: z.string().trim().max(200).optional(),
      message: z.string().trim().min(5).max(5000),
    }),
    req.body
  );
  await query("INSERT INTO contact_messages (name, email, phone, subject, message) VALUES ($1, $2, $3, $4, $5)", [
    body.name, body.email ?? null, body.phone ?? null, body.subject ?? null, body.message,
  ]);
  res.status(201).json({ message: "Thank you, we will get back to you shortly." });
});

router.post("/coupons/validate", rateLimit({ windowMs: 10 * 60 * 1000, limit: config.isTest ? 1000 : 30 }), async (req, res) => {
  const { code, subtotal } = parse(z.object({ code: z.string().trim().min(2).max(40), subtotal: money }), req.body);
  const result = await tx((client) => applyCoupon(client, code, subtotal));
  res.json({ data: { code: result.coupon.code, discount: result.discount, description: result.coupon.description } });
});

// ---------------------------------------------------------------- authenticated below
router.use(authenticate);

router.get("/settings", requirePermission("settings.manage"), async (_req, res) => {
  const { rows } = await query("SELECT key, value, is_public AS \"isPublic\", updated_at AS \"updatedAt\" FROM settings ORDER BY key");
  res.json({ data: rows });
});

const SETTING_SCHEMAS = {
  shop: z.object({
    name: z.string().trim().min(2).max(120),
    slogan: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().max(160).optional(),
    address: z.string().trim().max(300).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }),
  tax_rate_percent: z.number().min(0).max(100),
  reservation_minutes_online: z.number().int().min(5).max(24 * 60),
  reservation_hours_cash: z.number().int().min(1).max(24 * 14),
  slow_product_days: z.number().int().min(1).max(365),
  stuck_order_hours: z.number().int().min(1).max(24 * 60),
  alert_email: z.union([z.literal(""), email]),
  payment_approvals_required: z.number().int().min(1).max(3),
  proof_review_hours: z.number().int().min(1).max(24 * 14),
  // Shop's own MoMo / Orange Money accounts customers send their payments to (shown at checkout).
  settlement_accounts: z.object({
    mtn_momo: z.object({ number: z.string().trim().regex(/^6[0-9]{8}$/, "9-digit number starting with 6"), name: z.string().trim().min(2).max(120) }),
    orange_money: z.object({ number: z.string().trim().regex(/^6[0-9]{8}$/, "9-digit number starting with 6"), name: z.string().trim().min(2).max(120) }),
  }),
};

router.put("/settings/:key", requirePermission("settings.manage"), async (req, res) => {
  const key = req.params.key;
  const schema = SETTING_SCHEMAS[key];
  if (!schema) throw notFound("Unknown setting");
  const value = parse(schema, req.body?.value);
  await tx(async (client) => {
    const { rows } = await client.query("SELECT value FROM settings WHERE key = $1 FOR UPDATE", [key]);
    await client.query("UPDATE settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1", [key, JSON.stringify(value), req.user.id]);
    await audit({ req, client, action: "settings.change", entityType: "setting", entityId: key, oldValue: rows[0]?.value, newValue: value });
  });
  res.json({ data: { key, value } });
});

// ---------------------------------------------------------------- delivery zones

const zoneSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  fee: money,
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

router.get("/delivery-zones/all", requirePermission("delivery_zones.manage"), async (_req, res) => {
  const { rows } = await query(`SELECT id, name, description, fee, is_active AS "isActive", sort_order AS "sortOrder" FROM delivery_zones ORDER BY sort_order, name`);
  res.json({ data: rows });
});

router.post("/delivery-zones", requirePermission("delivery_zones.manage"), async (req, res) => {
  const b = parse(zoneSchema, req.body);
  const { rows } = await query(
    "INSERT INTO delivery_zones (name, description, fee, is_active, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [b.name, b.description ?? null, b.fee, b.isActive, b.sortOrder]
  ).catch((e) => { if (e.code === "23505") throw badRequest("A zone with this name exists"); throw e; });
  await audit({ req, action: "delivery_zone.create", entityType: "delivery_zone", entityId: rows[0].id, newValue: b });
  res.status(201).json({ data: rows[0] });
});

router.patch("/delivery-zones/:id", requirePermission("delivery_zones.manage"), async (req, res) => {
  const zoneId = parse(id, req.params.id);
  const b = parse(zoneSchema.partial(), req.body);
  const result = await tx(async (client) => {
    const { rows } = await client.query("SELECT * FROM delivery_zones WHERE id = $1 FOR UPDATE", [zoneId]);
    if (!rows[0]) throw notFound("Zone not found");
    const next = { name: b.name, description: b.description, fee: b.fee, is_active: b.isActive, sort_order: b.sortOrder };
    const { oldValue, newValue, changed } = diff(rows[0], next);
    if (!changed) return rows[0];
    const cols = Object.keys(newValue);
    const { rows: u } = await client.query(`UPDATE delivery_zones SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`, [zoneId, ...cols.map((c) => newValue[c])]);
    await audit({ req, client, action: "delivery_zone.update", entityType: "delivery_zone", entityId: zoneId, oldValue, newValue });
    return u[0];
  });
  res.json({ data: result });
});

// ---------------------------------------------------------------- coupons

const couponSchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).transform((s) => s.toUpperCase()),
  description: z.string().trim().max(200).nullable().optional(),
  discountType: z.enum(["percent", "fixed"]),
  value: z.coerce.number().int().positive(),
  minOrder: money.default(0),
  maxUses: z.coerce.number().int().positive().nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  isActive: z.boolean().default(true),
}).refine((c) => c.discountType !== "percent" || c.value <= 100, { message: "Percent discounts cannot exceed 100", path: ["value"] });

router.get("/coupons", requirePermission("coupons.manage"), async (_req, res) => {
  const { rows } = await query(
    `SELECT id, code, description, discount_type AS "discountType", value, min_order AS "minOrder", max_uses AS "maxUses",
            used_count AS "usedCount", starts_at AS "startsAt", ends_at AS "endsAt", is_active AS "isActive", created_at AS "createdAt"
       FROM coupons ORDER BY created_at DESC`
  );
  res.json({ data: rows });
});

router.post("/coupons", requirePermission("coupons.manage"), async (req, res) => {
  const c = parse(couponSchema, req.body);
  const { rows } = await query(
    `INSERT INTO coupons (code, description, discount_type, value, min_order, max_uses, starts_at, ends_at, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [c.code, c.description ?? null, c.discountType, c.value, c.minOrder, c.maxUses ?? null, c.startsAt ?? null, c.endsAt ?? null, c.isActive, req.user.id]
  ).catch((e) => { if (e.code === "23505") throw badRequest("This coupon code already exists"); throw e; });
  await audit({ req, action: "coupon.create", entityType: "coupon", entityId: rows[0].id, newValue: c });
  res.status(201).json({ data: { id: rows[0].id, ...c } });
});

router.patch("/coupons/:id", requirePermission("coupons.manage"), async (req, res) => {
  const couponId = parse(id, req.params.id);
  const b = parse(z.object({ isActive: z.boolean().optional(), endsAt: z.coerce.date().nullable().optional(), maxUses: z.coerce.number().int().positive().nullable().optional() }), req.body);
  await tx(async (client) => {
    const { rows } = await client.query("SELECT * FROM coupons WHERE id = $1 FOR UPDATE", [couponId]);
    if (!rows[0]) throw notFound("Coupon not found");
    const { oldValue, newValue, changed } = diff(rows[0], { is_active: b.isActive, ends_at: b.endsAt, max_uses: b.maxUses });
    if (!changed) return;
    const cols = Object.keys(newValue);
    await client.query(`UPDATE coupons SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`, [couponId, ...cols.map((c) => newValue[c])]);
    await audit({ req, client, action: "coupon.update", entityType: "coupon", entityId: couponId, oldValue, newValue });
  });
  res.json({ message: "Coupon updated" });
});

// ---------------------------------------------------------------- audit log (read-only, Super Admin)

router.get("/audit-logs", requirePermission("audit.view"), async (req, res) => {
  const q = parse(
    pagination.extend({
      action: z.string().trim().max(60).optional(),
      entityType: z.string().trim().max(40).optional(),
      actorId: id.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    req.query
  );
  const params = [];
  const where = ["true"];
  if (q.action) where.push(`a.action ILIKE $${params.push(`${q.action}%`)}`);
  if (q.entityType) where.push(`a.entity_type = $${params.push(q.entityType)}`);
  if (q.actorId) where.push(`a.actor_id = $${params.push(q.actorId)}`);
  const { rows } = await query(
    `SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.old_value AS "oldValue",
            a.new_value AS "newValue", a.ip, a.created_at AS "createdAt", a.actor_role AS "actorRole",
            u.full_name AS "actorName", u.email AS "actorEmail", count(*) OVER() AS total
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${where.join(" AND ")} ORDER BY a.id DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    params
  );
  res.json({ data: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 });
});

// ---------------------------------------------------------------- notifications

const STAFF_FEED = ["super_admin", "admin"];

// Every admin and the owner see the shared feed (sales, sold out, new orders...). Each person has
// their own read state, so an alert stays unread for the others until they open it themselves.
router.get("/notifications", async (req, res) => {
  const { since } = parse(z.object({ since: id.optional() }), req.query);
  const shared = STAFF_FEED.includes(req.user.role);
  const visible = `(n.user_id = $1 ${shared ? "OR (n.user_id IS NULL AND n.created_at > now() - interval '30 days')" : ""})`;
  const params = [req.user.id];
  const { rows } = await query(
    `SELECT n.id, n.type, n.title, n.message, n.data, n.created_at AS "createdAt",
            CASE WHEN n.user_id IS NULL THEN r.read_at ELSE n.read_at END AS "readAt"
       FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
      WHERE ${visible} ${since ? `AND n.id > ${since}` : ""}
      ORDER BY n.created_at DESC, n.id DESC LIMIT 50`,
    params
  );
  const unread = await query(
    `SELECT count(*)::int AS n FROM notifications n
       LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
      WHERE ${visible} AND CASE WHEN n.user_id IS NULL THEN r.read_at IS NULL ELSE n.read_at IS NULL END`,
    params
  );
  res.json({ data: rows, unread: unread.rows[0].n });
});

router.post("/notifications/read", async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(id).max(200).optional() }), req.body);
  const shared = STAFF_FEED.includes(req.user.role);
  const only = ids ? "AND id = ANY($2)" : "";
  const params = ids ? [req.user.id, ids] : [req.user.id];
  await query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL ${only}`, params);
  if (shared) {
    await query(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT id, $1 FROM notifications WHERE user_id IS NULL AND created_at > now() - interval '30 days' ${only}
       ON CONFLICT DO NOTHING`,
      params
    );
  }
  res.status(204).end();
});

// ---------------------------------------------------------------- staff directory (for delivery assignment)

router.get("/staff/delivery-people", requirePermission("orders.manage_delivery"), async (_req, res) => {
  const { rows } = await query(
    `SELECT id, full_name AS "fullName", phone, role FROM users WHERE status = 'active' AND role IN ('delivery', 'admin', 'super_admin')
      ORDER BY role = 'delivery' DESC, full_name`
  );
  res.json({ data: rows });
});

// ---------------------------------------------------------------- reviews moderation

router.get("/reviews", requirePermission("reviews.moderate"), async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }), req.query);
  const { rows } = await query(
    `SELECT r.id, r.rating, r.comment, r.status, r.created_at AS "createdAt", p.name_en AS "productName", p.id AS "productId",
            u.full_name AS "customerName"
       FROM reviews r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.user_id
      ${status ? "WHERE r.status = $1" : ""} ORDER BY r.created_at DESC LIMIT 200`,
    status ? [status] : []
  );
  res.json({ data: rows });
});

router.patch("/reviews/:id", requirePermission("reviews.moderate"), async (req, res) => {
  const reviewId = parse(id, req.params.id);
  const { status } = parse(z.object({ status: z.enum(["approved", "rejected"]) }), req.body);
  const { rows } = await query("UPDATE reviews SET status = $2, moderated_by = $3 WHERE id = $1 RETURNING id", [reviewId, status, req.user.id]);
  if (!rows[0]) throw notFound("Review not found");
  await audit({ req, action: `review.${status}`, entityType: "review", entityId: reviewId });
  res.json({ data: { id: reviewId, status } });
});

// ---------------------------------------------------------------- announcements & messages

router.get("/announcements/all", requirePermission("content.manage"), async (_req, res) => {
  const { rows } = await query(`SELECT id, title, body, is_active AS "isActive", starts_at AS "startsAt", ends_at AS "endsAt", created_at AS "createdAt" FROM announcements ORDER BY created_at DESC`);
  res.json({ data: rows });
});

const announcementSchema = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(2).max(5000),
  isActive: z.boolean().default(true),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
});

router.post("/announcements", requirePermission("content.manage"), async (req, res) => {
  const a = parse(announcementSchema, req.body);
  const { rows } = await query(
    "INSERT INTO announcements (title, body, is_active, starts_at, ends_at, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [a.title, a.body, a.isActive, a.startsAt ?? null, a.endsAt ?? null, req.user.id]
  );
  res.status(201).json({ data: { id: rows[0].id, ...a } });
});

router.patch("/announcements/:id", requirePermission("content.manage"), async (req, res) => {
  const annId = parse(id, req.params.id);
  const a = parse(announcementSchema.partial(), req.body);
  const { rowCount } = await query(
    `UPDATE announcements SET title = COALESCE($2, title), body = COALESCE($3, body), is_active = COALESCE($4, is_active) WHERE id = $1`,
    [annId, a.title ?? null, a.body ?? null, a.isActive ?? null]
  );
  if (!rowCount) throw notFound("Announcement not found");
  res.json({ message: "Updated" });
});

router.delete("/announcements/:id", requirePermission("content.manage"), async (req, res) => {
  await query("DELETE FROM announcements WHERE id = $1", [parse(id, req.params.id)]);
  res.status(204).end();
});

router.get("/messages", requirePermission("content.manage"), async (_req, res) => {
  const { rows } = await query(`SELECT id, name, email, phone, subject, message, status, created_at AS "createdAt" FROM contact_messages ORDER BY created_at DESC LIMIT 500`);
  res.json({ data: rows });
});

router.patch("/messages/:id", requirePermission("content.manage"), async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["new", "read", "replied", "archived"]) }), req.body);
  const { rowCount } = await query("UPDATE contact_messages SET status = $2 WHERE id = $1", [parse(id, req.params.id), status]);
  if (!rowCount) throw notFound("Message not found");
  res.json({ message: "Updated" });
});

// ---------------------------------------------------------------- expenses (for net profit)

router.get("/expenses", requirePermission("reports.full"), async (_req, res) => {
  const { rows } = await query(`SELECT e.id, e.description, e.category, e.amount, e.spent_on AS "spentOn", u.full_name AS "createdBy" FROM expenses e LEFT JOIN users u ON u.id = e.created_by ORDER BY spent_on DESC, id DESC LIMIT 500`);
  res.json({ data: rows });
});

router.post("/expenses", requirePermission("reports.full"), async (req, res) => {
  const e = parse(z.object({ description: z.string().trim().min(2).max(300), category: z.string().trim().max(80).optional(), amount: z.coerce.number().int().positive(), spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
  const { rows } = await query(
    "INSERT INTO expenses (description, category, amount, spent_on, created_by) VALUES ($1, $2, $3, COALESCE($4::date, current_date), $5) RETURNING id",
    [e.description, e.category ?? null, e.amount, e.spentOn ?? null, req.user.id]
  );
  await audit({ req, action: "expense.create", entityType: "expense", entityId: rows[0].id, newValue: e });
  res.status(201).json({ data: { id: rows[0].id, ...e } });
});

export default router;
