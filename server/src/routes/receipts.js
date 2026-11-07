import { Router } from "express";
import { z } from "zod";
import { query, tx } from "../db.js";
import { audit } from "../lib/audit.js";
import { notFound } from "../lib/errors.js";
import { can } from "../lib/rbac.js";
import { id, pagination, parse } from "../lib/validate.js";
import { authenticate, optionalAuth, requirePermission } from "../middleware/auth.js";
import { emailReceipt, receiptData, renderReceiptPdf, sendReceiptEverywhere } from "../services/receipts.js";

const router = Router();

/** Public QR verification: confirms a receipt is genuine without exposing personal details. */
router.get("/verify/:token", async (req, res) => {
  const { rows } = await query(
    `SELECT r.receipt_number, r.issued_at, o.grand_total, o.amount_refunded, o.status
       FROM receipts r JOIN orders o ON o.id = r.order_id WHERE r.verify_token = $1`,
    [String(req.params.token).slice(0, 100)]
  );
  if (!rows[0]) return res.json({ data: { valid: false } });
  res.json({
    data: {
      valid: true,
      number: rows[0].receipt_number,
      issuedAt: rows[0].issued_at,
      grandTotal: rows[0].grand_total,
      refunded: rows[0].amount_refunded > 0,
      orderStatus: rows[0].status,
    },
  });
});

router.get("/", authenticate, requirePermission("receipts.print", "orders.view"), async (req, res) => {
  const q = parse(
    pagination.extend({
      search: z.string().trim().max(100).optional(),
      mine: z.enum(["true"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    req.query
  );
  const params = [];
  const where = ["true"];
  const limitedToOwn = !can(req.user, "orders.view");
  if (limitedToOwn && q.search) {
    // Cashiers browse only their own sales, but can look up any receipt by its exact number to reprint it.
    const i = params.push(q.search.toUpperCase());
    where.push(`(o.cashier_id = $${params.push(req.user.id)} OR r.receipt_number = $${i} OR o.order_number = $${i})`);
  } else if (limitedToOwn || q.mine) {
    where.push(`o.cashier_id = $${params.push(req.user.id)}`);
  }
  if (q.search && !limitedToOwn) {
    const i = params.push(`%${q.search}%`);
    where.push(`(r.receipt_number ILIKE $${i} OR o.order_number ILIKE $${i} OR o.customer_name ILIKE $${i} OR o.customer_phone ILIKE $${i})`);
  }
  const { rows } = await query(
    `SELECT r.id, r.receipt_number AS number, r.issued_at AS "issuedAt", r.print_count AS "printCount", r.emailed_at AS "emailedAt",
            o.id AS "orderId", o.order_number AS "orderNumber", o.channel, o.status, o.customer_name AS "customerName",
            o.customer_phone AS "customerPhone", o.grand_total AS "grandTotal", o.amount_paid AS "amountPaid",
            o.amount_refunded AS "amountRefunded", o.payment_method AS "paymentMethod", c.full_name AS "cashierName",
            count(*) OVER() AS total
       FROM receipts r JOIN orders o ON o.id = r.order_id LEFT JOIN users c ON c.id = o.cashier_id
      WHERE ${where.join(" AND ")} ORDER BY r.issued_at DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    params
  );
  res.json({ data: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 });
});

async function loadAuthorised(req) {
  const receiptId = parse(id, req.params.id);
  const data = await receiptData(receiptId);
  if (!data) throw notFound("Receipt not found");
  const staff = can(req.user, "receipts.print") || can(req.user, "orders.view");
  const owner = (req.user && data.customerId === req.user.id) || (req.query.token && req.query.token === data.trackingToken);
  if (!staff && !owner) throw notFound("Receipt not found");
  return { data, staff };
}

router.get("/:id", optionalAuth, async (req, res) => {
  const { data } = await loadAuthorised(req);
  const { trackingToken, customerId, cashierId, ...publicData } = data;
  res.json({ data: publicData });
});

/**
 * PDF for printing or download. Staff prints are logged; every staff print after the first is
 * stamped COPY. Customers downloading their own receipt get the original layout.
 */
router.get("/:id/pdf", optionalAuth, async (req, res) => {
  const { data, staff } = await loadAuthorised(req);
  const { format } = parse(z.object({ format: z.enum(["80mm", "a4"]).default("a4") }), req.query);

  let copy = false;
  if (staff) {
    copy = await tx(async (client) => {
      const { rows } = await client.query("UPDATE receipts SET print_count = print_count + 1 WHERE id = $1 RETURNING print_count", [data.id]);
      const isCopy = rows[0].print_count > 1;
      await client.query("INSERT INTO receipt_prints (receipt_id, printed_by, is_copy, format) VALUES ($1, $2, $3, $4)", [data.id, req.user.id, isCopy, format]);
      if (isCopy) await audit({ req, client, action: "receipt.reprint", entityType: "receipt", entityId: data.id, newValue: { number: data.number, format, printCount: rows[0].print_count } });
      return isCopy;
    });
  }
  const pdf = await renderReceiptPdf(data, { format, copy });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${data.number}${copy ? "-COPY" : ""}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(pdf);
});

router.post("/:id/email", authenticate, requirePermission("receipts.print"), async (req, res) => {
  const { data } = await loadAuthorised(req);
  await emailReceipt(data.orderId);
  res.json({ message: data.customer.email ? `Receipt sent to ${data.customer.email}` : "This customer has no email address" });
});

/** Resend on WhatsApp. force=true retries a number previously found not to be on WhatsApp. */
router.post("/:id/whatsapp", authenticate, requirePermission("receipts.print"), async (req, res) => {
  const { data } = await loadAuthorised(req);
  const { force } = parse(z.object({ force: z.boolean().default(true) }), req.body);
  const { whatsapp } = await sendReceiptEverywhere(data.orderId, { email: false, force });
  const messages = {
    sent: "Receipt sent on WhatsApp",
    off: "WhatsApp sending is turned off on the server",
  };
  res.json({ data: whatsapp, message: messages[whatsapp.status] ?? whatsapp.reason ?? "Not sent" });
});

router.get("/:id/prints", authenticate, requirePermission("receipts.print"), async (req, res) => {
  const receiptId = parse(id, req.params.id);
  const { rows } = await query(
    `SELECT p.printed_at AS "printedAt", p.is_copy AS "isCopy", p.format, u.full_name AS "printedBy"
       FROM receipt_prints p LEFT JOIN users u ON u.id = p.printed_by WHERE p.receipt_id = $1 ORDER BY p.id`,
    [receiptId]
  );
  res.json({ data: rows });
});

export default router;
