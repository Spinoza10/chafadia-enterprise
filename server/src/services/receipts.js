import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { config } from "../config.js";
import { query } from "../db.js";
import { sendMail } from "../lib/mailer.js";
import { getShop } from "../lib/settings.js";
import { sendReceiptOnWhatsApp } from "./whatsapp.js";

const METHOD_LABELS = { cash: "Cash", mtn_momo: "MTN Mobile Money", orange_money: "Orange Money", card: "Bank card" };
export const fcfa = (n) => `${Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/ | /g, " ")} FCFA`;
export const verifyUrl = (token) => `${config.FRONTEND_URL}/verify/${token}`;

/** Everything printed on a receipt, from the database (never from the client). */
export async function receiptData(receiptId) {
  const { rows } = await query(
    `SELECT r.*, o.*, r.id AS receipt_id, o.id AS order_id, c.full_name AS cashier_name, i.full_name AS issuer_name
       FROM receipts r JOIN orders o ON o.id = r.order_id
       LEFT JOIN users c ON c.id = o.cashier_id LEFT JOIN users i ON i.id = r.issued_by
      WHERE r.id = $1`,
    [receiptId]
  );
  const r = rows[0];
  if (!r) return null;
  const items = (await query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [r.order_id])).rows;
  const shop = await getShop();
  return {
    id: r.receipt_id,
    number: r.receipt_number,
    verifyToken: r.verify_token,
    issuedAt: r.issued_at,
    printCount: r.print_count,
    orderId: r.order_id,
    orderNumber: r.order_number,
    channel: r.channel,
    status: r.status,
    shop,
    customer: { name: r.customer_name, phone: r.customer_phone, email: r.customer_email },
    servedBy: r.cashier_name ?? r.issuer_name ?? (r.channel === "online" ? "Online store" : null),
    paymentMethod: METHOD_LABELS[r.payment_method] ?? r.payment_method,
    items: items.map((i) => ({ name: i.product_name, sku: i.sku, option: i.option_label, quantity: i.quantity, unitPrice: i.unit_price, lineTotal: i.line_total })),
    subtotal: r.subtotal,
    discount: r.discount_total,
    tax: r.tax_total,
    deliveryFee: r.delivery_fee,
    grandTotal: r.grand_total,
    amountPaid: r.amount_paid,
    amountRefunded: r.amount_refunded,
    customerId: r.customer_id,
    cashierId: r.cashier_id,
    trackingToken: r.tracking_token,
  };
}

/** Render a receipt PDF. format: "80mm" (thermal) or "a4". */
export async function renderReceiptPdf(data, { format = "80mm", copy = false } = {}) {
  const qr = await QRCode.toBuffer(verifyUrl(data.verifyToken), { margin: 0, width: 220 });
  const thermal = format === "80mm";
  const width = thermal ? 226.77 : 595.28; // 80mm or A4 in points
  const margin = thermal ? 10 : 50;
  const height = thermal ? 380 + data.items.length * 30 + (data.discount ? 12 : 0) + (data.deliveryFee ? 12 : 0) : 841.89;
  const doc = new PDFDocument({ size: [width, height], margin, info: { Title: `Receipt ${data.number}` } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const inner = width - margin * 2;
  const fs = thermal ? 7.5 : 10;
  const date = new Date(data.issuedAt);
  const when = `${date.toLocaleDateString("en-GB")} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

  doc.font("Helvetica-Bold").fontSize(thermal ? 11 : 18).text(data.shop.name ?? "CHAFADIA ENTERPRISE", { align: "center" });
  doc.font("Helvetica").fontSize(fs);
  for (const line of [data.shop.address, data.shop.phone, data.shop.email].filter(Boolean)) doc.text(line, { align: "center" });
  doc.moveDown(0.5);
  if (copy) doc.font("Helvetica-Bold").fontSize(thermal ? 10 : 14).fillColor("#b91c1c").text("*** COPY ***", { align: "center" }).fillColor("black");
  doc.font("Helvetica-Bold").fontSize(fs + 1).text("SALES RECEIPT", { align: "center" });
  doc.font("Helvetica").fontSize(fs).moveDown(0.4);

  const kv = (k, v) => {
    const y = doc.y;
    doc.text(k, margin, y, { width: inner * 0.42 });
    doc.text(String(v ?? "-"), margin + inner * 0.42, y, { width: inner * 0.58, align: "right" });
  };
  kv("Receipt No:", data.number);
  kv("Order No:", data.orderNumber);
  kv("Date:", when);
  kv("Customer:", data.customer.name);
  if (data.customer.phone) kv("Phone:", data.customer.phone);
  kv("Served by:", data.servedBy);
  doc.moveDown(0.3);

  const rule = () => {
    doc.moveTo(margin, doc.y).lineTo(width - margin, doc.y).lineWidth(0.5).dash(2, { space: 2 }).stroke().undash();
    doc.moveDown(0.3);
  };
  rule();

  const col = thermal ? { qty: 0.12, unit: 0.28, total: 0.3 } : { qty: 0.1, unit: 0.2, total: 0.2 };
  const nameW = inner * (1 - col.qty - col.unit - col.total);
  const header = (cells, bold) => {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica");
    let x = margin;
    doc.text(cells[0], x, y, { width: nameW });
    const afterName = doc.y;
    x += nameW;
    doc.text(cells[1], x, y, { width: inner * col.qty, align: "right" });
    x += inner * col.qty;
    doc.text(cells[2], x, y, { width: inner * col.unit, align: "right" });
    x += inner * col.unit;
    doc.text(cells[3], x, y, { width: inner * col.total, align: "right" });
    doc.y = Math.max(afterName, doc.y);
    doc.x = margin;
  };
  header(["Item", "Qty", "Unit", "Total"], true);
  for (const it of data.items) {
    header([`${it.name}${it.option ? ` (${it.option})` : ""}\nSKU: ${it.sku}`, String(it.quantity), fcfa(it.unitPrice).replace(" FCFA", ""), fcfa(it.lineTotal).replace(" FCFA", "")], false);
    doc.moveDown(0.2);
  }
  rule();

  kv("Subtotal:", fcfa(data.subtotal));
  if (data.discount) kv("Discount:", `- ${fcfa(data.discount)}`);
  kv("Tax:", fcfa(data.tax));
  if (data.deliveryFee) kv("Delivery:", fcfa(data.deliveryFee));
  doc.font("Helvetica-Bold").fontSize(fs + 2);
  kv("GRAND TOTAL:", fcfa(data.grandTotal));
  doc.font("Helvetica").fontSize(fs);
  kv("Payment method:", data.paymentMethod);
  kv("Amount paid:", fcfa(data.amountPaid));
  if (data.amountRefunded) kv("Refunded:", fcfa(data.amountRefunded));
  doc.moveDown(0.6);

  const qrSize = thermal ? 80 : 110;
  doc.image(qr, (width - qrSize) / 2, doc.y, { width: qrSize });
  doc.y += qrSize + 4;
  doc.fontSize(fs - 1).text("Scan to verify this receipt", margin, doc.y, { align: "center", width: inner });
  doc.moveDown(0.4);
  doc.fontSize(fs).text("Thank you for shopping with us!", { align: "center", width: inner });
  doc.end();
  return done;
}

/**
 * Send the receipt to the customer on every channel they have: email (when an email address is
 * known) and WhatsApp (when their registered phone number is on WhatsApp and they opted in).
 * Returns { email: {status}, whatsapp: {status, reason} }.
 */
export async function sendReceiptEverywhere(orderId, { email = true, whatsapp = true, force = false } = {}) {
  const { rows } = await query("SELECT id FROM receipts WHERE order_id = $1", [orderId]);
  if (!rows[0]) return { email: { status: "skipped", reason: "No receipt yet" }, whatsapp: { status: "skipped", reason: "No receipt yet" } };
  const data = await receiptData(rows[0].id);
  const pdf = await renderReceiptPdf(data, { format: "a4" });
  const result = {};
  const jobs = [];
  if (email) {
    jobs.push(
      emailReceipt(orderId, { data, pdf })
        .then((sent) => (result.email = sent ? { status: "sent", to: data.customer.email } : { status: "skipped", reason: "No email address" }))
        .catch((err) => {
          console.error(`Receipt email for order ${orderId} failed: ${err.message}`);
          result.email = { status: "failed", reason: "Email could not be sent" };
        })
    );
  }
  if (whatsapp) {
    jobs.push(
      sendReceiptOnWhatsApp(orderId, { receipt: { id: data.id, number: data.number }, pdf, force })
        .then((r) => (result.whatsapp = r))
        .catch((err) => {
          console.error(`Receipt WhatsApp for order ${orderId} failed: ${err.message}`);
          result.whatsapp = { status: "failed", reason: "WhatsApp could not be reached" };
        })
    );
  }
  await Promise.all(jobs);
  return result;
}

/** Fire-and-forget version used after a payment: never throws, never delays the response. */
export function deliverReceipt(orderId) {
  return sendReceiptEverywhere(orderId).catch((err) => console.error(`Receipt delivery for order ${orderId} failed: ${err.message}`));
}

/** Email the receipt PDF for an order. Records emailed_at. Returns true when an email was sent. */
export async function emailReceipt(orderId, prepared) {
  let data = prepared?.data;
  if (!data) {
    const { rows } = await query("SELECT id FROM receipts WHERE order_id = $1", [orderId]);
    if (!rows[0]) return false;
    data = await receiptData(rows[0].id);
  }
  if (!data?.customer.email) return false;
  const pdf = prepared?.pdf ?? (await renderReceiptPdf(data, { format: "a4" }));
  const track = `${config.FRONTEND_URL}/track/${data.orderNumber}?token=${data.trackingToken}`;
  await sendMail({
    to: data.customer.email,
    subject: `Your receipt ${data.number} - ${data.shop.name}`,
    text: `Hello ${data.customer.name},\n\nThank you for your order ${data.orderNumber}. Total paid: ${fcfa(data.amountPaid)}.\nYour receipt is attached.\nTrack your order: ${track}\n\n${data.shop.name}`,
    attachments: [{ filename: `${data.number}.pdf`, content: pdf, contentType: "application/pdf" }],
  });
  await query("UPDATE receipts SET emailed_at = now() WHERE id = $1", [data.id]);
  return true;
}
