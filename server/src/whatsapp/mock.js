// Development/test WhatsApp provider: prints messages to the API console and reports a delivery
// status straight away, so the "is this number on WhatsApp?" logic runs end to end without Meta.
// Rule for testing: numbers ending in 0000 behave as "not on WhatsApp" (error 131026).
import crypto from "node:crypto";
import { config } from "../config.js";

export const sentWhatsApp = []; // inspected by tests

const outcome = (to) =>
  to.endsWith("0000")
    ? { status: "failed", errors: [{ code: 131026, title: "Message undeliverable: the number is not on WhatsApp" }] }
    : { status: "delivered" };

function send(kind, to, details) {
  const id = `wamid.mock_${crypto.randomBytes(8).toString("hex")}`;
  sentWhatsApp.push({ id, kind, to, ...details });
  if (!config.isTest) console.log(`[whatsapp:dev] ${kind} to +${to}${details.filename ? ` with ${details.filename}` : ""}: ${details.text ?? ""}`);
  return { id, simulatedStatus: { id, recipient_id: to, ...outcome(to) } };
}

export const mockProvider = {
  name: "mock",
  async sendReceipt({ to, filename, bodyParams }) {
    const [name, order, amount, receipt] = bodyParams;
    return send("receipt", to, { filename, text: `Hello ${name}, thank you for order ${order}. Paid ${amount}. Receipt ${receipt} attached.` });
  },
  async sendWelcome({ to, name }) {
    return send("welcome", to, { text: `Welcome ${name}! Your CHAFADIA receipts will be sent here on WhatsApp.` });
  },
  /** Free text: only allowed by WhatsApp within 24 h of the customer's last message. */
  async sendText({ to, text }) {
    return send("text", to, { text });
  },
  /** Approved template with body parameters ({{1}}, {{2}}...). */
  async sendTemplate({ to, template, bodyParams }) {
    return send(`template:${template}`, to, { text: bodyParams.join(" | ") });
  },
  verifySignature() {
    return false; // the mock never receives real webhooks
  },
};
