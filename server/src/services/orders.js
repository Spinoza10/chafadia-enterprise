import { config } from "../config.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { sendMailLater } from "../lib/mailer.js";
import { checkBackInStock, checkLowStock, notify, notifySale } from "../lib/notify.js";
import { can } from "../lib/rbac.js";
import { getSetting } from "../lib/settings.js";
import { randomToken } from "../lib/tokens.js";

export const STATUS_LABELS = {
  pending: "Pending payment",
  paid: "Paid",
  processing: "Processing",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

// Manual (staff) status moves. pending->paid only happens through a verified payment;
// ->refunded only through a refund; ->cancelled through cancelOrder.
const TRANSITIONS = {
  paid: ["processing", "completed"],
  processing: ["out_for_delivery", "completed"],
  out_for_delivery: ["delivered"],
};

const pad = (n, len = 6) => String(n).padStart(len, "0");

/**
 * Lock and price the requested lines from the database. Client prices are never trusted.
 * Variants are locked in id order so concurrent checkouts cannot deadlock.
 */
export async function priceLines(client, items) {
  if (!items.length) throw badRequest("Your cart is empty");
  const merged = new Map();
  for (const it of items) {
    const key = `${it.variantId}|${it.option ?? ""}|${it.bookingAt ?? ""}`;
    const prev = merged.get(key);
    merged.set(key, { ...it, quantity: (prev?.quantity ?? 0) + it.quantity });
  }
  const ids = [...new Set([...merged.values()].map((i) => i.variantId))].sort((a, b) => a - b);
  const { rows } = await client.query(
    `SELECT v.*, p.name_en, p.kind, p.is_active AS product_active, p.option_labels, p.id AS pid
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = ANY($1) ORDER BY v.id FOR UPDATE OF v`,
    [ids]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const lines = [];
  const needed = new Map(); // variantId -> total qty across lines
  for (const it of merged.values()) {
    const v = byId.get(it.variantId);
    if (!v || !v.is_active || !v.product_active) throw badRequest("An item in your cart is no longer available", { variantId: it.variantId });
    if (it.option && Array.isArray(v.option_labels) && v.option_labels.length && !v.option_labels.includes(it.option)) {
      throw badRequest(`Invalid option "${it.option}" for ${v.name_en}`);
    }
    needed.set(v.id, (needed.get(v.id) ?? 0) + it.quantity);
    lines.push({
      variant: v,
      quantity: it.quantity,
      option: it.option ?? null,
      bookingAt: it.bookingAt ?? null,
      lineTotal: v.price * it.quantity,
    });
  }
  for (const [vid, qty] of needed) {
    const v = byId.get(vid);
    const available = v.stock_qty - v.reserved_qty;
    if (v.track_stock && available < qty) {
      throw conflict(
        available > 0 ? `Only ${available} of ${v.name_en} left in stock` : `${v.name_en} is out of stock`,
        { variantId: vid, available: Math.max(0, available) }
      );
    }
  }
  return { lines, needed, byId };
}

export async function applyCoupon(client, code, subtotal) {
  if (!code) return { coupon: null, discount: 0 };
  const { rows } = await client.query(
    `SELECT * FROM coupons WHERE code = $1 AND is_active
        AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())`,
    [code.trim().toUpperCase()]
  );
  const c = rows[0];
  if (!c) throw badRequest("This coupon code is invalid or expired");
  if (c.max_uses !== null && c.used_count >= c.max_uses) throw badRequest("This coupon has reached its usage limit");
  if (subtotal < c.min_order) throw badRequest(`This coupon needs a minimum order of ${c.min_order} FCFA`);
  const discount = c.discount_type === "percent" ? Math.floor((subtotal * c.value) / 100) : Math.min(c.value, subtotal);
  return { coupon: c, discount };
}

export async function computeTax(client, taxable) {
  const rate = Number(await getSetting("tax_rate_percent", 0, client.query.bind(client))) || 0;
  return Math.round((Math.max(0, taxable) * rate) / 100);
}

export async function nextNumber(client, seq, prefix) {
  const { rows } = await client.query(`SELECT nextval('${seq}') AS n`);
  return `${prefix}-${new Date().getFullYear()}-${pad(rows[0].n)}`;
}

export async function insertItems(client, orderId, lines) {
  for (const l of lines) {
    await client.query(
      `INSERT INTO order_items (order_id, product_id, variant_id, kind, product_name, sku, option_label, quantity,
                                unit_price, unit_cost, line_total, booking_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [orderId, l.variant.pid, l.variant.id, l.variant.kind,
        l.variant.name === "Standard" ? l.variant.name_en : `${l.variant.name_en} - ${l.variant.name}`,
        l.variant.sku, l.option, l.quantity, l.variant.price, l.variant.cost_price, l.lineTotal, l.bookingAt]
    );
  }
}

export async function recordHistory(client, orderId, from, to, actorId, note) {
  await client.query(
    "INSERT INTO order_status_history (order_id, from_status, to_status, note, changed_by) VALUES ($1, $2, $3, $4, $5)",
    [orderId, from, to, note ?? null, actorId ?? null]
  );
}

/** Move stock out of the variant for every stock-tracked line, writing a stock movement each. */
export async function deductStock(client, orderId, needed, byId, { fromReservation, actorId, type = "sale" }) {
  for (const [vid, qty] of needed) {
    const v = byId.get(vid);
    if (!v.track_stock) continue;
    const { rows } = await client.query(
      `UPDATE product_variants
          SET stock_qty = stock_qty - $2, reserved_qty = reserved_qty - $3
        WHERE id = $1 AND stock_qty - $2 >= reserved_qty - $3
        RETURNING stock_qty, reserved_qty`,
      [vid, qty, fromReservation ? qty : 0]
    );
    if (!rows[0]) throw conflict(`Not enough stock for ${v.name_en}`, { variantId: vid });
    await client.query(
      `INSERT INTO stock_movements (variant_id, type, quantity, stock_before, stock_after, reference_type, reference_id, created_by)
       VALUES ($1, $2, $3, $4, $5, 'order', $6, $7)`,
      [vid, type, -qty, rows[0].stock_qty + qty, rows[0].stock_qty, String(orderId), actorId ?? null]
    );
    // converting a reservation does not change available stock; the alert fired when it was reserved
    if (!fromReservation) await checkLowStock(client, vid, v.stock_qty - v.reserved_qty);
  }
}

async function loadOrderLines(client, orderId) {
  const { rows } = await client.query(
    `SELECT oi.variant_id, sum(oi.quantity)::int AS qty, v.track_stock, v.stock_qty, v.reserved_qty, p.name_en
       FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id JOIN products p ON p.id = v.product_id
      WHERE oi.order_id = $1 GROUP BY oi.variant_id, v.id, p.name_en ORDER BY oi.variant_id`,
    [orderId]
  );
  // lock the variants in id order
  if (rows.length) await client.query("SELECT id FROM product_variants WHERE id = ANY($1) ORDER BY id FOR UPDATE", [rows.map((r) => r.variant_id)]);
  const fresh = rows.length
    ? (await client.query("SELECT v.*, p.name_en FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1)", [rows.map((r) => r.variant_id)])).rows
    : [];
  const byId = new Map(fresh.map((v) => [v.id, v]));
  const needed = new Map(rows.map((r) => [r.variant_id, r.qty]));
  return { needed, byId };
}

async function releaseReservation(client, order) {
  if (!order.stock_reserved) return;
  const { needed, byId } = await loadOrderLines(client, order.id);
  for (const [vid, qty] of needed) {
    const v = byId.get(vid);
    if (!v.track_stock) continue;
    await client.query("UPDATE product_variants SET reserved_qty = greatest(reserved_qty - $2, 0) WHERE id = $1", [vid, qty]);
    await checkBackInStock(client, vid, v.stock_qty - v.reserved_qty);
  }
  await client.query("UPDATE orders SET stock_reserved = false WHERE id = $1", [order.id]);
}

// ---------------------------------------------------------------- online checkout

export async function createOnlineOrder(client, req, body) {
  const { lines, needed, byId } = await priceLines(client, body.items);
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const { coupon, discount } = await applyCoupon(client, body.couponCode, subtotal);

  let deliveryFee = 0;
  let zoneId = null;
  if (body.fulfilment === "delivery") {
    const { rows } = await client.query("SELECT * FROM delivery_zones WHERE id = $1 AND is_active", [body.deliveryZoneId]);
    if (!rows[0]) throw badRequest("Choose a valid delivery zone");
    deliveryFee = rows[0].fee;
    zoneId = rows[0].id;
  }
  const taxTotal = await computeTax(client, subtotal - discount);
  const grandTotal = Math.max(0, subtotal - discount) + taxTotal + deliveryFee;
  if (grandTotal <= 0) throw badRequest("Order total must be greater than zero");

  // Reserve stock so nobody else can buy the same units while this customer pays.
  for (const [vid, qty] of needed) {
    const v = byId.get(vid);
    if (!v.track_stock) continue;
    await client.query("UPDATE product_variants SET reserved_qty = reserved_qty + $2 WHERE id = $1", [vid, qty]);
    await checkLowStock(client, vid, v.stock_qty - v.reserved_qty);
  }
  const run = client.query.bind(client);
  const holdMinutes = body.paymentMethod === "cash"
    ? Number(await getSetting("reservation_hours_cash", 48, run)) * 60
    : Number(await getSetting("reservation_minutes_online", 30, run));

  const orderNumber = await nextNumber(client, "order_number_seq", "ORD");
  const { rows } = await client.query(
    `INSERT INTO orders (order_number, tracking_token, channel, status, customer_id, customer_name, customer_email, customer_phone,
                         fulfilment, delivery_zone_id, delivery_address, latitude, longitude, place_id,
                         subtotal, discount_total, tax_total, delivery_fee, grand_total, coupon_id, payment_method,
                         stock_reserved, reservation_expires_at, notes, whatsapp_opt_in)
     VALUES ($1, $2, 'online', 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
             true, now() + make_interval(mins => $20), $21, $22)
     RETURNING *`,
    [orderNumber, randomToken(18), req.user?.role === "customer" ? req.user.id : null, body.customer.name,
      body.customer.email ?? null, body.customer.phone, body.fulfilment, zoneId,
      body.fulfilment === "delivery" ? body.address?.line : null, body.address?.latitude ?? null,
      body.address?.longitude ?? null, body.address?.placeId ?? null, subtotal, discount, taxTotal, deliveryFee,
      grandTotal, coupon?.id ?? null, body.paymentMethod, holdMinutes, body.notes ?? null, body.whatsappOptIn !== false]
  );
  const order = rows[0];
  await insertItems(client, order.id, lines);
  await recordHistory(client, order.id, null, "pending", req.user?.id, "Order placed");
  await notify({ type: "order.new", title: "New online order", message: `${order.order_number} - ${order.customer_name} - ${grandTotal} FCFA`, data: { orderId: order.id }, client });
  return order;
}

// ---------------------------------------------------------------- receipts

export async function issueReceipt(client, orderId, issuedBy) {
  const existing = await client.query("SELECT * FROM receipts WHERE order_id = $1", [orderId]);
  if (existing.rows[0]) return existing.rows[0];
  const number = await nextNumber(client, "receipt_number_seq", "RCP");
  const { rows } = await client.query(
    "INSERT INTO receipts (receipt_number, order_id, verify_token, issued_by) VALUES ($1, $2, $3, $4) RETURNING *",
    [number, orderId, randomToken(16), issuedBy ?? null]
  );
  return rows[0];
}

// ---------------------------------------------------------------- payment confirmation

/**
 * Mark a payment as succeeded and the order as paid, deduct stock and issue the receipt.
 * Idempotent: calling it again for an already-succeeded payment is a no-op.
 * Must be called inside a transaction. Returns { order, receipt, alreadyProcessed }.
 */
export async function confirmPayment(client, paymentId, { actor, providerReference, raw } = {}) {
  const { rows: pRows } = await client.query("SELECT * FROM payments WHERE id = $1 FOR UPDATE", [paymentId]);
  const payment = pRows[0];
  if (!payment) throw notFound("Payment not found");
  const { rows: oRows } = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [payment.order_id]);
  const order = oRows[0];

  if (["succeeded", "refunded", "partially_refunded"].includes(payment.status)) {
    return { order, alreadyProcessed: true };
  }
  if (payment.amount !== order.grand_total - order.amount_paid) {
    await client.query("UPDATE payments SET status = 'failed', failure_reason = 'Amount mismatch' WHERE id = $1", [paymentId]);
    await notify({ type: "payment.mismatch", title: "Payment amount mismatch", message: `${order.order_number}: paid ${payment.amount}, due ${order.grand_total - order.amount_paid}`, data: { orderId: order.id }, client });
    return { order, alreadyProcessed: false, mismatch: true };
  }

  await client.query(
    `UPDATE payments SET status = 'succeeded', succeeded_at = now(), provider_reference = COALESCE($2, provider_reference),
            raw = COALESCE($3, raw) WHERE id = $1`,
    [paymentId, providerReference ?? null, raw ? JSON.stringify(raw) : null]
  );

  let attention = null;
  if (order.status === "pending") {
    const { needed, byId } = await loadOrderLines(client, order.id);
    try {
      await client.query("SAVEPOINT stock");
      await deductStock(client, order.id, needed, byId, { fromReservation: order.stock_reserved, actorId: actor?.id });
      await client.query("RELEASE SAVEPOINT stock");
    } catch (err) {
      if (err.status !== 409) throw err;
      await client.query("ROLLBACK TO SAVEPOINT stock");
      attention = "Paid but stock was no longer available - restock or refund";
    }
  } else {
    // Payment arrived after the order was cancelled/expired: keep the money, flag for refund.
    attention = `Payment received while order was ${order.status} - refund required`;
  }

  const newStatus = order.status === "pending" ? "paid" : order.status;
  const { rows: updated } = await client.query(
    `UPDATE orders SET status = $2::order_status, amount_paid = amount_paid + $3, paid_at = now(), stock_reserved = false,
            payment_method = $4, reservation_expires_at = NULL, needs_attention = $5,
            status_changed_at = CASE WHEN status <> $2::order_status THEN now() ELSE status_changed_at END
      WHERE id = $1 RETURNING *`,
    [order.id, newStatus, payment.amount, payment.method, attention]
  );
  if (newStatus !== order.status) await recordHistory(client, order.id, order.status, newStatus, actor?.id, `Payment ${payment.reference} confirmed`);
  if (order.coupon_id) {
    await client.query("UPDATE coupons SET used_count = used_count + 1 WHERE id = $1 AND (max_uses IS NULL OR used_count < max_uses)", [order.coupon_id]);
  }
  const receipt = await issueReceipt(client, order.id, actor?.id);
  await audit({
    client, actor, action: "payment.confirmed", entityType: "order", entityId: order.id,
    newValue: { payment: payment.reference, provider: payment.provider, amount: payment.amount, receipt: receipt.receipt_number, attention },
  });
  if (attention) await notify({ type: "order.attention", title: "Order needs attention", message: `${order.order_number}: ${attention}`, data: { orderId: order.id }, client });
  if (newStatus === "paid") await notifySale(client, order.id);
  if (order.customer_id) {
    await notify({ userId: order.customer_id, type: "order.paid", title: "Payment received", message: `Thank you! ${order.order_number} is paid. Your receipt is ready.`, data: { orderId: order.id }, client });
  }
  return { order: updated[0], receipt, alreadyProcessed: false };
}

// ---------------------------------------------------------------- cancellation & expiry

export async function cancelOrder(client, orderId, { actor, reason, req }) {
  const { rows } = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
  const order = rows[0];
  if (!order) throw notFound("Order not found");
  if (order.status !== "pending") throw badRequest("Only unpaid orders can be cancelled. Paid orders need a refund.");
  // the customer may already have sent the money: an admin must approve or reject the screenshot first
  const review = await client.query("SELECT 1 FROM payment_proofs WHERE order_id = $1 AND status = 'pending_review'", [orderId]);
  if (review.rowCount) {
    throw badRequest("This order's payment screenshot is being checked. It cannot be cancelled until an admin approves or rejects the payment.");
  }
  await releaseReservation(client, order);
  await client.query(
    "UPDATE orders SET status = 'cancelled', cancelled_at = now(), status_changed_at = now(), reservation_expires_at = NULL WHERE id = $1",
    [orderId]
  );
  await client.query("UPDATE payments SET status = 'cancelled' WHERE order_id = $1 AND status = 'pending'", [orderId]);
  await recordHistory(client, orderId, "pending", "cancelled", actor?.id, reason);
  await audit({ req, client, actor, action: "order.cancel", entityType: "order", entityId: orderId, oldValue: { status: "pending" }, newValue: { status: "cancelled", reason } });
  return order;
}

/** Cancel unpaid orders whose reservation expired and expire stale pending payments. Returns counts. */
export async function expireStale(tx) {
  const payments = await tx(async (client) => {
    const { rowCount } = await client.query(
      "UPDATE payments SET status = 'expired' WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now()"
    );
    return rowCount;
  });
  const { rows } = await tx((client) =>
    // an order whose payment screenshot is being checked by the admins never expires
    client.query(
      `SELECT id FROM orders o WHERE status = 'pending' AND stock_reserved AND reservation_expires_at < now()
          AND NOT EXISTS (SELECT 1 FROM payment_proofs p WHERE p.order_id = o.id AND p.status = 'pending_review') LIMIT 200`
    )
  );
  let orders = 0;
  for (const { id } of rows) {
    // one order that cannot be expired (e.g. a screenshot arrived meanwhile) must not stop the others
    try {
      await tx(async (client) => {
        const { rows: o } = await client.query("SELECT status, reservation_expires_at FROM orders WHERE id = $1 FOR UPDATE", [id]);
        if (o[0]?.status !== "pending" || o[0].reservation_expires_at > new Date()) return;
        await cancelOrder(client, id, { actor: null, reason: "Payment not received in time (expired)" });
        orders += 1;
      });
    } catch (err) {
      if (err.status !== 400) throw err;
    }
  }
  return { payments, orders };
}

// ---------------------------------------------------------------- status updates

export async function changeStatus(client, orderId, to, { actor, note, req }) {
  const { rows } = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
  const order = rows[0];
  if (!order) throw notFound("Order not found");
  if (actor.role === "delivery" && order.delivery_person_id !== actor.id) throw forbidden("This delivery is not assigned to you");

  const allowed = TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(to)) throw badRequest(`Cannot move an order from "${STATUS_LABELS[order.status]}" to "${STATUS_LABELS[to]}"`);
  if (to === "out_for_delivery" && order.fulfilment !== "delivery") throw badRequest("This order is not for delivery");
  if (to === "delivered" && order.fulfilment !== "delivery") throw badRequest("Use Completed for pickup orders");

  const { rows: updated } = await client.query(
    `UPDATE orders SET status = $2::order_status, status_changed_at = now(),
            delivered_at = CASE WHEN $2::order_status IN ('delivered', 'completed') THEN now() ELSE delivered_at END
      WHERE id = $1 RETURNING *`,
    [orderId, to]
  );
  await recordHistory(client, orderId, order.status, to, actor.id, note);
  await audit({ req, client, actor, action: "order.status_change", entityType: "order", entityId: orderId, oldValue: { status: order.status }, newValue: { status: to, note } });
  return updated[0];
}

export function notifyCustomerOfStatus(order) {
  if (order.customer_id) {
    notify({
      userId: order.customer_id, type: "order.status", title: `Order ${STATUS_LABELS[order.status]}`,
      message: `Your order ${order.order_number} is now: ${STATUS_LABELS[order.status]}.`, data: { orderId: order.id },
    }).catch((e) => console.error(`Customer notification failed: ${e.message}`));
  }
  if (!order.customer_email) return;
  const link = `${config.FRONTEND_URL}/track/${order.order_number}?token=${order.tracking_token}`;
  sendMailLater({
    to: order.customer_email,
    subject: `Order ${order.order_number}: ${STATUS_LABELS[order.status]}`,
    text: `Hello ${order.customer_name},\n\nYour order ${order.order_number} is now: ${STATUS_LABELS[order.status]}.\nTrack it here: ${link}\n\nCHAFADIA ENTERPRISE`,
  });
}

// ---------------------------------------------------------------- refunds

export async function refundOrder(client, orderId, { amount, reason, restock, actor, req, provider }) {
  const { rows } = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
  const order = rows[0];
  if (!order) throw notFound("Order not found");
  const refundable = order.amount_paid - order.amount_refunded;
  if (refundable <= 0) throw badRequest("Nothing left to refund on this order");
  const value = amount ?? refundable;
  if (value > refundable) throw badRequest(`At most ${refundable} FCFA can be refunded`);

  const { rows: pay } = await client.query(
    "SELECT * FROM payments WHERE order_id = $1 AND status IN ('succeeded', 'partially_refunded') ORDER BY id DESC LIMIT 1 FOR UPDATE",
    [orderId]
  );
  const payment = pay[0];
  if (!payment) throw badRequest("No successful payment found for this order");

  let status = "completed";
  let providerReference = null;
  if (payment.provider !== "cash" && payment.provider !== "manual") {
    const result = await provider.refund({ payment, amount: value, reason });
    status = result.status; // completed | pending | manual
    providerReference = result.providerReference ?? null;
  }

  const full = value === refundable;
  const { rows: refund } = await client.query(
    `INSERT INTO refunds (order_id, payment_id, amount, reason, status, restock, provider_reference, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [orderId, payment.id, value, reason, status, restock && full, providerReference, actor.id]
  );
  await client.query("UPDATE payments SET status = $2 WHERE id = $1", [payment.id, full ? "refunded" : "partially_refunded"]);

  if (restock && full) {
    // Put back exactly what this order took out (nothing, if stock was never deducted).
    const { rows: sold } = await client.query(
      `SELECT variant_id, -sum(quantity)::int AS qty FROM stock_movements
        WHERE reference_type = 'order' AND reference_id = $1 AND type = 'sale' GROUP BY variant_id ORDER BY variant_id`,
      [String(orderId)]
    );
    for (const { variant_id: vid, qty } of sold) {
      if (qty <= 0) continue;
      const { rows: v } = await client.query(
        "UPDATE product_variants SET stock_qty = stock_qty + $2 WHERE id = $1 RETURNING stock_qty, reserved_qty",
        [vid, qty]
      );
      await checkBackInStock(client, vid, v[0].stock_qty - qty - v[0].reserved_qty);
      await client.query(
        `INSERT INTO stock_movements (variant_id, type, quantity, stock_before, stock_after, reference_type, reference_id, note, created_by)
         VALUES ($1, 'return', $2, $3, $4, 'refund', $5, $6, $7)`,
        [vid, qty, v[0].stock_qty - qty, v[0].stock_qty, String(refund[0].id), reason, actor.id]
      );
    }
  }

  const { rows: updated } = await client.query(
    `UPDATE orders SET amount_refunded = amount_refunded + $2,
            status = CASE WHEN $3 THEN 'refunded'::order_status ELSE status END,
            status_changed_at = CASE WHEN $3 THEN now() ELSE status_changed_at END,
            needs_attention = CASE WHEN $3 THEN NULL ELSE needs_attention END
      WHERE id = $1 RETURNING *`,
    [orderId, value, full]
  );
  if (full) await recordHistory(client, orderId, order.status, "refunded", actor.id, reason);
  await audit({
    req, client, actor, action: full ? "refund.full" : "refund.partial", entityType: "order", entityId: orderId,
    oldValue: { amount_refunded: order.amount_refunded, status: order.status },
    newValue: { amount: value, reason, restock: restock && full, refundStatus: status },
  });
  return { order: updated[0], refund: refund[0] };
}

// ---------------------------------------------------------------- access & shaping

/** Throws unless the requester may see this order. */
export function assertCanView(req, order, token) {
  const u = req.user;
  if (u && can(u, "orders.view")) return;
  if (u && can(u, "receipts.print")) return; // cashiers/admins reprint any receipt
  if (u && u.role === "cashier" && order.cashier_id === u.id) return;
  if (u && u.role === "delivery" && order.delivery_person_id === u.id) return;
  if (u && order.customer_id && order.customer_id === u.id) return;
  if (token && token === order.tracking_token) return;
  throw notFound("Order not found");
}

export async function loadOrderDetail(run, orderId, { includeCost = false } = {}) {
  const { rows } = await run(
    `SELECT o.*, z.name AS zone_name, c.full_name AS cashier_name, d.full_name AS delivery_name, d.phone AS delivery_phone,
            r.receipt_number, r.id AS receipt_id, r.verify_token, r.emailed_at, r.whatsapp_sent_at,
            (SELECT json_build_object('status', w.status, 'error', w.error, 'at', w.updated_at)
               FROM whatsapp_messages w WHERE w.order_id = o.id AND w.purpose = 'receipt' ORDER BY w.id DESC LIMIT 1) AS whatsapp_last,
            EXISTS (SELECT 1 FROM payment_proofs pp WHERE pp.order_id = o.id AND pp.status = 'pending_review') AS proof_pending
       FROM orders o LEFT JOIN delivery_zones z ON z.id = o.delivery_zone_id
       LEFT JOIN users c ON c.id = o.cashier_id LEFT JOIN users d ON d.id = o.delivery_person_id
       LEFT JOIN receipts r ON r.order_id = o.id
      WHERE o.id = $1`,
    [orderId]
  );
  if (!rows[0]) return null;
  const [items, payments, history, refunds] = await Promise.all([
    run("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [orderId]),
    run("SELECT id, provider, method, amount, status, reference, failure_reason, checkout_url, created_at, succeeded_at FROM payments WHERE order_id = $1 ORDER BY id", [orderId]),
    run(`SELECT h.from_status, h.to_status, h.note, h.created_at, u.full_name AS by_name
           FROM order_status_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.order_id = $1 ORDER BY h.id`, [orderId]),
    run("SELECT id, amount, reason, status, restock, created_at FROM refunds WHERE order_id = $1 ORDER BY id", [orderId]),
  ]);
  return shapeOrder(rows[0], { items: items.rows, payments: payments.rows, history: history.rows, refunds: refunds.rows, includeCost });
}

export function shapeOrder(o, { items = [], payments = [], history = [], refunds = [], includeCost = false } = {}) {
  return {
    id: o.id,
    orderNumber: o.order_number,
    trackingToken: o.tracking_token,
    channel: o.channel,
    status: o.status,
    statusLabel: STATUS_LABELS[o.status],
    customer: { id: o.customer_id, name: o.customer_name, email: o.customer_email, phone: o.customer_phone },
    fulfilment: o.fulfilment,
    deliveryZone: o.delivery_zone_id ? { id: o.delivery_zone_id, name: o.zone_name } : null,
    deliveryAddress: o.delivery_address,
    location: o.latitude !== null && o.longitude !== null ? { lat: o.latitude, lng: o.longitude, placeId: o.place_id } : null,
    subtotal: o.subtotal,
    discountTotal: o.discount_total,
    taxTotal: o.tax_total,
    deliveryFee: o.delivery_fee,
    grandTotal: o.grand_total,
    amountPaid: o.amount_paid,
    amountRefunded: o.amount_refunded,
    balance: Math.max(0, o.grand_total - o.amount_paid),
    paymentMethod: o.payment_method,
    paymentStatus: o.amount_paid >= o.grand_total ? (o.amount_refunded >= o.amount_paid ? "refunded" : "paid") : "unpaid",
    reservationExpiresAt: o.reservation_expires_at,
    cashier: o.cashier_id ? { id: o.cashier_id, name: o.cashier_name } : null,
    deliveryPerson: o.delivery_person_id ? { id: o.delivery_person_id, name: o.delivery_name, phone: o.delivery_phone } : null,
    receipt: o.receipt_id
      ? {
          id: o.receipt_id, number: o.receipt_number, verifyToken: o.verify_token,
          emailedAt: o.emailed_at ?? null, whatsappSentAt: o.whatsapp_sent_at ?? null, whatsapp: o.whatsapp_last ?? null,
        }
      : null,
    whatsappOptIn: o.whatsapp_opt_in,
    paymentUnderReview: Boolean(o.proof_pending),
    needsAttention: o.needs_attention,
    notes: o.notes,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    deliveredAt: o.delivered_at,
    statusChangedAt: o.status_changed_at,
    items: items.map((i) => ({
      id: i.id,
      productId: i.product_id,
      variantId: i.variant_id,
      kind: i.kind,
      name: i.product_name,
      sku: i.sku,
      option: i.option_label,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
      bookingAt: i.booking_at,
      ...(includeCost && { unitCost: i.unit_cost }),
    })),
    payments: payments.map((p) => ({
      id: p.id, provider: p.provider, method: p.method, amount: p.amount, status: p.status, reference: p.reference,
      failureReason: p.failure_reason, createdAt: p.created_at, succeededAt: p.succeeded_at,
    })),
    history: history.map((h) => ({ from: h.from_status, to: h.to_status, note: h.note, at: h.created_at, by: h.by_name })),
    refunds,
  };
}
