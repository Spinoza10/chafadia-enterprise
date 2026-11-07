// API protection, sold-out awareness, sale alerts for every admin, mobile money direct charge
// and WhatsApp receipts.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { bearer, checkoutBody, setup } from "./helpers.js";

let t;
let s;
let sentWhatsApp;
let sentMail;
before(async () => {
  t = await setup();
  s = await t.seedRoles();
  ({ sentWhatsApp } = await import("../src/whatsapp/mock.js"));
  ({ sentMail } = await import("../src/lib/mailer.js"));
});
after(() => t.teardown());

const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));

async function placeOrder(variantId, qty = 1, extra = {}, session) {
  const req = t.api().post("/api/orders");
  if (session) req.set(bearer(session));
  const res = await req.send(checkoutBody(variantId, qty, extra));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
}

async function payWithMomo(order, phone = "+237652433338", method = "mtn_momo") {
  const init = await t.api().post("/api/payments/initiate").send({ orderId: order.id, token: order.trackingToken, method, phone });
  assert.equal(init.status, 201, JSON.stringify(init.body));
  const done = await t.api().post(`/api/payments/mock/${init.body.data.reference}/complete`).send({ outcome: "success" });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return init.body.data;
}

const feed = async (session) => (await t.api().get("/api/notifications").set(bearer(session))).body;

// ---------------------------------------------------------------------------------------------

describe("API protection", () => {
  test("calls without the web app's header are refused", async () => {
    const res = await t.rawApi().get("/api/products");
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "FORBIDDEN");
    const post = await t.rawApi().post("/api/auth/login").send({ email: "owner@test.cm", password: "Password123" });
    assert.equal(post.status, 403, "login cannot be scripted from another site either");
  });

  test("the web app's calls work, responses are not cached or indexed", async () => {
    const res = await t.api().get("/api/products");
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.match(res.headers["x-robots-tag"], /noindex/);
    assert.equal(res.headers["x-powered-by"], undefined);
  });

  test("provider webhooks skip the header but still need a valid signature", async () => {
    const res = await t.rawApi().post("/api/payments/webhook/mock").set("Content-Type", "application/json").send("{}");
    assert.equal(res.status, 401);
  });

  test("the health check stays reachable for monitoring", async () => {
    assert.equal((await t.rawApi().get("/api/health")).status, 200);
  });
});

describe("sold out: customers and every admin are told", () => {
  test("buying the last unit shows the product as sold out and alerts all admins", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Last Perfume", price: 5000, stock: 1, threshold: 0 });
    const before = await t.api().get(`/api/products/availability?variants=${variantId}`);
    assert.equal(before.body.data[0].status, "available");

    const order = await placeOrder(variantId, 1);
    const after = await t.api().get(`/api/products/availability?variants=${variantId}`);
    assert.equal(after.body.data[0].status, "sold_out");
    assert.equal(after.body.data[0].available, 0);

    // a second customer cannot buy it
    const second = await t.api().post("/api/orders").send(checkoutBody(variantId, 1));
    assert.equal(second.status, 409);
    assert.match(second.body.error.message, /out of stock/i);

    for (const who of [s.owner, s.admin]) {
      const f = await feed(who);
      assert.ok(f.data.some((n) => n.type === "stock.out" && /Last Perfume/.test(n.message) && /sold out/i.test(n.message)), "sold-out alert");
    }
    // cancelling releases the unit: back in stock
    await t.api().post(`/api/orders/${order.id}/cancel`).send({ token: order.trackingToken });
    assert.equal((await t.api().get(`/api/products/availability?variants=${variantId}`)).body.data[0].status, "available");
    assert.ok((await feed(s.admin)).data.some((n) => n.type === "stock.back" && /Last Perfume/.test(n.message)));
  });

  test("hidden or unknown products are reported as unavailable", async () => {
    const { variantId, product } = await t.createProduct(s.owner.token, { name: "Hidden Soap", stock: 5 });
    await t.db.query("UPDATE products SET is_active = false WHERE id = $1", [product.id]);
    const res = await t.api().get(`/api/products/availability?variants=${variantId},999999`);
    assert.deepEqual(res.body.data.map((r) => r.status), ["unavailable", "unavailable"]);
    assert.equal((await t.api().get("/api/products/availability?variants=abc")).status, 400);
  });

  test("every sale (online and POS) is announced to every admin with the items sold", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Shea Butter", price: 2000, stock: 10 });
    const order = await placeOrder(variantId, 2);
    await payWithMomo(order);
    await t.api().post("/api/pos/shifts/open").set(bearer(s.cashier)).send({ openingFloat: 0 });
    const pos = await t.api().post("/api/pos/sales").set(bearer(s.cashier))
      .send({ items: [{ variantId, quantity: 3 }], payment: { method: "cash", amountTendered: 10000 } });
    assert.equal(pos.status, 201, JSON.stringify(pos.body));

    for (const who of [s.owner, s.admin]) {
      const sales = (await feed(who)).data.filter((n) => n.type === "sale");
      assert.ok(sales.some((n) => n.message.includes(order.orderNumber) && n.message.includes("2 x Shea Butter")), "online sale");
      assert.ok(sales.some((n) => n.message.includes("3 x Shea Butter") && /in store by Cashier One/.test(n.message)), "POS sale");
    }
    // cashiers and delivery staff do not get the shop-wide feed
    assert.ok(!(await feed(s.cashier)).data.some((n) => n.type === "sale"));
    assert.ok(!(await feed(s.rider)).data.some((n) => n.type === "sale"));
  });

  test("each admin has their own read state", async () => {
    const ownerBefore = (await feed(s.owner)).unread;
    assert.ok(ownerBefore > 0);
    const r = await t.api().post("/api/notifications/read").set(bearer(s.admin)).send({});
    assert.equal(r.status, 204);
    assert.equal((await feed(s.admin)).unread, 0, "admin read everything");
    assert.equal((await feed(s.owner)).unread, ownerBefore, "owner still sees them as unread");
  });
});

describe("mobile money direct charge (customer confirms with their PIN on the phone)", () => {
  test("MTN MoMo sends a prompt to the phone instead of redirecting", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Momo Juice", price: 1500, stock: 10 });
    const order = await placeOrder(variantId, 1);
    const init = await t.api().post("/api/payments/initiate")
      .send({ orderId: order.id, token: order.trackingToken, method: "mtn_momo", phone: "6 52 43 33 38" });
    assert.equal(init.status, 201, JSON.stringify(init.body));
    assert.equal(init.body.data.mode, "push");
    assert.equal(init.body.data.checkoutUrl, null);
    assert.equal(init.body.data.phone, "6** ** **38", "number is masked");
    assert.match(init.body.data.instructions, /PIN on your phone/);

    const { rows } = await t.db.query("SELECT phone FROM payments WHERE reference = $1", [init.body.data.reference]);
    assert.equal(rows[0].phone, "237652433338", "stored in international format");

    const pending = await t.api().get(`/api/payments/${init.body.data.reference}/status`);
    assert.equal(pending.body.data.status, "pending");
    assert.equal(pending.body.data.mode, "push");

    // customer approves on the phone -> provider webhook -> paid
    await t.api().post(`/api/payments/mock/${init.body.data.reference}/complete`).send({ outcome: "success" });
    const paid = await t.api().get(`/api/payments/${init.body.data.reference}/status`);
    assert.equal(paid.body.data.status, "succeeded");
    assert.equal(paid.body.data.orderStatus, "paid");
  });

  test("Orange Money works the same way", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Orange Tea", price: 1000, stock: 10 });
    const order = await placeOrder(variantId, 1, { paymentMethod: "orange_money" });
    const init = await payWithMomo(order, "688332699", "orange_money");
    assert.equal(init.mode, "push");
    assert.equal((await t.api().get(`/api/payments/${init.reference}/status`)).body.data.status, "succeeded");
  });

  test("the number must belong to the chosen network", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Network Check", price: 1000, stock: 10 });
    const order = await placeOrder(variantId, 1);
    const pay = (method, phone) => t.api().post("/api/payments/initiate").send({ orderId: order.id, token: order.trackingToken, method, phone });
    const wrongMtn = await pay("mtn_momo", "688332699");
    assert.equal(wrongMtn.status, 400);
    assert.match(wrongMtn.body.error.message, /Orange number/);
    const wrongOrange = await pay("orange_money", "652433338");
    assert.match(wrongOrange.body.error.message, /MTN number/);
    assert.equal((await pay("mtn_momo", "12345")).status, 400);
  });

  test("a declined prompt can be retried with another number", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Retry Cream", price: 1000, stock: 10 });
    const order = await placeOrder(variantId, 1);
    const first = await t.api().post("/api/payments/initiate").send({ orderId: order.id, token: order.trackingToken, method: "mtn_momo", phone: "652433338" });
    await t.api().post(`/api/payments/mock/${first.body.data.reference}/complete`).send({ outcome: "failure" });
    const failed = await t.api().get(`/api/payments/${first.body.data.reference}/status`);
    assert.equal(failed.body.data.status, "failed");
    assert.equal(failed.body.data.canRetry, true);
    const second = await t.api().post("/api/payments/initiate").send({ orderId: order.id, token: order.trackingToken, method: "mtn_momo", phone: "677000001" });
    assert.equal(second.status, 201);
    assert.notEqual(second.body.data.reference, first.body.data.reference);
  });
});

describe("WhatsApp receipts", () => {
  async function register(email, phone, extra = {}) {
    const res = await t.api().post("/api/auth/register").send({ fullName: "Awa Buyer", email, password: "Password123", phone, ...extra });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await wait(150);
    return { token: res.body.accessToken, user: res.body.user };
  }

  test("registration checks whether the number is on WhatsApp", async () => {
    const on = await register("awa@test.cm", "+237652433338");
    const me = await t.api().get("/api/whatsapp/me").set(bearer(on));
    assert.equal(me.body.data.status, "on_whatsapp");
    assert.ok(sentWhatsApp.some((m) => m.kind === "welcome" && m.to === "237652433338"));

    const off = await register("nowa@test.cm", "+237677770000"); // mock rule: ...0000 is not on WhatsApp
    const me2 = await t.api().get("/api/whatsapp/me").set(bearer(off));
    assert.equal(me2.body.data.status, "not_on_whatsapp");
  });

  test("a paid order's receipt goes to email AND WhatsApp on the registered number", async () => {
    const session = await t.login("awa@test.cm");
    const { variantId } = await t.createProduct(s.owner.token, { name: "WA Lotion", price: 3000, stock: 5 });
    // the checkout phone differs; the registered number is used for WhatsApp
    const order = await placeOrder(variantId, 1, { customer: { name: "Awa Buyer", phone: "+237699999999", email: "awa@test.cm" } }, session);
    const pay = await payWithMomo(order);
    await wait();
    assert.ok(sentMail.some((m) => m.to === "awa@test.cm" && /receipt/i.test(m.subject)), "emailed");
    const wa = sentWhatsApp.find((m) => m.kind === "receipt" && m.to === "237652433338");
    assert.ok(wa, "sent on WhatsApp");
    assert.match(wa.filename, /^RCP-\d{4}-\d{6}\.pdf$/);

    const status = await t.api().get(`/api/payments/${pay.reference}/status`);
    assert.deepEqual(status.body.data.receiptSent, { email: true, whatsapp: true });

    const detail = await t.api().get(`/api/orders/${order.id}`).set(bearer(s.admin));
    assert.equal(detail.body.data.receipt.whatsapp.status, "delivered");
  });

  test("numbers not on WhatsApp get email only, and staff see why", async () => {
    const session = await t.login("nowa@test.cm");
    const { variantId } = await t.createProduct(s.owner.token, { name: "No WA Soap", price: 1000, stock: 5 });
    const order = await placeOrder(variantId, 1, { customer: { name: "Awa Buyer", phone: "+237677770000", email: "nowa@test.cm" } }, session);
    const before = sentWhatsApp.length;
    await payWithMomo(order);
    await wait();
    assert.ok(sentMail.some((m) => m.to === "nowa@test.cm" && /receipt/i.test(m.subject)), "still emailed");
    assert.equal(sentWhatsApp.length, before, "no WhatsApp attempt for a known non-WhatsApp number");
    const detail = await t.api().get(`/api/orders/${order.id}`).set(bearer(s.admin));
    assert.equal(detail.body.data.receipt.whatsappSentAt, null);
    assert.equal(detail.body.data.receipt.whatsapp.status, "skipped");

    // staff can force a re-check from the receipts screen
    const resend = await t.api().post(`/api/receipts/${detail.body.data.receipt.id}/whatsapp`).set(bearer(s.admin)).send({});
    assert.equal(resend.status, 200);
    assert.match(resend.body.message, /not on WhatsApp/);
  });

  test("customers who opt out get no WhatsApp messages", async () => {
    const guest = sentWhatsApp.length;
    const { variantId } = await t.createProduct(s.owner.token, { name: "Opt Out Oil", price: 1000, stock: 5 });
    const order = await placeOrder(variantId, 1, { customer: { name: "Guest", phone: "+237652111111", email: "g2@test.cm" }, whatsappOptIn: false });
    await payWithMomo(order);
    await wait();
    assert.equal(sentWhatsApp.length, guest);
  });

  test("POS receipts go on WhatsApp when the cashier enters the customer's phone", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "POS WA Item", price: 1000, stock: 5 });
    const res = await t.api().post("/api/pos/sales").set(bearer(s.cashier))
      .send({ items: [{ variantId, quantity: 1 }], customer: { name: "Walk In", phone: "670123456" }, payment: { method: "cash", amountTendered: 1000 } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await wait();
    assert.ok(sentWhatsApp.some((m) => m.kind === "receipt" && m.to === "237670123456"));
  });

  test("the Meta webhook is closed unless the Cloud API is configured", async () => {
    assert.equal((await t.rawApi().post("/api/whatsapp/webhook").send("{}")).status, 404);
    assert.equal((await t.rawApi().get("/api/whatsapp/webhook?hub.mode=subscribe")).status, 404);
  });
});
