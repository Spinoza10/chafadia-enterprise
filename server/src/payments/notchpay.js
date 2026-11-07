// Notch Pay (https://notchpay.co) - Cameroonian aggregator: MTN MoMo, Orange Money and cards in XAF.
// Written against Notch Pay's public REST API. Verify field names in their sandbox before go-live;
// all calls are isolated here so differences only need fixing in this file.
import crypto from "node:crypto";
import { config } from "../config.js";
import { safeEqual } from "../lib/tokens.js";

const STATUS_MAP = {
  complete: "succeeded",
  completed: "succeeded",
  success: "succeeded",
  failed: "failed",
  canceled: "cancelled",
  cancelled: "cancelled",
  expired: "expired",
  pending: "pending",
  processing: "pending",
};

async function api(path, { method = "GET", body } = {}) {
  if (!config.NOTCHPAY_PUBLIC_KEY) throw new Error("NOTCHPAY_PUBLIC_KEY is not configured");
  const res = await fetch(`${config.NOTCHPAY_API_URL}${path}`, {
    method,
    headers: {
      Authorization: config.NOTCHPAY_PUBLIC_KEY,
      ...(config.NOTCHPAY_PRIVATE_KEY && { "X-Grant": config.NOTCHPAY_PRIVATE_KEY }),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Notch Pay ${method} ${path} failed (${res.status}): ${data.message ?? "unknown error"}`);
  return data;
}

const CHANNELS = { mtn_momo: "cm.mtn", orange_money: "cm.orange", card: "card" };

export const notchpayProvider = {
  name: "notchpay",

  /**
   * Mobile money is charged directly ("direct charge"): Notch Pay asks MTN / Orange to push a
   * payment prompt to the customer's phone, the customer types their own PIN on the phone, and
   * the money moves. The PIN never passes through our website. Cards use Notch Pay's hosted page.
   */
  async initiate({ payment, order }) {
    const data = await api("/payments", {
      method: "POST",
      body: {
        amount: payment.amount,
        currency: "XAF",
        reference: payment.reference,
        email: order.customer_email || undefined,
        phone: payment.phone || order.customer_phone || undefined,
        customer: { name: order.customer_name, email: order.customer_email || undefined, phone: payment.phone || order.customer_phone || undefined },
        description: `Order ${order.order_number}`,
        callback: `${config.FRONTEND_URL}/payment/return?reference=${encodeURIComponent(payment.reference)}`,
        locked_channel: CHANNELS[payment.method],
      },
    });
    const providerReference = data.transaction?.reference ?? null;

    if (payment.method === "mtn_momo" || payment.method === "orange_money") {
      if (!providerReference) throw new Error("Notch Pay did not return a transaction reference");
      await api(`/payments/${encodeURIComponent(providerReference)}`, {
        method: "POST",
        body: { channel: CHANNELS[payment.method], data: { phone: `+${payment.phone.replace(/\D/g, "")}` } },
      });
      return { providerReference, checkoutUrl: null, mode: "push" };
    }
    return { providerReference, checkoutUrl: data.authorization_url ?? null, mode: "redirect" };
  },

  verifyWebhook(rawBody, headers) {
    const signature = headers["x-notch-signature"];
    if (!config.NOTCHPAY_WEBHOOK_HASH || !signature) return null;
    const expected = crypto.createHmac("sha256", config.NOTCHPAY_WEBHOOK_HASH).update(rawBody).digest("hex");
    if (!safeEqual(signature, expected)) return null;
    const event = JSON.parse(rawBody.toString("utf8"));
    const data = event.data ?? {};
    return {
      eventId: event.id ?? `${event.event}:${data.reference ?? data.merchant_reference}`,
      reference: data.merchant_reference ?? data.trxref ?? data.reference,
    };
  },

  async fetchStatus(reference) {
    const data = await api(`/payments/${encodeURIComponent(reference)}`);
    const t = data.transaction ?? {};
    return {
      status: STATUS_MAP[String(t.status).toLowerCase()] ?? "pending",
      amount: Number(t.amount),
      providerReference: t.reference ?? null,
    };
  },

  // Notch Pay refunds are handled from the merchant dashboard; record as manual.
  async refund() {
    return { status: "manual", providerReference: null };
  },
};
