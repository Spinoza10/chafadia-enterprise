// WhatsApp receipts and "is this number on WhatsApp?" tracking.
//
// WhatsApp offers no API to look a number up, so we learn it from what happens to our messages:
//   delivered / read           -> on_whatsapp
//   failed with error 131026   -> not_on_whatsapp (we stop sending to it for 30 days)
// The check runs when a customer registers (welcome message) and on every receipt.
import { config } from "../config.js";
import { query } from "../db.js";
import { notify } from "../lib/notify.js";
import { toE164Digits } from "../lib/phone.js";
import { cloudProvider } from "../whatsapp/cloud.js";
import { mockProvider } from "../whatsapp/mock.js";

const NOT_ON_WHATSAPP = new Set([131026]);
const RECHECK_DAYS = 30;

const provider = () => (config.WHATSAPP_PROVIDER === "cloud" ? cloudProvider : config.WHATSAPP_PROVIDER === "mock" ? mockProvider : null);
export const whatsappEnabled = () => Boolean(provider());

export async function contactStatus(phone) {
  const digits = toE164Digits(phone);
  if (!digits) return { phone: null, status: "unknown" };
  const { rows } = await query("SELECT status, checked_at, last_error FROM whatsapp_contacts WHERE phone = $1", [digits]);
  return { phone: digits, status: rows[0]?.status ?? "unknown", checkedAt: rows[0]?.checked_at ?? null, error: rows[0]?.last_error ?? null };
}

async function setContact(digits, status, error = null) {
  await query(
    `INSERT INTO whatsapp_contacts (phone, status, last_error, checked_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (phone) DO UPDATE SET status = EXCLUDED.status, last_error = EXCLUDED.last_error, checked_at = now()`,
    [digits, status, error]
  );
}

/** Apply a delivery report (from Meta's webhook, or the mock straight away). */
export async function applyStatus({ id, status, errors, recipient_id: recipient }) {
  if (!id) return;
  const error = errors?.[0];
  const mapped = ["sent", "delivered", "read", "failed"].includes(status) ? status : null;
  if (!mapped) return;
  const { rows } = await query(
    // reports can arrive out of order: never move back from read to delivered/sent
    `UPDATE whatsapp_messages
        SET status = CASE WHEN $2::text <> 'failed'
                           AND coalesce(array_position(ARRAY['queued','sent','delivered','read'], status), 0)
                             > array_position(ARRAY['queued','sent','delivered','read'], $2::text)
                          THEN status ELSE $2::text END,
            error = COALESCE($3::text, error)
      WHERE provider_message_id = $1 RETURNING phone, receipt_id`,
    [id, mapped, error ? `${error.code}: ${error.title ?? error.message ?? ""}`.slice(0, 300) : null]
  );
  const msg = rows[0];
  const phone = msg?.phone ?? toE164Digits(recipient);
  if (!phone) return;
  if (mapped === "delivered" || mapped === "read") {
    await setContact(phone, "on_whatsapp");
  } else if (mapped === "failed") {
    if (NOT_ON_WHATSAPP.has(Number(error?.code))) await setContact(phone, "not_on_whatsapp", "This number is not on WhatsApp");
    if (msg?.receipt_id) await query("UPDATE receipts SET whatsapp_sent_at = NULL WHERE id = $1", [msg.receipt_id]);
  }
}

async function record({
  phone, purpose, orderId = null, receiptId = null, providerMessageId = null, status, error = null,
  body = null, userId = null, sentBy = null, direction = "out",
}) {
  const { rows } = await query(
    `INSERT INTO whatsapp_messages (phone, purpose, order_id, receipt_id, provider, provider_message_id, status, error, body, user_id, sent_by, direction)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [phone, purpose, orderId, receiptId, config.WHATSAPP_PROVIDER, providerMessageId, status, error?.slice(0, 300) ?? null,
      body?.slice(0, 4000) ?? null, userId, sentBy, direction]
  );
  return rows[0].id;
}

// WhatsApp template parameters may not contain new lines, tabs or long runs of spaces.
const templateSafe = (s) => String(s).replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 1000);
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";

/** Did the customer write to us in the last 24 hours? Then WhatsApp allows a free-text reply. */
async function inReplyWindow(digits) {
  const { rows } = await query("SELECT last_inbound_at > now() - interval '24 hours' AS open FROM whatsapp_contacts WHERE phone = $1", [digits]);
  return Boolean(rows[0]?.open);
}

/**
 * Message a registered customer on WhatsApp from the admin screens (single message or broadcast).
 * Respects the customer's opt-in and skips numbers known not to be on WhatsApp (unless force).
 * Returns { status: sent | skipped | failed | off, reason?, mode? }.
 */
export async function sendCustomerMessage({ user, text, sentBy = null, purpose = "message", force = false }) {
  const p = provider();
  if (!p) return { status: "off", reason: "WhatsApp sending is turned off on the server" };
  const digits = toE164Digits(user.phone);
  if (!digits) return { status: "skipped", reason: "No phone number" };
  if (user.whatsapp_opt_in === false && !force) return { status: "skipped", reason: "Customer turned off WhatsApp messages" };
  const known = await contactStatus(digits);
  if (known.status === "not_on_whatsapp" && !force) {
    await record({ phone: digits, purpose, status: "skipped", error: "Number is not on WhatsApp", body: text, userId: user.id, sentBy });
    return { status: "skipped", reason: "This number is not on WhatsApp" };
  }
  const freeText = await inReplyWindow(digits);
  try {
    const result = freeText
      ? await p.sendText({ to: digits, text })
      : await p.sendTemplate({ to: digits, template: config.WHATSAPP_MESSAGE_TEMPLATE, bodyParams: [templateSafe(firstName(user.full_name)), templateSafe(text)] });
    await record({ phone: digits, purpose, providerMessageId: result.id, status: "sent", body: text, userId: user.id, sentBy });
    await query("INSERT INTO whatsapp_contacts (phone) VALUES ($1) ON CONFLICT DO NOTHING", [digits]);
    if (result.simulatedStatus) await applyStatus(result.simulatedStatus);
    const after = await contactStatus(digits);
    if (after.status === "not_on_whatsapp") return { status: "failed", reason: "This number is not on WhatsApp" };
    return { status: "sent", mode: freeText ? "text" : "template" };
  } catch (err) {
    if (NOT_ON_WHATSAPP.has(Number(err.code))) await setContact(digits, "not_on_whatsapp", "This number is not on WhatsApp");
    await record({ phone: digits, purpose, status: "failed", error: err.message, body: text, userId: user.id, sentBy });
    console.error(`[whatsapp] ${purpose} to +${digits} failed: ${err.message}`);
    return { status: "failed", reason: NOT_ON_WHATSAPP.has(Number(err.code)) ? "This number is not on WhatsApp" : "WhatsApp could not deliver the message" };
  }
}

/** Password reset link on WhatsApp (for accounts registered with only a phone number). */
export async function sendResetOnWhatsApp(user, link) {
  const p = provider();
  const digits = toE164Digits(user.phone);
  if (!p || !digits) return;
  const known = await contactStatus(digits);
  if (known.status === "not_on_whatsapp") return;
  try {
    const result = await p.sendTemplate({ to: digits, template: config.WHATSAPP_RESET_TEMPLATE, bodyParams: [templateSafe(firstName(user.full_name)), link] });
    // the link is a secret: it is not stored in the message history
    await record({ phone: digits, purpose: "reset", providerMessageId: result.id, status: "sent", body: "Password reset link", userId: user.id });
    if (result.simulatedStatus) await applyStatus(result.simulatedStatus);
  } catch (err) {
    await handleSendError(digits, err, { purpose: "reset" });
  }
}

/** A customer wrote to the shop on WhatsApp (from Meta's webhook). */
export async function recordInbound({ from, id, text, profileName }) {
  const digits = toE164Digits(from);
  if (!digits) return;
  const { rows } = await query("SELECT id, full_name FROM users WHERE phone = $1 AND status <> 'deleted'", [`+${digits}`]);
  const user = rows[0];
  await query(
    `INSERT INTO whatsapp_messages (phone, purpose, provider, provider_message_id, status, body, user_id, direction)
     VALUES ($1, 'inbound', $2, $3, 'received', $4, $5, 'in') ON CONFLICT (provider_message_id) DO NOTHING`,
    [digits, config.WHATSAPP_PROVIDER, id, text?.slice(0, 4000) ?? "(media message)", user?.id ?? null]
  );
  await query(
    `INSERT INTO whatsapp_contacts (phone, status, checked_at, last_inbound_at) VALUES ($1, 'on_whatsapp', now(), now())
     ON CONFLICT (phone) DO UPDATE SET status = 'on_whatsapp', checked_at = now(), last_inbound_at = now(), last_error = NULL`,
    [digits]
  );
  const who = user?.full_name ?? profileName ?? `+${digits}`;
  await notify({
    type: "whatsapp.in", title: `WhatsApp from ${who}`, message: (text ?? "(media message)").slice(0, 200),
    data: { userId: user?.id ?? null, phone: digits },
  });
}

async function handleSendError(digits, err, meta) {
  if (NOT_ON_WHATSAPP.has(Number(err.code))) await setContact(digits, "not_on_whatsapp", "This number is not on WhatsApp");
  await record({ ...meta, phone: digits, status: "failed", error: err.message });
  console.error(`[whatsapp] ${meta.purpose} to +${digits} failed: ${err.message}`);
}

/**
 * Send a receipt PDF on WhatsApp. Uses the customer's registered phone number (or the number on
 * the order for guests). Skips numbers known not to be on WhatsApp unless force is true.
 * Returns { status: sent | skipped | failed | off, reason? }.
 */
export async function sendReceiptOnWhatsApp(orderId, { receipt, pdf, force = false } = {}) {
  const p = provider();
  if (!p) return { status: "off" };
  const { rows } = await query(
    `SELECT o.order_number, o.customer_name, o.customer_phone, o.whatsapp_opt_in, o.amount_paid,
            u.phone AS account_phone, u.whatsapp_opt_in AS account_opt_in
       FROM orders o LEFT JOIN users u ON u.id = o.customer_id WHERE o.id = $1`,
    [orderId]
  );
  const o = rows[0];
  if (!o) return { status: "skipped", reason: "Order not found" };
  if (!o.whatsapp_opt_in || o.account_opt_in === false) return { status: "skipped", reason: "Customer did not want WhatsApp receipts" };
  const digits = toE164Digits(o.account_phone || o.customer_phone);
  if (!digits) return { status: "skipped", reason: "No phone number" };

  const meta = { purpose: "receipt", orderId, receiptId: receipt.id };
  const known = await contactStatus(digits);
  const fresh = known.checkedAt && Date.now() - new Date(known.checkedAt).getTime() < RECHECK_DAYS * 86400_000;
  if (!force && known.status === "not_on_whatsapp" && fresh) {
    await record({ ...meta, phone: digits, status: "skipped", error: "Number is not on WhatsApp" });
    return { status: "skipped", reason: "This number is not on WhatsApp" };
  }

  try {
    const fcfa = `${Math.round(Number(o.amount_paid)).toLocaleString("fr-FR").replace(/[  ]/g, " ")} FCFA`;
    const result = await p.sendReceipt({
      to: digits,
      pdf,
      filename: `${receipt.number}.pdf`,
      bodyParams: [o.customer_name, o.order_number, fcfa, receipt.number],
    });
    await record({ ...meta, phone: digits, providerMessageId: result.id, status: "sent" });
    await query("UPDATE receipts SET whatsapp_sent_at = now() WHERE id = $1", [receipt.id]);
    if (known.status === "unknown") await query("INSERT INTO whatsapp_contacts (phone) VALUES ($1) ON CONFLICT DO NOTHING", [digits]);
    if (result.simulatedStatus) await applyStatus(result.simulatedStatus);
    const after = await contactStatus(digits);
    return after.status === "not_on_whatsapp" ? { status: "failed", reason: "This number is not on WhatsApp" } : { status: "sent" };
  } catch (err) {
    await handleSendError(digits, err, meta);
    return { status: "failed", reason: NOT_ON_WHATSAPP.has(Number(err.code)) ? "This number is not on WhatsApp" : "WhatsApp could not deliver the message" };
  }
}

/** At registration: a short welcome on WhatsApp, which also tells us whether the number is on WhatsApp. */
export async function checkOnRegistration(user) {
  const p = provider();
  const digits = toE164Digits(user.phone);
  if (!p || !digits || user.whatsapp_opt_in === false) return;
  await query("INSERT INTO whatsapp_contacts (phone) VALUES ($1) ON CONFLICT DO NOTHING", [digits]);
  try {
    const result = await p.sendWelcome({ to: digits, name: user.full_name });
    if (!result) return; // no welcome template configured: the first receipt performs the check
    await record({ purpose: "welcome", phone: digits, providerMessageId: result.id, status: "sent" });
    if (result.simulatedStatus) await applyStatus(result.simulatedStatus);
  } catch (err) {
    await handleSendError(digits, err, { purpose: "welcome" });
  }
}
