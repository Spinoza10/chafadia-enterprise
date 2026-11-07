// Dashboards and reports. "Sold" means paid orders, net of refunds.
import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { can } from "../lib/rbac.js";
import { getSetting } from "../lib/settings.js";
import { parse } from "../lib/validate.js";
import { authenticate, requirePermission } from "../middleware/auth.js";

const router = Router();
router.use(authenticate);

const rangeSchema = z.object({
  period: z.enum(["today", "week", "month", "year", "custom", "all"]).default("month"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function resolveRange(q) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (q.period === "custom" && q.from) return { from: q.from, to: q.to ?? new Date(now.getTime() + 86400000) };
  const from = {
    today: start,
    week: new Date(start.getTime() - 6 * 86400000),
    month: new Date(now.getFullYear(), now.getMonth(), 1),
    year: new Date(now.getFullYear(), 0, 1),
    all: new Date(2000, 0, 1),
    custom: new Date(now.getFullYear(), now.getMonth(), 1),
  }[q.period];
  return { from, to: new Date(now.getTime() + 60000) };
}

const SOLD = "o.paid_at IS NOT NULL AND o.status <> 'refunded' AND o.paid_at >= $1 AND o.paid_at < $2";

async function salesTotals(from, to) {
  const { rows } = await query(
    `SELECT count(*)::int AS orders, coalesce(sum(o.amount_paid - o.amount_refunded), 0)::bigint AS revenue,
            coalesce(sum(o.discount_total), 0)::bigint AS discounts
       FROM orders o WHERE ${SOLD}`,
    [from, to]
  );
  return rows[0];
}

function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function send(res, req, rows, filename) {
  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    return res.send(`﻿${toCsv(rows)}`);
  }
  res.json({ data: rows });
}

// ---------------------------------------------------------------- Super Admin dashboard

router.get("/summary", requirePermission("reports.full"), async (req, res) => {
  const { from, to } = resolveRange(parse(rangeSchema, req.query));
  const p = [from, to];
  const [totals, profit, byMethod, byCashier, byCategory, byChannel, best, stock, lowStock, pending, recent, daily] = await Promise.all([
    salesTotals(from, to),
    query(
      `SELECT coalesce(sum(oi.line_total - oi.unit_cost * oi.quantity), 0)::bigint AS gross_profit,
              coalesce(sum(oi.unit_cost * oi.quantity), 0)::bigint AS cost_of_goods
         FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${SOLD}`, p),
    query(`SELECT o.payment_method AS method, count(*)::int AS orders, sum(o.amount_paid - o.amount_refunded)::bigint AS amount
             FROM orders o WHERE ${SOLD} GROUP BY 1 ORDER BY amount DESC`, p),
    query(`SELECT coalesce(u.full_name, 'Online store') AS cashier, count(*)::int AS orders, sum(o.amount_paid - o.amount_refunded)::bigint AS amount
             FROM orders o LEFT JOIN users u ON u.id = o.cashier_id WHERE ${SOLD} GROUP BY 1 ORDER BY amount DESC`, p),
    query(`SELECT coalesce(c.name_en, 'Uncategorised') AS category, sum(oi.quantity)::int AS units, sum(oi.line_total)::bigint AS amount,
                  sum(oi.line_total - oi.unit_cost * oi.quantity)::bigint AS profit
             FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products pr ON pr.id = oi.product_id
             LEFT JOIN categories c ON c.id = pr.category_id WHERE ${SOLD} GROUP BY 1 ORDER BY amount DESC`, p),
    query(`SELECT o.channel, count(*)::int AS orders, sum(o.amount_paid - o.amount_refunded)::bigint AS amount
             FROM orders o WHERE ${SOLD} GROUP BY 1`, p),
    query(`SELECT oi.product_id AS "productId", max(oi.product_name) AS name, sum(oi.quantity)::int AS units, sum(oi.line_total)::bigint AS amount
             FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${SOLD} GROUP BY 1 ORDER BY units DESC LIMIT 10`, p),
    query(`SELECT coalesce(sum(stock_qty * cost_price), 0)::bigint AS cost_value, coalesce(sum(stock_qty * price), 0)::bigint AS retail_value,
                  coalesce(sum(stock_qty), 0)::bigint AS units
             FROM product_variants WHERE track_stock AND is_active`),
    query(`SELECT v.id AS "variantId", p.name_en AS name, v.sku, v.stock_qty - v.reserved_qty AS available, v.low_stock_threshold AS threshold
             FROM product_variants v JOIN products p ON p.id = v.product_id
            WHERE v.track_stock AND v.is_active AND p.is_active AND v.stock_qty - v.reserved_qty <= v.low_stock_threshold
            ORDER BY available, p.name_en LIMIT 50`),
    query(`SELECT status, count(*)::int AS n FROM orders WHERE status IN ('pending','paid','processing','out_for_delivery') GROUP BY status`),
    query(`SELECT a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.created_at AS "createdAt", u.full_name AS actor
             FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 12`),
    query(`SELECT to_char(date_trunc('day', o.paid_at), 'YYYY-MM-DD') AS day, count(*)::int AS orders,
                  sum(o.amount_paid - o.amount_refunded)::bigint AS amount
             FROM orders o WHERE ${SOLD} GROUP BY 1 ORDER BY 1`, p),
  ]);
  const expenses = await query("SELECT coalesce(sum(amount), 0)::bigint AS total FROM expenses WHERE spent_on >= $1::date AND spent_on < $2::date + 1", p);
  res.json({
    data: {
      range: { from, to },
      ...totals,
      grossProfit: profit.rows[0].gross_profit,
      costOfGoods: profit.rows[0].cost_of_goods,
      expenses: expenses.rows[0].total,
      netProfit: profit.rows[0].gross_profit - expenses.rows[0].total,
      byMethod: byMethod.rows,
      byCashier: byCashier.rows,
      byCategory: byCategory.rows,
      byChannel: byChannel.rows,
      bestSellers: best.rows,
      stockValue: stock.rows[0],
      lowStock: lowStock.rows,
      pipeline: Object.fromEntries(pending.rows.map((r) => [r.status, r.n])),
      recentActivity: recent.rows,
      daily: daily.rows,
    },
  });
});

// ---------------------------------------------------------------- Admin dashboard (limited)

router.get("/admin", requirePermission("reports.sales_total", "reports.slow_products"), async (req, res) => {
  const { from, to } = resolveRange(parse(rangeSchema, req.query));
  const run = query;
  const slowDays = Number(await getSetting("slow_product_days", 30, run));
  const stuckHours = Number(await getSetting("stuck_order_hours", 48, run));
  const data = {};

  if (can(req.user, "reports.sales_total")) {
    const [totals, pipeline, queue] = await Promise.all([
      salesTotals(from, to),
      query("SELECT status, count(*)::int AS n FROM orders GROUP BY status"),
      query(`SELECT o.id, o.order_number AS "orderNumber", o.customer_name AS "customerName", o.status, o.delivery_address AS address,
                    o.latitude AS lat, o.longitude AS lng, d.full_name AS "deliveryPerson", o.status_changed_at AS "since"
               FROM orders o LEFT JOIN users d ON d.id = o.delivery_person_id
              WHERE o.fulfilment = 'delivery' AND o.status IN ('paid','processing','out_for_delivery') ORDER BY o.paid_at LIMIT 100`),
    ]);
    Object.assign(data, {
      range: { from, to },
      totalSold: totals.revenue,
      ordersSold: totals.orders,
      pipeline: Object.fromEntries(pipeline.rows.map((r) => [r.status, r.n])),
      deliveryQueue: queue.rows,
    });
  }
  if (can(req.user, "reports.slow_products")) {
    const [slow, stuck] = await Promise.all([
      query(
        `SELECT p.id, p.name_en AS name, v.sku, v.stock_qty AS stock, max(o.paid_at) AS "lastSoldAt", p.created_at AS "createdAt"
           FROM products p JOIN product_variants v ON v.product_id = p.id
           LEFT JOIN order_items oi ON oi.variant_id = v.id
           LEFT JOIN orders o ON o.id = oi.order_id AND o.paid_at IS NOT NULL
          WHERE p.is_active AND v.is_active AND p.created_at < now() - make_interval(days => $1)
          GROUP BY p.id, v.id HAVING max(o.paid_at) IS NULL OR max(o.paid_at) < now() - make_interval(days => $1)
          ORDER BY max(o.paid_at) NULLS FIRST, v.stock_qty DESC LIMIT 100`,
        [slowDays]
      ),
      query(
        `SELECT id, order_number AS "orderNumber", customer_name AS "customerName", status, status_changed_at AS since, needs_attention AS "needsAttention"
           FROM orders WHERE (status IN ('paid','processing','out_for_delivery') AND status_changed_at < now() - make_interval(hours => $1))
              OR needs_attention IS NOT NULL
          ORDER BY status_changed_at LIMIT 100`,
        [stuckHours]
      ),
    ]);
    Object.assign(data, { slowProducts: slow.rows, stuckOrders: stuck.rows, thresholds: { slowDays, stuckHours } });
  }
  res.json({ data });
});

// ---------------------------------------------------------------- per product

router.get("/products", requirePermission("reports.full", "reports.sales_total"), async (req, res) => {
  const { from, to } = resolveRange(parse(rangeSchema, req.query));
  const full = can(req.user, "reports.full");
  const { rows } = await query(
    `SELECT p.id AS "productId", p.name_en AS name, v.sku, v.stock_qty AS "inStock",
            coalesce(sum(oi.quantity) FILTER (WHERE o.id IS NOT NULL), 0)::int AS "quantitySold",
            coalesce(sum(oi.line_total) FILTER (WHERE o.id IS NOT NULL), 0)::bigint AS "amountSold"
            ${full ? `, v.price, v.cost_price AS "costPrice",
            coalesce(sum(oi.line_total - oi.unit_cost * oi.quantity) FILTER (WHERE o.id IS NOT NULL), 0)::bigint AS profit` : ""}
       FROM product_variants v JOIN products p ON p.id = v.product_id
       LEFT JOIN order_items oi ON oi.variant_id = v.id
       LEFT JOIN orders o ON o.id = oi.order_id AND ${SOLD}
      GROUP BY p.id, v.id ORDER BY "amountSold" DESC, p.name_en`,
    [from, to]
  );
  send(res, req, rows, "products-report");
});

router.get("/sales", requirePermission("reports.full"), async (req, res) => {
  const { from, to } = resolveRange(parse(rangeSchema, req.query));
  const { rows } = await query(
    `SELECT o.order_number AS "order", r.receipt_number AS receipt, o.channel, o.status, o.paid_at AS "paidAt",
            o.customer_name AS customer, o.payment_method AS method, o.subtotal, o.discount_total AS discount, o.tax_total AS tax,
            o.delivery_fee AS delivery, o.grand_total AS total, o.amount_refunded AS refunded, coalesce(u.full_name, 'Online') AS cashier
       FROM orders o LEFT JOIN receipts r ON r.order_id = o.id LEFT JOIN users u ON u.id = o.cashier_id
      WHERE o.paid_at IS NOT NULL AND o.paid_at >= $1 AND o.paid_at < $2 ORDER BY o.paid_at DESC`,
    [from, to]
  );
  send(res, req, rows, "sales");
});

export default router;
