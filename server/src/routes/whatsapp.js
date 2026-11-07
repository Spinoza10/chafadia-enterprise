// WhatsApp: Meta webhook (delivery reports) and the customer's own WhatsApp receipt preference.
import express, { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db.js";
import { forbidden, notFound } from "../lib/errors.js";
import { maskPhone } from "../lib/phone.js";
import { safeEqual } from "../lib/tokens.js";
import { parse } from "../lib/validate.js";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { cloudProvider } from "../whatsapp/cloud.js";
import { applyStatus, checkOnRegistration, contactStatus, recordInbound, whatsappEnabled } from "../services/whatsapp.js";

const router = Router();

// Meta calls this once when the webhook URL is saved in the app dashboard.
router.get("/webhook", (req, res) => {
  if (config.WHATSAPP_PROVIDER !== "cloud") throw notFound();
  const token = String(req.query["hub.verify_token"] ?? "");
  if (req.query["hub.mode"] !== "subscribe" || !config.WHATSAPP_VERIFY_TOKEN || !safeEqual(token, config.WHATSAPP_VERIFY_TOKEN)) {
    throw forbidden();
  }
  res.type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
});

router.post("/webhook", express.raw({ type: "*/*", limit: "512kb" }), async (req, res) => {
  if (config.WHATSAPP_PROVIDER !== "cloud") throw notFound();
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!cloudProvider.verifySignature(raw, req.headers)) {
    return res.status(401).json({ error: { code: "INVALID_SIGNATURE", message: "Invalid signature" } });
  }
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Malformed JSON" } });
  }
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) await applyStatus(status);
      // customers writing to the shop: kept in their conversation history, admins notified
      const names = Object.fromEntries((change.value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of change.value?.messages ?? []) {
        await recordInbound({ from: m.from, id: m.id, text: m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? null, profileName: names[m.from] });
      }
    }
  }
  res.json({ received: true });
});

// Development only (WHATSAPP_PROVIDER=mock): pretend a customer replied on WhatsApp, to try the
// conversation screen and the 24 h free-text window without Meta.
router.post("/mock/inbound", authenticate, requirePermission("customers.message"), async (req, res) => {
  if (config.isProd || config.WHATSAPP_PROVIDER !== "mock") throw notFound();
  const body = parse(z.object({ phone: z.string().min(6).max(20), text: z.string().trim().min(1).max(1000) }), req.body);
  await recordInbound({ from: body.phone, id: `wamid.mockin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text: body.text });
  res.json({ received: true });
});

// ---------------------------------------------------------------- signed-in user

router.get("/me", authenticate, async (req, res) => {
  const { rows } = await query("SELECT phone, whatsapp_opt_in FROM users WHERE id = $1", [req.user.id]);
  const c = await contactStatus(rows[0].phone);
  res.json({
    data: { enabled: whatsappEnabled(), phone: maskPhone(rows[0].phone), optIn: rows[0].whatsapp_opt_in, status: c.status, checkedAt: c.checkedAt },
  });
});

router.patch("/me", authenticate, async (req, res) => {
  const { optIn } = parse(z.object({ optIn: z.boolean() }), req.body);
  const { rows } = await query("UPDATE users SET whatsapp_opt_in = $2 WHERE id = $1 RETURNING *", [req.user.id, optIn]);
  if (optIn) checkOnRegistration(rows[0]).catch(() => {});
  res.json({ data: { optIn } });
});

export default router;
