import { query } from "../db.js";
import { getSetting } from "./settings.js";
import { sendMailLater } from "./mailer.js";

const fcfa = (n) => `${Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ")} FCFA`;

/**
 * Notification for one user (userId) or for every admin and the owner (userId = null).
 * Shared notifications keep a separate read state per admin (notification_reads).
 */
export async function notify({ userId = null, type, title, message, data, client }) {
  const run = client ? client.query.bind(client) : query;
  await run("INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1, $2, $3, $4, $5)", [
    userId,
    type,
    title,
    message,
    data ? JSON.stringify(data) : null,
  ]);
}

async function alertEmail(client, subject, text) {
  const to = await getSetting("alert_email", "", client.query.bind(client));
  if (to) sendMailLater({ to, subject: `[CHAFADIA] ${subject}`, text });
}

/**
 * Raise a low-stock or sold-out alert when a variant's available stock crosses its threshold
 * (only on the crossing, so repeated sales don't spam). Available = stock - reserved, so an item
 * is "sold out" as soon as the last unit is reserved by a paying customer.
 */
export async function checkLowStock(client, variantId, availableBefore) {
  const { rows } = await client.query(
    `SELECT v.sku, v.name AS variant_name, v.stock_qty - v.reserved_qty AS available, v.low_stock_threshold, v.track_stock,
            p.id AS product_id, p.name_en
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
    [variantId]
  );
  const v = rows[0];
  if (!v || !v.track_stock) return;
  const crossedLow = availableBefore > v.low_stock_threshold && v.available <= v.low_stock_threshold;
  const crossedOut = availableBefore > 0 && v.available <= 0;
  if (!crossedLow && !crossedOut) return;

  const out = v.available <= 0;
  const name = v.variant_name && v.variant_name !== "Standard" ? `${v.name_en} - ${v.variant_name}` : v.name_en;
  const title = out ? "Sold out" : "Low stock";
  const message = out
    ? `${name} (${v.sku}) is completely sold out. Customers now see it as unavailable.`
    : `${name} (${v.sku}) - only ${v.available} left`;
  await notify({ type: out ? "stock.out" : "stock.low", title, message, data: { variantId, productId: v.product_id, sku: v.sku }, client });
  await alertEmail(client, `${title}: ${name}`, message);
}

/** A sold-out variant got units back (reservation released, restock, refund). */
export async function checkBackInStock(client, variantId, availableBefore) {
  if (availableBefore > 0) return;
  const { rows } = await client.query(
    `SELECT v.sku, v.stock_qty - v.reserved_qty AS available, v.track_stock, p.id AS product_id, p.name_en
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
    [variantId]
  );
  const v = rows[0];
  if (!v || !v.track_stock || v.available <= 0) return;
  await notify({
    type: "stock.back",
    title: "Back in stock",
    message: `${v.name_en} (${v.sku}) is available again - ${v.available} in stock.`,
    data: { variantId, productId: v.product_id, sku: v.sku },
    client,
  });
}

/** Tell every admin exactly what was sold: items, quantities, total, channel and who sold it. */
export async function notifySale(client, orderId) {
  const { rows } = await client.query(
    `SELECT o.order_number, o.channel, o.grand_total, o.payment_method, o.customer_name, u.full_name AS cashier
       FROM orders o LEFT JOIN users u ON u.id = o.cashier_id WHERE o.id = $1`,
    [orderId]
  );
  const o = rows[0];
  if (!o) return;
  const { rows: items } = await client.query(
    "SELECT product_name, quantity FROM order_items WHERE order_id = $1 ORDER BY id",
    [orderId]
  );
  const list = items.map((i) => `${i.quantity} x ${i.product_name}`).join(", ");
  const where = o.channel === "pos" ? `in store by ${o.cashier ?? "cashier"}` : `online to ${o.customer_name}`;
  await notify({
    type: "sale",
    title: `Sold: ${fcfa(o.grand_total)}`,
    message: `${o.order_number} sold ${where}: ${list}`,
    data: { orderId, channel: o.channel, items: items.map((i) => ({ name: i.product_name, quantity: i.quantity })) },
    client,
  });
}
