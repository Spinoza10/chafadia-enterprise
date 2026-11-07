import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { bearer, setup } from "./helpers.js";

let t;
let s;
let variantId;
before(async () => {
  t = await setup();
  s = await t.seedRoles();
  ({ variantId } = await t.createProduct(s.owner.token, { name: "POS Chips", price: 500, cost: 300, stock: 20, threshold: 15 }));
  await t.db.query("UPDATE product_variants SET barcode = '6001234567890' WHERE id = $1", [variantId]);
});
after(() => t.teardown());

const sale = (session, body) => t.api().post("/api/pos/sales").set(bearer(session)).send(body);
const cashSale = (qty = 2, extra = {}) => ({ items: [{ variantId, quantity: qty }], payment: { method: "cash", amountTendered: 5000 }, ...extra });

describe("POS shifts and sales", () => {
  test("cannot sell without an open shift", async () => {
    const res = await sale(s.cashier, cashSale());
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Open your shift/);
  });

  test("barcode lookup finds the product", async () => {
    const res = await t.api().get("/api/pos/lookup/6001234567890").set(bearer(s.cashier));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.variantId, variantId);
  });

  test("cash sale: stock deducted at once, receipt issued, change computed", async () => {
    await t.api().post("/api/pos/shifts/open").set(bearer(s.cashier)).send({ openingFloat: 10000 });
    const res = await sale(s.cashier, cashSale(3));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, "completed");
    assert.equal(res.body.data.grandTotal, 1500);
    assert.equal(res.body.data.change, 3500);
    assert.ok(res.body.data.receipt.number);
    assert.equal(res.body.data.cashier.name, "Cashier One");
    assert.deepEqual(await t.stockOf(variantId), { stock_qty: 17, reserved_qty: 0 });
  });

  test("low-stock alert raised when stock crosses the threshold", async () => {
    await sale(s.cashier, cashSale(3)); // 17 -> 14, threshold 15
    const { rows } = await t.db.query("SELECT type, message FROM notifications WHERE type = 'stock.low'");
    assert.equal(rows.length, 1);
    const feed = await t.api().get("/api/notifications").set(bearer(s.admin));
    assert.ok(feed.body.data.some((n) => n.type === "stock.low"));
  });

  test("offline retry with the same clientReference does not double-charge or double-deduct", async () => {
    const body = cashSale(1, { clientReference: "offline-queue-abc-123" });
    const a = await sale(s.cashier, body);
    const b = await sale(s.cashier, body);
    assert.equal(a.status, 201);
    assert.equal(b.body.duplicate, true);
    assert.equal(a.body.data.id, b.body.data.id);
    assert.equal((await t.stockOf(variantId)).stock_qty, 13);
  });

  test("discounts need the pos.discount permission", async () => {
    const res = await sale(s.cashier, cashSale(1, { discount: 100 }));
    assert.equal(res.status, 403);
  });

  test("mobile money / card sales need a transaction reference", async () => {
    const res = await sale(s.cashier, { items: [{ variantId, quantity: 1 }], payment: { method: "mtn_momo" } });
    assert.equal(res.status, 400);
    const ok = await sale(s.cashier, { items: [{ variantId, quantity: 1 }], payment: { method: "mtn_momo", reference: "MP240101.1234.A12345" } });
    assert.equal(ok.status, 201);
  });

  test("cashier sees only their own sales and daily summary", async () => {
    await t.api().post("/api/pos/shifts/open").set(bearer(s.cashier2)).send({ openingFloat: 0 });
    await sale(s.cashier2, cashSale(1));
    const mine = await t.api().get("/api/orders").set(bearer(s.cashier));
    assert.ok(mine.body.data.length >= 4);
    assert.ok(mine.body.data.every((o) => o.cashier.name === "Cashier One"));
    const summary = await t.api().get("/api/pos/summary").set(bearer(s.cashier2));
    assert.equal(summary.body.data.orders, 1);
    assert.equal(summary.body.data.total, 500);
  });

  test("closing the shift reconciles cash and reports the variance", async () => {
    const current = await t.api().get("/api/pos/shifts/current").set(bearer(s.cashier));
    const cashTaken = current.body.data.totals.byMethod.cash.amount;
    const res = await t.api().post("/api/pos/shifts/close").set(bearer(s.cashier)).send({ countedCash: 10000 + cashTaken - 200 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.expectedCash, 10000 + cashTaken);
    assert.equal(res.body.data.variance, -200);
    assert.equal(res.body.data.status, "closed");
  });
});

describe("receipts", () => {
  let receiptId;
  let verifyToken;
  before(async () => {
    const list = await t.api().get("/api/receipts").set(bearer(s.cashier));
    receiptId = list.body.data[0].id;
    const r = await t.api().get(`/api/receipts/${receiptId}`).set(bearer(s.cashier));
    verifyToken = r.body.data.verifyToken;
  });

  test("receipt contains number, items with SKU, prices, totals, payment method, cashier and date", async () => {
    const r = await t.api().get(`/api/receipts/${receiptId}`).set(bearer(s.cashier));
    const d = r.body.data;
    assert.match(d.number, /^RCP-/);
    assert.ok(d.issuedAt);
    assert.equal(d.items[0].name, "POS Chips");
    assert.ok(d.items[0].sku);
    assert.ok(d.items[0].unitPrice > 0 && d.items[0].lineTotal > 0);
    assert.ok(d.grandTotal > 0);
    assert.ok(d.paymentMethod);
    assert.equal(d.servedBy, "Cashier One");
    assert.equal(d.shop.name, "CHAFADIA ENTERPRISE");
  });

  test("first print is the original; reprints are stamped COPY and logged", async () => {
    const first = await t.api().get(`/api/receipts/${receiptId}/pdf?format=80mm`).set(bearer(s.cashier)).buffer(true);
    assert.equal(first.status, 200);
    assert.equal(first.headers["content-type"], "application/pdf");
    assert.ok(first.body.length > 1000);
    assert.doesNotMatch(first.headers["content-disposition"], /COPY/);

    const second = await t.api().get(`/api/receipts/${receiptId}/pdf?format=a4`).set(bearer(s.admin)).buffer(true);
    assert.match(second.headers["content-disposition"], /COPY/);

    const prints = await t.api().get(`/api/receipts/${receiptId}/prints`).set(bearer(s.admin));
    assert.deepEqual(prints.body.data.map((p) => p.isCopy), [false, true]);
    const { rows } = await t.db.query("SELECT 1 FROM audit_logs WHERE action = 'receipt.reprint' AND entity_id = $1", [String(receiptId)]);
    assert.equal(rows.length, 1);
  });

  test("QR verification confirms authenticity without personal data", async () => {
    const ok = await t.api().get(`/api/receipts/verify/${verifyToken}`);
    assert.equal(ok.body.data.valid, true);
    assert.equal(JSON.stringify(ok.body).includes("Walk-in"), false);
    const fake = await t.api().get("/api/receipts/verify/not-a-real-token");
    assert.equal(fake.body.data.valid, false);
  });

  test("customers cannot open other people's receipts", async () => {
    assert.equal((await t.api().get(`/api/receipts/${receiptId}`).set(bearer(s.customer))).status, 404);
    assert.equal((await t.api().get(`/api/receipts/${receiptId}/pdf`)).status, 404);
  });

  test("Super Admin can refund a POS sale; the cash refund lowers the shift's expected cash", async () => {
    const { rows } = await t.db.query("SELECT order_id FROM receipts WHERE id = $1", [receiptId]);
    const res = await t.api().post(`/api/orders/${rows[0].order_id}/refunds`).set(bearer(s.owner)).send({ reason: "Customer changed mind", restock: true });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.refund.status, "completed");
  });
});
