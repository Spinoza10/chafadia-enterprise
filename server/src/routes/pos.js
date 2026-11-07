// Cashier point of sale: shifts, on-site sales (stock deducted immediately), daily summary.
import { Router } from "express";
import { z } from "zod";
import { query, tx } from "../db.js";
import { audit } from "../lib/audit.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { can } from "../lib/rbac.js";
import { email, money, pagination, parse, phone } from "../lib/validate.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import {
  computeTax, deductStock, insertItems, issueReceipt, loadOrderDetail, nextNumber, priceLines, recordHistory,
} from "../services/orders.js";
import { randomToken } from "../lib/tokens.js";
import { itemsSchema } from "./orders.js";
import { deliverReceipt } from "../services/receipts.js";
import { notifySale } from "../lib/notify.js";

const router = Router();
router.use(authenticate);

async function openShift(run, cashierId) {
  const { rows } = await run("SELECT * FROM cashier_shifts WHERE cashier_id = $1 AND status = 'open'", [cashierId]);
  return rows[0] ?? null;
}

async function shiftTotals(run, shiftId) {
  const { rows } = await run(
    `SELECT p.method, count(DISTINCT o.id)::int AS orders, coalesce(sum(p.amount), 0)::bigint AS amount
       FROM orders o JOIN payments p ON p.order_id = o.id AND p.status IN ('succeeded','refunded','partially_refunded')
      WHERE o.shift_id = $1 GROUP BY p.method`,
    [shiftId]
  );
  const refunds = await run(
    `SELECT coalesce(sum(rf.amount), 0)::bigint AS amount FROM refunds rf JOIN payments p ON p.id = rf.payment_id
       JOIN orders o ON o.id = rf.order_id WHERE o.shift_id = $1 AND p.method = 'cash'`,
    [shiftId]
  );
  const byMethod = Object.fromEntries(rows.map((r) => [r.method, { orders: r.orders, amount: r.amount }]));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return { byMethod, total, cashRefunds: refunds.rows[0].amount };
}

const shapeShift = (s, totals) => ({
  id: s.id,
  status: s.status,
  openingFloat: s.opening_float,
  expectedCash: s.expected_cash,
  countedCash: s.counted_cash,
  variance: s.variance,
  notes: s.notes,
  openedAt: s.opened_at,
  closedAt: s.closed_at,
  cashierName: s.cashier_name,
  ...(totals && { totals }),
});

// ---------------------------------------------------------------- shifts

router.get("/shifts/current", requirePermission("pos.sell"), async (req, res) => {
  const shift = await openShift(query, req.user.id);
  res.json({ data: shift ? shapeShift(shift, await shiftTotals(query, shift.id)) : null });
});

router.post("/shifts/open", requirePermission("pos.sell"), async (req, res) => {
  const { openingFloat } = parse(z.object({ openingFloat: money.default(0) }), req.body);
  if (await openShift(query, req.user.id)) throw badRequest("You already have an open shift");
  const { rows } = await query("INSERT INTO cashier_shifts (cashier_id, opening_float) VALUES ($1, $2) RETURNING *", [req.user.id, openingFloat]);
  await audit({ req, action: "shift.open", entityType: "shift", entityId: rows[0].id, newValue: { openingFloat } });
  res.status(201).json({ data: shapeShift(rows[0]) });
});

router.post("/shifts/close", requirePermission("pos.sell"), async (req, res) => {
  const body = parse(z.object({ countedCash: money, notes: z.string().trim().max(500).optional() }), req.body);
  const result = await tx(async (client) => {
    const { rows } = await client.query("SELECT * FROM cashier_shifts WHERE cashier_id = $1 AND status = 'open' FOR UPDATE", [req.user.id]);
    const shift = rows[0];
    if (!shift) throw badRequest("You have no open shift");
    const totals = await shiftTotals(client.query.bind(client), shift.id);
    const expected = shift.opening_float + (totals.byMethod.cash?.amount ?? 0) - totals.cashRefunds;
    const { rows: closed } = await client.query(
      `UPDATE cashier_shifts SET status = 'closed', closed_at = now(), expected_cash = $2, counted_cash = $3, variance = $4, notes = $5
        WHERE id = $1 RETURNING *`,
      [shift.id, expected, body.countedCash, body.countedCash - expected, body.notes ?? null]
    );
    await audit({ req, client, action: "shift.close", entityType: "shift", entityId: shift.id, newValue: { expected, counted: body.countedCash, variance: body.countedCash - expected } });
    return shapeShift(closed[0], totals);
  });
  res.json({ data: result });
});

router.get("/shifts", requirePermission("pos.sell", "shifts.view_all"), async (req, res) => {
  const q = parse(pagination, req.query);
  const all = can(req.user, "shifts.view_all");
  const { rows } = await query(
    `SELECT s.*, u.full_name AS cashier_name FROM cashier_shifts s JOIN users u ON u.id = s.cashier_id
      ${all ? "" : "WHERE s.cashier_id = $1"} ORDER BY s.opened_at DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    all ? [] : [req.user.id]
  );
  res.json({ data: rows.map((s) => shapeShift(s)) });
});

// ---------------------------------------------------------------- sales

const saleSchema = z.object({
  clientReference: z.string().trim().min(8).max(80).optional(), // idempotency key for offline retries
  items: itemsSchema,
  customer: z.object({ name: z.string().trim().max(120).optional(), phone: phone.optional(), email: email.optional() }).default({}),
  discount: money.default(0),
  payment: z.object({
    method: z.enum(["cash", "mtn_momo", "orange_money", "card"]),
    amountTendered: money.optional(),
    reference: z.string().trim().max(100).optional(), // MoMo/Orange/card terminal transaction id
  }),
  notes: z.string().trim().max(500).optional(),
});

router.post("/sales", requirePermission("pos.sell"), async (req, res) => {
  const body = parse(saleSchema, req.body);
  if (body.discount > 0 && !can(req.user, "pos.discount")) throw forbidden("You are not allowed to give discounts");
  if (body.payment.method !== "cash" && !body.payment.reference) throw badRequest("Enter the transaction reference for this payment");

  if (body.clientReference) {
    const dup = await query("SELECT id FROM orders WHERE client_reference = $1", [body.clientReference]);
    if (dup.rows[0]) return res.json({ data: await loadOrderDetail(query, dup.rows[0].id), duplicate: true });
  }
  const shift = await openShift(query, req.user.id);
  if (!shift) throw badRequest("Open your shift before selling");

  const orderId = await tx(async (client) => {
    const { lines, needed, byId } = await priceLines(client, body.items);
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    if (body.discount > subtotal) throw badRequest("Discount cannot exceed the subtotal");
    const tax = await computeTax(client, subtotal - body.discount);
    const total = subtotal - body.discount + tax;
    if (total <= 0) throw badRequest("Sale total must be greater than zero");
    if (body.payment.method === "cash" && body.payment.amountTendered !== undefined && body.payment.amountTendered < total) {
      throw badRequest(`Amount tendered is less than the total (${total} FCFA)`);
    }

    const number = await nextNumber(client, "order_number_seq", "POS");
    const { rows } = await client.query(
      `INSERT INTO orders (order_number, tracking_token, channel, status, customer_name, customer_email, customer_phone, fulfilment,
                           subtotal, discount_total, tax_total, grand_total, amount_paid, payment_method, cashier_id, shift_id,
                           client_reference, notes, paid_at, delivered_at)
       VALUES ($1, $2, 'pos', 'completed', $3, $4, $5, 'in_store', $6, $7, $8, $9, $9, $10, $11, $12, $13, $14, now(), now())
       RETURNING *`,
      [number, randomToken(18), body.customer.name || "Walk-in customer", body.customer.email ?? null, body.customer.phone ?? null,
        subtotal, body.discount, tax, total, body.payment.method, req.user.id, shift.id, body.clientReference ?? null, body.notes ?? null]
    );
    const order = rows[0];
    await insertItems(client, order.id, lines);
    await deductStock(client, order.id, needed, byId, { fromReservation: false, actorId: req.user.id });
    await client.query(
      `INSERT INTO payments (order_id, provider, method, amount, status, reference, provider_reference, recorded_by, succeeded_at, raw)
       VALUES ($1, $2, $3, $4, 'succeeded', $5, $6, $7, now(), $8)`,
      [order.id, body.payment.method === "cash" ? "cash" : "manual", body.payment.method, total, `${number}-PAY`,
        body.payment.reference ?? null, req.user.id, JSON.stringify({ amountTendered: body.payment.amountTendered ?? null })]
    );
    await recordHistory(client, order.id, null, "completed", req.user.id, "POS sale");
    await issueReceipt(client, order.id, req.user.id);
    await notifySale(client, order.id);
    if (body.discount > 0) {
      await audit({ req, client, action: "pos.discount", entityType: "order", entityId: order.id, newValue: { discount: body.discount, subtotal } });
    }
    return order.id;
  });

  const detail = await loadOrderDetail(query, orderId);
  deliverReceipt(orderId); // email and/or WhatsApp when the cashier entered contact details
  const tendered = body.payment.amountTendered;
  res.status(201).json({ data: { ...detail, change: tendered !== undefined ? tendered - detail.grandTotal : 0 } });
});

/** The cashier's own figures for today (or a given day). */
router.get("/summary", requirePermission("pos.sell"), async (req, res) => {
  const { date } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
  const day = date ?? new Date().toISOString().slice(0, 10);
  const { rows } = await query(
    `SELECT o.payment_method AS method, count(*)::int AS orders, coalesce(sum(o.grand_total - o.amount_refunded), 0)::bigint AS amount
       FROM orders o WHERE o.cashier_id = $1 AND o.paid_at IS NOT NULL
        AND o.created_at >= $2::date AND o.created_at < $2::date + 1 GROUP BY o.payment_method`,
    [req.user.id, day]
  );
  const items = await query(
    `SELECT coalesce(sum(oi.quantity), 0)::int AS units FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.cashier_id = $1 AND o.paid_at IS NOT NULL AND o.created_at >= $2::date AND o.created_at < $2::date + 1`,
    [req.user.id, day]
  );
  res.json({
    data: {
      date: day,
      byMethod: rows,
      orders: rows.reduce((s, r) => s + r.orders, 0),
      total: rows.reduce((s, r) => s + r.amount, 0),
      unitsSold: items.rows[0].units,
    },
  });
});

/** Barcode / SKU lookup for the scanner. */
router.get("/lookup/:code", requirePermission("pos.sell"), async (req, res) => {
  const code = String(req.params.code).trim().slice(0, 60);
  const { rows } = await query(
    `SELECT v.id AS "variantId", v.sku, v.barcode, v.name AS "variantName", v.price, v.track_stock AS "trackStock",
            v.stock_qty - v.reserved_qty AS available, p.id AS "productId", p.name_en AS name, p.option_labels AS options
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE (v.barcode = $1 OR upper(v.sku) = upper($1)) AND v.is_active AND p.is_active LIMIT 1`,
    [code]
  );
  if (!rows[0]) throw notFound("No product with this code");
  res.json({ data: rows[0] });
});

export default router;
