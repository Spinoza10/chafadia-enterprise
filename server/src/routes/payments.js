import { Router } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query, tx } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { id, pagination, parse, phone } from "../lib/validate.js";
import { authenticate, optionalAuth, requirePermission } from "../middleware/auth.js";
import { getProvider, mockProvider } from "../payments/index.js";
import { assertCanView, confirmPayment } from "../services/orders.js";
import { deliverReceipt } from "../services/receipts.js";
import { localCameroon, maskPhone, operatorOf, toE164Digits } from "../lib/phone.js";
import { randomToken } from "../lib/tokens.js";

const router = Router();
const limiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: config.isTest ? 1000 : 30, standardHeaders: "draft-7", legacyHeaders: false });

/**
 * Process a verified provider reference: ask the provider for the real status (never trust the
 * webhook body or the browser) and confirm or fail the payment. Safe to call repeatedly.
 */
export async function reconcile(providerName, reference) {
  const provider = getProvider(providerName);
  const { rows } = await query("SELECT * FROM payments WHERE reference = $1 AND provider = $2", [reference, providerName]);
  const payment = rows[0];
  if (!payment) return { status: "unknown" };
  if (payment.status !== "pending" && payment.status !== "expired") return { status: payment.status };

  const remote = await provider.fetchStatus(reference);
  if (remote.status === "succeeded") {
    if (Number(remote.amount) !== payment.amount) {
      await query("UPDATE payments SET status = 'failed', failure_reason = 'Amount mismatch from provider' WHERE id = $1", [payment.id]);
      return { status: "failed" };
    }
    const result = await tx((client) => confirmPayment(client, payment.id, { providerReference: remote.providerReference, raw: remote }));
    if (!result.alreadyProcessed && !result.mismatch) deliverReceipt(payment.order_id); // background, never throws
    return { status: result.mismatch ? "failed" : "succeeded" };
  }
  if (["failed", "cancelled", "expired"].includes(remote.status)) {
    await query("UPDATE payments SET status = $2, failure_reason = $3 WHERE id = $1 AND status = 'pending'", [payment.id, remote.status, `Provider reported ${remote.status}`]);
    return { status: remote.status };
  }
  return { status: "pending" };
}

// ---------------------------------------------------------------- initiate

router.post("/initiate", limiter, optionalAuth, async (req, res) => {
  const body = parse(
    z.object({
      orderId: id,
      token: z.string().max(100).optional(),
      method: z.enum(["mtn_momo", "orange_money", "card"]),
      phone: phone.optional(),
    }),
    req.body
  );
  if (config.ONLINE_PAYMENT_MODE === "manual") {
    throw badRequest("Send the money to the shop's Mobile Money number and upload the screenshot of the payment.");
  }
  const isMobile = body.method === "mtn_momo" || body.method === "orange_money";
  let payerPhone = null;
  if (isMobile) {
    if (!body.phone) throw badRequest("Enter the mobile money phone number");
    const local = localCameroon(body.phone);
    if (!local || !local.startsWith("6")) throw badRequest("Enter a valid Cameroon mobile number (9 digits starting with 6)");
    const operator = operatorOf(local);
    if (body.method === "mtn_momo" && operator === "orange") throw badRequest("This is an Orange number. Choose Orange Money or enter an MTN number.");
    if (body.method === "orange_money" && operator === "mtn") throw badRequest("This is an MTN number. Choose MTN Mobile Money or enter an Orange number.");
    payerPhone = toE164Digits(local);
  }

  const { rows } = await query("SELECT * FROM orders WHERE id = $1", [body.orderId]);
  const order = rows[0];
  if (!order) throw notFound("Order not found");
  assertCanView(req, order, body.token);
  if (order.status !== "pending") throw badRequest("This order is not awaiting payment");
  if (!order.stock_reserved) throw badRequest("This order has expired. Please place a new order.");

  const provider = getProvider();
  // Idempotent: reuse a live pending payment for the same method instead of creating duplicates.
  // A different payer number starts a new prompt; the same number reuses the one already sent.
  const live = await query(
    `SELECT * FROM payments WHERE order_id = $1 AND status = 'pending' AND method = $2 AND expires_at > now()
        AND phone IS NOT DISTINCT FROM $3 ORDER BY id DESC LIMIT 1`,
    [order.id, body.method, payerPhone]
  );
  if (live.rows[0]) {
    const p = live.rows[0];
    return res.json({
      data: { reference: p.reference, checkoutUrl: p.checkout_url, status: "pending", mode: isMobile ? "push" : "redirect", phone: maskPhone(p.phone), instructions: instructionsFor(p) },
    });
  }

  const amount = order.grand_total - order.amount_paid;
  const reference = `PAY-${order.order_number}-${randomToken(4)}`;
  const { rows: created } = await query(
    `INSERT INTO payments (order_id, provider, method, amount, status, reference, phone, expires_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, now() + make_interval(mins => $7)) RETURNING *`,
    [order.id, provider.name, body.method, amount, reference, payerPhone, config.PAYMENT_TIMEOUT_MINUTES]
  );
  const payment = created[0];
  try {
    const init = await provider.initiate({ payment, order });
    await query("UPDATE payments SET provider_reference = $2, checkout_url = $3 WHERE id = $1", [payment.id, init.providerReference, init.checkoutUrl]);
    await query("UPDATE orders SET payment_method = $2 WHERE id = $1", [order.id, body.method]);
    res.status(201).json({
      data: { reference, checkoutUrl: init.checkoutUrl, status: "pending", mode: init.mode, phone: maskPhone(payerPhone), instructions: instructionsFor(payment) },
    });
  } catch (err) {
    console.error(`[payments] initiate ${reference} failed: ${err.message}`);
    await query("UPDATE payments SET status = 'failed', failure_reason = $2 WHERE id = $1", [payment.id, err.message.slice(0, 300)]);
    throw badRequest(
      isMobile
        ? "We could not send the payment request to this number. Check the number and that the account is active, then try again."
        : "The payment provider is unavailable. Please try again in a moment."
    );
  }
});

const NETWORK = { mtn_momo: "MTN Mobile Money", orange_money: "Orange Money" };

/** What the customer sees while the prompt is on their phone. */
function instructionsFor(p) {
  if (!NETWORK[p.method]) return "Complete the card payment on the secure page.";
  return `A payment request of ${Number(p.amount).toLocaleString("fr-FR")} FCFA was sent to ${maskPhone(p.phone)}. `
    + `Enter your ${NETWORK[p.method]} PIN on your phone to confirm. Never share your PIN with anyone, including our staff.`;
}

/** Polled by the payment return page. Re-checks the provider while the payment is pending. */
router.get("/:reference/status", limiter, async (req, res) => {
  const reference = String(req.params.reference).slice(0, 120);
  const { rows } = await query(
    `SELECT p.status, p.provider, p.method, p.amount, p.phone, o.status AS order_status, o.order_number, o.tracking_token,
            o.id AS order_id, o.customer_email
       FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.reference = $1`,
    [reference]
  );
  const p = rows[0];
  if (!p) throw notFound("Payment not found");
  let status = p.status;
  // only gateway payments can be re-checked with a provider; manual ones wait for the admins
  if (status === "pending" && ["mock", "notchpay"].includes(p.provider)) status = (await reconcile(p.provider, reference)).status;
  const order = (await query("SELECT status, stock_reserved FROM orders WHERE id = $1", [p.order_id])).rows[0];
  const receipt = (await query("SELECT emailed_at, whatsapp_sent_at FROM receipts WHERE order_id = $1", [p.order_id])).rows[0];
  // The reference itself is the capability here, so returning the tracking token is safe.
  res.json({
    data: {
      status,
      method: p.method,
      mode: NETWORK[p.method] ? "push" : "redirect",
      amount: p.amount,
      phone: maskPhone(p.phone),
      instructions: status === "pending" ? instructionsFor(p) : undefined,
      simulated: p.provider === "mock",
      canRetry: order.status === "pending" && order.stock_reserved,
      receiptSent: receipt ? { email: Boolean(receipt.emailed_at), whatsapp: Boolean(receipt.whatsapp_sent_at) } : null,
      orderStatus: order.status,
      orderId: p.order_id,
      orderNumber: p.order_number,
      trackingToken: p.tracking_token,
    },
  });
});

// ---------------------------------------------------------------- webhooks

router.post("/webhook/:provider", express.raw({ type: "*/*", limit: "256kb" }), async (req, res) => {
  const providerName = req.params.provider;
  if (!["mock", "notchpay"].includes(providerName)) throw notFound();
  if (providerName === "mock" && config.isProd) throw notFound();
  const provider = getProvider(providerName);
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");

  let event = null;
  try {
    event = provider.verifyWebhook(raw, req.headers);
  } catch {
    event = null;
  }
  if (!event) {
    await query(
      "INSERT INTO payment_webhook_events (provider, event_id, signature_valid, payload) VALUES ($1, $2, false, NULL) ON CONFLICT DO NOTHING",
      [providerName, `invalid-${randomToken(8)}`]
    );
    return res.status(401).json({ error: { code: "INVALID_SIGNATURE", message: "Invalid signature" } });
  }

  // Idempotency: the first delivery of an event id wins; replays are acknowledged and ignored.
  const inserted = await query(
    `INSERT INTO payment_webhook_events (provider, event_id, reference, signature_valid, payload)
     VALUES ($1, $2, $3, true, $4) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
    [providerName, String(event.eventId).slice(0, 200), event.reference ?? null, raw.toString("utf8").slice(0, 20000)]
  );
  if (!inserted.rowCount) return res.json({ received: true, duplicate: true });

  try {
    const result = await reconcile(providerName, event.reference);
    await query("UPDATE payment_webhook_events SET processed_at = now() WHERE id = $1", [inserted.rows[0].id]);
    res.json({ received: true, status: result.status });
  } catch (err) {
    await query("UPDATE payment_webhook_events SET error = $2 WHERE id = $1", [inserted.rows[0].id, err.message.slice(0, 500)]);
    throw err; // 500 -> provider retries later
  }
});

// Development only: the simulated checkout page calls this to approve/decline a mock payment.
router.post("/mock/:reference/complete", limiter, async (req, res) => {
  if (config.isProd || config.PAYMENT_PROVIDER !== "mock") throw notFound();
  const { outcome } = parse(z.object({ outcome: z.enum(["success", "failure"]) }), req.body);
  const sim = mockProvider.simulate(String(req.params.reference), outcome);
  if (!sim) throw notFound("Payment not found");
  // Deliver a signed webhook to ourselves, exactly as the provider would.
  const r = await fetch(`http://127.0.0.1:${req.socket.localPort}/api/payments/webhook/mock`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mock-signature": sim.signature },
    body: sim.body,
  });
  res.status(r.ok ? 200 : 502).json(await r.json());
});

// ---------------------------------------------------------------- staff listing

router.get("/", authenticate, requirePermission("payments.view"), async (req, res) => {
  const q = parse(
    pagination.extend({
      status: z.string().max(30).optional(),
      method: z.enum(["cash", "mtn_momo", "orange_money", "card"]).optional(),
      search: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    req.query
  );
  const params = [];
  const where = ["true"];
  if (q.status) where.push(`p.status = $${params.push(q.status)}`);
  if (q.method) where.push(`p.method = $${params.push(q.method)}`);
  if (q.search) {
    const i = params.push(`%${q.search}%`);
    where.push(`(p.reference ILIKE $${i} OR o.order_number ILIKE $${i} OR o.customer_name ILIKE $${i} OR p.phone ILIKE $${i})`);
  }
  const { rows } = await query(
    `SELECT p.id, p.provider, p.method, p.amount, p.status, p.reference, p.provider_reference AS "providerReference",
            p.phone, p.failure_reason AS "failureReason", p.created_at AS "createdAt", p.succeeded_at AS "succeededAt",
            o.id AS "orderId", o.order_number AS "orderNumber", o.customer_name AS "customerName", o.channel,
            u.full_name AS "recordedBy", count(*) OVER() AS total
       FROM payments p JOIN orders o ON o.id = p.order_id LEFT JOIN users u ON u.id = p.recorded_by
      WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    params
  );
  res.json({ data: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 });
});

export default router;
