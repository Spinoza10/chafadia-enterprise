import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { bearer, checkoutBody, setup } from "./helpers.js";

let t;
let s;
let mockProvider;
let sign;
before(async () => {
  t = await setup();
  s = await t.seedRoles();
  ({ mockProvider } = await import("../src/payments/index.js"));
  ({ sign } = await import("../src/payments/mock.js"));
});
after(() => t.teardown());

async function placeAndInitiate(variantId, qty = 1, extra = {}) {
  const order = await t.api().post("/api/orders").send(checkoutBody(variantId, qty, extra));
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const o = order.body.data;
  const pay = await t.api().post("/api/payments/initiate").send({ orderId: o.id, token: o.trackingToken, method: "mtn_momo", phone: "+237650000000" });
  assert.equal(pay.status, 201, JSON.stringify(pay.body));
  return { order: o, reference: pay.body.data.reference };
}

// Providers do not send the web app's header: webhooks must work without it.
const webhook = (body, signature) =>
  t.rawApi().post("/api/payments/webhook/mock").set("Content-Type", "application/json").set("x-mock-signature", signature).send(body);

async function orderRow(id) {
  return (await t.db.query("SELECT * FROM orders WHERE id = $1", [id])).rows[0];
}

describe("checkout", () => {
  test("prices come from the database, not the client", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Price Check", price: 2500, stock: 5 });
    const body = checkoutBody(variantId, 2);
    body.items[0].price = 1; // ignored
    body.total = 1; // ignored
    const res = await t.api().post("/api/orders").send(body);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.subtotal, 5000);
    assert.equal(res.body.data.grandTotal, 5000);
    assert.equal(res.body.data.status, "pending");
  });

  test("placing an order reserves stock but does not deduct it", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Reserve", stock: 5 });
    await t.api().post("/api/orders").send(checkoutBody(variantId, 2));
    assert.deepEqual(await t.stockOf(variantId), { stock_qty: 5, reserved_qty: 2 });
  });

  test("cannot order more than is available", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Scarce", stock: 2 });
    const res = await t.api().post("/api/orders").send(checkoutBody(variantId, 3));
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /Only 2/);
  });

  test("no overselling under concurrent checkouts", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Hot Item", stock: 5 });
    const results = await Promise.all(Array.from({ length: 8 }, () => t.api().post("/api/orders").send(checkoutBody(variantId, 2))));
    const ok = results.filter((r) => r.status === 201).length;
    assert.equal(ok, 2, "only 2 orders of 2 units fit in 5 units");
    const stock = await t.stockOf(variantId);
    assert.equal(stock.reserved_qty, 4);
    assert.ok(stock.reserved_qty <= stock.stock_qty);
  });

  test("delivery orders add the zone fee and keep the customer's coordinates", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Delivered", price: 3000, stock: 5 });
    const zones = await t.api().get("/api/delivery-zones");
    const zone = zones.body.data[0];
    const res = await t.api().post("/api/orders").send(
      checkoutBody(variantId, 1, { fulfilment: "delivery", deliveryZoneId: zone.id, address: { line: "Bastos, Yaoundé", latitude: 3.8889, longitude: 11.5135 } })
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.data.deliveryFee, zone.fee);
    assert.equal(res.body.data.grandTotal, 3000 + zone.fee);
    assert.deepEqual([res.body.data.location.lat, res.body.data.location.lng], [3.8889, 11.5135]);
  });

  test("a guest cannot see someone else's order without the tracking token", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Private", stock: 5 });
    const res = await t.api().post("/api/orders").send(checkoutBody(variantId, 1));
    assert.equal((await t.api().get(`/api/orders/${res.body.data.id}`)).status, 404);
    assert.equal((await t.api().get(`/api/orders/${res.body.data.id}?token=wrongwrongwrong`)).status, 404);
    assert.equal((await t.api().get(`/api/orders/${res.body.data.id}?token=${res.body.data.trackingToken}`)).status, 200);
    assert.equal((await t.api().get(`/api/orders/${res.body.data.id}`).set(bearer(s.customer))).status, 404);
  });
});

describe("payments and webhooks", () => {
  test("a webhook with a bad signature is rejected and the order stays pending", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Bad Sig", stock: 5 });
    const { order, reference } = await placeAndInitiate(variantId);
    mockProvider.simulate(reference, "success");
    const body = JSON.stringify({ id: "evt_forged", reference });
    const res = await webhook(body, "deadbeef");
    assert.equal(res.status, 401);
    assert.equal((await orderRow(order.id)).status, "pending");
  });

  test("a correctly signed webhook is not trusted on its own: the provider status is re-checked", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Recheck", stock: 5 });
    const { order, reference } = await placeAndInitiate(variantId);
    // signed "success" event, but the provider still says pending
    const body = JSON.stringify({ id: "evt_premature", reference });
    const res = await webhook(body, sign(body));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "pending");
    assert.equal((await orderRow(order.id)).status, "pending");
  });

  test("the browser cannot mark an order paid", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "No Self Pay", stock: 5 });
    const { order } = await placeAndInitiate(variantId);
    const cash = await t.api().post(`/api/orders/${order.id}/payments/cash`).set(bearer(s.customer)).send({});
    assert.equal(cash.status, 403);
    const anon = await t.api().post(`/api/orders/${order.id}/payments/cash`).send({});
    assert.equal(anon.status, 401);
    const rider = await t.api().post(`/api/orders/${order.id}/payments/cash`).set(bearer(s.rider)).send({});
    assert.equal(rider.status, 404, "riders record cash only on orders assigned to them");
    assert.equal((await orderRow(order.id)).status, "pending");
  });

  test("verified payment -> paid, stock deducted, receipt issued, emailed; duplicate webhook ignored", async () => {
    const { sentMail } = await import("../src/lib/mailer.js");
    const { variantId } = await t.createProduct(s.owner.token, { name: "Happy Path", price: 2000, stock: 5 });
    const { order, reference } = await placeAndInitiate(variantId, 2);
    const sim = mockProvider.simulate(reference, "success");

    const first = await webhook(sim.body, sim.signature);
    assert.equal(first.status, 200);
    assert.equal(first.body.status, "succeeded");
    const row = await orderRow(order.id);
    assert.equal(row.status, "paid");
    assert.equal(row.amount_paid, 4000);
    assert.deepEqual(await t.stockOf(variantId), { stock_qty: 3, reserved_qty: 0 });

    const receipt = await t.db.query("SELECT * FROM receipts WHERE order_id = $1", [order.id]);
    assert.equal(receipt.rowCount, 1);
    assert.match(receipt.rows[0].receipt_number, /^RCP-\d{4}-\d{6}$/);

    const movements = await t.db.query("SELECT type, quantity FROM stock_movements WHERE reference_id = $1", [String(order.id)]);
    assert.deepEqual(movements.rows, [{ type: "sale", quantity: -2 }]);

    const dup = await webhook(sim.body, sim.signature);
    assert.equal(dup.body.duplicate, true);
    assert.deepEqual(await t.stockOf(variantId), { stock_qty: 3, reserved_qty: 0 }, "no double deduction");

    // a different event id for the same payment is also harmless
    const replay = JSON.stringify({ id: "evt_other", reference });
    await webhook(replay, sign(replay));
    assert.deepEqual(await t.stockOf(variantId), { stock_qty: 3, reserved_qty: 0 });

    await new Promise((r) => setTimeout(r, 300));
    assert.ok(sentMail.some((m) => m.to === "guest@test.cm" && /receipt/i.test(m.subject)), "receipt emailed");
  });

  test("failed payment leaves the order pending and stock reserved so the customer can retry", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Retry", stock: 5 });
    const { order, reference } = await placeAndInitiate(variantId);
    const sim = mockProvider.simulate(reference, "failure");
    const res = await webhook(sim.body, sim.signature);
    assert.equal(res.body.status, "failed");
    assert.equal((await orderRow(order.id)).status, "pending");
    assert.equal((await t.stockOf(variantId)).reserved_qty, 1);
    const retry = await t.api().post("/api/payments/initiate").send({ orderId: order.id, token: order.trackingToken, method: "orange_money", phone: "+237690000000" });
    assert.equal(retry.status, 201);
    assert.notEqual(retry.body.data.reference, reference);
  });

  test("initiating twice returns the same pending payment (idempotent)", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Twice", stock: 5 });
    const { order, reference } = await placeAndInitiate(variantId);
    const again = await t.api().post("/api/payments/initiate").send({ orderId: order.id, token: order.trackingToken, method: "mtn_momo", phone: "+237650000000" });
    assert.equal(again.body.data.reference, reference);
  });

  test("unpaid orders expire: reservation released, order cancelled; a late payment is flagged for refund", async () => {
    const { tx } = await import("../src/db.js");
    const { expireStale } = await import("../src/services/orders.js");
    const { variantId } = await t.createProduct(s.owner.token, { name: "Expire", stock: 5 });
    const { order, reference } = await placeAndInitiate(variantId, 2);
    await t.db.query("UPDATE orders SET reservation_expires_at = now() - interval '1 minute' WHERE id = $1", [order.id]);
    const r = await expireStale(tx);
    assert.ok(r.orders >= 1);
    assert.equal((await orderRow(order.id)).status, "cancelled");
    assert.deepEqual(await t.stockOf(variantId), { stock_qty: 5, reserved_qty: 0 });

    await t.db.query("UPDATE payments SET status = 'pending' WHERE reference = $1", [reference]);
    const sim = mockProvider.simulate(reference, "success");
    await webhook(sim.body, sim.signature);
    const row = await orderRow(order.id);
    assert.equal(row.status, "cancelled");
    assert.match(row.needs_attention, /refund required/);
    assert.deepEqual(await t.stockOf(variantId), { stock_qty: 5, reserved_qty: 0 }, "no stock taken for a cancelled order");
  });

  test("customer can cancel their own pending order; stock is released", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Cancel Me", stock: 5 });
    const res = await t.api().post("/api/orders").set(bearer(s.customer)).send(checkoutBody(variantId, 3));
    assert.equal(res.status, 201);
    const cancel = await t.api().post(`/api/orders/${res.body.data.id}/cancel`).set(bearer(s.customer)).send({});
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.data.status, "cancelled");
    assert.equal((await t.stockOf(variantId)).reserved_qty, 0);
    const mine = await t.api().get("/api/orders/mine").set(bearer(s.customer));
    assert.ok(mine.body.data.some((o) => o.id === res.body.data.id));
  });
});

describe("delivery workflow and refunds", () => {
  let orderId;
  let variantId;
  before(async () => {
    ({ variantId } = await t.createProduct(s.owner.token, { name: "Ship It", price: 5000, stock: 4 }));
    const zones = await t.api().get("/api/delivery-zones");
    const order = await t.api().post("/api/orders").send(
      checkoutBody(variantId, 2, { fulfilment: "delivery", deliveryZoneId: zones.body.data[0].id, address: { line: "Mvan, Yaoundé", latitude: 3.83, longitude: 11.52 } })
    );
    orderId = order.body.data.id;
    const pay = await t.api().post("/api/payments/initiate").send({ orderId, token: order.body.data.trackingToken, method: "card" });
    const sim = mockProvider.simulate(pay.body.data.reference, "success");
    await webhook(sim.body, sim.signature);
  });

  test("illegal status jumps are refused", async () => {
    const res = await t.api().patch(`/api/orders/${orderId}/status`).set(bearer(s.admin)).send({ status: "delivered" });
    assert.equal(res.status, 400);
  });

  test("admin assigns a rider; rider can only progress their own delivery", async () => {
    const { rows } = await t.db.query("SELECT id FROM users WHERE email = 'rider@test.cm'");
    const processing = await t.api().patch(`/api/orders/${orderId}/status`).set(bearer(s.rider)).send({ status: "processing" });
    assert.equal(processing.status, 400, "riders only use out_for_delivery / delivered");
    assert.equal((await t.api().patch(`/api/orders/${orderId}/status`).set(bearer(s.admin)).send({ status: "processing" })).status, 200);
    const notMine = await t.api().patch(`/api/orders/${orderId}/status`).set(bearer(s.rider)).send({ status: "out_for_delivery" });
    assert.equal(notMine.status, 403);
    assert.equal((await t.api().patch(`/api/orders/${orderId}/assign`).set(bearer(s.admin)).send({ deliveryPersonId: rows[0].id })).status, 200);
    assert.equal((await t.api().patch(`/api/orders/${orderId}/status`).set(bearer(s.rider)).send({ status: "out_for_delivery" })).status, 200);
    const done = await t.api().patch(`/api/orders/${orderId}/status`).set(bearer(s.rider)).send({ status: "delivered" });
    assert.equal(done.status, 200);
    assert.equal(done.body.data.status, "delivered");
    const riderList = await t.api().get("/api/orders").set(bearer(s.rider));
    assert.deepEqual(riderList.body.data.map((o) => o.id), [orderId], "rider only sees assigned orders");
  });

  test("partial then full refund by Super Admin; full refund restocks exactly what was sold", async () => {
    assert.deepEqual(await t.stockOf(variantId), { stock_qty: 2, reserved_qty: 0 });
    const order = await orderRow(orderId);
    const partial = await t.api().post(`/api/orders/${orderId}/refunds`).set(bearer(s.owner)).send({ amount: 1000, reason: "Damaged box" });
    assert.equal(partial.status, 201);
    assert.equal((await orderRow(orderId)).status, "delivered");
    const tooMuch = await t.api().post(`/api/orders/${orderId}/refunds`).set(bearer(s.owner)).send({ amount: order.grand_total, reason: "Too much" });
    assert.equal(tooMuch.status, 400);
    const full = await t.api().post(`/api/orders/${orderId}/refunds`).set(bearer(s.owner)).send({ reason: "Customer returned items", restock: true });
    assert.equal(full.status, 201);
    const row = await orderRow(orderId);
    assert.equal(row.status, "refunded");
    assert.equal(row.amount_refunded, row.amount_paid);
    assert.deepEqual(await t.stockOf(variantId), { stock_qty: 4, reserved_qty: 0 });
    const { rows } = await t.db.query("SELECT action FROM audit_logs WHERE entity_type = 'order' AND entity_id = $1 AND action LIKE 'refund.%' ORDER BY id", [String(orderId)]);
    assert.deepEqual(rows.map((r) => r.action), ["refund.partial", "refund.full"]);
  });
});

describe("reports reflect sales", () => {
  test("summary shows revenue, profit and best sellers", async () => {
    const { variantId } = await t.createProduct(s.owner.token, { name: "Report Item", price: 1000, cost: 600, stock: 10 });
    const { reference } = await placeAndInitiate(variantId, 3);
    const sim = mockProvider.simulate(reference, "success");
    await webhook(sim.body, sim.signature);
    const res = await t.api().get("/api/reports/summary?period=today").set(bearer(s.owner));
    assert.equal(res.status, 200);
    assert.ok(res.body.data.revenue >= 3000);
    assert.ok(res.body.data.grossProfit >= 1200);
    assert.ok(res.body.data.bestSellers.some((b) => b.name === "Report Item" && b.units === 3));
    const csv = await t.api().get("/api/reports/products?format=csv").set(bearer(s.owner));
    assert.match(csv.headers["content-type"], /text\/csv/);
    assert.match(csv.text, /Report Item/);
  });
});
