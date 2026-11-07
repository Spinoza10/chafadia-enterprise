import crypto from "node:crypto";
import { Router } from "express";
import argon2 from "argon2";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query, tx } from "../db.js";
import { audit } from "../lib/audit.js";
import { badRequest, forbidden, unauthorized } from "../lib/errors.js";
import { sendMailLater } from "../lib/mailer.js";
import { loadPermissions } from "../lib/rbac.js";
import { randomToken, sha256, signAccessToken } from "../lib/tokens.js";
import { customerPassword, email, parse, passwordFor, phone } from "../lib/validate.js";
import { notify } from "../lib/notify.js";
import { normalizePhone } from "../lib/phone.js";
import { authenticate } from "../middleware/auth.js";
import { checkOnRegistration, sendResetOnWhatsApp } from "../services/whatsapp.js";

const router = Router();

const REFRESH_COOKIE = "chf_rt";
const cookieOptions = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: "strict",
  path: "/api/auth",
  maxAge: config.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
});

// Dummy hash so unknown emails take as long as wrong passwords (no user enumeration by timing).
const DUMMY_HASH = await argon2.hash(randomToken());

const limited = { error: { code: "RATE_LIMITED", message: "Too many attempts from this network. Please wait a few minutes and try again." } };
// Only FAILED logins count: staff sharing the shop's internet connection must never lock each
// other out by logging in normally. Each account also locks itself after LOGIN_MAX_ATTEMPTS failures.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 30,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: limited,
});
// New accounts and password recovery: every request counts (they always "succeed").
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: config.isTest ? 1000 : 30, standardHeaders: "draft-7", legacyHeaders: false, message: limited });
const recoveryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isTest ? 1000 : 10, standardHeaders: "draft-7", legacyHeaders: false, message: limited });

/** Cookie-authenticated endpoints need a custom header, which cross-site forms cannot send (CSRF). */
function requireCsrfHeader(req, _res, next) {
  if (req.get("x-requested-with") !== "chafadia") return next(forbidden("Missing CSRF header"));
  next();
}

export const publicUser = (u, permissions) => ({
  id: u.id,
  email: u.email,
  fullName: u.full_name,
  phone: u.phone,
  role: u.role,
  locale: u.locale,
  permissions,
});

async function issueSession(req, res, user, familyId = crypto.randomUUID(), client) {
  const run = client ? client.query.bind(client) : query;
  const refresh = randomToken(48);
  await run(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(days => $4), $5, $6)`,
    [user.id, sha256(refresh), familyId, config.REFRESH_TOKEN_DAYS, req.ip, req.get("user-agent")?.slice(0, 300)]
  );
  res.cookie(REFRESH_COOKIE, refresh, cookieOptions());
  const permissions = await loadPermissions(user, run);
  return { accessToken: signAccessToken(user), user: publicUser(user, permissions) };
}

/** One account per email and per phone number. */
async function assertContactFree({ email: e, phone: p }, exceptUserId = 0) {
  if (e) {
    const r = await query("SELECT 1 FROM users WHERE email = $1 AND status <> 'deleted' AND id <> $2", [e, exceptUserId]);
    if (r.rowCount) throw badRequest("An account with this email already exists. Log in instead, or use \"Forgot password\".");
  }
  if (p) {
    const r = await query("SELECT 1 FROM users WHERE phone = $1 AND status <> 'deleted' AND id <> $2", [p, exceptUserId]);
    if (r.rowCount) throw badRequest("An account with this phone number already exists. Log in instead, or use \"Forgot password\".");
  }
}

/** Find an account by email or phone number (whatever the person typed). */
async function findByLogin(login, extra = "") {
  const value = String(login).trim();
  if (value.includes("@")) {
    const r = await query(`SELECT * FROM users WHERE email = $1 AND status <> 'deleted' ${extra}`, [value.toLowerCase()]);
    return r.rows[0];
  }
  const p = normalizePhone(value);
  if (!p) return null;
  const r = await query(`SELECT * FROM users WHERE phone = $1 AND status <> 'deleted' ${extra}`, [p]);
  return r.rows[0];
}

router.post("/register", registerLimiter, async (req, res) => {
  const body = parse(
    z.object({
      fullName: z.string().trim().min(2, "Enter your name").max(120),
      // quick sign-up: a phone number (WhatsApp) is enough; email is optional
      email: z.union([z.literal(""), email]).optional(),
      password: customerPassword,
      phone: phone.optional(),
      whatsappOptIn: z.boolean().default(true),
      source: z.enum(["signup", "checkout"]).default("signup"),
    }),
    req.body
  );
  const userEmail = body.email || null;
  const userPhone = body.phone ? normalizePhone(body.phone) : null;
  if (body.phone && !userPhone) throw badRequest("Enter a valid phone number");
  if (!userEmail && !userPhone) throw badRequest("Enter your phone number (or an email address)");
  await assertContactFree({ email: userEmail, phone: userPhone });

  const hash = await argon2.hash(body.password, { type: argon2.argon2id });
  // Public sign-up can only ever create customers.
  const { rows } = await query(
    `INSERT INTO users (email, full_name, phone, password_hash, role, whatsapp_opt_in, source)
     VALUES ($1, $2, $3, $4, 'customer', $5, $6) RETURNING *`,
    [userEmail, body.fullName, userPhone, hash, body.whatsappOptIn, body.source]
  );
  await notify({
    type: "customer.new", title: "New customer registered",
    message: `${body.fullName}${userPhone ? ` - ${userPhone}` : ""}${userEmail ? ` - ${userEmail}` : ""}${body.source === "checkout" ? " (at checkout)" : ""}`,
    data: { userId: rows[0].id },
  });
  await audit({ req, actor: rows[0], action: "user.register", entityType: "user", entityId: rows[0].id });
  // Is the registered number on WhatsApp? Learned from the welcome message's delivery report.
  checkOnRegistration(rows[0]).catch((e) => console.error(`WhatsApp check failed: ${e.message}`));
  res.status(201).json(await issueSession(req, res, rows[0]));
});

router.post("/login", loginLimiter, async (req, res) => {
  // "login" is an email or a phone number; "email" is still accepted from older clients
  const body = parse(
    z.object({ login: z.string().trim().min(3).max(160).optional(), email: z.string().trim().max(160).optional(), password: z.string().min(1).max(128) })
      .refine((b) => b.login || b.email, { message: "Enter your phone number or email", path: ["login"] }),
    req.body
  );
  const user = await findByLogin(body.login ?? body.email);
  const invalid = unauthorized("Wrong phone number / email or password");

  if (!user) {
    await argon2.verify(DUMMY_HASH, body.password).catch(() => false);
    throw invalid;
  }
  if (user.locked_until && user.locked_until > new Date()) {
    throw unauthorized(`Too many failed attempts. Try again in ${config.LOGIN_LOCK_MINUTES} minutes.`);
  }

  const ok = await argon2.verify(user.password_hash, body.password).catch(() => false);
  if (!ok) {
    const attempts = user.failed_login_count + 1;
    const lock = attempts >= config.LOGIN_MAX_ATTEMPTS;
    await query(
      `UPDATE users SET failed_login_count = $2,
              locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END
        WHERE id = $1`,
      [user.id, lock ? 0 : attempts, lock, config.LOGIN_LOCK_MINUTES]
    );
    if (lock) await audit({ req, actor: user, action: "auth.lockout", entityType: "user", entityId: user.id });
    throw invalid;
  }
  if (user.status !== "active") throw forbidden("This account is suspended. Contact the shop owner.");

  await query("UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [user.id]);
  await audit({ req, actor: user, action: "auth.login", entityType: "user", entityId: user.id });
  res.json(await issueSession(req, res, user));
});

router.post("/refresh", requireCsrfHeader, async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  // A visitor who never logged in: not an error, just "nobody is signed in".
  if (!token) return res.status(204).end();

  const result = await tx(async (client) => {
    const { rows } = await client.query(
      `SELECT rt.*, u.status, u.role, u.token_version FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1 FOR UPDATE OF rt`,
      [sha256(token)]
    );
    const rt = rows[0];
    if (!rt) return null;
    if (rt.revoked_at) {
      // A rotated token was replayed: assume theft and kill the whole session family.
      await client.query("UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL", [rt.family_id]);
      await audit({ req, actor: { id: rt.user_id, role: rt.role }, action: "auth.refresh_reuse", entityType: "user", entityId: rt.user_id, client });
      return null;
    }
    if (rt.expires_at < new Date() || rt.status !== "active") return null;

    await client.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [rt.id]);
    const user = (await client.query("SELECT * FROM users WHERE id = $1", [rt.user_id])).rows[0];
    return issueSession(req, res, user, rt.family_id, client);
  });

  if (!result) {
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
    throw unauthorized("Session expired");
  }
  res.json(result);
});

router.post("/logout", requireCsrfHeader, async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    await query(
      `UPDATE refresh_tokens SET revoked_at = now()
        WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL`,
      [sha256(token)]
    );
  }
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
});

router.get("/me", authenticate, (req, res) => {
  res.json({ user: publicUser(req.user, req.user.permissions) });
});

router.patch("/me", authenticate, async (req, res) => {
  const body = parse(
    z.object({
      fullName: z.string().trim().min(2).max(120).optional(),
      phone: phone.optional(),
      email: email.optional(),
      locale: z.enum(["en", "fr"]).optional(),
      whatsappOptIn: z.boolean().optional(),
    }),
    req.body
  );
  const newPhone = body.phone ? normalizePhone(body.phone) : null;
  if (body.phone && !newPhone) throw badRequest("Enter a valid phone number");
  await assertContactFree({ email: body.email, phone: newPhone }, req.user.id);
  const { rows } = await query(
    `UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone), locale = COALESCE($4, locale),
            email = COALESCE($5, email), whatsapp_opt_in = COALESCE($6, whatsapp_opt_in)
      WHERE id = $1 RETURNING *`,
    [req.user.id, body.fullName ?? null, newPhone, body.locale ?? null, body.email ?? null, body.whatsappOptIn ?? null]
  );
  // a new number: find out again whether it is on WhatsApp
  if (newPhone && newPhone !== req.user.phone) checkOnRegistration(rows[0]).catch(() => {});
  res.json({ user: publicUser(rows[0], req.user.permissions) });
});

router.post("/change-password", authenticate, async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordFor(req.user.role) }), req.body);
  const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
  if (!(await argon2.verify(rows[0].password_hash, body.currentPassword))) throw badRequest("Current password is incorrect");

  const hash = await argon2.hash(body.newPassword, { type: argon2.argon2id });
  // Bumping token_version signs out every other device.
  const updated = await query(
    "UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING *",
    [req.user.id, hash]
  );
  await query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [req.user.id]);
  await audit({ req, action: "auth.password_change", entityType: "user", entityId: req.user.id });
  res.json(await issueSession(req, res, updated.rows[0]));
});

router.post("/forgot-password", recoveryLimiter, async (req, res) => {
  const body = parse(
    z.object({ login: z.string().trim().min(3).max(160).optional(), email: z.string().trim().max(160).optional() })
      .refine((b) => b.login || b.email, { message: "Enter your phone number or email", path: ["login"] }),
    req.body
  );
  const user = await findByLogin(body.login ?? body.email, "AND status = 'active'");
  if (user) {
    const token = randomToken(32);
    await query(
      "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes')",
      [user.id, sha256(token)]
    );
    const link = `${config.FRONTEND_URL}/reset-password?token=${token}`;
    if (user.email) {
      sendMailLater({
        to: user.email,
        subject: "Reset your CHAFADIA password",
        text: `Hello ${user.full_name},\n\nUse this link within 30 minutes to choose a new password:\n${link}\n\nIf you did not ask for this, ignore this email.`,
      });
    }
    // phone-only accounts (and anyone on WhatsApp) also get the link on WhatsApp
    if (user.phone) sendResetOnWhatsApp(user, link).catch((e) => console.error(`WhatsApp reset failed: ${e.message}`));
  }
  // Same answer whether or not the account exists.
  res.json({ message: "If an account exists, a reset link has been sent by email and/or WhatsApp. It is valid for 30 minutes." });
});

router.post("/reset-password", recoveryLimiter, async (req, res) => {
  const body = parse(z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(128) }), req.body);

  const userId = await tx(async (client) => {
    const { rows } = await client.query(
      `SELECT pr.*, u.role FROM password_resets pr JOIN users u ON u.id = pr.user_id
        WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now() FOR UPDATE OF pr`,
      [sha256(body.token)]
    );
    if (!rows[0]) throw badRequest("This reset link is invalid or has expired");
    parse(z.object({ password: passwordFor(rows[0].role) }), { password: body.password });
    const hash = await argon2.hash(body.password, { type: argon2.argon2id });
    await client.query("UPDATE password_resets SET used_at = now() WHERE id = $1", [rows[0].id]);
    await client.query(
      "UPDATE users SET password_hash = $2, token_version = token_version + 1, failed_login_count = 0, locked_until = NULL WHERE id = $1",
      [rows[0].user_id, hash]
    );
    await client.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [rows[0].user_id]);
    return rows[0].user_id;
  });
  await audit({ req, actor: { id: userId }, action: "auth.password_reset", entityType: "user", entityId: userId });
  res.json({ message: "Password updated. You can now log in." });
});

export default router;
