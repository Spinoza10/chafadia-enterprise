// Online payments by MoMo / Orange Money transfer + screenshot, verified by two different admins.
import crypto from "node:crypto";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { bearer, checkoutBody, setup } from "./helpers.js";

let t;
let s;
let sentMail;
before(async () => {
  t = await setup({ env: { ONLINE_PAYMENT_MODE: "manual" } });
  s = await t.seedRoles();
  ({ sentMail } = await import("../src/lib/mailer.js"));
});
after(() => t.teardown());

const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));
// a unique "screenshot" each call: PNG signature + random bytes
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
let txnCounter = 1000;
const nextTxn = () => `MP2611${txnCounter++}.1234.A${txnCounter}`;

async function order(qty = 1, extra = {}, price = 3000, stock = 10) {
  const { variantId } = await t.createProduct(s.owner.token, { name: `Proof Item ${txnCounter}`, price, stock });
  const res = await t.api().post("/api/orders").send(checkoutBody(variantId, qty, extra));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { ...res.body.data, variantId };
}

function sendProof(o, { image = png(), txn = nextTxn(), method = "mtn_momo", phone = "677112233", name = "Awa Ngono", amount, token = o.trackingToken } = {}) {
  const req = t.api().post(`/api/payments/manual/${o.id}/proof`).field("token", token).field("method", method)
    .field("transactionId", txn).field("senderPhone", phone).field("senderName", name);
  if (amount !== undefined) req.field("amountClaimed", String(amount));
  if (image) req.attach("screenshot", image, { filename: "momo.png", contentType: "image/png" });
  return req;
}

const proofsFor = async (session, status = "all") => (await t.api().get(`/api/payments/proofs?status=${status}`).set(bearer(session))).body;
const approve = (session, proofId, body = { confirmReceived: true }) => t.api().post(`/api/payments/proofs/${proofId}/approve`).set(bearer(session)).send(body);
const info = async (o) => (await t.api().get(`/api/payments/manual/${o.id}?token=${o.trackingToken}`)).body.data;

describe("customer pays by MoMo transfer and uploads a screenshot", () => {
  test("the shop's MoMo and Orange Money numbers and names are shown with the exact amount", async () => {
    const o = await order(2);
    const d = await info(o);
    assert.deepEqual(d.accounts.mtn_momo, { label: "MTN Mobile Money", number: "652433338", name: "CHAFIOU HAMIDOU", ussd: "*126#" });
    assert.deepEqual(d.accounts.orange_money, { label: "Orange Money", number: "688332699", name: "SADIYATOU SEMIRNYUY KIKA", ussd: "#150#" });
    assert.equal(d.amountDue, 6000);
    assert.equal(d.reference, o.orderNumber);
    assert.equal(d.canSubmit, true);
    assert.equal(d.approvalsRequired, 2, "owner + admin must both approve");
  });

  test("automatic gateway payments and cards are switched off", async () => {
    const o = await order();
    const init = await t.api().post("/api/payments/initiate").send({ orderId: o.id, token: o.trackingToken, method: "mtn_momo", phone: "652433338" });
    assert.equal(init.status, 400);
    assert.match(init.body.error.message, /screenshot/);
    const { variantId } = await t.createProduct(s.owner.token, { name: "Card Item", stock: 5 });
    const card = await t.api().post("/api/orders").send(checkoutBody(variantId, 1, { paymentMethod: "card" }));
    assert.equal(card.status, 400);
  });

  test("the screenshot must be a real image and the details are required", async () => {
    const o = await order();
    assert.equal((await sendProof(o, { image: null })).status, 400);
    const fake = await sendProof(o, { image: Buffer.from("this is not an image, just text pretending....") });
    assert.equal(fake.status, 400);
    assert.match(fake.body.error.message, /JPEG, PNG or WebP/);
    assert.equal((await sendProof(o, { txn: "x" })).status, 400);
    assert.equal((await sendProof(o, { token: "wrong-token-1234567890" })).status, 404, "strangers cannot submit for someone's order");
  });

  test("a valid screenshot puts the order under review and alerts every admin", async () => {
    const o = await order();
    const res = await sendProof(o);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, "pending_review");
    const d = await info(o);
    assert.equal(d.status, "pending", "not paid until admins approve");
    assert.equal(d.canSubmit, false);
    assert.equal(d.proofs[0].senderPhone, "6** ** **33", "customer view masks the number");
    for (const who of [s.owner, s.admin]) {
      const f = (await t.api().get("/api/notifications").set(bearer(who))).body;
      assert.ok(f.data.some((n) => n.type === "payment.proof" && n.message.includes(o.orderNumber)));
    }
    assert.equal((await sendProof(o)).status, 409, "only one screenshot under review at a time");
  });

  test("the same transaction ID or the same screenshot cannot pay two orders", async () => {
    const a = await order();
    const b = await order();
    const image = png();
    const txn = nextTxn();
    assert.equal((await sendProof(a, { image, txn })).status, 201);
    const sameTxn = await sendProof(b, { txn });
    assert.equal(sameTxn.status, 409);
    assert.match(sameTxn.body.error.message, /transaction ID was already used/);
    const sameImage = await sendProof(b, { image });
    assert.equal(sameImage.status, 409);
    assert.match(sameImage.body.error.message, /screenshot was already submitted/);
  });

  test("suspicious details are flagged for the admins", async () => {
    const o = await order(1, {}, 2500);
    await sendProof(o, { phone: "699887766", amount: 2000 }); // Orange number for an MTN payment, wrong amount
    const p = (await proofsFor(s.admin, "pending_review")).data.find((x) => x.order.number === o.orderNumber);
    assert.ok(p.warnings.some((w) => /Orange number/.test(w)));
    assert.ok(p.warnings.some((w) => /2 000 FCFA.*2 500 FCFA is due/.test(w)));
    assert.equal(p.senderPhone, "+237699887766", "admins see the full number");
  });
});

describe("screenshots are private", () => {
  test("only admins with payments.verify and the order's owner can see them", async () => {
    const o = await order();
    const { body } = await sendProof(o);
    const url = `/api/payments/proofs/${body.data.id}/image`;
    const admin = await t.api().get(url).set(bearer(s.admin));
    assert.equal(admin.status, 200);
    assert.equal(admin.headers["content-type"], "image/png");
    assert.match(admin.headers["cache-control"], /no-store/);
    assert.equal((await t.api().get(`${url}?token=${o.trackingToken}`)).status, 200, "customer with the order link");
    assert.equal((await t.api().get(url)).status, 404, "anonymous");
    assert.equal((await t.api().get(url).set(bearer(s.customer))).status, 404, "another customer");
    assert.equal((await t.api().get(url).set(bearer(s.rider))).status, 404, "delivery staff");
    assert.equal((await t.api().get("/api/payments/proofs").set(bearer(s.cashier))).status, 403);
    assert.equal((await t.api().get("/api/payments/proofs").set(bearer(s.customer))).status, 403);
  });
});

describe("two different admins must approve", () => {
  test("first approval is not enough; the same admin cannot approve twice; the second admin finalizes", async () => {
    const o = await order(2, {}, 1500, 5);
    const { body } = await sendProof(o);
    const proofId = body.data.id;

    const noCheck = await approve(s.admin, proofId, {});
    assert.equal(noCheck.status, 400, "admin must confirm the money is in the account");

    const first = await approve(s.admin, proofId);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.completed, false);
    assert.match(first.body.message, /1 of 2/);
    let d = await info(o);
    assert.equal(d.status, "pending");
    assert.equal(d.proofs[0].approvalCount, 1);
    assert.deepEqual(await t.stockOf(o.variantId), { stock_qty: 5, reserved_qty: 2 }, "stock still only reserved");

    const again = await approve(s.admin, proofId);
    assert.equal(again.status, 409);
    assert.match(again.body.error.message, /Another admin/);

    const pending = (await proofsFor(s.owner, "pending_review")).data.find((x) => x.id === proofId);
    assert.equal(pending.approvals[0].name, "Admin");
    assert.equal(pending.youApproved, false);

    const second = await approve(s.owner, proofId);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.data.completed, true);
    d = await info(o);
    assert.equal(d.status, "paid");
    assert.equal(d.proofs[0].status, "approved");
    assert.deepEqual(await t.stockOf(o.variantId), { stock_qty: 3, reserved_qty: 0 }, "stock deducted on approval");

    const detail = (await t.api().get(`/api/orders/${o.id}`).set(bearer(s.admin))).body.data;
    assert.ok(detail.receipt.number, "receipt issued");
    assert.equal(detail.payments.at(-1).status, "succeeded");
    await wait();
    assert.ok(sentMail.some((m) => m.to === "guest@test.cm" && /Payment approved/.test(m.subject)), "approval email");
    assert.ok(sentMail.some((m) => m.to === "guest@test.cm" && /receipt/i.test(m.subject)), "receipt email");
    const sales = (await t.api().get("/api/notifications").set(bearer(s.admin))).body.data;
    assert.ok(sales.some((n) => n.type === "sale" && n.message.includes(o.orderNumber)));

    assert.equal((await approve(s.owner, proofId)).status, 400, "already approved");
  });

  test("a rejected screenshot tells the customer why and lets them send a new one", async () => {
    const o = await order();
    const txn = nextTxn();
    const { body } = await sendProof(o, { txn });
    const short = await t.api().post(`/api/payments/proofs/${body.data.id}/reject`).set(bearer(s.admin)).send({ reason: "no" });
    assert.equal(short.status, 400);
    const rej = await t.api().post(`/api/payments/proofs/${body.data.id}/reject`).set(bearer(s.admin))
      .send({ reason: "Amount on the screenshot is 1 000 FCFA, not 3 000 FCFA" });
    assert.equal(rej.status, 200);
    const d = await info(o);
    assert.equal(d.proofs[0].status, "rejected");
    assert.match(d.proofs[0].rejectionReason, /1 000 FCFA/);
    assert.equal(d.canSubmit, true);
    await wait();
    assert.ok(sentMail.some((m) => m.to === "guest@test.cm" && /Payment not accepted/.test(m.subject)));
    assert.equal((await sendProof(o, { txn })).status, 201, "can resubmit (a rejected transaction ID can be reused)");
  });

  test("the owner can lower the requirement to one approval", async () => {
    await t.api().put("/api/settings/payment_approvals_required").set(bearer(s.owner)).send({ value: 1 });
    const o = await order();
    const { body } = await sendProof(o);
    const res = await approve(s.admin, body.data.id);
    assert.equal(res.body.data.completed, true);
    assert.equal((await info(o)).status, "paid");
    await t.api().put("/api/settings/payment_approvals_required").set(bearer(s.owner)).send({ value: 2 });
  });

  test("an order under review never expires, even past its reservation time", async () => {
    const o = await order();
    await sendProof(o);
    await t.db.query("UPDATE orders SET reservation_expires_at = now() - interval '1 hour' WHERE id = $1", [o.id]);
    const { expireStale } = await import("../src/services/orders.js");
    await expireStale(t.db.tx);
    assert.equal((await info(o)).status, "pending");
  });

  test("while a screenshot is under review the order cannot be cancelled or paid in cash", async () => {
    const o = await order();
    await sendProof(o);
    const cancel = await t.api().post(`/api/orders/${o.id}/cancel`).send({ token: o.trackingToken });
    assert.equal(cancel.status, 400);
    assert.match(cancel.body.error.message, /being checked/);
    const staffCancel = await t.api().post(`/api/orders/${o.id}/cancel`).set(bearer(s.admin)).send({ reason: "test" });
    assert.equal(staffCancel.status, 400);
    const cash = await t.api().post(`/api/orders/${o.id}/payments/cash`).set(bearer(s.cashier)).send({});
    assert.equal(cash.status, 400);
    assert.match(cash.body.error.message, /Verify payments/);
    const detail = (await t.api().get(`/api/orders/track/${o.orderNumber}?token=${o.trackingToken}`)).body.data;
    assert.equal(detail.paymentUnderReview, true, "the order shows it is under review");
  });

  test("admins without payments.verify cannot approve", async () => {
    const o = await order();
    const { body } = await sendProof(o);
    const admin = (await t.db.query("SELECT id FROM users WHERE email = 'admin@test.cm'")).rows[0];
    const off = await t.api().put(`/api/users/${admin.id}/permissions`).set(bearer(s.owner)).send({ overrides: { "payments.verify": false } });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal((await approve(s.admin, body.data.id)).status, 403);
    await t.api().put(`/api/users/${admin.id}/permissions`).set(bearer(s.owner)).send({ overrides: {} });
  });
});
