// Development/test provider. Simulates a hosted checkout and sends signed webhooks, so the real
// webhook verification path runs end to end. Refused at startup when NODE_ENV=production.
import crypto from "node:crypto";
import { config } from "../config.js";
import { safeEqual } from "../lib/tokens.js";

const state = new Map(); // reference -> { status, amount }

export const sign = (rawBody) => crypto.createHmac("sha256", config.MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex");

export const mockProvider = {
  name: "mock",

  // Mobile money behaves like the real direct charge: no redirect, the customer approves on the
  // phone. In development the "phone" is simulated on the payment page (see PaymentReturn).
  async initiate({ payment }) {
    state.set(payment.reference, { status: "pending", amount: payment.amount });
    if (payment.method === "mtn_momo" || payment.method === "orange_money") {
      return { providerReference: `mock_${payment.reference}`, checkoutUrl: null, mode: "push" };
    }
    return {
      providerReference: `mock_${payment.reference}`,
      checkoutUrl: `${config.FRONTEND_URL}/payment/mock?reference=${encodeURIComponent(payment.reference)}`,
      mode: "redirect",
    };
  },

  /** Returns the parsed event or throws when the signature is invalid. */
  verifyWebhook(rawBody, headers) {
    const signature = headers["x-mock-signature"];
    if (!signature || !safeEqual(signature, sign(rawBody))) return null;
    const event = JSON.parse(rawBody.toString("utf8"));
    return { eventId: event.id, reference: event.reference };
  },

  /** Server-to-server status check: the source of truth, never the webhook body. */
  async fetchStatus(reference) {
    const s = state.get(reference);
    if (!s) return { status: "unknown" };
    return { status: s.status, amount: s.amount, providerReference: `mock_${reference}` };
  },

  async refund() {
    return { status: "completed", providerReference: `mock_refund_${crypto.randomBytes(6).toString("hex")}` };
  },

  // ---- dev helpers (used by the /payment/mock page and tests)
  simulate(reference, outcome) {
    const s = state.get(reference);
    if (!s) return null;
    s.status = outcome === "success" ? "succeeded" : "failed";
    const body = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, type: `payment.${s.status}`, reference });
    return { body, signature: sign(body) };
  },
};
