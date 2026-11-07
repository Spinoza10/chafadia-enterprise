// Manual mobile money payments verified by admins.
//
// 1. The customer sends the exact amount to the shop's MTN MoMo / Orange Money number (shown at checkout).
// 2. They upload the screenshot of the transfer plus the transaction ID, sender number and name.
// 3. Admins compare it with the shop's MoMo account. Each approval is recorded per admin; when the
//    required number of DIFFERENT admins have approved (default 2), the order becomes paid, stock is
//    deducted and the receipt is issued and sent. A rejection tells the customer why and lets them retry.
import { audit } from "../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { sendMailLater } from "../lib/mailer.js";
import { notify } from "../lib/notify.js";
import { localCameroon, maskPhone, operatorOf, toE164Digits } from "../lib/phone.js";
import { loadPermissions } from "../lib/rbac.js";
import { getSetting } from "../lib/settings.js";
import { randomToken } from "../lib/tokens.js";
import { config } from "../config.js";
import { confirmPayment } from "./orders.js";

export const NETWORK = { mtn_momo: "MTN Mobile Money", orange_money: "Orange Money" };
// Dial codes customers use to send money (shown as tap-to-dial on phones).
export const USSD = { mtn_momo: "*126#", orange_money: "#150#" };

const fcfa = (n) => `${Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ")} FCFA`;
const trackLink = (o) => `${config.FRONTEND_URL}/track/${o.order_number}?token=${o.tracking_token}`;

export async function receivingAccounts(run) {
  return getSetting("settlement_accounts", {}, run);
}

/**
 * How many different admins must approve. Never more than the number of people who can approve,
 * so a shop with only the owner is never stuck.
 */
export async function approvalsRequired(run) {
  const wanted = Math.max(1, Math.min(3, Number(await getSetting("payment_approvals_required", 2, run)) || 1));
  const { rows } = await run("SELECT id, role FROM users WHERE role IN ('super_admin', 'admin') AND status = 'active'");
  let eligible = 0;
  for (const u of rows) {
    if (u.role === "super_admin" || (await loadPermissions(u, run)).includes("payments.verify")) eligible += 1;
  }
  return Math.max(1, Math.min(wanted, eligible));
}

// ---------------------------------------------------------------- customer submits proof

export async function submitProof(client, req, { orderId, method, transactionId, senderPhone, senderName, amountClaimed, note, file }) {
  const run = client.query.bind(client);
  const { rows } = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
  const order = rows[0];
  if (!order) throw notFound("Order not found");
  if (order.channel !== "online") throw badRequest("Only online orders are paid this way");
  if (order.status !== "pending") throw badRequest("This order is not awaiting payment");
  if (!order.stock_reserved) throw badRequest("This order has expired. Please place a new order.");

  const open = await client.query("SELECT id FROM payment_proofs WHERE order_id = $1 AND status = 'pending_review'", [orderId]);
  if (open.rowCount) throw conflict("A payment screenshot for this order is already being checked. Please wait for the admins' decision.");

  const txn = transactionId.trim().toUpperCase();
  const dupTxn = await client.query(
    "SELECT o.order_number FROM payment_proofs p JOIN orders o ON o.id = p.order_id WHERE p.method = $1 AND upper(p.transaction_id) = $2 AND p.status <> 'rejected'",
    [method, txn]
  );
  if (dupTxn.rowCount) throw conflict("This transaction ID was already used to pay another order.");
  const dupImage = await client.query("SELECT 1 FROM payment_proofs WHERE image_sha256 = $1 AND status <> 'rejected'", [file.sha256]);
  if (dupImage.rowCount) throw conflict("This screenshot was already submitted for another payment. Upload the screenshot of this payment.");

  const accounts = await receivingAccounts(run);
  const account = accounts?.[method];
  if (!account?.number) throw badRequest(`${NETWORK[method]} payments are not set up yet. Please choose another method.`);

  const due = order.grand_total - order.amount_paid;
  const sender = toE164Digits(localCameroon(senderPhone) ?? senderPhone);
  if (!sender) throw badRequest("Enter the number you sent the money from");

  // Checks shown to the admins next to the screenshot (they decide; nothing is auto-approved).
  const warnings = [];
  const op = operatorOf(sender);
  if (method === "mtn_momo" && op === "orange") warnings.push("Sender number is an Orange number but the payment is marked MTN MoMo");
  if (method === "orange_money" && op === "mtn") warnings.push("Sender number is an MTN number but the payment is marked Orange Money");
  if (amountClaimed !== undefined && amountClaimed !== due) warnings.push(`Customer says they sent ${fcfa(amountClaimed)}, but ${fcfa(due)} is due`);
  if (localCameroon(sender) === account.number) warnings.push("Sender number is the shop's own receiving number");
  const previous = await client.query("SELECT count(*)::int AS n FROM payment_proofs WHERE order_id = $1 AND status = 'rejected'", [orderId]);
  if (previous.rows[0].n) warnings.push(`${previous.rows[0].n} earlier screenshot(s) for this order were rejected`);

  const { rows: pay } = await client.query(
    `INSERT INTO payments (order_id, provider, method, amount, status, reference, phone)
     VALUES ($1, 'manual_transfer', $2, $3, 'pending', $4, $5) RETURNING *`,
    [orderId, method, due, `MAN-${order.order_number}-${randomToken(4)}`, sender]
  );
  const required = await approvalsRequired(run);
  const { rows: proof } = await client.query(
    `INSERT INTO payment_proofs (payment_id, order_id, method, amount_due, amount_claimed, transaction_id, sender_phone, sender_name,
                                 paid_to, image_path, image_sha256, image_type, image_bytes, note, warnings, approvals_required,
                                 submitted_by, submitted_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
    [pay[0].id, orderId, method, due, amountClaimed ?? null, txn, sender, senderName.trim(), `${account.number} (${account.name})`,
      file.name, file.sha256, file.type, file.size, note ?? null, JSON.stringify(warnings), required, req.user?.id ?? null, req.ip]
  );

  // Keep the items reserved while the admins check (the expiry job also skips orders under review).
  const hours = Number(await getSetting("proof_review_hours", 48, run)) || 48;
  await client.query(
    `UPDATE orders SET payment_method = $2,
            reservation_expires_at = greatest(coalesce(reservation_expires_at, now()), now() + make_interval(hours => $3))
      WHERE id = $1`,
    [orderId, method, hours]
  );
  await audit({
    req, client, action: "payment.proof_submitted", entityType: "order", entityId: orderId,
    newValue: { proof: proof[0].id, method, amount: due, transactionId: txn, sender: maskPhone(sender), warnings },
  });
  await notify({
    type: "payment.proof",
    title: `Payment to verify: ${fcfa(due)}`,
    message: `${order.order_number} - ${senderName.trim()} sent ${NETWORK[method]} (ID ${txn}). ${required} approval${required > 1 ? "s" : ""} needed.${warnings.length ? ` ⚠ ${warnings.length} warning(s)` : ""}`,
    data: { orderId, proofId: proof[0].id },
    client,
  });
  return { proof: proof[0], order };
}

// ---------------------------------------------------------------- admins decide

async function lockProof(client, proofId) {
  const { rows } = await client.query("SELECT * FROM payment_proofs WHERE id = $1 FOR UPDATE", [proofId]);
  if (!rows[0]) throw notFound("Payment proof not found");
  return rows[0];
}

/** Returns { proof, approvals, required, completed, order? }. */
export async function approveProof(client, req, proofId, { note } = {}) {
  const proof = await lockProof(client, proofId);
  if (proof.status !== "pending_review") throw badRequest(`This payment was already ${proof.status === "approved" ? "approved" : "rejected"}`);
  if (proof.submitted_by && proof.submitted_by === req.user.id) throw forbidden("You cannot approve your own payment");

  const inserted = await client.query(
    "INSERT INTO payment_approvals (proof_id, approver_id, note) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING proof_id",
    [proofId, req.user.id, note ?? null]
  );
  if (!inserted.rowCount) throw conflict("You already approved this payment. Another admin must give the next approval.");

  const { rows: cnt } = await client.query("SELECT count(*)::int AS n FROM payment_approvals WHERE proof_id = $1", [proofId]);
  // if staff left since submission, never require more approvers than exist
  const required = Math.min(proof.approvals_required, await approvalsRequired(client.query.bind(client)));
  const approvals = cnt[0].n;
  const { rows: o } = await client.query("SELECT * FROM orders WHERE id = $1", [proof.order_id]);
  const order = o[0];

  await audit({
    req, client, action: "payment.proof_approve", entityType: "order", entityId: proof.order_id,
    newValue: { proof: proofId, approval: `${approvals}/${required}`, note },
  });

  if (approvals < required) {
    await notify({
      type: "payment.proof",
      title: `Second approval needed: ${fcfa(proof.amount_due)}`,
      message: `${order.order_number}: ${req.user.full_name} approved (${approvals} of ${required}). Another admin must check and approve.`,
      data: { orderId: order.id, proofId },
      client,
    });
    if (order.customer_id) {
      await notify({
        userId: order.customer_id, type: "payment.review", title: "Payment being verified",
        message: `${order.order_number}: ${approvals} of ${required} approvals done. We will confirm shortly.`, data: { orderId: order.id }, client,
      });
    }
    return { proof, approvals, required, completed: false };
  }

  const result = await confirmPayment(client, proof.payment_id, { actor: req.user, providerReference: proof.transaction_id });
  if (result.mismatch) throw conflict("The amount due changed since the screenshot was sent. Reject it and ask the customer to pay the new amount.");
  await client.query("UPDATE payment_proofs SET status = 'approved', reviewed_by = $2, reviewed_at = now() WHERE id = $1", [proofId, req.user.id]);
  if (order.customer_id) {
    await notify({
      userId: order.customer_id, type: "payment.approved", title: "Payment approved ✅",
      message: `${order.order_number}: your ${NETWORK[proof.method]} payment of ${fcfa(proof.amount_due)} was verified. Your receipt has been sent.`,
      data: { orderId: order.id }, client,
    });
  }
  return { proof, approvals, required, completed: true, order: result.order };
}

export async function rejectProof(client, req, proofId, { reason }) {
  const proof = await lockProof(client, proofId);
  if (proof.status !== "pending_review") throw badRequest(`This payment was already ${proof.status === "approved" ? "approved" : "rejected"}`);
  await client.query(
    "UPDATE payment_proofs SET status = 'rejected', rejection_reason = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1",
    [proofId, reason, req.user.id]
  );
  await client.query("UPDATE payments SET status = 'failed', failure_reason = $2 WHERE id = $1 AND status = 'pending'", [proof.payment_id, `Rejected: ${reason}`.slice(0, 300)]);
  // give the customer a day to send a correct screenshot
  const { rows } = await client.query(
    `UPDATE orders SET reservation_expires_at = greatest(coalesce(reservation_expires_at, now()), now() + interval '24 hours')
      WHERE id = $1 AND status = 'pending' AND stock_reserved RETURNING *`,
    [proof.order_id]
  );
  const order = rows[0] ?? (await client.query("SELECT * FROM orders WHERE id = $1", [proof.order_id])).rows[0];
  await audit({ req, client, action: "payment.proof_reject", entityType: "order", entityId: proof.order_id, newValue: { proof: proofId, reason } });
  await notify({
    type: "payment.rejected", title: "Payment rejected",
    message: `${order.order_number}: ${req.user.full_name} rejected the screenshot - ${reason}`, data: { orderId: order.id, proofId }, client,
  });
  if (order.customer_id) {
    await notify({
      userId: order.customer_id, type: "payment.rejected", title: "Payment not accepted",
      message: `${order.order_number}: ${reason}. Please upload a correct screenshot of your payment.`, data: { orderId: order.id }, client,
    });
  }
  return { proof, order };
}

/** Email the customer about the decision (after the transaction commits). */
export function emailDecision(order, { approved, reason, amount, method }) {
  if (!order?.customer_email) return;
  sendMailLater({
    to: order.customer_email,
    subject: approved ? `Payment approved - order ${order.order_number}` : `Payment not accepted - order ${order.order_number}`,
    text: approved
      ? `Hello ${order.customer_name},\n\nYour ${NETWORK[method]} payment of ${fcfa(amount)} for order ${order.order_number} was verified and approved by our team.\nYour receipt is attached in a separate email and on WhatsApp.\nTrack your order: ${trackLink(order)}\n\nCHAFADIA ENTERPRISE`
      : `Hello ${order.customer_name},\n\nWe could not accept the payment screenshot for order ${order.order_number}.\nReason: ${reason}\n\nYour items are still reserved for 24 hours. Upload the correct screenshot here: ${config.FRONTEND_URL}/pay/${order.order_number}?token=${order.tracking_token}\n\nCHAFADIA ENTERPRISE`,
  });
}

/** Reminder for proofs waiting more than 2 hours (sent once). Called by the jobs loop. */
export async function remindStaleProofs(run) {
  const { rows } = await run(
    `UPDATE payment_proofs p SET reminded_at = now() FROM orders o
      WHERE o.id = p.order_id AND p.status = 'pending_review' AND p.reminded_at IS NULL AND p.created_at < now() - interval '2 hours'
      RETURNING p.id, p.order_id, p.amount_due, o.order_number`
  );
  for (const r of rows) {
    await notify({
      type: "payment.proof", title: "Payment still waiting for approval",
      message: `${r.order_number} (${fcfa(r.amount_due)}) has been waiting more than 2 hours. The customer is waiting for confirmation.`,
      data: { orderId: r.order_id, proofId: r.id },
    });
  }
  return rows.length;
}
