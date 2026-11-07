import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query, tx } from "../db.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { can } from "../lib/rbac.js";
import { email, id, pagination, parse, phone } from "../lib/validate.js";
import { authenticate, optionalAuth, requirePermission } from "../middleware/auth.js";
import { getProvider } from "../payments/index.js";
import {
  assertCanView, cancelOrder, changeStatus, confirmPayment, createOnlineOrder, loadOrderDetail,
  notifyCustomerOfStatus, refundOrder, shapeOrder,
} from "../services/orders.js";
import { deliverReceipt } from "../services/receipts.js";

const router = Router();

const checkoutLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: config.isTest ? 1000 : 30, standardHeaders: "draft-7", legacyHeaders: false });

export const itemsSchema = z
  .array(
    z.object({
      variantId: id,
      quantity: z.coerce.number().int().min(1).max(1000),
      option: z.string().trim().max(60).optional(),
      bookingAt: z.coerce.date().optional(),
    })
  )
  .min(1)
  .max(100);

const checkoutSchema = z
  .object({
    items: itemsSchema,
    customer: z.object({ name: z.string().trim().min(2).max(120), email: email.optional(), phone }),
    fulfilment: z.enum(["delivery", "pickup"]),
    deliveryZoneId: id.optional(),
    address: z
      .object({
        line: z.string().trim().min(3).max(300),
        latitude: z.coerce.number().min(-90).max(90).optional(),
        longitude: z.coerce.number().min(-180).max(180).optional(),
        placeId: z.string().trim().max(300).optional(),
      })
      .optional(),
    couponCode: z.string().trim().max(40).optional(),
    paymentMethod: z.enum(["mtn_momo", "orange_money", "card", "cash"]),
    notes: z.string().trim().max(1000).optional(),
    whatsappOptIn: z.boolean().default(true),
  })
  .refine((b) => b.fulfilment !== "delivery" || (b.deliveryZoneId && b.address), {
    message: "Delivery orders need a delivery zone and address",
    path: ["address"],
  });

const includeCost = (req) => can(req.user, "products.view_cost") || can(req.user, "reports.full");

// ---------------------------------------------------------------- customer / public

router.post("/", checkoutLimiter, optionalAuth, async (req, res) => {
  const body = parse(checkoutSchema, req.body);
  if (req.user && req.user.role !== "customer") throw badRequest("Staff accounts use the POS screen to sell");
  if (config.ONLINE_PAYMENT_MODE === "manual" && body.paymentMethod === "card") {
    throw badRequest("Card payments are not available. Pay with MTN MoMo, Orange Money or cash.");
  }
  const order = await tx((client) => createOnlineOrder(client, req, body));
  const detail = await loadOrderDetail(query, order.id);
  res.status(201).json({ data: detail });
});

router.get("/mine", authenticate, async (req, res) => {
  const q = parse(pagination, req.query);
  const { rows } = await query(
    `SELECT o.*, r.receipt_number, r.id AS receipt_id, count(*) OVER() AS total,
            EXISTS (SELECT 1 FROM payment_proofs pp WHERE pp.order_id = o.id AND pp.status = 'pending_review') AS proof_pending
       FROM orders o LEFT JOIN receipts r ON r.order_id = o.id
      WHERE o.customer_id = $1 ORDER BY o.created_at DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    [req.user.id]
  );
  const ids = rows.map((r) => r.id);
  const items = ids.length ? (await query("SELECT * FROM order_items WHERE order_id = ANY($1) ORDER BY id", [ids])).rows : [];
  res.json({
    data: rows.map((o) => shapeOrder(o, { items: items.filter((i) => i.order_id === o.id) })),
    total: rows[0]?.total ?? 0,
  });
});

/** Public tracking: order number + tracking token (from the confirmation page / email). */
router.get("/track/:orderNumber", async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(100) }), req.query);
  const { rows } = await query("SELECT id, tracking_token FROM orders WHERE order_number = $1", [String(req.params.orderNumber).slice(0, 40)]);
  if (!rows[0] || rows[0].tracking_token !== token) throw notFound("Order not found");
  const detail = await loadOrderDetail(query, rows[0].id);
  res.json({ data: detail });
});

router.get("/:id", optionalAuth, async (req, res) => {
  const orderId = parse(id, req.params.id);
  const detail = await loadOrderDetail(query, orderId, { includeCost: includeCost(req) });
  if (!detail) throw notFound("Order not found");
  assertCanView(req, { customer_id: detail.customer.id, cashier_id: detail.cashier?.id, delivery_person_id: detail.deliveryPerson?.id, tracking_token: detail.trackingToken }, req.query.token);
  res.json({ data: detail });
});

router.post("/:id/cancel", optionalAuth, async (req, res) => {
  const orderId = parse(id, req.params.id);
  const { reason, token } = parse(z.object({ reason: z.string().trim().max(300).optional(), token: z.string().optional() }), req.body);
  const { rows } = await query("SELECT * FROM orders WHERE id = $1", [orderId]);
  if (!rows[0]) throw notFound("Order not found");
  const isStaff = can(req.user, "orders.manage_delivery");
  const isOwner = (req.user && rows[0].customer_id === req.user.id) || (token && token === rows[0].tracking_token);
  if (!isStaff && !isOwner) throw notFound("Order not found");
  await tx((client) => cancelOrder(client, orderId, { actor: req.user, reason: reason ?? (isStaff ? "Cancelled by staff" : "Cancelled by customer"), req }));
  res.json({ data: await loadOrderDetail(query, orderId) });
});

// ---------------------------------------------------------------- staff

router.get("/", authenticate, requirePermission("orders.view", "delivery.perform", "pos.sell"), async (req, res) => {
  const q = parse(
    pagination.extend({
      status: z.enum(["pending", "paid", "processing", "out_for_delivery", "delivered", "completed", "cancelled", "refunded"]).optional(),
      channel: z.enum(["online", "pos"]).optional(),
      search: z.string().trim().max(100).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      attention: z.enum(["true"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    req.query
  );
  const params = [];
  const where = ["true"];
  // Cashiers see only their own sales; delivery staff only their assignments.
  if (!can(req.user, "orders.view")) {
    if (req.user.role === "delivery") where.push(`o.delivery_person_id = $${params.push(req.user.id)}`);
    else where.push(`o.cashier_id = $${params.push(req.user.id)}`);
  }
  if (q.status) where.push(`o.status = $${params.push(q.status)}`);
  if (q.channel) where.push(`o.channel = $${params.push(q.channel)}`);
  if (q.from) where.push(`o.created_at >= $${params.push(q.from)}`);
  if (q.to) where.push(`o.created_at < $${params.push(q.to)}`);
  if (q.attention) where.push("o.needs_attention IS NOT NULL");
  if (q.search) {
    const i = params.push(`%${q.search}%`);
    where.push(`(o.order_number ILIKE $${i} OR o.customer_name ILIKE $${i} OR o.customer_phone ILIKE $${i} OR o.customer_email ILIKE $${i} OR r.receipt_number ILIKE $${i})`);
  }
  const { rows } = await query(
    `SELECT o.*, z.name AS zone_name, c.full_name AS cashier_name, d.full_name AS delivery_name, d.phone AS delivery_phone,
            r.receipt_number, r.id AS receipt_id, r.verify_token, count(*) OVER() AS total
       FROM orders o LEFT JOIN delivery_zones z ON z.id = o.delivery_zone_id
       LEFT JOIN users c ON c.id = o.cashier_id LEFT JOIN users d ON d.id = o.delivery_person_id
       LEFT JOIN receipts r ON r.order_id = o.id
      WHERE ${where.join(" AND ")}
      ORDER BY o.created_at DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    params
  );
  const ids = rows.map((r) => r.id);
  const items = ids.length ? (await query("SELECT * FROM order_items WHERE order_id = ANY($1) ORDER BY id", [ids])).rows : [];
  res.json({
    data: rows.map((o) => shapeOrder(o, { items: items.filter((i) => i.order_id === o.id), includeCost: includeCost(req) })),
    total: rows[0]?.total ?? 0,
    page: q.page,
    limit: q.limit,
  });
});

router.patch("/:id/status", authenticate, requirePermission("orders.manage_delivery", "delivery.perform"), async (req, res) => {
  const orderId = parse(id, req.params.id);
  const body = parse(
    z.object({ status: z.enum(["processing", "out_for_delivery", "delivered", "completed"]), note: z.string().trim().max(300).optional() }),
    req.body
  );
  if (!can(req.user, "orders.manage_delivery") && !["out_for_delivery", "delivered"].includes(body.status)) {
    throw badRequest("Delivery staff can only mark orders out for delivery or delivered");
  }
  const order = await tx((client) => changeStatus(client, orderId, body.status, { actor: req.user, note: body.note, req }));
  notifyCustomerOfStatus(order);
  res.json({ data: await loadOrderDetail(query, orderId, { includeCost: includeCost(req) }) });
});

router.patch("/:id/assign", authenticate, requirePermission("orders.manage_delivery"), async (req, res) => {
  const orderId = parse(id, req.params.id);
  const { deliveryPersonId } = parse(z.object({ deliveryPersonId: id.nullable() }), req.body);
  await tx(async (client) => {
    if (deliveryPersonId) {
      const { rows } = await client.query("SELECT role, status FROM users WHERE id = $1", [deliveryPersonId]);
      if (!rows[0] || rows[0].status !== "active" || !["delivery", "admin", "super_admin"].includes(rows[0].role)) {
        throw badRequest("Choose an active delivery person");
      }
    }
    const { rows } = await client.query("SELECT delivery_person_id, fulfilment FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (!rows[0]) throw notFound("Order not found");
    if (rows[0].fulfilment !== "delivery") throw badRequest("This order is not for delivery");
    await client.query("UPDATE orders SET delivery_person_id = $2 WHERE id = $1", [orderId, deliveryPersonId]);
    await audit({ req, client, action: "order.assign_delivery", entityType: "order", entityId: orderId, oldValue: { delivery_person_id: rows[0].delivery_person_id }, newValue: { delivery_person_id: deliveryPersonId } });
  });
  res.json({ data: await loadOrderDetail(query, orderId, { includeCost: includeCost(req) }) });
});

/** Cash collected at pickup/delivery for a pending online order. */
router.post("/:id/payments/cash", authenticate, requirePermission("payments.record_cash"), async (req, res) => {
  const orderId = parse(id, req.params.id);
  const { note } = parse(z.object({ note: z.string().trim().max(300).optional() }), req.body);
  const result = await tx(async (client) => {
    const { rows } = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const order = rows[0];
    if (!order) throw notFound("Order not found");
    if (req.user.role === "delivery" && order.delivery_person_id !== req.user.id) throw notFound("Order not found");
    if (order.status !== "pending") throw badRequest("This order is not awaiting payment");
    const review = await client.query("SELECT 1 FROM payment_proofs WHERE order_id = $1 AND status = 'pending_review'", [orderId]);
    if (review.rowCount) throw badRequest("A Mobile Money screenshot for this order is waiting in Verify payments. Approve or reject it first.");
    const due = order.grand_total - order.amount_paid;
    const { rows: p } = await client.query(
      `INSERT INTO payments (order_id, provider, method, amount, status, reference, recorded_by, raw)
       VALUES ($1, 'cash', 'cash', $2, 'pending', $3, $4, $5) RETURNING id`,
      [orderId, due, `CASH-${order.order_number}-${Date.now()}`, req.user.id, JSON.stringify({ note })]
    );
    return confirmPayment(client, p[0].id, { actor: req.user });
  });
  deliverReceipt(result.order.id); // email + WhatsApp, in the background
  res.json({ data: await loadOrderDetail(query, orderId, { includeCost: includeCost(req) }) });
});

router.post("/:id/refunds", authenticate, requirePermission("refunds.manage"), async (req, res) => {
  const orderId = parse(id, req.params.id);
  const body = parse(
    z.object({
      amount: z.coerce.number().int().positive().optional(),
      reason: z.string().trim().min(3).max(500),
      restock: z.boolean().default(true),
    }),
    req.body
  );
  const { refund } = await tx(async (client) => {
    const { rows } = await client.query("SELECT p.provider FROM payments p WHERE p.order_id = $1 AND p.status IN ('succeeded','partially_refunded') ORDER BY id DESC LIMIT 1", [orderId]);
    const provider = rows[0] && !["cash", "manual"].includes(rows[0].provider) ? getProvider(rows[0].provider) : null;
    return refundOrder(client, orderId, { ...body, actor: req.user, req, provider });
  });
  res.status(201).json({ data: { refund, order: await loadOrderDetail(query, orderId, { includeCost: true }) } });
});

export default router;
