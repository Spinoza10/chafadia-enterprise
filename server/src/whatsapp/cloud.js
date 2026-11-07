// Meta WhatsApp Cloud API (official). Business-initiated messages must use a template approved in
// WhatsApp Manager, so the receipt is sent as the "order_receipt" template with the PDF as its
// document header. See README section "WhatsApp receipts" for the template text.
import crypto from "node:crypto";
import { config } from "../config.js";
import { safeEqual } from "../lib/tokens.js";

export class WhatsAppError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function graph(path, init) {
  const res = await fetch(`${config.WHATSAPP_API_URL}/${config.WHATSAPP_PHONE_NUMBER_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}`, ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error ?? {};
    throw new WhatsAppError(`${e.message ?? `HTTP ${res.status}`}${e.error_data?.details ? ` - ${e.error_data.details}` : ""}`, e.code);
  }
  return data;
}

export const cloudProvider = {
  name: "cloud",

  async uploadPdf(pdf, filename) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "application/pdf");
    form.append("file", new Blob([pdf], { type: "application/pdf" }), filename);
    const data = await graph("/media", { method: "POST", body: form });
    return data.id;
  },

  async sendTemplate({ to, template, header, bodyParams }) {
    const components = [];
    if (header) components.push({ type: "header", parameters: [header] });
    if (bodyParams?.length) components.push({ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text: String(text) })) });
    const data = await graph("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: { name: template, language: { code: config.WHATSAPP_TEMPLATE_LANG }, components },
      }),
    });
    return { id: data.messages?.[0]?.id ?? null };
  },

  async sendReceipt({ to, pdf, filename, bodyParams }) {
    const mediaId = await this.uploadPdf(pdf, filename);
    return this.sendTemplate({
      to,
      template: config.WHATSAPP_RECEIPT_TEMPLATE,
      header: { type: "document", document: { id: mediaId, filename } },
      bodyParams,
    });
  },

  /** Free-form text: WhatsApp only allows it within 24 h of the customer's last message to us. */
  async sendText({ to, text }) {
    const data = await graph("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text, preview_url: true } }),
    });
    return { id: data.messages?.[0]?.id ?? null };
  },

  async sendWelcome({ to, name }) {
    if (!config.WHATSAPP_WELCOME_TEMPLATE) return null; // no approved template: the first receipt does the check
    return this.sendTemplate({ to, template: config.WHATSAPP_WELCOME_TEMPLATE, bodyParams: [name] });
  },

  /** Meta signs webhook bodies with the app secret: X-Hub-Signature-256: sha256=<hex>. */
  verifySignature(rawBody, headers) {
    const header = String(headers["x-hub-signature-256"] ?? "");
    if (!header.startsWith("sha256=") || !config.WHATSAPP_APP_SECRET) return false;
    const expected = crypto.createHmac("sha256", config.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
    return safeEqual(header.slice(7), expected);
  },
};
