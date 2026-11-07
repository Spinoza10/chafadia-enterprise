// Registered customers: directory, profile, notes/tags, CSV export and WhatsApp messaging.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db.js";
import { audit, diff } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { normalizePhone, toE164Digits, waLink } from "../lib/phone.js";
import { email, id, parse, phone } from "../lib/validate.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { checkOnRegistration, contactStatus, sendCustomerMessage, whatsappEnabled } from "../services/whatsapp.js";

const router = Router();
router.use(authenticate);

const messageLimiter = rateLimit({ windowMs: 60 * 1000, limit: config.isTest ? 10000 : 30, standardHeaders: "draft-7", legacyHeaders: false });

// whatsapp_contacts are keyed by digits only (237...), users.phone is +237...
const CONTACT_JOIN = "LEFT JOIN whatsapp_contacts c ON c.phone = regexp_replace(u.phone, '[^0-9]', '', 'g')";
const STATS_JOIN = `LEFT JOIN LATERAL (
    SELECT count(*)::int AS orders,
           coalesce(sum(o.amount_paid - o.amount_refunded) FILTER (WHERE o.paid_at IS NOT NULL), 0)::bigint AS spent,
           max(o.created_at) AS last_order_at
      FROM orders o WHERE o.customer_id = u.id) s ON true`;

const shape = (r) => ({
  id: r.id,
  fullName: r.full_name,
  email: r.email,
  phone: r.phone,
  status: r.status,
  source: r.source,
  tags: r.tags ?? [],
  notes: r.notes ?? null,
  whatsapp: {
    optIn: r.whatsapp_opt_in,
    status: r.wa_status ?? "unknown",
    checkedAt: r.checked_at ?? null,
    lastMessageFromCustomerAt: r.last_inbound_at ?? null,
    chatLink: waLink(r.phone, `Hello ${String(r.full_name).split(" ")[0]}, `),
  },
  orders: r.orders ?? 0,
  totalSpent: r.spent ?? 0,
  lastOrderAt: r.last_order_at ?? null,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  whatsapp: z.enum(["on_whatsapp", "not_on_whatsapp", "unknown"]).optional(),
  optIn: z.enum(["true", "false"]).optional(),
  tag: z.string().trim().max(30).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  sort: z.enum(["newest", "name", "spent", "orders", "last_order"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const SORTS = {
  newest: "u.created_at DESC",
  name: "u.full_name ASC",
  spent: "s.spent DESC, u.created_at DESC",
  orders: "s.orders DESC, u.created_at DESC",
  last_order: "s.last_order_at DESC NULLS LAST",
};

function whereFor(q) {
  const params = [];
  const where = ["u.role = 'customer'", "u.status <> 'deleted'"];
  if (q.search) {
    const i = params.push(`%${q.search}%`);
    const digits = q.search.replace(/\D/g, "");
    where.push(`(u.full_name ILIKE $${i} OR u.email ILIKE $${i} OR u.phone ILIKE $${i}${digits.length >= 3 ? ` OR regexp_replace(u.phone, '[^0-9]', '', 'g') LIKE $${params.push(`%${digits}%`)}` : ""})`);
  }
  if (q.whatsapp) where.push(`coalesce(c.status, 'unknown') = $${params.push(q.whatsapp)}`);
  if (q.optIn) where.push(`u.whatsapp_opt_in = ${q.optIn === "true"}`);
  if (q.tag) where.push(`$${params.push(q.tag.toLowerCase())} = ANY(u.tags)`);
  if (q.status) where.push(`u.status = $${params.push(q.status)}`);
  return { where: where.join(" AND "), params };
}

// ---------------------------------------------------------------- directory

router.get("/", requirePermission("customers.manage"), async (req, res) => {
  const q = parse(listSchema, req.query);
  const { where, params } = whereFor(q);
  const { rows } = await query(
    `SELECT u.*, c.status AS wa_status, c.checked_at, c.last_inbound_at, s.*, u.id AS id, u.created_at AS created_at, count(*) OVER() AS total
       FROM users u ${CONTACT_JOIN} ${STATS_JOIN}
      WHERE ${where} ORDER BY ${SORTS[q.sort]} LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    params
  );
  res.json({ data: rows.map(shape), total: rows[0]?.total ?? 0, page: q.page, limit: q.limit });
});

router.get("/stats", requirePermission("customers.manage"), async (_req, res) => {
  const { rows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE c.status = 'on_whatsapp')::int AS on_whatsapp,
            count(*) FILTER (WHERE c.status = 'not_on_whatsapp')::int AS not_on_whatsapp,
            count(*) FILTER (WHERE u.phone IS NOT NULL AND coalesce(c.status, 'unknown') = 'unknown')::int AS unknown,
            count(*) FILTER (WHERE u.whatsapp_opt_in AND u.phone IS NOT NULL)::int AS opted_in,
            count(*) FILTER (WHERE u.created_at > now() - interval '7 days')::int AS new_7_days,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id AND o.paid_at IS NOT NULL))::int AS buyers
       FROM users u ${CONTACT_JOIN} WHERE u.role = 'customer' AND u.status <> 'deleted'`
  );
  const { rows: tags } = await query(
    "SELECT t AS tag, count(*)::int AS n FROM users u, unnest(u.tags) t WHERE u.role = 'customer' AND u.status <> 'deleted' GROUP BY t ORDER BY n DESC LIMIT 30"
  );
  const r = rows[0];
  res.json({
    data: {
      total: r.total, onWhatsApp: r.on_whatsapp, notOnWhatsApp: r.not_on_whatsapp, unknown: r.unknown,
      optedIn: r.opted_in, newLast7Days: r.new_7_days, buyers: r.buyers, tags, whatsappEnabled: whatsappEnabled(),
    },
  });
});

const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // never let a spreadsheet run a formula from customer data
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// Phone numbers are normalised by us (+ and digits only), so the ="..." text form is safe and keeps
// Excel from turning +237652433338 into 2.37E+11.
const csvPhone = (p) => (p && /^\+[0-9]{8,15}$/.test(p) ? `"=""${p}"""` : "");

router.get("/export.csv", requirePermission("customers.manage"), async (req, res) => {
  const q = parse(listSchema.omit({ page: true, limit: true }), req.query);
  const { where, params } = whereFor(q);
  const { rows } = await query(
    `SELECT u.*, c.status AS wa_status, s.*, u.id AS id, u.created_at AS created_at FROM users u ${CONTACT_JOIN} ${STATS_JOIN}
      WHERE ${where} ORDER BY ${SORTS[q.sort]} LIMIT 20000`,
    params
  );
  const header = ["Name", "Phone", "Email", "WhatsApp", "WhatsApp receipts/messages", "Orders", "Total spent (FCFA)", "Last order", "Registered", "Status", "Tags", "Notes"];
  const lines = rows.map((r) => [
    csvCell(r.full_name), csvPhone(r.phone),
    ...[r.email, r.wa_status ?? "unknown", r.whatsapp_opt_in ? "yes" : "no", r.orders, r.spent,
      r.last_order_at?.toISOString().slice(0, 10), r.created_at.toISOString().slice(0, 10), r.status, r.tags, r.notes].map(csvCell),
  ].join(","));
  await audit({ req, action: "customers.export", entityType: "user", entityId: null, newValue: { count: rows.length, filters: q } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="chafadia-customers-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${[header.join(","), ...lines].join("\r\n")}`);
});

// ---------------------------------------------------------------- broadcast (before /:id routes)

const broadcastSchema = z.object({
  text: z.string().trim().min(2, "Write the message").max(1000),
  ids: z.array(id).max(1000).optional(),
  tag: z.string().trim().max(30).optional(),
});

/** Opted-in customers with a phone number not known to be off WhatsApp. */
async function broadcastRecipients({ ids, tag }) {
  const params = [];
  const where = [
    "u.role = 'customer'", "u.status = 'active'", "u.phone IS NOT NULL", "u.whatsapp_opt_in",
    "coalesce(c.status, 'unknown') <> 'not_on_whatsapp'",
  ];
  if (ids?.length) where.push(`u.id = ANY($${params.push(ids)})`);
  if (tag) where.push(`$${params.push(tag.toLowerCase())} = ANY(u.tags)`);
  const { rows } = await query(`SELECT u.* FROM users u ${CONTACT_JOIN} WHERE ${where.join(" AND ")} ORDER BY u.id LIMIT 1000`, params);
  return rows;
}

router.get("/broadcast/preview", requirePermission("customers.message"), async (req, res) => {
  const q = parse(z.object({ tag: z.string().trim().max(30).optional(), ids: z.string().regex(/^\d+(,\d+)*$/).optional() }), req.query);
  const recipients = await broadcastRecipients({ tag: q.tag, ids: q.ids?.split(",").map(Number) });
  res.json({ data: { recipients: recipients.length } });
});

router.post("/broadcast", messageLimiter, requirePermission("customers.message"), async (req, res) => {
  const body = parse(broadcastSchema, req.body);
  if (!whatsappEnabled()) throw badRequest("WhatsApp sending is turned off on the server");
  const recipients = await broadcastRecipients(body);
  if (!recipients.length) throw badRequest("No customer to send to (they need a WhatsApp number and to accept WhatsApp messages)");
  await audit({ req, action: "customers.broadcast", entityType: "user", entityId: null, newValue: { recipients: recipients.length, tag: body.tag, text: body.text } });

  // Sent one by one in the background (WhatsApp rate limits); the admins get a summary at the end.
  const sender = req.user;
  (async () => {
    const counts = { sent: 0, skipped: 0, failed: 0 };
    for (const user of recipients) {
      const r = await sendCustomerMessage({ user, text: body.text, sentBy: sender.id, purpose: "broadcast" }).catch(() => ({ status: "failed" }));
      counts[r.status === "sent" ? "sent" : r.status === "skipped" ? "skipped" : "failed"] += 1;
      if (config.WHATSAPP_PROVIDER === "cloud") await new Promise((done) => setTimeout(done, 120));
    }
    await notify({
      type: "whatsapp.broadcast", title: "WhatsApp broadcast finished",
      message: `${sender.full_name}'s message: ${counts.sent} sent, ${counts.skipped} skipped, ${counts.failed} failed (of ${recipients.length}).`,
      data: counts,
    });
  })().catch((e) => console.error(`[whatsapp] broadcast failed: ${e.message}`));

  res.status(202).json({ data: { recipients: recipients.length }, message: `Sending to ${recipients.length} customer(s). You will get a notification when it is done.` });
});

// ---------------------------------------------------------------- one customer

async function loadCustomer(customerId) {
  const { rows } = await query(
    `SELECT u.*, c.status AS wa_status, c.checked_at, c.last_inbound_at, s.*, u.id AS id, u.created_at AS created_at
       FROM users u ${CONTACT_JOIN} ${STATS_JOIN}
      WHERE u.id = $1 AND u.role = 'customer' AND u.status <> 'deleted'`,
    [customerId]
  );
  if (!rows[0]) throw notFound("Customer not found");
  return rows[0];
}

router.get("/:id", requirePermission("customers.manage"), async (req, res) => {
  const customer = await loadCustomer(parse(id, req.params.id));
  const digits = toE164Digits(customer.phone);
  const [orders, messages] = await Promise.all([
    query(
      `SELECT id, order_number AS "orderNumber", status, channel, grand_total AS total, amount_paid AS "amountPaid",
              payment_method AS "paymentMethod", created_at AS "createdAt"
         FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [customer.id]
    ),
    query(
      `SELECT m.id, m.direction, m.purpose, m.status, m.body, m.error, m.created_at AS "createdAt", s.full_name AS "sentBy"
         FROM whatsapp_messages m LEFT JOIN users s ON s.id = m.sent_by
        WHERE m.user_id = $1 OR ($2::text IS NOT NULL AND m.phone = $2) ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
      [customer.id, digits]
    ),
  ]);
  const inWindow = customer.last_inbound_at && Date.now() - new Date(customer.last_inbound_at).getTime() < 24 * 3600_000;
  res.json({
    data: {
      ...shape(customer),
      recentOrders: orders.rows,
      messages: messages.rows.reverse(),
      canMessage: whatsappEnabled() && Boolean(customer.phone),
      replyWindowOpen: Boolean(inWindow),
    },
  });
});

router.patch("/:id", requirePermission("customers.manage"), async (req, res) => {
  const customerId = parse(id, req.params.id);
  const body = parse(
    z.object({
      fullName: z.string().trim().min(2).max(120).optional(),
      phone: z.union([z.literal(""), phone]).optional(),
      email: z.union([z.literal(""), email]).optional(),
      notes: z.string().trim().max(2000).nullable().optional(),
      tags: z.array(z.string().trim().toLowerCase().min(1).max(30).regex(/^[\p{L}0-9 _-]+$/u)).max(10).optional(),
      whatsappOptIn: z.boolean().optional(),
      status: z.enum(["active", "suspended"]).optional(),
    }),
    req.body
  );
  const before = await loadCustomer(customerId);
  const next = {
    full_name: body.fullName ?? before.full_name,
    phone: body.phone === undefined ? before.phone : body.phone === "" ? null : normalizePhone(body.phone),
    email: body.email === undefined ? before.email : body.email || null,
    notes: body.notes === undefined ? before.notes : body.notes || null,
    tags: body.tags ? [...new Set(body.tags)] : before.tags,
    whatsapp_opt_in: body.whatsappOptIn ?? before.whatsapp_opt_in,
    status: body.status ?? before.status,
  };
  if (body.phone && !next.phone) throw badRequest("Enter a valid phone number");
  if (!next.phone && !next.email) throw badRequest("A customer needs a phone number or an email to log in");
  for (const [col, label] of [["phone", "phone number"], ["email", "email"]]) {
    if (next[col] && next[col] !== before[col]) {
      const dup = await query(`SELECT 1 FROM users WHERE ${col} = $1 AND status <> 'deleted' AND id <> $2`, [next[col], customerId]);
      if (dup.rowCount) throw badRequest(`Another account already uses this ${label}`);
    }
  }
  const { rows } = await query(
    `UPDATE users SET full_name = $2, phone = $3, email = $4, notes = $5, tags = $6, whatsapp_opt_in = $7, status = $8::user_status,
            token_version = token_version + CASE WHEN $8::user_status = 'suspended' AND status <> 'suspended' THEN 1 ELSE 0 END
      WHERE id = $1 RETURNING *`,
    [customerId, next.full_name, next.phone, next.email, next.notes, next.tags, next.whatsapp_opt_in, next.status]
  );
  if (next.status === "suspended" && before.status !== "suspended") {
    await query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [customerId]);
  }
  const pick = (u) => ({ full_name: u.full_name, phone: u.phone, email: u.email, notes: u.notes, tags: u.tags, whatsapp_opt_in: u.whatsapp_opt_in, status: u.status });
  const changes = diff(pick(before), pick(rows[0]));
  if (changes.changed) {
    await audit({ req, action: "customer.update", entityType: "user", entityId: customerId, oldValue: changes.oldValue, newValue: changes.newValue });
  }
  if (next.phone && next.phone !== before.phone) checkOnRegistration(rows[0]).catch(() => {});
  res.json({ data: shape(await loadCustomer(customerId)) });
});

/** Ask WhatsApp again whether this customer's number is on WhatsApp (sends the short welcome message). */
router.post("/:id/check-whatsapp", messageLimiter, requirePermission("customers.message"), async (req, res) => {
  const customer = await loadCustomer(parse(id, req.params.id));
  if (!customer.phone) throw badRequest("This customer has no phone number");
  if (!whatsappEnabled()) throw badRequest("WhatsApp sending is turned off on the server");
  await checkOnRegistration({ ...customer, whatsapp_opt_in: true });
  const c = await contactStatus(customer.phone);
  const label = { on_whatsapp: "is on WhatsApp", not_on_whatsapp: "is NOT on WhatsApp", unknown: "is being checked - the answer arrives when WhatsApp reports delivery" };
  res.json({ data: { status: c.status }, message: `${customer.phone} ${label[c.status]}` });
});

router.post("/:id/message", messageLimiter, requirePermission("customers.message"), async (req, res) => {
  const customer = await loadCustomer(parse(id, req.params.id));
  const { text, force } = parse(z.object({ text: z.string().trim().min(1, "Write a message").max(1000), force: z.boolean().default(false) }), req.body);
  const result = await sendCustomerMessage({ user: customer, text, sentBy: req.user.id, force });
  await audit({ req, action: "customer.whatsapp_message", entityType: "user", entityId: customer.id, newValue: { status: result.status, text } });
  const messages = { sent: "Message sent on WhatsApp", off: result.reason };
  res.status(result.status === "sent" ? 201 : 200).json({ data: result, message: messages[result.status] ?? result.reason });
});

export default router;
