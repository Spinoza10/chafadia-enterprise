// Quick sign-up (phone + password), login by phone, password reset on WhatsApp and the customer
// directory with WhatsApp messaging.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { bearer, setup } from "./helpers.js";

let t;
let s;
let sentWhatsApp;
before(async () => {
  t = await setup();
  s = await t.seedRoles();
  ({ sentWhatsApp } = await import("../src/whatsapp/mock.js"));
});
after(() => t.teardown());

const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const register = (body) => t.api().post("/api/auth/register").send(body);
const customers = (session, qs = "") => t.api().get(`/api/customers${qs}`).set(bearer(session));
const idOf = async (phone) => (await t.db.query("SELECT id FROM users WHERE phone = $1", [phone])).rows[0].id;

describe("quick sign-up", () => {
  test("name + phone + 8-character password is enough; email is optional", async () => {
    const res = await register({ fullName: "Mireille Fon", phone: "+237 652 11 22 33", password: "mimi2026" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.user.phone, "+237652112233", "stored in one standard format");
    assert.equal(res.body.user.email, null);
    await wait();
    assert.ok(sentWhatsApp.some((m) => m.kind === "welcome" && m.to === "237652112233"), "WhatsApp check at registration");
  });

  test("log in with the phone number written any way, or with the email", async () => {
    for (const login of ["652112233", "+237652112233", "00237 6 52 11 22 33"]) {
      const res = await t.api().post("/api/auth/login").send({ login, password: "mimi2026" });
      assert.equal(res.status, 200, `${login}: ${JSON.stringify(res.body)}`);
    }
    await register({ fullName: "Paul Email", email: "paul@test.cm", phone: "677445566", password: "paul2026x" });
    assert.equal((await t.api().post("/api/auth/login").send({ login: "PAUL@test.cm", password: "paul2026x" })).status, 200);
    const wrong = await t.api().post("/api/auth/login").send({ login: "652112233", password: "nope12345" });
    assert.equal(wrong.status, 401);
  });

  test("one account per phone number and per email", async () => {
    const dup = await register({ fullName: "Copy", phone: "652112233", password: "copy2026" });
    assert.equal(dup.status, 400);
    assert.match(dup.body.error.message, /phone number already exists/);
    const dupMail = await register({ fullName: "Copy", email: "paul@test.cm", phone: "699000111", password: "copy2026" });
    assert.match(dupMail.body.error.message, /email already exists/);
  });

  test("still validated: a way to log in, and a password with letters and numbers", async () => {
    assert.equal((await register({ fullName: "Nobody", password: "abcd1234" })).status, 400);
    assert.equal((await register({ fullName: "Short", phone: "699111222", password: "abc123" })).status, 400);
    assert.equal((await register({ fullName: "Letters", phone: "699111223", password: "abcdefghij" })).status, 400);
  });

  test("staff phone numbers are normalised and cannot reuse a customer's number", async () => {
    const dup = await t.api().post("/api/users").set(bearer(s.owner))
      .send({ fullName: "New Cashier", email: "nc@test.cm", phone: "652 11 22 33", role: "cashier", password: "Cashier12345" });
    assert.equal(dup.status, 400);
    assert.match(dup.body.error.message, /already uses this phone/);
    const ok = await t.api().post("/api/users").set(bearer(s.owner))
      .send({ fullName: "New Cashier", email: "nc@test.cm", phone: "6 70 11 22 99", role: "cashier", password: "Cashier12345" });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.phone, "+237670112299");
    assert.equal((await t.api().post("/api/auth/login").send({ login: "670112299", password: "Cashier12345" })).status, 200, "staff can log in with their phone too");
  });

  test("staff keep the stricter 10-character rule", async () => {
    const res = await t.api().post("/api/auth/change-password").set(bearer(s.admin)).send({ currentPassword: "Password123", newPassword: "short123" });
    assert.equal(res.status, 400);
  });

  test("forgot password works with only a phone number: the link arrives on WhatsApp", async () => {
    const before = sentWhatsApp.length;
    const res = await t.api().post("/api/auth/forgot-password").send({ login: "652112233" });
    assert.equal(res.status, 200);
    await wait();
    const msg = sentWhatsApp.slice(before).find((m) => m.kind === "template:password_reset");
    assert.ok(msg, "reset sent on WhatsApp");
    const token = msg.text.match(/token=([\w-]+)/)[1];
    const { rows } = await t.db.query("SELECT body FROM whatsapp_messages WHERE purpose = 'reset' ORDER BY id DESC LIMIT 1");
    assert.equal(rows[0].body, "Password reset link", "the secret link is not kept in the history");
    const reset = await t.api().post("/api/auth/reset-password").send({ token, password: "newmimi99" });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal((await t.api().post("/api/auth/login").send({ login: "652112233", password: "newmimi99" })).status, 200);
  });

  test("admins are told about every new customer", async () => {
    const feed = (await t.api().get("/api/notifications").set(bearer(s.admin))).body.data;
    assert.ok(feed.some((n) => n.type === "customer.new" && /Mireille Fon/.test(n.message) && /\+237652112233/.test(n.message)));
  });
});

describe("customer directory", () => {
  test("admins see every registered customer with WhatsApp status and spending; others cannot", async () => {
    const res = await customers(s.admin);
    assert.equal(res.status, 200);
    const m = res.body.data.find((c) => c.phone === "+237652112233");
    assert.equal(m.fullName, "Mireille Fon");
    assert.equal(m.whatsapp.status, "on_whatsapp");
    assert.equal(m.whatsapp.chatLink, "https://wa.me/237652112233?text=Hello%20Mireille%2C%20");
    assert.equal(m.orders, 0);
    assert.ok(!res.body.data.some((c) => c.fullName === "Admin"), "staff are not listed as customers");
    assert.equal((await customers(s.cashier)).status, 403);
    assert.equal((await customers(s.customer)).status, 403);
  });

  test("search by any part of the phone number, filter by WhatsApp status", async () => {
    await register({ fullName: "No WhatsApp Lady", phone: "677880000", password: "nowa2026" }); // mock: ...0000 is not on WhatsApp
    await wait();
    const found = (await customers(s.admin, "?search=11 22")).body.data;
    assert.deepEqual(found.map((c) => c.fullName), ["Mireille Fon"]);
    const not = (await customers(s.admin, "?whatsapp=not_on_whatsapp")).body.data;
    assert.ok(not.some((c) => c.fullName === "No WhatsApp Lady"));
    assert.ok(!not.some((c) => c.fullName === "Mireille Fon"));
    const stats = (await t.api().get("/api/customers/stats").set(bearer(s.admin))).body.data;
    assert.ok(stats.total >= 4 && stats.onWhatsApp >= 1 && stats.notOnWhatsApp >= 1);
  });

  test("admins keep notes and tags; duplicates are refused; changes are audited", async () => {
    const cid = await idOf("+237652112233");
    const res = await t.api().patch(`/api/customers/${cid}`).set(bearer(s.admin)).send({ notes: "Prefers delivery in Bastos", tags: ["VIP", "vip", "Wholesale"] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.tags, ["vip", "wholesale"]);
    const dup = await t.api().patch(`/api/customers/${cid}`).set(bearer(s.admin)).send({ phone: "677445566" });
    assert.equal(dup.status, 400);
    const { rows } = await t.db.query("SELECT 1 FROM audit_logs WHERE action = 'customer.update' AND entity_id = $1", [String(cid)]);
    assert.equal(rows.length, 1);
    assert.deepEqual((await customers(s.admin, "?tag=vip")).body.data.map((c) => c.fullName), ["Mireille Fon"]);
  });

  test("CSV export, safe to open in Excel", async () => {
    await register({ fullName: "=HYPERLINK(evil)", phone: "699554433", password: "csv2026x" });
    const res = await t.api().get("/api/customers/export.csv").set(bearer(s.admin));
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/csv/);
    assert.match(res.text, /Name,Phone,Email,WhatsApp/);
    assert.ok(res.text.includes('Mireille Fon,"=""+237652112233"""'), "phone kept as text");
    assert.match(res.text, /'=HYPERLINK/, "formulas are neutralised");
  });

  test("a suspended customer can no longer log in", async () => {
    const cid = await idOf("+237699554433");
    await t.api().patch(`/api/customers/${cid}`).set(bearer(s.owner)).send({ status: "suspended" });
    assert.equal((await t.api().post("/api/auth/login").send({ login: "699554433", password: "csv2026x" })).status, 403);
  });
});

describe("WhatsApp messages from the system", () => {
  test("message one customer: template first, free text once they have replied (24 h window)", async () => {
    const cid = await idOf("+237652112233");
    const first = await t.api().post(`/api/customers/${cid}/message`).set(bearer(s.admin)).send({ text: "Your perfume is back in stock!" });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.mode, "template");
    assert.ok(sentWhatsApp.some((m) => m.kind === "template:customer_message" && m.to === "237652112233"));

    // the customer answers on WhatsApp
    await t.api().post("/api/whatsapp/mock/inbound").set(bearer(s.admin)).send({ phone: "+237652112233", text: "Great, I will come tomorrow" });
    const feed = (await t.api().get("/api/notifications").set(bearer(s.owner))).body.data;
    assert.ok(feed.some((n) => n.type === "whatsapp.in" && /Mireille Fon/.test(n.title)));

    const reply = await t.api().post(`/api/customers/${cid}/message`).set(bearer(s.admin)).send({ text: "See you tomorrow!" });
    assert.equal(reply.body.data.mode, "text");

    const detail = (await t.api().get(`/api/customers/${cid}`).set(bearer(s.admin))).body.data;
    assert.equal(detail.replyWindowOpen, true);
    const convo = detail.messages.filter((m) => ["message", "inbound"].includes(m.purpose)).map((m) => [m.direction, m.body]);
    assert.deepEqual(convo, [
      ["out", "Your perfume is back in stock!"],
      ["in", "Great, I will come tomorrow"],
      ["out", "See you tomorrow!"],
    ]);
    assert.equal(detail.messages.find((m) => m.body === "See you tomorrow!").sentBy, "Admin");
  });

  test("numbers not on WhatsApp and customers who opted out are skipped", async () => {
    const noWa = await idOf("+237677880000");
    const r1 = await t.api().post(`/api/customers/${noWa}/message`).set(bearer(s.admin)).send({ text: "Hello" });
    assert.equal(r1.body.data.status, "skipped");
    assert.match(r1.body.message, /not on WhatsApp/);
    const paul = await idOf("+237677445566");
    await t.api().patch(`/api/customers/${paul}`).set(bearer(s.admin)).send({ whatsappOptIn: false });
    const r2 = await t.api().post(`/api/customers/${paul}/message`).set(bearer(s.admin)).send({ text: "Hello" });
    assert.match(r2.body.message, /turned off WhatsApp/);
  });

  test("broadcast goes only to opted-in customers on WhatsApp, with a summary at the end", async () => {
    const preview = await t.api().get("/api/customers/broadcast/preview").set(bearer(s.admin));
    const expected = preview.body.data.recipients;
    assert.ok(expected >= 1);
    const before = sentWhatsApp.filter((m) => m.kind === "template:customer_message" || m.kind === "text").length;
    const res = await t.api().post("/api/customers/broadcast").set(bearer(s.admin)).send({ text: "Weekend promo: 10% off with code CHAFADIA10" });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.data.recipients, expected);
    await wait(500);
    const after = sentWhatsApp.filter((m) => m.kind === "template:customer_message" || m.kind === "text").length;
    assert.equal(after - before, expected);
    const feed = (await t.api().get("/api/notifications").set(bearer(s.admin))).body.data;
    assert.ok(feed.some((n) => n.type === "whatsapp.broadcast" && /sent/.test(n.message)));
    // only to a tag
    const vip = await t.api().get("/api/customers/broadcast/preview?tag=vip").set(bearer(s.admin));
    assert.equal(vip.body.data.recipients, 1);
  });

  test("cashiers cannot message customers", async () => {
    const cid = await idOf("+237652112233");
    assert.equal((await t.api().post(`/api/customers/${cid}/message`).set(bearer(s.cashier)).send({ text: "hi" })).status, 403);
    assert.equal((await t.api().post("/api/customers/broadcast").set(bearer(s.cashier)).send({ text: "hi all" })).status, 403);
  });
});
