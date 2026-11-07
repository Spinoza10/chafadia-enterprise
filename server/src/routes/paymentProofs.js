// Manual mobile money payments: customer uploads the payment screenshot, admins verify it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query, tx } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { maskPhone } from "../lib/phone.js";
import { can } from "../lib/rbac.js";
import { id, parse } from "../lib/validate.js";
import { authenticate, optionalAuth, requirePermission } from "../middleware/auth.js";
import { assertCanView } from "../services/orders.js";
import {
  approvalsRequired, approveProof, emailDecision, NETWORK, receivingAccounts, rejectProof, submitProof, USSD,
} from "../services/paymentProofs.js";
import { deliverReceipt } from "../services/receipts.js";

const router = Router();
fs.mkdirSync(config.PROOF_DIR, { recursive: true });

const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: config.isTest ? 1000 : 15, standardHeaders: "draft-7", legacyHeaders: false });
const TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 20 },
});

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

const proofView = (p, { staff = false, approvals = [], userId } = {}) => ({
  id: p.id,
  status: p.status,
  method: p.method,
  network: NETWORK[p.method],
  amountDue: p.amount_due,
  amountClaimed: p.amount_claimed,
  transactionId: p.transaction_id,
  senderName: p.sender_name,
  senderPhone: staff ? `+${p.sender_phone}` : maskPhone(p.sender_phone),
  paidTo: p.paid_to,
  approvals: staff ? approvals : approvals.length,
  approvalCount: approvals.length,
  approvalsRequired: p.approvals_required,
  youApproved: Boolean(userId && approvals.some((a) => a.approverId === userId)),
  rejectionReason: p.rejection_reason,
  reviewedAt: p.reviewed_at,
  createdAt: p.created_at,
  imageUrl: `/api/payments/proofs/${p.id}/image`,
  ...(staff && { warnings: p.warnings ?? [], note: p.note, imageBytes: p.image_bytes }),
});

async function approvalsFor(proofIds) {
  if (!proofIds.length) return new Map();
  const { rows } = await query(
    `SELECT a.proof_id, a.approver_id AS "approverId", u.full_name AS name, u.role, a.note, a.created_at AS at
       FROM payment_approvals a JOIN users u ON u.id = a.approver_id WHERE a.proof_id = ANY($1) ORDER BY a.created_at`,
    [proofIds]
  );
  const map = new Map();
  for (const { proof_id: pid, ...r } of rows) map.set(pid, [...(map.get(pid) ?? []), r]);
  return map;
}

// ---------------------------------------------------------------- customer

/** Where to send the money, how much, and the state of every screenshot sent for this order. */
router.get("/manual/:orderId", optionalAuth, async (req, res) => {
  const orderId = parse(id, req.params.orderId);
  const { rows } = await query("SELECT * FROM orders WHERE id = $1", [orderId]);
  const order = rows[0];
  if (!order) throw notFound("Order not found");
  assertCanView(req, order, req.query.token);

  const accounts = await receivingAccounts(query);
  const { rows: proofs } = await query("SELECT * FROM payment_proofs WHERE order_id = $1 ORDER BY id DESC", [orderId]);
  const approvals = await approvalsFor(proofs.map((p) => p.id));
  const open = proofs.find((p) => p.status === "pending_review");
  res.json({
    data: {
      orderId: order.id,
      orderNumber: order.order_number,
      trackingToken: order.tracking_token,
      status: order.status,
      amountDue: Math.max(0, order.grand_total - order.amount_paid),
      paymentMethod: order.payment_method,
      reservationExpiresAt: order.reservation_expires_at,
      reference: order.order_number,
      accounts: Object.fromEntries(
        Object.entries(NETWORK).filter(([k]) => accounts?.[k]?.number).map(([k, label]) => [k, { label, number: accounts[k].number, name: accounts[k].name, ussd: USSD[k] }])
      ),
      approvalsRequired: open?.approvals_required ?? (await approvalsRequired(query)),
      canSubmit: order.status === "pending" && order.stock_reserved && !open,
      proofs: proofs.map((p) => proofView(p, { approvals: approvals.get(p.id) ?? [] })),
    },
  });
});

router.post("/manual/:orderId/proof", uploadLimiter, optionalAuth, upload.single("screenshot"), async (req, res) => {
  const orderId = parse(id, req.params.orderId);
  const body = parse(
    z.object({
      token: z.string().max(100).optional(),
      method: z.enum(["mtn_momo", "orange_money"]),
      transactionId: z.string().trim().min(4, "Enter the transaction ID from the confirmation SMS").max(60).regex(/^[A-Za-z0-9.\-_/ ]+$/, "Letters and numbers only"),
      senderPhone: z.string().trim().min(6).max(20),
      senderName: z.string().trim().min(2, "Enter the name on the MoMo account that paid").max(120),
      amountClaimed: z.coerce.number().int().positive().optional(),
      note: z.string().trim().max(500).optional(),
    }),
    req.body
  );
  if (!req.file) throw badRequest("Attach the screenshot of your payment");
  const type = sniff(req.file.buffer);
  if (!type) throw badRequest(`The screenshot must be a JPEG, PNG or WebP image (max ${config.MAX_UPLOAD_MB} MB)`);

  const { rows } = await query("SELECT * FROM orders WHERE id = $1", [orderId]);
  if (!rows[0]) throw notFound("Order not found");
  assertCanView(req, rows[0], body.token);

  const name = `${crypto.randomUUID()}${TYPES[type]}`;
  const file = { name, type, size: req.file.size, sha256: crypto.createHash("sha256").update(req.file.buffer).digest("hex") };
  fs.writeFileSync(path.join(config.PROOF_DIR, name), req.file.buffer, { mode: 0o600 });
  try {
    const { proof } = await tx((client) => submitProof(client, req, { orderId, ...body, file }));
    res.status(201).json({ data: proofView(proof), message: "Screenshot received. Our team is checking your payment." });
  } catch (err) {
    fs.rmSync(path.join(config.PROOF_DIR, name), { force: true });
    throw err;
  }
});

// ---------------------------------------------------------------- screenshot (private)

router.get("/proofs/:id/image", optionalAuth, async (req, res) => {
  const proofId = parse(id, req.params.id);
  const { rows } = await query(
    "SELECT p.image_path, p.image_type, o.* FROM payment_proofs p JOIN orders o ON o.id = p.order_id WHERE p.id = $1",
    [proofId]
  );
  const r = rows[0];
  if (!r) throw notFound();
  if (!can(req.user, "payments.verify")) assertCanView(req, r, req.query.token);
  const file = path.join(config.PROOF_DIR, path.basename(r.image_path));
  if (!fs.existsSync(file)) throw notFound("Screenshot file missing");
  res.setHeader("Content-Type", r.image_type);
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(file);
});

// ---------------------------------------------------------------- admins

router.get("/proofs", authenticate, requirePermission("payments.verify"), async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["pending_review", "approved", "rejected", "all"]).default("pending_review") }), req.query);
  const { rows } = await query(
    `SELECT p.*, o.order_number, o.customer_name, o.customer_phone, o.customer_email, o.grand_total, o.status AS order_status,
            o.fulfilment, o.created_at AS order_created_at, rv.full_name AS reviewer
       FROM payment_proofs p JOIN orders o ON o.id = p.order_id LEFT JOIN users rv ON rv.id = p.reviewed_by
      ${status === "all" ? "" : "WHERE p.status = $1"}
      ORDER BY CASE WHEN p.status = 'pending_review' THEN 0 ELSE 1 END, p.created_at ${status === "pending_review" ? "ASC" : "DESC"} LIMIT 200`,
    status === "all" ? [] : [status]
  );
  const approvals = await approvalsFor(rows.map((r) => r.id));
  const { rows: count } = await query("SELECT count(*)::int AS n FROM payment_proofs WHERE status = 'pending_review'");
  res.json({
    data: rows.map((r) => ({
      ...proofView(r, { staff: true, approvals: approvals.get(r.id) ?? [], userId: req.user.id }),
      reviewer: r.reviewer,
      order: {
        id: r.order_id, number: r.order_number, status: r.order_status, total: r.grand_total, fulfilment: r.fulfilment,
        customer: { name: r.customer_name, phone: r.customer_phone, email: r.customer_email }, createdAt: r.order_created_at,
      },
    })),
    pending: count[0].n,
  });
});

router.post("/proofs/:id/approve", authenticate, requirePermission("payments.verify"), async (req, res) => {
  const proofId = parse(id, req.params.id);
  const { note, confirmReceived } = parse(
    z.object({ note: z.string().trim().max(300).optional(), confirmReceived: z.literal(true, { message: "Confirm that the money is in the shop's account" }) }),
    req.body
  );
  void confirmReceived;
  const result = await tx((client) => approveProof(client, req, proofId, { note }));
  if (result.completed) {
    deliverReceipt(result.proof.order_id);
    emailDecision(result.order, { approved: true, amount: result.proof.amount_due, method: result.proof.method });
  }
  res.json({
    data: { approvals: result.approvals, required: result.required, completed: result.completed },
    message: result.completed
      ? "Payment approved. The order is now paid and the receipt was sent to the customer."
      : `Your approval is recorded (${result.approvals} of ${result.required}). Another admin must approve too.`,
  });
});

router.post("/proofs/:id/reject", authenticate, requirePermission("payments.verify"), async (req, res) => {
  const proofId = parse(id, req.params.id);
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, "Tell the customer why (at least 5 characters)").max(300) }), req.body);
  const { proof, order } = await tx((client) => rejectProof(client, req, proofId, { reason }));
  emailDecision(order, { approved: false, reason, amount: proof.amount_due, method: proof.method });
  res.json({ message: "Payment rejected. The customer has been told why and can upload a new screenshot." });
});

export default router;
